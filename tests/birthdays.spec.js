import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const PASSWORD = 'Impact23-test-admin-2026';
const NAME = 'E2E Ada Member';
const PHONE = '+2348000000001';

async function records(page) {
  const response = await page.request.get('/api/birthdays');
  expect(response.ok()).toBeTruthy();
  return (await response.json()).birthdays;
}

async function openDirectory(page) {
  await page.locator('.sidebar').getByRole('button', { name: 'Birthday directory', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'The people behind our impact.' })).toBeVisible();
}

test('admin can create, find, edit, export and remove persistent birthday records', async ({ page }) => {
  const browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Add birthday', exact: true })).toBeEnabled();
  expect(await records(page)).toEqual([]);

  await page.getByRole('button', { name: /explore a sample birthday book/i }).click();
  await expect(page.getByText('You’re exploring sample birthdays.', { exact: false })).toBeVisible();
  await expect(page.locator('.person-row')).toHaveCount(6);
  expect(await records(page)).toEqual([]);
  await page.screenshot({ path: '/tmp/impact23-desktop.png', fullPage: true });
  await page.getByRole('button', { name: /Exit sample view/ }).click();

  // The initial Add action takes a first admin through setup, then into the form.
  await page.getByRole('button', { name: 'Add birthday', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'A home for your birthday book.' })).toBeVisible();
  await dialog.getByLabel('Create password').fill(PASSWORD);
  await dialog.getByLabel('Confirm password').fill(PASSWORD);
  await dialog.getByRole('button', { name: 'Create admin account' }).click();
  await expect(dialog.getByRole('heading', { name: 'Someone special to celebrate.' })).toBeVisible();

  await dialog.getByLabel('Full name').fill(NAME);
  await dialog.getByLabel('Title / role').fill('E2E Foundation Volunteer');
  await dialog.getByLabel('Birth month').selectOption('4');
  await dialog.getByRole('spinbutton', { name: /^Day/ }).fill('31');
  await dialog.locator('summary').filter({ hasText: 'WhatsApp birthday greeting' }).click();
  await dialog.getByLabel('WhatsApp number').fill(PHONE);
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Save birthday' }).click();
  await expect(dialog.getByRole('alert')).toContainText('valid birthday');
  expect(await records(page)).toEqual([]);
  await dialog.getByLabel('Birth month').selectOption('12');
  await dialog.getByRole('spinbutton', { name: /^Day/ }).fill('25');
  await dialog.getByRole('button', { name: 'Save birthday' }).click();
  await expect(dialog).toHaveCount(0);
  const saved = await records(page);
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ name: NAME, title: 'E2E Foundation Volunteer', month: 12, day: 25, whatsappPhone: PHONE, whatsappOptIn: true });

  await openDirectory(page);
  await expect(page.locator('.person-row')).toHaveCount(1);
  await expect(page.locator('.person-row')).toContainText(NAME);
  await page.getByRole('searchbox', { name: 'Search names or titles' }).fill('not a member');
  await expect(page.getByRole('heading', { name: 'No birthdays found' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await page.getByRole('searchbox', { name: 'Search names or titles' }).fill('Foundation Volunteer');
  await expect(page.locator('.person-row')).toHaveCount(1);
  await page.getByLabel('Filter by month').selectOption('4');
  await expect(page.locator('.person-row')).toHaveCount(0);
  await page.getByLabel('Filter by month').selectOption('12');
  await expect(page.locator('.person-row')).toHaveCount(1);
  await page.getByRole('searchbox', { name: 'Search names or titles' }).fill('');
  await page.getByRole('button', { name: `Edit ${NAME}` }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('WhatsApp number')).toHaveValue(PHONE);
  await expect(dialog.getByRole('checkbox')).toBeChecked();
  await dialog.getByLabel('Title / role').fill('E2E Programme Lead');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.person-row')).toContainText('E2E Programme Lead');

  await page.reload();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await openDirectory(page);
  await expect(page.locator('.person-row')).toContainText('E2E Programme Lead');
  expect((await records(page))[0]).toMatchObject({ month: 12, day: 25, whatsappPhone: PHONE, whatsappOptIn: true });

  await page.locator('.sidebar').getByRole('button', { name: 'Overview', exact: true }).click();
  await page.getByRole('button', { name: /View December: 1 birthdays/ }).click();
  await expect(page.locator('.calendar-toolbar h2')).toContainText('December');
  await expect(page.locator('.calendar-event')).toContainText(NAME);
  await page.getByRole('button', { name: 'Next calendar month' }).click();
  await expect(page.locator('.calendar-toolbar h2')).toContainText('January');
  await page.getByRole('button', { name: 'Previous calendar month' }).click();
  await expect(page.locator('.calendar-event')).toContainText(NAME);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Add birthdays to your calendar' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('impact23-birthdays.ics');
  const ics = await readFile(await download.path(), 'utf8');
  expect(ics).toContain('BEGIN:VCALENDAR');
  expect(ics).toContain('DTSTART;VALUE=DATE:20001225');
  expect(ics).toContain('RRULE:FREQ=YEARLY');
  expect(ics).toContain('TRIGGER:-P1D');
  expect(ics).toContain(`${NAME}'s birthday`);

  await page.locator('.sidebar').getByRole('button', { name: 'Reminders', exact: true }).click();
  await expect(page.getByText('Setup needed', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('button', { name: 'Admin sign in' })).toBeVisible();
  expect((await records(page))[0]).toMatchObject({ whatsappPhone: '', whatsappOptIn: false });
  const forbidden = await page.request.post('/api/birthdays', { data: { name: 'Unauthorized', month: 1, day: 1 } });
  expect(forbidden.status()).toBe(401);

  await page.getByRole('button', { name: 'Add birthday', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Admin password').fill(PASSWORD);
  await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Someone special to celebrate.' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await openDirectory(page);
  await page.getByRole('button', { name: `Delete ${NAME}` }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove birthday' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await records(page)).toEqual([]);
  await expect(page.getByRole('heading', { name: 'Make room for your people' })).toBeVisible();
  expect(browserErrors).toEqual([]);
});

test('mobile navigation, sample records and birthday calendar fit a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Add birthday', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: /explore a sample birthday book/i }).click();
  await expect(page.locator('.person-row')).toHaveCount(6);
  await page.screenshot({ path: '/tmp/impact23-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.locator('.sidebar').getByRole('button', { name: 'Birthday directory', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'The people behind our impact.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close menu' })).toHaveCount(0);
  await expect(page.locator('.person-row')).toHaveCount(6);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.locator('.sidebar').getByRole('button', { name: 'Calendar', exact: true }).click();
  await expect(page.locator('.calendar-grid')).toBeVisible();
  await expect(page.locator('.calendar-event')).toHaveCount(6);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  // Sample viewing never writes fictional members into the foundation database.
  expect(await records(page)).toEqual([]);
});
