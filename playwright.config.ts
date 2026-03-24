import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:3000',
    // Use Playwright's bundled Chromium (not system Chrome)
    browserName: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 720 },
    screenshot: 'only-on-failure',
  },
});
