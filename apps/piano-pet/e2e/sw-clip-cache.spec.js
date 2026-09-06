import { test, expect } from '@playwright/test';

// 記録クリップの SW キャッシュ（#303）。
// SW の同一オリジン処理は network-first（`cache: 'reload'`）で、キャッシュはオフライン時の
// フォールバックにしか使われない。そのため cat-video.js の prime（先読み）がオンラインで効かず、
// 再生のたびにクリップ全量（106〜172KB）を取り直していた。PLAY_TIMEOUT_MS=1秒に間に合わないと
// 抽選に当たっても動画が出ない。クリップは同名で上書きしない規約（#300）なので cache-first にする。
test.use({ serviceWorkers: 'allow' });

const CLIP = './video/cat_shiro_record_v1.mp4';

/** アプリの prime / tryPlay と同じく <video> で読み込む。 */
const loadClip = (page, src) => page.evaluate(async (s) => {
  const v = document.createElement('video');
  v.preload = 'auto';
  v.muted = true;
  v.src = s;
  return await new Promise((resolve) => {
    const t = setTimeout(() => resolve(false), 10000);
    v.addEventListener('canplaythrough', () => { clearTimeout(t); resolve(true); }, { once: true });
    v.addEventListener('error', () => { clearTimeout(t); resolve(false); }, { once: true });
  });
}, src);

test.describe('記録クリップの SW キャッシュ（#303）', () => {
  test('一度読んだクリップは2回目にネットワークへ出ない', async ({ page, context }) => {
    const hits = [];
    await context.route('**/video/*.mp4', async (route) => {
      hits.push(route.request().url().split('/').pop());
      await route.fallback();
    });

    await page.goto('/');
    await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 20000 });

    expect(await loadClip(page, CLIP), '1回目が読めること').toBe(true);
    await expect.poll(async () => page.evaluate(async () => {
      for (const n of await caches.keys()) {
        const keys = await (await caches.open(n)).keys();
        if (keys.some((k) => k.url.includes('cat_shiro_record_v1.mp4'))) return true;
      }
      return false;
    }), { timeout: 5000 }).toBe(true);

    const afterFirst = hits.length;
    expect(afterFirst, '1回目はネットワークから取る').toBeGreaterThan(0);

    expect(await loadClip(page, CLIP), '2回目が読めること').toBe(true);
    await page.waitForTimeout(500);

    // ここが本題。network-first のままだと2回目もネットワークへ出て全量ダウンロードになる。
    expect(hits.length, `2回目でネットワーク取得が増えた: ${hits.join(', ')}`).toBe(afterFirst);
  });

  test('JS はネットワーク優先のまま（鮮度の担保を落としていない）', async ({ page, context }) => {
    const hits = [];
    await context.route('**/js/cat-video.js*', async (route) => {
      hits.push(route.request().url());
      await route.fallback();
    });

    await page.goto('/');
    await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 20000 });

    await page.evaluate(() => fetch('./js/cat-video.js').then((r) => r.text()));
    const afterFirst = hits.length;
    await page.evaluate(() => fetch('./js/cat-video.js').then((r) => r.text()));
    await page.waitForTimeout(300);

    expect(hits.length, 'JS は毎回ネットワークを見に行く').toBeGreaterThan(afterFirst);
  });

  // #317: 同一オリジンの失敗レスポンス（5xx/404）をキャッシュに焼くと、
  // 以後オフラインになったときエラーページが返り「オフライン時だけ白画面」になる。
  test('失敗レスポンス(503)はキャッシュに焼かず、オフラインでは正常版が返る（#317）', async ({ page, context }) => {
    await page.goto('/');
    await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 20000 });

    // 正常版を SW 経由で取ってキャッシュに入れる（query 無し URL のエントリを自分で作る）
    const goodBody = await page.evaluate(() => fetch('./js/app.js').then((r) => r.text()));
    expect(goodBody).toContain('import');
    await expect.poll(() => page.evaluate(async () => {
      for (const n of await caches.keys()) {
        const keys = await (await caches.open(n)).keys();
        if (keys.some((k) => k.url.endsWith('/js/app.js'))) return true;
      }
      return false;
    }), { timeout: 10000 }).toBe(true);

    // app.js に 503 を返させて SW に取りに行かせる（network-first の put 分岐）
    let served503 = false;
    await context.route('**/js/app.js', async (route) => {
      served503 = true;
      await route.fulfill({ status: 503, contentType: 'application/javascript', body: '/* PWNED-503 */' });
    });
    await page.evaluate(() => fetch('./js/app.js', { cache: 'reload' }).then((r) => r.text()).catch(() => null));
    expect(served503).toBe(true);
    await context.unroute('**/js/app.js');

    // オフラインで取り直す → キャッシュ済みの正常版（503 本文で上書きされていない）
    await context.setOffline(true);
    const offlineBody = await page.evaluate(() => fetch('./js/app.js').then((r) => r.text()).catch(() => 'FETCH-ERR'));
    await context.setOffline(false);
    expect(offlineBody).not.toContain('PWNED-503');
    expect(offlineBody).toContain('import');
  });

  test('キャッシュ済みのクリップはオフラインでも再生できる', async ({ page, context }) => {
    await page.goto('/');
    await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 20000 });

    expect(await loadClip(page, CLIP)).toBe(true);
    await page.waitForTimeout(500);

    await context.setOffline(true);
    const offlineOk = await loadClip(page, CLIP);
    await context.setOffline(false);
    expect(offlineOk, 'オフラインでもキャッシュから再生できること').toBe(true);
  });
});
