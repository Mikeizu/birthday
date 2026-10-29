import { test, expect } from '@playwright/test';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

const PASSWORD = 'Impact23-offline-test-password';

async function records(page) {
  // Playwright's API context is intentionally outside browser network
  // emulation, so it can verify that offline edits have not reached the server.
  const response = await page.request.get('/api/birthdays');
  expect(response.ok()).toBeTruthy();
  return (await response.json()).birthdays;
}

async function openDirectory(page) {
  await page.locator('.sidebar').getByRole('button', { name: 'Birthday directory', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'The people behind our impact.' })).toBeVisible();
}

async function signIn(page, { add = false } = {}) {
  await expect(page.getByRole('button', { name: 'Add birthday', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: add ? 'Add birthday' : 'Admin sign in', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  if (await dialog.getByLabel('Create password', { exact: true }).count()) {
    await dialog.getByLabel('Create password', { exact: true }).fill(PASSWORD);
    await dialog.getByLabel('Confirm password', { exact: true }).fill(PASSWORD);
    await dialog.getByRole('button', { name: 'Create admin account', exact: true }).click();
  } else {
    await dialog.getByLabel('Admin password', { exact: true }).fill(PASSWORD);
    await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
  }
  if (add) await expect(dialog.getByRole('heading', { name: 'Someone special to celebrate.' })).toBeVisible();
  else await expect(dialog).toHaveCount(0);
}

async function fillBirthday(page, { name, title = 'Offline test volunteer', month = '10', day = '29', phone } = {}) {
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Full name').fill(name);
  await dialog.getByLabel('Title / role').fill(title);
  await dialog.getByLabel('Birth month').selectOption(month);
  await dialog.getByRole('spinbutton', { name: /^Day/ }).fill(day);
  if (phone) {
    await dialog.locator('summary').filter({ hasText: 'WhatsApp birthday greeting' }).click();
    await dialog.getByLabel('WhatsApp number').fill(phone);
    await dialog.getByRole('checkbox').check();
  }
  await dialog.getByRole('button', { name: 'Save birthday', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

async function addBirthday(page, data) {
  await page.getByRole('button', { name: 'Add birthday', exact: true }).click();
  await fillBirthday(page, data);
}

async function waitForOfflineShell(page) {
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker?.controller)), { timeout: 20_000 }).toBe(true);
  const requests = await page.evaluate(async () => {
    const keys = (await caches.keys()).filter(key => key.startsWith('impact23-shell-'));
    if (!keys.length) return [];
    return (await Promise.all(keys.map(async key => (await (await caches.open(key)).keys()).map(request => request.url)))).flat();
  });
  expect(requests.some(url => new URL(url).pathname === '/index.html')).toBeTruthy();
  expect(requests.some(url => new URL(url).pathname.startsWith('/assets/'))).toBeTruthy();
  expect(requests.some(url => new URL(url).pathname.startsWith('/api/'))).toBeFalsy();
}

async function editTitle(page, name, title) {
  await page.getByRole('button', { name: `Edit ${name}`, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Title / role').fill(title);
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

async function deleteBirthday(page, name) {
  await page.getByRole('button', { name: `Delete ${name}`, exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove birthday', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test('installed shell reloads offline and durable admin edits sync exactly once when reconnected', async ({ page, context }) => {
  const browserErrors = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Add birthday', exact: true })).toBeEnabled();
  await signIn(page, { add: true });
  await fillBirthday(page, { name: 'Offline Original Member', title: 'Before the connection dropped' });
  await addBirthday(page, { name: 'Offline Removed Member', day: '30' });
  await waitForOfflineShell(page);
  const originalServerRecords = await records(page);
  expect(originalServerRecords.filter(person => person.name.startsWith('Offline '))).toHaveLength(2);

  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('sync-status')).toContainText(/offline|on this device/i);
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
  await openDirectory(page);
  await expect(page.locator('.person-row').filter({ hasText: 'Offline Original Member' })).toBeVisible();
  await editTitle(page, 'Offline Original Member', 'Updated without internet');
  await deleteBirthday(page, 'Offline Removed Member');
  await addBirthday(page, { name: 'Offline Added Member', month: '2', day: '29' });
  await openDirectory(page);
  await editTitle(page, 'Offline Added Member', 'Created and edited offline');
  await expect(page.getByTestId('sync-status')).toContainText(/sync|pending|waiting/i);
  expect(await records(page)).toEqual(originalServerRecords);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await openDirectory(page);
  await expect(page.locator('.person-row').filter({ hasText: 'Offline Original Member' })).toContainText('Updated without internet');
  await expect(page.locator('.person-row').filter({ hasText: 'Offline Added Member' })).toContainText('Created and edited offline');
  await expect(page.locator('.person-row').filter({ hasText: 'Offline Removed Member' })).toHaveCount(0);
  await page.screenshot({ path: '/tmp/impact23-offline-directory.png', fullPage: true, animations: 'disabled' });
  await page.locator('.sidebar').getByRole('button', { name: 'Calendar', exact: true }).click();
  await expect(page.locator('.calendar-grid')).toBeVisible();

  await context.setOffline(false);
  await expect.poll(async () => (await records(page)).filter(person => person.name.startsWith('Offline ')).map(person => ({ name: person.name, title: person.title })).sort((a, b) => a.name.localeCompare(b.name))).toEqual([
    { name: 'Offline Added Member', title: 'Created and edited offline' },
    { name: 'Offline Original Member', title: 'Updated without internet' },
  ]);
  await page.reload();
  await openDirectory(page);
  await expect(page.locator('.person-row').filter({ hasText: 'Offline Added Member' })).toHaveCount(1);
  await context.setOffline(true);
  await context.setOffline(false);
  await expect.poll(async () => (await records(page)).filter(person => person.name.startsWith('Offline ')).length).toBe(2);
  expect(browserErrors).toEqual([]);
  await deleteBirthday(page, 'Offline Added Member');
  await deleteBirthday(page, 'Offline Original Member');
});

test('expired server login keeps pending changes until admin signs in again', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Admin sign in', exact: true })).toBeVisible();
  await signIn(page);
  await addBirthday(page, { name: 'Session Waiting Member', title: 'Original server version' });
  await waitForOfflineShell(page);
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await openDirectory(page);
  await editTitle(page, 'Session Waiting Member', 'Preserved pending update');

  const logout = await page.request.post('/api/auth/logout', { data: {} });
  expect(logout.ok()).toBeTruthy();
  await context.setOffline(false);
  await expect(page.getByTestId('sync-status')).toContainText(/sign in/i);
  expect((await records(page)).find(person => person.name === 'Session Waiting Member').title).toBe('Original server version');
  await page.getByRole('button', { name: /sign in.*sync/i }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Admin password', { exact: true }).fill(PASSWORD);
  await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(async () => (await records(page)).find(person => person.name === 'Session Waiting Member')?.title).toBe('Preserved pending update');
  await openDirectory(page);
  await deleteBirthday(page, 'Session Waiting Member');
});

test('an offline edit cannot silently overwrite a newer server version', async ({ page, context }) => {
  await page.goto('/');
  await signIn(page);
  await addBirthday(page, { name: 'Conflict Review Member', title: 'Original shared version' });
  await waitForOfflineShell(page);
  await context.setOffline(true);
  await openDirectory(page);
  await editTitle(page, 'Conflict Review Member', 'Version saved on this device');

  const serverRecord = (await records(page)).find(person => person.name === 'Conflict Review Member');
  const changedElsewhere = await page.request.put(`/api/birthdays/${serverRecord.id}`, {
    data: {
      name: serverRecord.name,
      title: 'Newer server version from another admin',
      month: serverRecord.month,
      day: serverRecord.day,
      whatsappPhone: '',
      whatsappOptIn: false,
      baseRevision: serverRecord.revision,
    },
  });
  expect(changedElsewhere.ok()).toBeTruthy();
  await context.setOffline(false);
  await expect(page.getByTestId('sync-status')).toContainText(/review changes/i);
  expect((await records(page)).find(person => person.id === serverRecord.id).title).toBe('Newer server version from another admin');

  await page.getByRole('button', { name: 'Review changes', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Version saved on this device');
  await expect(dialog).toContainText('Newer server version from another admin');
  await dialog.getByRole('button', { name: 'Keep device version', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(async () => (await records(page)).find(person => person.id === serverRecord.id)?.title).toBe('Version saved on this device');
  await page.reload();
  await openDirectory(page);
  await expect(page.locator('.person-row').filter({ hasText: 'Conflict Review Member' })).toContainText('Version saved on this device');
  await deleteBirthday(page, 'Conflict Review Member');
});

test('explicit offline sign-out stays signed out after reconnect and clears cached contact details', async ({ page, context }) => {
  const phone = '+2348000000002';
  await page.goto('/');
  await signIn(page);
  await addBirthday(page, { name: 'Logout Privacy Member', phone });
  await waitForOfflineShell(page);
  expect((await records(page)).find(person => person.name === 'Logout Privacy Member').whatsappPhone).toBe(phone);
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Admin sign in', exact: true })).toBeVisible();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Admin sign in', exact: true })).toBeVisible();
  await openDirectory(page);
  await expect(page.getByRole('button', { name: 'Edit Logout Privacy Member', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => Object.values(localStorage).join(''))).not.toContain(phone);

  await context.setOffline(false);
  await expect.poll(async () => (await (await page.request.get('/api/auth/status')).json()).authenticated).toBe(false);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Admin sign in', exact: true })).toBeVisible();
  expect((await records(page)).find(person => person.name === 'Logout Privacy Member').whatsappPhone).toBe('');
  await signIn(page);
  await openDirectory(page);
  expect((await records(page)).find(person => person.name === 'Logout Privacy Member').whatsappPhone).toBe(phone);
  await deleteBirthday(page, 'Logout Privacy Member');
});

test('standalone HTML preview works offline without API or asset requests', async ({ page, context }) => {
  const requests = [];
  const errors = [];
  const previewUrl = 'https://impact23-preview.test/preview.html';
  const html = await readFile(path.resolve('preview.html'), 'utf8');
  // This environment's managed Chromium blocks all file:// navigation before
  // page scripts run (ERR_BLOCKED_BY_ADMINISTRATOR). Fulfill the unmodified
  // HTML from memory instead; no server, API, or asset request can be used.
  await context.route('**/*', async route => {
    if (route.request().isNavigationRequest() && route.request().url() === previewUrl) {
      await route.fulfill({ status: 200, contentType: 'text/html', body: html });
    } else {
      await route.abort('internetdisconnected');
    }
  });
  page.on('request', request => {
    if (/^https?:/.test(request.url()) && !(request.resourceType() === 'document' && request.url() === previewUrl)) requests.push(request.url());
  });
  page.on('pageerror', error => errors.push(error.message));
  await context.setOffline(true);
  await page.goto(previewUrl);
  await expect(page.getByRole('heading', { name: 'A little joy. For every birthday.' })).toBeVisible();
  await expect(page.getByTestId('sync-status')).toContainText(/preview|local|device/i);
  await signIn(page, { add: true });
  await fillBirthday(page, { name: 'Standalone Preview Member', title: 'Stored on this device' });
  await openDirectory(page);
  await editTitle(page, 'Standalone Preview Member', 'Edited without a server');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await openDirectory(page);
  await expect(page.locator('.person-row').filter({ hasText: 'Standalone Preview Member' })).toContainText('Edited without a server');
  await page.screenshot({ path: '/tmp/impact23-html-preview.png', fullPage: true, animations: 'disabled' });
  await deleteBirthday(page, 'Standalone Preview Member');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await openDirectory(page);
  await expect(page.locator('.person-row')).toHaveCount(0);
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
});
