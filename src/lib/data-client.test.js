import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto, randomUUID } from 'node:crypto';
import { createDataClient, validateRecord } from './data-client.js';

const PASSWORD = 'standalone-test-password-5678';
const sample = { name: 'Test Member', title: 'Volunteer', month: 10, day: 29, whatsappPhone: '+2348012345678', whatsappOptIn: true };
const copy = value => JSON.parse(JSON.stringify(value));
const options = (method, body = {}) => ({ method, body: JSON.stringify(body) });

function memoryStorage() {
  const values = new Map();
  return {
    fail: false, failWhen: null,
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { if (this.fail || this.failWhen?.(JSON.parse(value))) throw new Error('quota exceeded'); values.set(key, value); },
    dump() { return [...values.values()].join('\n'); },
  };
}

function fakeServer(initial = []) {
  const server = { authenticated: true, offline: false, losePostResponse: false, failBirthdayReads: 0, records: new Map(initial.map(row => [row.id, copy(row)])), calls: [] };
  const response = (status, body) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  server.fetch = async (url, config = {}) => {
    const path = url.replace(/^\/api/, ''), method = config.method || 'GET';
    server.calls.push({ path, method });
    if (server.offline) throw new TypeError('network unavailable');
    if (path === '/auth/status') return response(200, { authenticated: server.authenticated, setupRequired: false });
    if (path === '/auth/login' || path === '/auth/setup') { server.authenticated = true; return response(200, { authenticated: true, setupRequired: false }); }
    if (path === '/auth/logout') { server.authenticated = false; return response(200, { authenticated: false }); }
    if (path === '/reminders/status') return response(200, { whatsapp: { configured: false, missing: [] } });
    if (path === '/birthdays' && method === 'GET') {
      if (server.failBirthdayReads) { server.failBirthdayReads--; return response(503, { error: 'Server record temporarily unavailable' }); }
      return response(200, { birthdays: [...server.records.values()].map(row => server.authenticated ? row : { ...row, whatsappPhone: '', whatsappOptIn: false }) });
    }
    if (!server.authenticated) return response(401, { error: 'Sign in again' });
    const body = JSON.parse(config.body || '{}');
    const id = method === 'POST' ? body.id : path.split('/').at(-1);
    const existing = server.records.get(id);
    const data = method === 'DELETE' ? null : validateRecord(body);
    const same = existing && data && Object.entries(data).every(([name, value]) => existing[name] === value);
    if (method === 'POST') {
      if (existing) return same ? response(200, { birthday: existing }) : response(409, { error: 'Conflicting record ID' });
      const birthday = { ...data, id, revision: 1, createdAt: '2026-10-29T08:00:00.000Z', hasWhatsapp: Boolean(data.whatsappPhone && data.whatsappOptIn) };
      server.records.set(id, birthday);
      if (server.losePostResponse) { server.losePostResponse = false; throw new TypeError('response lost after commit'); }
      return response(201, { birthday });
    }
    if (!existing) return response(404, { error: 'Record deleted' });
    if (method === 'PUT' && same) return response(200, { birthday: existing });
    if (body.baseRevision !== existing.revision) return response(409, { error: 'Changed on another device' });
    if (method === 'DELETE') { server.records.delete(id); return response(204); }
    const birthday = { ...existing, ...data, revision: existing.revision + 1, hasWhatsapp: Boolean(data.whatsappPhone && data.whatsappOptIn) };
    server.records.set(id, birthday);
    return response(200, { birthday });
  };
  return server;
}

function client(server, storage = memoryStorage(), extra = {}) {
  return createDataClient({ storage, fetchImpl: server.fetch, cryptoImpl: webcrypto, locks: null, ...extra });
}

test('invalid local dates are rejected before records or pending changes are saved', async () => {
  const server = fakeServer(), storage = memoryStorage(), app = client(server, storage);
  await app.request('/auth/status');
  const saved = storage.dump();
  await assert.rejects(app.request('/birthdays', options('POST', { ...sample, month: 4, day: 31 })), { status: 400 });
  assert.equal(storage.dump(), saved);
  assert.equal(app.getState().records.length, 0);
  assert.equal(server.calls.filter(call => call.method === 'POST').length, 0);
  assert.equal(validateRecord({ ...sample, month: 2, day: 29 }).day, 29);
});

test('storage quota failure preserves the last snapshot and never sends an unsaved mutation', async () => {
  const server = fakeServer(), storage = memoryStorage(), app = client(server, storage);
  await app.request('/auth/status');
  const saved = storage.dump();
  storage.fail = true;
  await assert.rejects(app.request('/birthdays', options('POST', sample)), /could not save/);
  assert.equal(storage.dump(), saved);
  assert.equal(app.getState().pendingCount, 0);
  assert.equal(app.getState().records.length, 0);
  assert.equal(server.records.size, 0);
});

test('a lost create response replays the same UUID and never duplicates the server birthday', async () => {
  const server = fakeServer(), app = client(server);
  await app.request('/auth/status');
  server.losePostResponse = true;
  const local = (await app.request('/birthdays', options('POST', sample))).birthday;
  assert.equal(app.getState().pendingCount, 1);
  assert.equal(server.records.size, 1);
  await app.sync();
  assert.equal(app.getState().pendingCount, 0);
  assert.equal(server.records.size, 1);
  assert.equal(app.getState().records[0].id, local.id);
  assert.equal(server.calls.filter(call => call.path === '/birthdays' && call.method === 'POST').length, 2);
});

test('quota failure after server acknowledgement retains a safely replayable pending operation', async () => {
  const server = fakeServer(), storage = memoryStorage(), app = client(server, storage);
  await app.request('/auth/status');
  app.setOnline(false);
  await app.request('/birthdays', options('POST', sample));
  storage.failWhen = next => next.pending.length === 0;
  await app.sync();
  assert.equal(server.records.size, 1);
  assert.equal(app.getState().pendingCount, 1);
  assert.match(app.getState().error, /could not save/);
  storage.failWhen = null;
  await app.sync();
  assert.equal(app.getState().pendingCount, 0);
  assert.equal(server.records.size, 1);
});

test('a durable online save still succeeds locally if its sync acknowledgement hits storage quota', async () => {
  const server = fakeServer(), storage = memoryStorage(), app = client(server, storage);
  await app.request('/auth/status');
  storage.failWhen = next => next.pending.length === 0;
  const result = await app.request('/birthdays', options('POST', sample));
  assert.equal(result.birthday.name, sample.name);
  assert.equal(app.getState().pendingCount, 1);
  assert.equal(server.records.size, 1);
  assert.match(app.getState().error, /could not save/);
  storage.failWhen = null;
  await app.sync();
  assert.equal(app.getState().pendingCount, 0);
  assert.equal(server.records.size, 1);
});

test('expired server authorization keeps offline edits until successful login', async () => {
  const server = fakeServer(), app = client(server);
  await app.request('/auth/status');
  server.authenticated = false;
  await app.request('/birthdays', options('POST', sample));
  assert.equal(app.getState().pendingCount, 1);
  assert.equal(app.getState().needsLogin, true);
  assert.equal(app.getState().adminUnlocked, true);
  await app.sync();
  assert.equal(app.getState().pendingCount, 1);
  assert.equal(server.records.size, 0);
  await app.request('/auth/login', options('POST', { password: PASSWORD }));
  assert.equal(app.getState().pendingCount, 0);
  assert.equal(app.getState().needsLogin, false);
  assert.equal(server.records.size, 1);
});

test('explicit offline logout stays locked after reload and revokes the old cookie before refresh', async () => {
  const row = { ...sample, id: randomUUID(), revision: 1 };
  const server = fakeServer([row]), storage = memoryStorage(), app = client(server, storage);
  await app.request('/auth/status');
  server.offline = true;
  app.setOnline(false);
  await app.request('/auth/logout', options('POST'));
  assert.equal(app.getState().deferredLogout, true);
  assert.equal(app.getState().adminUnlocked, false);
  assert.equal(app.getState().records[0].whatsappPhone, '');
  assert.equal(server.authenticated, true);
  const reopened = client(server, storage);
  assert.equal((await reopened.request('/auth/status')).authenticated, false);
  assert.equal(reopened.getState().deferredLogout, true);
  server.offline = false;
  const start = server.calls.length;
  await reopened.sync();
  assert.equal(server.calls[start].path, '/auth/logout');
  assert.equal(server.calls[start + 1].path, '/auth/status');
  assert.equal(server.authenticated, false);
  assert.equal(reopened.getState().adminUnlocked, false);
  assert.equal(reopened.getState().deferredLogout, false);
  await assert.rejects(reopened.request('/birthdays', options('POST', sample)), { status: 401 });
});

test('unknown conflict reads retain the queue; resolution uses the newest local edit', async () => {
  const row = { ...sample, id: randomUUID(), revision: 1 };
  const server = fakeServer([row]), app = client(server);
  await app.request('/auth/status');
  server.records.set(row.id, { ...row, title: 'Remote Chair', revision: 2 });
  server.failBirthdayReads = 1;
  await app.request(`/birthdays/${row.id}`, options('PUT', { ...sample, title: 'Local First' }));
  assert.equal(app.getState().pendingCount, 1);
  assert.equal(app.getState().conflict.serverKnown, false);
  await app.request(`/birthdays/${row.id}`, options('PUT', { ...sample, title: 'Local Latest' }));
  assert.equal(app.getState().conflict.localRecord.title, 'Local Latest');
  assert.equal(app.getState().pendingCount, 2);
  await assert.rejects(app.resolveConflict('local'), /Reconnect/);
  assert.equal(app.getState().pendingCount, 2);
  assert.equal(server.records.get(row.id).title, 'Remote Chair');
  await app.sync();
  assert.equal(app.getState().conflict.serverKnown, true);
  await app.resolveConflict('local');
  assert.equal(server.records.get(row.id).title, 'Local Latest');
  assert.equal(server.records.get(row.id).revision, 3);
  assert.equal(app.getState().pendingCount, 0);
  assert.equal(app.getState().conflict, null);
});

test('choosing the known server version drops local edits without overwriting remote data', async () => {
  const row = { ...sample, id: randomUUID(), revision: 1 };
  const server = fakeServer([row]), app = client(server);
  await app.request('/auth/status');
  server.records.set(row.id, { ...row, title: 'Remote Chair', revision: 2 });
  await app.request(`/birthdays/${row.id}`, options('PUT', { ...sample, title: 'Local First' }));
  await app.resolveConflict('server');
  assert.equal(app.getState().records[0].title, 'Remote Chair');
  assert.equal(app.getState().pendingCount, 0);
  assert.equal(server.records.get(row.id).revision, 2);
});

test('shared Web Locks serialize two tabs and storage events refresh subscribers', { timeout: 5000 }, async () => {
  let tail = Promise.resolve(), active = 0, maximum = 0;
  const locks = { request(_name, task) { const next = tail.then(async () => { maximum = Math.max(maximum, ++active); try { return await task(); } finally { active--; } }); tail = next.catch(() => {}); return next; } };
  const server = fakeServer(), storage = memoryStorage(), events = new EventTarget();
  const a = client(server, storage, { locks, eventTarget: events }), b = client(server, storage, { locks, eventTarget: events });
  await Promise.all([a.request('/birthdays', options('POST', { ...sample, name: 'Tab A Member' })), b.request('/birthdays', options('POST', { ...sample, name: 'Tab B Member' }))]);
  assert.equal(server.records.size, 2);
  let received;
  b.subscribe(value => { received = value; });
  events.dispatchEvent(Object.assign(new Event('storage'), { key: 'impact23-offline-v1' }));
  await a.request('/birthdays');
  await b.request('/birthdays');
  assert.equal(a.getState().records.length, 2);
  assert.equal(received.records.length, 2);
  assert.equal(maximum, 1);
  assert.equal(a.getState().crossTabSafe, true);
  a.dispose(); b.dispose();
});

test('per-tab serialization remains usable when Web Locks are unavailable', async () => {
  const server = fakeServer(), app = client(server);
  await Promise.all([app.request('/birthdays', options('POST', { ...sample, name: 'A' })), app.request('/birthdays', options('POST', { ...sample, name: 'B' }))]);
  assert.equal(app.getState().records.length, 2);
  assert.equal(app.getState().crossTabSafe, false);
});

test('standalone login hashes passwords, never uses the network and preserves contacts across logout', async () => {
  const storage = memoryStorage();
  let networkCalls = 0;
  const app = createDataClient({ storage, standalone: true, cryptoImpl: webcrypto, fetchImpl: async () => { networkCalls++; throw new Error('must not call'); } });
  await app.request('/auth/setup', options('POST', { password: PASSWORD }));
  const birthday = (await app.request('/birthdays', options('POST', sample))).birthday;
  assert.equal(storage.dump().includes(PASSWORD), false);
  const saved = JSON.parse(storage.getItem('impact23-preview-v1'));
  assert.equal(saved.credential.hash.length, 32);
  assert.equal(saved.credential.salt.length, 16);
  assert.equal(app.exportBackup().birthdays[0].whatsappPhone, sample.whatsappPhone);
  assert.equal('credential' in app.exportBackup(), false);
  await app.request('/auth/logout', options('POST'));
  assert.equal(app.getState().records[0].whatsappPhone, '');
  await assert.rejects(app.request('/auth/login', options('POST', { password: 'incorrect-password' })), { status: 401 });
  await app.request('/auth/login', options('POST', { password: PASSWORD }));
  assert.equal(app.getState().records[0].id, birthday.id);
  assert.equal(app.getState().records[0].whatsappPhone, sample.whatsappPhone);
  assert.equal(networkCalls, 0);
});

test('pending edits require backup confirmation before sign-out and remain exportable', async () => {
  const server = fakeServer(), app = client(server);
  await app.request('/auth/status');
  app.setOnline(false);
  await app.request('/birthdays', options('POST', sample));
  await assert.rejects(app.request('/auth/logout', options('POST')), { status: 428 });
  assert.equal(app.getState().adminUnlocked, true);
  assert.equal(app.getState().pendingCount, 1);
  assert.equal(app.exportBackup().birthdays[0].whatsappPhone, sample.whatsappPhone);
  await app.backupAndSignOut();
  assert.equal(app.getState().pendingCount, 0);
  assert.equal(app.getState().deferredLogout, true);
  assert.equal(app.getState().adminUnlocked, false);
  assert.equal(app.getState().records[0].name, sample.name);
});

test('backup import validates all records atomically and never silently overwrites a different version', async () => {
  const storage = memoryStorage();
  const app = createDataClient({ storage, standalone: true, cryptoImpl: webcrypto });
  await app.request('/auth/setup', options('POST', { password: PASSWORD }));
  await app.request('/birthdays', options('POST', sample));
  const backup = app.exportBackup(), saved = storage.dump();
  const newRow = { ...sample, id: randomUUID(), name: 'Imported Member' };
  await assert.rejects(app.importBackup({ ...backup, birthdays: [newRow, { ...backup.birthdays[0], title: 'Different Title' }] }), { status: 409 });
  assert.equal(storage.dump(), saved);
  await assert.rejects(app.importBackup({ ...backup, birthdays: [{ ...newRow, month: 4, day: 31 }] }), { status: 400 });
  assert.equal(storage.dump(), saved);
  assert.deepEqual(await app.importBackup({ ...backup, birthdays: [newRow] }), { imported: 1 });
  assert.deepEqual(await app.importBackup({ ...backup, birthdays: [newRow] }), { imported: 0 });
  assert.equal(app.getState().records.length, 2);
});
