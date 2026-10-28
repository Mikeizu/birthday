import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
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
