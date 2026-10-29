import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
import path from 'node:path';

// Exercise the production build and real service worker, independently of the
// Vite development browser suite. The runner strips messaging credentials.
export default defineConfig({
  testDir: './tests',
  testMatch: '**/offline.spec.js',
  outputDir: '.local/offline-test-results',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:3004',
    viewport: { width: 1440, height: 1000 },
    timezoneId: 'Africa/Lagos',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      ...(process.env.CHROMIUM_PATH
        ? { executablePath: process.env.CHROMIUM_PATH }
        : existsSync('/usr/bin/chromium') ? { executablePath: '/usr/bin/chromium' } : {}),
      args: ['--no-sandbox'],
    },
  },
  webServer: {
    command: 'node tests/e2e-server.js',
    url: 'http://127.0.0.1:3004/api/health',
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      NODE_ENV: 'test',
      PORT: '3004',
      HOST: '127.0.0.1',
      DATABASE_PATH: path.resolve(`.local/offline-${process.pid}.sqlite`),
    },
  },
});
