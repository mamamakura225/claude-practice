import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';

// データのバックアップ/復元（#140）。本番Firestoreと干渉しないよう Firebase 関連を全ブロック。
// （クラウド取得が成功すると下のシード状態を上書きしてしまうため必須）
const blockFirebase = async (page) => {
  await page.route('**/www.gstatic.com/firebasejs/**', (route) => route.abort());
  await page.route('**/firestore.googleapis.com/**', (route) => route.abort());
  await page.route('**/firebase.googleapis.com/**', (route) => route.abort());
  await page.route('**/identitytoolkit.googleapis.com/**', (route) => route.abort());
};

// コイン123を持った状態で開始。**未設定時のみ**シードする（復元→reload 後に
// addInitScript がシードで上書きしてしまうのを防ぐため）。
const SEED = {
  version: 1,
  pet: { name: 'きーちゃん', level: 1, xp: 0, coins: 123, equippedItems: [], affinity: 0, foodSpent: 0 },
  inventory: [],
  streak: { current: 0, best: 0, lastPracticeDate: null, freezes: 0 },
  badges: [],
  sessions: [],
  settings: { soundOn: true },
};

function backupJson(coins, level = 1) {
  return JSON.stringify({
    app: 'piano-pet',
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    state: {
      version: 1,
      pet: { name: 'きーちゃん', level, xp: 0, coins, equippedItems: [], affinity: 0, foodSpent: 0 },
      inventory: [],
      streak: { current: 0, best: 0, lastPracticeDate: null, freezes: 0 },
      badges: [],
      sessions: [],
      settings: { soundOn: true },
    },
  });
}

async function passGate(page) {
  await page.click('#settingsToggle');
  await expect(page.locator('#settingsGate')).toBeVisible();
  const a = Number(await page.locator('#gateA').textContent());
  const b = Number(await page.locator('#gateB').textContent());
  await page.fill('#gateAnswer', String(a + b));
  await page.click('#gateSubmit');
  await expect(page.locator('#settingsMenu')).toBeVisible();
}

test.describe('データのバックアップ/復元', () => {
  test.beforeEach(async ({ page }) => {
    await blockFirebase(page);
    await page.addInitScript((seed) => {
      if (!localStorage.getItem('piano-pet')) {
        localStorage.setItem('piano-pet', JSON.stringify(seed));
      }
    }, SEED);

    // 初回オンボーディング（#141）が全画面で重ならないよう「見た」フラグを立てる。
    await page.addInitScript(() => {
      try { localStorage.setItem('piano-pet-onboarded', '1'); } catch { /* 無視 */ }
    });
  });

  test('親ゲート：誤答では開かず、正答でメニューが開く', async ({ page }) => {
    await page.goto('/');
    await page.click('#settingsToggle');
    const a = Number(await page.locator('#gateA').textContent());
    const b = Number(await page.locator('#gateB').textContent());

    await page.fill('#gateAnswer', String(a + b + 1)); // 誤答
    await page.click('#gateSubmit');
    await expect(page.locator('#settingsMenu')).toBeHidden();
    await expect(page.locator('#gateError')).toBeVisible();

    await page.fill('#gateAnswer', String(a + b)); // 正答
    await page.click('#gateSubmit');
    await expect(page.locator('#settingsMenu')).toBeVisible();
  });

  test('ほぞん：app マーカー付き JSON がダウンロードされる', async ({ page }) => {
    await page.goto('/');
    await passGate(page);

    const downloadPromise = page.waitForEvent('download');
    await page.click('#exportBtn');
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/^piano-pet-backup-\d{4}-\d{2}-\d{2}\.json$/);
    const path = await download.path();
    const obj = JSON.parse(await fs.readFile(path, 'utf-8'));
    expect(obj.app).toBe('piano-pet');
    expect(obj.state.pet.coins).toBe(123);
  });

  test('よみこむ：確認OKで復元され、リロード後に反映される', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#statCoins')).toHaveText('123');
    await passGate(page);

    page.on('dialog', (d) => d.accept());
    await page.setInputFiles('#importFile', {
      name: 'backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(backupJson(999)),
    });

    // reload 後に取り込んだコイン999が反映される（直接フィールドなので確実な証拠）
    await expect(page.locator('#statCoins')).toHaveText('999', { timeout: 10000 });
  });

  test('よみこむ：確認キャンセルなら復元しない', async ({ page }) => {
    await page.goto('/');
    await passGate(page);

    page.on('dialog', (d) => d.dismiss());
    await page.setInputFiles('#importFile', {
      name: 'backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(backupJson(999)),
    });

    await expect(page.locator('#settingsMenu')).toBeVisible(); // 復元されずメニューのまま
    await page.click('#settingsMenu [data-action="close-settings"]');
    await expect(page.locator('#statCoins')).toHaveText('123');
  });

  test('別アプリの JSON はエラー表示で復元されない', async ({ page }) => {
    await page.goto('/');
    await passGate(page);

    await page.setInputFiles('#importFile', {
      name: 'other.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ app: 'dtask', state: { tasks: [] } })),
    });

    await expect(page.locator('#importStatus')).toBeVisible();
    await expect(page.locator('#importStatus')).toContainText('ピアノペットの ファイルじゃ');
    await page.click('#settingsMenu [data-action="close-settings"]');
    await expect(page.locator('#statCoins')).toHaveText('123');
  });
});
