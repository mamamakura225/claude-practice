import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './apps/dtask/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // テスト実行時に http-server を自動起動・終了
  webServer: {
    command: 'npx http-server ./apps/dtask -p 3000 -c-1 --silent',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
