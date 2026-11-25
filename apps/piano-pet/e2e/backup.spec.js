import fs from 'node:fs/promises';
import { test, expect, makeState, seed, readLocal, gotoHome, openSettings, closeSettings, importJson, backupOf, addSong } from './helpers.js';

// データのバックアップ/復元（#140）・しょきか（#183）。読み込みの成功は undo.spec.js（読み込み→ひとつ まえ の往復）で通す。
test.describe('データのバックアップ/復元', () => {
  test.beforeEach(({ page }) => seed(page, makeState({ pet: { coins: 123 } })));

  test('親ゲート：誤答では開かず、正答でメニューが開く', async ({ page }) => {
    await gotoHome(page);
    await page.click('#settingsToggle');
    await expect(page.locator('#settingsGate')).toBeVisible();
    const a = Number(await page.locator('#gateA').textContent());
    const b = Number(await page.locator('#gateB').textContent());

    await page.fill('#gateAnswer', String(a * b + 1));
    await page.click('#gateSubmit');
    await expect(page.locator('#gateError')).toBeVisible();
    await expect(page.locator('#settingsMenu')).toBeHidden();

    await page.fill('#gateAnswer', String(a * b));
    await page.click('#gateSubmit');
    await expect(page.locator('#settingsMenu')).toBeVisible();
  });

  test('ほぞん：app マーカー付き JSON がダウンロードされる', { tag: '@compat' }, async ({ page }) => {
    await gotoHome(page);
    await openSettings(page);
    const downloadPromise = page.waitForEvent('download');
    await page.click('#exportBtn');
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/^piano-pet-backup-\d{4}-\d{2}-\d{2}\.json$/);
    const obj = JSON.parse(await fs.readFile(await download.path(), 'utf-8'));
    expect(obj.app).toBe('piano-pet');
    expect(obj.state.pet.coins).toBe(123);
  });

  test('確認をやめた読み込み・しょきか、別アプリの JSON では、データが変わらない', async ({ page }) => {
    await gotoHome(page);
    await openSettings(page);
    let asked = 0;
    page.on('dialog', (d) => { asked += 1; d.dismiss(); });

    await importJson(page, backupOf(makeState({ pet: { coins: 999 } })));
    await expect.poll(() => asked).toBe(1);
    await page.click('#resetBtn');
    await expect.poll(() => asked).toBe(2);
    await importJson(page, { app: 'dtask', state: { tasks: [] } });
    await expect(page.locator('#importStatus')).toContainText('ピアノペットの ファイルじゃ');
    expect(asked).toBe(2);   // 中身が違うファイルは確認まで進まない

    await closeSettings(page);
    await expect(page.locator('#statCoins')).toHaveText('123');
    expect((await readLocal(page)).pet.coins).toBe(123);
  });

  test('しょきか：確認OKで新品に戻り、リロード後にコインが0になる', async ({ page }) => {
    await gotoHome(page);
    await openSettings(page);
    page.on('dialog', (d) => d.accept());
    await page.click('#resetBtn');
    await expect(page.locator('#statCoins')).toHaveText('0', { timeout: 10000 });
  });

  test('しょきかしたら、書きかけのスタンプも残らない（#428）', async ({ page }) => {
    await page.goto('/#/record');
    await addSong(page, 'きらきらぼし');
    await page.click('#stampCard');
    await page.click('.nav-btn[data-nav="home"]');
    await openSettings(page);
    page.on('dialog', (d) => d.accept());
    const reloaded = page.waitForEvent('load');
    await page.click('#resetBtn');
    await reloaded;
    await page.click('#goRecordBtn');
    await expect(page.locator('#recordTotal')).toHaveText('0');
  });

  test('よみこむ：端末に保存できなければ、何も変えずに知らせる（#428）', async ({ page }) => {
    const STASH = 'piano-pet-backup-before-restore';
    const prevStash = JSON.stringify({ pet: { coins: 42 } });
    await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [STASH, prevStash]);
    await gotoHome(page);
    await openSettings(page);
    await page.evaluate(() => {
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function setItem(k, v) {
        if (k === 'piano-pet') throw new DOMException('full', 'QuotaExceededError');
        return set.call(this, k, v);
      };
    });
    page.on('dialog', (d) => d.accept());
    await importJson(page, backupOf(makeState({ pet: { coins: 999 } }), { cloudDocId: 'pp-0123456789abcdef0123456789abcdef' }));
    await expect(page.locator('#importStatus')).toContainText('ほぞんできませんでした');
    expect(await page.evaluate(() => localStorage.getItem('piano-pet:cloud-ids'))).toBeNull();   // 保存先だけ切り替わらない
    expect(await page.evaluate((k) => localStorage.getItem(k), STASH)).toBe(prevStash);          // 前の退避も残る
    await closeSettings(page);
    await expect(page.locator('#statCoins')).toHaveText('123');
  });
});
