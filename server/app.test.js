import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from './app.js';

const TEST_PASSWORD = 'test-only-password-5678';

async function start(t, options = {}) {
  const instance = createApp({ databasePath: ':memory:', adminPassword: undefined, production: false, ...options });
  const server = await new Promise((resolve) => {
    const server = instance.app.listen(0, '127.0.0.1', () => resolve(server));
  });
  const address = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const request = async (route, { method = 'GET', body, headers = {}, authenticated = true } = {}) => {
    const response = await fetch(`${address}${route}`, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(authenticated && cookie ? { Cookie: cookie } : {}), ...headers },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const newCookie = response.headers.get('set-cookie');
    if (newCookie) cookie = newCookie.split(';')[0];
    return response;
  };
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    instance.close();
  });
  return { ...instance, request };
}

async function setup(request) {
  const response = await request('/api/auth/setup', { method: 'POST', body: { password: TEST_PASSWORD } });
  assert.equal(response.status, 201);
  return response;
}

test('administrator setup, session cookies, login and logout protect writes', async (t) => {
  const { request } = await start(t);
  assert.deepEqual(await (await request('/api/auth/status')).json(), { authenticated: false, setupRequired: true });
  const sample = { name: 'Ada Member', title: 'Volunteer', month: 10, day: 28 };
  assert.equal((await request('/api/birthdays', { method: 'POST', body: sample })).status, 401);
  assert.equal((await request('/api/auth/setup', { method: 'POST', body: { password: 'short' } })).status, 400);
  const response = await setup(request);
  assert.match(response.headers.get('set-cookie'), /HttpOnly/);
  assert.match(response.headers.get('set-cookie'), /SameSite=Strict/);
  assert.deepEqual(await (await request('/api/auth/status')).json(), { authenticated: true, setupRequired: false });
  assert.equal((await request('/api/auth/setup', { method: 'POST', body: { password: TEST_PASSWORD } })).status, 403);
  assert.equal((await request('/api/auth/logout', { method: 'POST', body: {} })).status, 200);
  assert.equal((await request('/api/birthdays', { method: 'POST', body: sample })).status, 401);
  assert.equal((await request('/api/auth/login', { method: 'POST', body: { password: 'incorrect-password' } })).status, 401);
  assert.equal((await request('/api/auth/login', { method: 'POST', body: { password: TEST_PASSWORD } })).status, 200);
  assert.equal((await request('/api/birthdays', { method: 'POST', body: sample })).status, 201);
});

test('birthday CRUD validates month/day, trims input and protects private phone data', async (t) => {
  const { request } = await start(t);
  await setup(request);
  for (const invalid of [
    { name: '', month: 1, day: 1 },
    { name: 'X', month: 0, day: 1 },
    { name: 'X', month: 2, day: 30 },
    { name: 'X', month: 4, day: 31 },
    { name: 'X', month: 1.5, day: 3 },
    { name: 'X', month: '01', day: 3 },
    { name: 'X', title: 'a'.repeat(101), month: 1, day: 3 },
    { name: 'X', month: 1, day: 3, whatsappPhone: '08012345678' },
    { name: 'X', month: 1, day: 3, whatsappOptIn: true },
    { name: 'X', month: 1, day: 3, whatsappOptIn: 'true' },
  ]) {
    assert.equal((await request('/api/birthdays', { method: 'POST', body: invalid })).status, 400);
  }
  const response = await request('/api/birthdays', { method: 'POST', body: {
    name: '  Ada Member  ', title: ' Director ', month: 2, day: 29, whatsappPhone: '+2348012345678', whatsappOptIn: true,
  } });
  assert.equal(response.status, 201);
  const { birthday } = await response.json();
  assert.equal(birthday.name, 'Ada Member');
  assert.equal(birthday.title, 'Director');
  assert.equal(birthday.whatsappOptIn, true);
  assert.equal(birthday.hasWhatsapp, true);
  const privateRow = (await (await request('/api/birthdays')).json()).birthdays[0];
  assert.equal(privateRow.whatsappPhone, '+2348012345678');
  const publicRow = (await (await request('/api/birthdays', { authenticated: false })).json()).birthdays[0];
  assert.equal(publicRow.whatsappPhone, '');
  assert.equal(publicRow.whatsappOptIn, false);
  assert.equal(publicRow.hasWhatsapp, true);
  const updated = await request(`/api/birthdays/${birthday.id}`, { method: 'PUT', body: { name: 'Ada Updated', month: 12, day: 31 } });
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).birthday.name, 'Ada Updated');
  assert.equal((await request('/api/birthdays/missing', { method: 'PUT', body: { name: 'Ada', month: 1, day: 1 } })).status, 404);
  assert.equal((await request(`/api/birthdays/${birthday.id}`, { method: 'DELETE', body: {} })).status, 204);
  assert.deepEqual((await (await request('/api/birthdays')).json()).birthdays, []);
  assert.equal((await request(`/api/birthdays/${birthday.id}`, { method: 'DELETE', body: {} })).status, 404);
});

test('records and password survive reopening the database; sessions do not', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'impact23-api-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const databasePath = path.join(directory, 'birthdays.sqlite');
  const first = createApp({ databasePath, adminPassword: undefined, production: false });
  const server = await new Promise((resolve) => {
    const server = first.app.listen(0, '127.0.0.1', () => resolve(server));
  });
  const root = `http://127.0.0.1:${server.address().port}`;
  const auth = await fetch(`${root}/api/auth/setup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: TEST_PASSWORD }) });
  const cookie = auth.headers.get('set-cookie').split(';')[0];
  const created = await fetch(`${root}/api/birthdays`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ name: 'Persistent Member', month: 5, day: 4 }) });
  assert.equal(created.status, 201);
  await new Promise((resolve) => server.close(resolve));
  first.close();
  const second = await start(t, { databasePath });
  assert.deepEqual(await (await second.request('/api/auth/status', { headers: { Cookie: cookie } })).json(), { authenticated: false, setupRequired: false });
  assert.equal((await (await second.request('/api/birthdays')).json()).birthdays[0].name, 'Persistent Member');
  assert.equal((await second.request('/api/auth/login', { method: 'POST', body: { password: TEST_PASSWORD } })).status, 200);
});

test('cross-origin mutations and non-JSON mutations are blocked', async (t) => {
  const { request } = await start(t);
  assert.equal((await request('/api/auth/setup', { method: 'POST', body: { password: TEST_PASSWORD }, headers: { Origin: 'https://unrelated.example' } })).status, 403);
  assert.equal((await request('/api/auth/setup', { method: 'POST', body: { password: TEST_PASSWORD }, headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal((await request('/api/auth/setup', { method: 'POST', headers: { 'Content-Type': 'text/plain' } })).status, 415);
});

test('login throttling returns a retry interval', async (t) => {
  const { request } = await start(t, { adminPassword: TEST_PASSWORD });
  for (let i = 0; i < 10; i += 1) {
    assert.equal((await request('/api/auth/login', { method: 'POST', body: { password: 'no' } })).status, 401);
  }
  const limited = await request('/api/auth/login', { method: 'POST', body: { password: 'no' } });
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) > 0);
});

test('production requires a configured administrator password', () => {
  assert.throws(() => createApp({ databasePath: ':memory:', adminPassword: undefined, production: true }), /Configure ADMIN_PASSWORD/);
  assert.throws(() => createApp({ databasePath: ':memory:', adminPassword: 'short', production: true }), /at least|between 12/);
});

test('client UUIDs make offline create retries idempotent without overwriting conflicts', async (t) => {
  const { request } = await start(t);
  await setup(request);
  const body = { id: 'CAD3D0B1-6F90-431B-A781-3C5311AE9C91', name: '  Offline Member  ', title: 'Volunteer', month: 8, day: 19, whatsappPhone: '+2348012345678', whatsappOptIn: true };
  const created = await request('/api/birthdays', { method: 'POST', body });
  assert.equal(created.status, 201);
  const original = (await created.json()).birthday;
  assert.equal(original.id, body.id.toLowerCase());
  const retried = await request('/api/birthdays', { method: 'POST', body: { ...body, id: original.id, name: 'Offline Member' } });
  assert.equal(retried.status, 200);
  assert.deepEqual((await retried.json()).birthday, original);
  assert.equal((await (await request('/api/birthdays')).json()).birthdays.length, 1);
  for (const change of [{ name: 'Someone Else' }, { day: 20 }, { whatsappOptIn: false }, { whatsappPhone: '+2348012345679' }]) {
    const conflicting = await request('/api/birthdays', { method: 'POST', body: { ...body, ...change } });
    assert.equal(conflicting.status, 409);
  }
  assert.deepEqual((await (await request('/api/birthdays')).json()).birthdays, [original]);
  // An ID is not an authorization token; unauthenticated retries are forbidden.
  assert.equal((await request('/api/birthdays', { method: 'POST', body, authenticated: false })).status, 401);
});

test('client record IDs reject malformed, non-RFC and non-string UUIDs', async (t) => {
  const { request } = await start(t);
  await setup(request);
  for (const id of ['', 'not-a-uuid', null, 42, {}, 'cad3d0b1-6f90-031b-a781-3c5311ae9c91', 'cad3d0b1-6f90-431b-7781-3c5311ae9c91']) {
    assert.equal((await request('/api/birthdays', { method: 'POST', body: { id, name: 'Member', month: 1, day: 1 } })).status, 400);
  }
  assert.deepEqual((await (await request('/api/birthdays')).json()).birthdays, []);
});

test('service worker responses cannot be cached by the HTTP cache and manifest has its media type', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'impact23-static-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await Promise.all([
    writeFile(path.join(directory, 'index.html'), '<!doctype html><title>Impact23</title>'),
    writeFile(path.join(directory, 'sw.js'), 'self.addEventListener("fetch", () => {});'),
    writeFile(path.join(directory, 'manifest.webmanifest'), '{"name":"Impact23 Birthday Book"}'),
  ]);
  const { request } = await start(t, { distPath: directory });
  const worker = await request('/sw.js');
  assert.equal(worker.status, 200);
  assert.equal(worker.headers.get('cache-control'), 'no-store');
  assert.equal(worker.headers.get('service-worker-allowed'), '/');
  assert.match(worker.headers.get('content-type'), /javascript/);
  const manifest = await request('/manifest.webmanifest');
  assert.equal(manifest.status, 200);
  assert.match(manifest.headers.get('content-type'), /application\/manifest\+json/);
});

test('revision checks reject stale edits and deletes, while repeated identical edits are idempotent', async (t) => {
  const { request } = await start(t);
  await setup(request);
  const data = { name: 'Shared Member', title: 'Volunteer', month: 11, day: 8 };
  const created = (await (await request('/api/birthdays', { method: 'POST', body: data })).json()).birthday;
  assert.equal(created.revision, 1);
  const route = `/api/birthdays/${created.id}`;
  const edit = { ...data, title: 'Programme Lead', baseRevision: 1 };
  const changed = await request(route, { method: 'PUT', body: edit });
  assert.equal(changed.status, 200);
  const updated = (await changed.json()).birthday;
  assert.equal(updated.revision, 2);
  const repeated = await request(route, { method: 'PUT', body: edit });
  assert.equal(repeated.status, 200);
  assert.deepEqual((await repeated.json()).birthday, updated);
  const stale = await request(route, { method: 'PUT', body: { ...data, name: 'Stale Change', baseRevision: 1 } });
  assert.equal(stale.status, 409);
  assert.equal((await request(route, { method: 'DELETE', body: { baseRevision: 1 } })).status, 409);
  assert.deepEqual((await (await request('/api/birthdays')).json()).birthdays, [updated]);
  assert.equal((await request(route, { method: 'DELETE', body: { baseRevision: 2 } })).status, 204);
  assert.equal((await request(route, { method: 'DELETE', body: { baseRevision: 2 } })).status, 404);
  assert.equal((await request(route, { method: 'PUT', body: { ...edit, baseRevision: 2 } })).status, 404);
});

test('legacy edits without a revision still work and invalid revisions are rejected', async (t) => {
  const { request } = await start(t);
  await setup(request);
  const data = { name: 'Legacy Member', month: 6, day: 5 };
  const original = (await (await request('/api/birthdays', { method: 'POST', body: data })).json()).birthday;
  const route = `/api/birthdays/${original.id}`;
  for (const baseRevision of [0, -1, 1.5, '1', null, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal((await request(route, { method: 'PUT', body: { ...data, baseRevision } })).status, 400);
    assert.equal((await request(route, { method: 'DELETE', body: { baseRevision } })).status, 400);
  }
  const changed = await request(route, { method: 'PUT', body: { ...data, name: 'Legacy Updated' } });
  assert.equal(changed.status, 200);
  assert.equal((await changed.json()).birthday.revision, 2);
  const repeated = await request(route, { method: 'PUT', body: { ...data, name: 'Legacy Updated' } });
  assert.equal((await repeated.json()).birthday.revision, 2);
  assert.equal((await request(route, { method: 'DELETE', body: {} })).status, 204);
});

test('existing SQLite records migrate to revision one without losing their details', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'impact23-migration-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const databasePath = path.join(directory, 'birthdays.sqlite');
  const legacy = new DatabaseSync(databasePath);
  legacy.exec(`CREATE TABLE birthdays (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, title TEXT NOT NULL DEFAULT '',
    month INTEGER NOT NULL, day INTEGER NOT NULL, whatsappPhone TEXT NOT NULL DEFAULT '',
    whatsappOptIn INTEGER NOT NULL DEFAULT 0, createdAt TEXT NOT NULL
  )`);
  const id = '97746de0-49a9-48c3-9a09-859b72fd73e1';
  legacy.prepare('INSERT INTO birthdays VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, 'Existing Member', 'Trustee', 2, 29, '+2348012345678', 1, '2026-10-28T12:00:00.000Z');
  legacy.close();
  const { request } = await start(t, { databasePath });
  await setup(request);
  const [birthday] = (await (await request('/api/birthdays')).json()).birthdays;
  assert.deepEqual(birthday, {
    id, name: 'Existing Member', title: 'Trustee', month: 2, day: 29,
    whatsappPhone: '+2348012345678', whatsappOptIn: true, hasWhatsapp: true,
    createdAt: '2026-10-28T12:00:00.000Z', revision: 1,
  });
  const changed = await request(`/api/birthdays/${id}`, { method: 'PUT', body: { ...birthday, title: 'Chair', baseRevision: 1 } });
  assert.equal(changed.status, 200);
  assert.equal((await changed.json()).birthday.revision, 2);
});
