import { defineConfig, devices } from '@playwright/test';

// アプリごとに http-server を別ポートで立て、project の testDir / baseURL で振り分ける。
const DTASK_PORT = 3000;
const PIANO_PORT = 3100;

export default defineConfig({
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',

  use: {
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'dtask',
      testDir: './apps/dtask/e2e',
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${DTASK_PORT}` },
    },
    {
      name: 'piano-pet',
      testDir: './apps/piano-pet/e2e',
      // モバイル PWA なのでスマホ相当でテスト。SW のキャッシュ干渉を避けるため block。
      use: {
        ...devices['Pixel 5'],
        baseURL: `http://localhost:${PIANO_PORT}`,
        serviceWorkers: 'block',
      },
    },

    // 互換ブラウザ（Firefox / Safari=WebKit）。全件は重いので @compat タグの
    // クリティカルパスだけを各ブラウザで実行する。
    {
      name: 'dtask-firefox',
      testDir: './apps/dtask/e2e',
      grep: /@compat/,
      use: { ...devices['Desktop Firefox'], baseURL: `http://localhost:${DTASK_PORT}` },
    },
    {
      name: 'dtask-webkit',
      testDir: './apps/dtask/e2e',
      grep: /@compat/,
      use: { ...devices['Desktop Safari'], baseURL: `http://localhost:${DTASK_PORT}` },
    },
    {
      // piano-pet はモバイル PWA。実機での懸念は iOS Safari なので WebKit モバイルで検証。
      name: 'piano-pet-mobile-safari',
      testDir: './apps/piano-pet/e2e',
      grep: /@compat/,
      use: {
        ...devices['iPhone 13'],
        baseURL: `http://localhost:${PIANO_PORT}`,
        serviceWorkers: 'block',
      },
    },
  ],

  // テスト実行時に各アプリの http-server を自動起動・終了
  webServer: [
    {
      command: `npx http-server ./apps/dtask -p ${DTASK_PORT} -c-1 --silent`,
      url: `http://localhost:${DTASK_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
    },
    {
      command: `npx http-server ./apps/piano-pet -p ${PIANO_PORT} -c-1 --silent`,
      url: `http://localhost:${PIANO_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
    },
  ],
});
