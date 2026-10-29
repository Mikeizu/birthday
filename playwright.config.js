import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
import path from 'node:path';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/birthdays.spec.js',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5174',
    viewport: { width: 1440, height: 1000 },
    timezoneId: 'Africa/Lagos',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : existsSync('/usr/bin/chromium') ? { executablePath: '/usr/bin/chromium' } : {}),
      args: ['--no-sandbox'],
    },
  },
  webServer: [
    {
      command: 'node tests/e2e-server.js',
      url: 'http://127.0.0.1:3002/api/health',
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        NODE_ENV: 'test',
        PORT: '3002',
        HOST: '127.0.0.1',
        DATABASE_PATH: path.resolve(`.local/e2e-${process.pid}.sqlite`),
      },
    },
    {
      command: 'npx vite --host 127.0.0.1 --port 5174 --strictPort',
      url: 'http://127.0.0.1:5174',
      reuseExistingServer: false,
      timeout: 30_000,
      env: { API_PORT: '3002' },
    },
  ],
});
