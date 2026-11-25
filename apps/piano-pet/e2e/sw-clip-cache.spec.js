import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { APP_DIR, isMediaAsset, listCodeAssets, listMediaAssets } from '../../../scripts/piano-pet-assets.mjs';
import { test, expect } from './helpers.js';

// SW のキャッシュ方針：メディア（クリップ・画像・音）は cache-first（#303。クリップを再生のたびに取り直すと
// 1秒の上限に間に合わない）、コードは network-first。差し替えは gen-sw のハッシュがキャッシュ名を動かして届ける（#318）。
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

const waitForSw = (page) => page.waitForFunction(
  () => navigator.serviceWorker?.controller != null, null, { timeout: 20000 },
);

/** その名前で終わる URL がキャッシュに入るまで待つ。 */
const waitCached = (page, suffix) => expect.poll(() => page.evaluate(async (end) => {
  for (const n of await caches.keys()) {
    const keys = await (await caches.open(n)).keys();
    if (keys.some((k) => k.url.endsWith(end))) return true;
  }
  return false;
}, suffix), { timeout: 10000 }).toBe(true);

test.describe('記録クリップの SW キャッシュ（#303）', () => {
  test('一度読んだクリップは2回目にネットワークへ出ない', async ({ page, context }) => {
    const hits = [];
    await context.route('**/video/*.mp4', async (route) => {
      hits.push(route.request().url().split('/').pop());
      await route.fallback();
    });

    await page.goto('/');
    await waitForSw(page);

    expect(await loadClip(page, CLIP), '1回目が読めること').toBe(true);
    await waitCached(page, 'cat_shiro_record_v1.mp4');

    const afterFirst = hits.length;
    expect(afterFirst, '1回目はネットワークから取る').toBeGreaterThan(0);

    expect(await loadClip(page, CLIP), '2回目が読めること').toBe(true);
    await page.waitForTimeout(500);   // 「ネットワークへ出ない」ことの証拠時間

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
    await waitForSw(page);

    await page.evaluate(() => fetch('./js/cat-video.js').then((r) => r.text()));
    const afterFirst = hits.length;
    await page.evaluate(() => fetch('./js/cat-video.js').then((r) => r.text()));
    expect(hits.length, 'JS は毎回ネットワークを見に行く').toBeGreaterThan(afterFirst);
  });

  // #317: 同一オリジンの失敗レスポンス（5xx/404）をキャッシュに焼くと、
  // 以後オフラインになったときエラーページが返り「オフライン時だけ白画面」になる。
  test('失敗レスポンス(503)はキャッシュに焼かず、オフラインでは正常版が返る（#317）', async ({ page, context }) => {
    await page.goto('/');
    await waitForSw(page);

    // 正常版を SW 経由で取ってキャッシュに入れる（query 無し URL のエントリを自分で作る）
    const goodBody = await page.evaluate(() => fetch('./js/app.js').then((r) => r.text()));
    expect(goodBody).toContain('import');
    await waitCached(page, '/js/app.js');

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
    await waitForSw(page);

    expect(await loadClip(page, CLIP)).toBe(true);
    await waitCached(page, 'cat_shiro_record_v1.mp4');

    await context.setOffline(true);
    const offlineOk = await loadClip(page, CLIP);
    await context.setOffline(false);
    expect(offlineOk, 'オフラインでもキャッシュから再生できること').toBe(true);
  });
});

// コード用とメディア用のキャッシュ分割（#259）と、アプリシェルのオフライン起動（#289）。
test.describe('コードとメディアのキャッシュ（#259 #289）', () => {
  /** { キャッシュ名: [アプリ相対パス（?v= は除く）] } */
  const dumpCaches = (page) => page.evaluate(async () => {
    const out = {};
    for (const name of await caches.keys()) {
      const keys = await (await caches.open(name)).keys();
      out[name] = keys.map((k) => new URL(k.url).pathname.slice(1));
    }
    return out;
  });

  const countMedia = async (context) => {
    const hits = [];
    await context.route(/\/(?:img|icons|sounds|video)\//, async (route) => {
      hits.push(new URL(route.request().url()).pathname);
      await route.fallback();
    });
    return hits;
  };

  test('install でコードとメディアが別々のキャッシュに全部入る', async ({ page }) => {
    await page.goto('/');
    await waitForSw(page);
    const dump = await dumpCaches(page);
    const names = Object.keys(dump).sort();
    expect(names).toEqual([expect.stringMatching(/^piano-pet-code-/), expect.stringMatching(/^piano-pet-media-/)]);

    const [code, media] = names.map((n) => dump[n]);
    expect(code).toEqual(expect.arrayContaining(['', ...listCodeAssets()]));
    expect(media).toEqual(expect.arrayContaining(listMediaAssets()));
    // 二重に持たない（コード側に画像が入ると、コードの更新のたびに取り直すことになる）
    expect(code.filter(isMediaAsset)).toEqual([]);
    expect(media.filter((p) => !isMediaAsset(p))).toEqual([]);
    expect(media.filter((p) => p.startsWith('video/')), '動画はプリキャッシュしない（#227）').toEqual([]);
  });

  test('オフラインで開き直しても起動し、未知の URL は index.html に落ちる', async ({ page, context }) => {
    await page.goto('/');
    await waitForSw(page);
    await context.setOffline(true);
    // setOffline は HTTP キャッシュを止めないが、配信は no-store 相当（-c-1）なので SW 以外からは返らない
    await page.reload();
    await expect(page.locator('#catStage .cat__body')).toBeVisible();
    await page.goto('/?nazo=1');
    await expect(page.locator('#catStage .cat__body')).toBeVisible();
    // 今の見た目では使っていない画像もオフラインで出る（全画像のオフライン保証・#66）
    const ok = await page.evaluate((paths) => Promise.all(paths.map((p) => fetch(p).then((r) => r.ok, () => false))), listMediaAssets());
    expect(ok.every(Boolean)).toBe(true);
    await context.setOffline(false);
  });

  test('画像は2回目からネットワークへ出ない', async ({ page, context }) => {
    const hits = await countMedia(context);
    await page.goto('/');
    await waitForSw(page);
    expect(hits.length, '計測が効いていること（install で取りに行く）').toBeGreaterThan(0);

    hits.length = 0;
    await page.reload();
    await expect(page.locator('#catStage .cat__body')).toBeVisible();
    await page.evaluate(() => fetch('./img/stamp/paw.webp').then((r) => r.blob()));
    // アイコン類（favicon 等）はブラウザが SW を通さず直接取るので、アプリが使う画像だけを見る
    expect(hits.filter((p) => p.startsWith('/img/'))).toEqual([]);
  });

  // 版の更新だけは自前のサーバーで試す。SW の更新確認（sw.js の再取得）はブラウザ本体が行い、
  // Playwright の route では差し替えられないため。sw.js の書き換えはキャッシュ名そのものの置換で行う
  // （ソースでも最小化済みの dist でも同じに効く）。
  const ROOT = process.env.E2E_DIST ? path.resolve(APP_DIR, '../../dist/apps/piano-pet') : APP_DIR;
  const MIME = {
    '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4',
  };
  const startServer = async () => {
    const hits = [];
    let editSw = (text) => text;
    const server = createServer(async (req, res) => {
      const rel = new URL(req.url, 'http://x').pathname.slice(1) || 'index.html';
      hits.push(rel);
      try {
        let body = await readFile(path.join(ROOT, rel));
        if (rel === 'sw.js') body = editSw(body.toString());
        res.writeHead(200, { 'content-type': MIME[path.extname(rel)], 'cache-control': 'no-store' }).end(body);
      } catch {
        res.writeHead(404).end();
      }
    });
    await new Promise((resolve) => server.listen(0, resolve));
    return {
      url: `http://localhost:${server.address().port}/`,
      hits,
      /** kind（code / media）のキャッシュ名だけが違う sw.js を配る。 */
      bump: (kind) => {
        editSw = (text) => text.replace(new RegExp(`piano-pet-${kind}-\\w+`), `piano-pet-${kind}-next`);
      },
      close: () => { server.closeAllConnections(); server.close(); },
    };
  };
  const update = (page) => page.evaluate(async () => {
    await (await navigator.serviceWorker.getRegistration()).update();
  });
  const cacheOf = async (page, kind) =>
    Object.entries(await dumpCaches(page)).filter(([name]) => name.startsWith(`piano-pet-${kind}-`));

  test('コードだけ変わった版へ更新しても、メディアは残り取り直さない', async ({ page }) => {
    const server = await startServer();
    try {
      await page.goto(server.url);
      await waitForSw(page);
      expect(server.hits.filter(isMediaAsset).length, '計測が効いていること').toBeGreaterThan(0);
      expect(await loadClip(page, CLIP)).toBe(true);
      await expect.poll(async () => (await cacheOf(page, 'media'))[0][1]).toContain('video/cat_shiro_record_v1.mp4');
      const before = await cacheOf(page, 'media');

      server.hits.length = 0;
      server.bump('code');
      await update(page);
      await expect.poll(async () => (await cacheOf(page, 'code')).map(([name]) => name), { timeout: 20000 })
        .toEqual(['piano-pet-code-next']);
      const after = await cacheOf(page, 'media');
      expect(after.map(([name, files]) => [name, files.sort()]), '再生済みのクリップも残る')
        .toEqual(before.map(([name, files]) => [name, files.sort()]));
      expect(server.hits, '新しい版のコードは取り直している').toContain('js/app.js');
      expect(server.hits.filter((p) => isMediaAsset(p) && !p.startsWith('icons/')), 'メディアは取り直していない').toEqual([]);
    } finally {
      server.close();
    }
  });

  test('メディアが変わった版へ更新すると、古いメディアは捨てて取り直す（#318）', async ({ page }) => {
    const server = await startServer();
    try {
      await page.goto(server.url);
      await waitForSw(page);
      expect(await loadClip(page, CLIP)).toBe(true);
      await expect.poll(async () => (await cacheOf(page, 'media'))[0][1]).toContain('video/cat_shiro_record_v1.mp4');

      server.hits.length = 0;
      server.bump('media');
      await update(page);
      await expect.poll(async () => (await cacheOf(page, 'media')).map(([name]) => name), { timeout: 20000 })
        .toEqual(['piano-pet-media-next']);
      const [[, media]] = await cacheOf(page, 'media');
      expect(media).toEqual(expect.arrayContaining(listMediaAssets()));
      expect(media.filter((p) => p.startsWith('video/')), '古いクリップを引き継がない').toEqual([]);
      expect(server.hits).toEqual(expect.arrayContaining(listMediaAssets()));
    } finally {
      server.close();
    }
  });
});
