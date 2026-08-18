import { test, expect } from '@playwright/test';

// 写真モード（きせかえ猫のスナップ・#237）。Web Share 対応時は共有、非対応時はダウンロード。
// 端末内完結・PII（曲名/こども名）を共有ペイロードに含めない。

// 準備完了＝**猫の本体画像が読み込み終わっている**こと（#280）。
// #photoBtn は index.html の静的要素なのでページ表示と同時に可視になり、猫の DOM は
// app.js の renderHome() が注入し、その <img> の読み込みはさらに後になる。未ロードのまま
// 押すと renderCatCanvas が同じ画像を取り直すことになり、ローカルの http-server
// （-c-1＝キャッシュ無効）ではその再取得に数秒かかって共有が始まらない。
async function waitForCatReady(page) {
  await expect(page.locator('#catStage .cat__body')).toBeVisible({ timeout: 10000 });
  await page.waitForFunction(() => {
    const b = document.querySelector('#catStage .cat__body');
    return b && b.complete && b.naturalWidth > 0;
  }, null, { timeout: 10000 });
}

test.describe('写真モード（#237）', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/www.gstatic.com/firebasejs/**', (route) => route.abort());
    await page.route('**/firestore.googleapis.com/**', (route) => route.abort());
    await page.route('**/firebase.googleapis.com/**', (route) => route.abort());
    await page.route('**/identitytoolkit.googleapis.com/**', (route) => route.abort());
    await page.addInitScript(() => {
      try { localStorage.setItem('piano-pet-onboarded', '1'); } catch { /* 無視 */ }
    });
  });

  test('Web Share 対応時は PNG ファイルを共有する（PII を含めない）', { tag: '@compat' }, async ({ page }) => {
    await page.addInitScript(() => {
      window.__shared = null;
      // navigator.canShare / share をモック（ファイル共有対応を装う）。
      navigator.canShare = () => true;
      navigator.share = async (data) => {
        window.__shared = {
          title: data.title,
          text: data.text,
          files: (data.files || []).map((f) => ({ name: f.name, type: f.type, size: f.size })),
        };
      };
    });
    await page.goto('/');
    await waitForCatReady(page);

    await page.click('#photoBtn');
    await expect.poll(() => page.evaluate(() => window.__shared), { timeout: 15000 }).not.toBeNull();

    const shared = await page.evaluate(() => window.__shared);
    expect(shared.files).toHaveLength(1);
    expect(shared.files[0].type).toBe('image/png');
    expect(shared.files[0].size).toBeGreaterThan(0);
    // PII 非送信：タイトルは固定文言、text は付けない、ファイル名に子名・曲名を入れない。
    expect(shared.title).toBe('ピアノペット');
    expect(shared.text).toBeUndefined();
    expect(shared.files[0].name).toBe('pianopet.png');
  });

  test('Web Share 非対応時はダウンロードにフォールバックする', async ({ page }) => {
    await page.addInitScript(() => {
      // canShare 無し＝ファイル共有非対応 → ダウンロード経路へ。
      navigator.canShare = undefined;
      navigator.share = undefined;
    });
    await page.goto('/');
    await waitForCatReady(page);

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#photoBtn'),
    ]);
    expect(download.suggestedFilename()).toBe('pianopet.png');
  });
});
