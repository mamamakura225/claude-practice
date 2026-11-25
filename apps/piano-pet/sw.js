// ===== Service Worker =====
// キャッシュはコード用とメディア用の2つ（#259）。コードだけのデプロイで画像（約4MiB）を取り直さない。
//   - コード（html/css/js/manifest）: network-first。取れないときだけキャッシュ
//   - メディア（画像・音・アイコン・動画）: cache-first。中身が変わると MEDIA_CACHE の名前が変わる
// 下の4つの定数は gen-sw が生成する（手で直さない）。
const CODE_CACHE = 'piano-pet-code-050e06d5';
const MEDIA_CACHE = 'piano-pet-media-b879623f';

const APP_SHELL = [
  './',
  './index.html',
  './css/cat.css?v=050e06d5',
  './css/style.css?v=050e06d5',
  './js/account.js',
  './js/analytics.js',
  './js/app.js?v=050e06d5',
  './js/backup.js',
  './js/badges.js',
  './js/cat-image.js',
  './js/cat-snapshot.js',
  './js/cat-video.js',
  './js/child-profile.js',
  './js/cloud-queue.js',
  './js/cloud.js',
  './js/dialog.js',
  './js/dressup.js',
  './js/feed.js',
  './js/firebase-config.js',
  './js/game.js',
  './js/history-view.js',
  './js/history.js',
  './js/html.js',
  './js/lesson-settings.js',
  './js/monitoring-config.js',
  './js/onboarding-ui.js',
  './js/onboarding.js',
  './js/record-form.js',
  './js/router.js',
  './js/sentry.js',
  './js/shop.js',
  './js/song-color.js',
  './js/sound.js',
  './js/stamp-book.js',
  './js/stamp-settings.js',
  './js/stamp-view.js',
  './js/storage.js',
  './manifest.json',
];

const MEDIA_SHELL = [
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-96.png',
  './icons/icon.svg',
  './img/cat/cat_russianblue_high_happy.webp',
  './img/cat/cat_russianblue_high_hiss.webp',
  './img/cat/cat_russianblue_high_idle.webp',
  './img/cat/cat_russianblue_high_love.webp',
  './img/cat/cat_russianblue_high_sleep.webp',
  './img/cat/cat_russianblue_low_happy.webp',
  './img/cat/cat_russianblue_low_hiss.webp',
  './img/cat/cat_russianblue_low_idle.webp',
  './img/cat/cat_russianblue_low_love.webp',
  './img/cat/cat_russianblue_low_sleep.webp',
  './img/cat/cat_russianblue_mid_happy.webp',
  './img/cat/cat_russianblue_mid_hiss.webp',
  './img/cat/cat_russianblue_mid_idle.webp',
  './img/cat/cat_russianblue_mid_love.webp',
  './img/cat/cat_russianblue_mid_sleep.webp',
  './img/cat/cat_shiro_high_happy.webp',
  './img/cat/cat_shiro_high_hiss.webp',
  './img/cat/cat_shiro_high_idle.webp',
  './img/cat/cat_shiro_high_love.webp',
  './img/cat/cat_shiro_high_sleep.webp',
  './img/cat/cat_shiro_low_happy.webp',
  './img/cat/cat_shiro_low_hiss.webp',
  './img/cat/cat_shiro_low_idle.webp',
  './img/cat/cat_shiro_low_love.webp',
  './img/cat/cat_shiro_low_sleep.webp',
  './img/cat/cat_shiro_mid_happy.webp',
  './img/cat/cat_shiro_mid_hiss.webp',
  './img/cat/cat_shiro_mid_idle.webp',
  './img/cat/cat_shiro_mid_love.webp',
  './img/cat/cat_shiro_mid_sleep.webp',
  './img/cat/cat_tora_high_happy.webp',
  './img/cat/cat_tora_high_hiss.webp',
  './img/cat/cat_tora_high_idle.webp',
  './img/cat/cat_tora_high_love.webp',
  './img/cat/cat_tora_high_sleep.webp',
  './img/cat/cat_tora_low_happy.webp',
  './img/cat/cat_tora_low_hiss.webp',
  './img/cat/cat_tora_low_idle.webp',
  './img/cat/cat_tora_low_love.webp',
  './img/cat/cat_tora_low_sleep.webp',
  './img/cat/cat_tora_mid_happy.webp',
  './img/cat/cat_tora_mid_hiss.webp',
  './img/cat/cat_tora_mid_idle.webp',
  './img/cat/cat_tora_mid_love.webp',
  './img/cat/cat_tora_mid_sleep.webp',
  './img/cat/items/backpack.webp',
  './img/cat/items/balloon.webp',
  './img/cat/items/bandana.webp',
  './img/cat/items/beeWings.webp',
  './img/cat/items/bell.webp',
  './img/cat/items/beret.webp',
  './img/cat/items/bowTieBlue.webp',
  './img/cat/items/bowtie.webp',
  './img/cat/items/butterflyWings.webp',
  './img/cat/items/cap.webp',
  './img/cat/items/cape.webp',
  './img/cat/items/collar.webp',
  './img/cat/items/crown.webp',
  './img/cat/items/dragonWings.webp',
  './img/cat/items/flower.webp',
  './img/cat/items/flowerCrown.webp',
  './img/cat/items/glasses.webp',
  './img/cat/items/gradCap.webp',
  './img/cat/items/hat.webp',
  './img/cat/items/headphones.webp',
  './img/cat/items/heartGlasses.webp',
  './img/cat/items/medal.webp',
  './img/cat/items/monocle.webp',
  './img/cat/items/partyHat.webp',
  './img/cat/items/pearls.webp',
  './img/cat/items/ribbon.webp',
  './img/cat/items/roundGlasses.webp',
  './img/cat/items/sailorHat.webp',
  './img/cat/items/scarf.webp',
  './img/cat/items/stars.webp',
  './img/cat/items/sunglasses.webp',
  './img/cat/items/tophat.webp',
  './img/cat/items/wings.webp',
  './img/cat/scene/cushion.webp',
  './img/cat/scene/fishToy.webp',
  './img/cat/scene/lamp.webp',
  './img/cat/scene/lantern.webp',
  './img/cat/scene/miniPiano.webp',
  './img/cat/scene/plant.webp',
  './img/cat/scene/present.webp',
  './img/cat/scene/sofa.webp',
  './img/cat/scene/teddy.webp',
  './img/cat/scene/tree.webp',
  './img/cat/scene/window.webp',
  './img/cat/scene/yarnBall.webp',
  './img/stamp/fumifumi.webp',
  './img/stamp/hako.webp',
  './img/stamp/heart.webp',
  './img/stamp/jump.webp',
  './img/stamp/keito.webp',
  './img/stamp/nabe.webp',
  './img/stamp/nobi.webp',
  './img/stamp/ojigi.webp',
  './img/stamp/paw.webp',
  './img/stamp/punch.webp',
  './img/stamp/sakana.webp',
  './sounds/hiss1.mp3',
  './sounds/meow1.mp3',
  './sounds/meow2.mp3',
  './sounds/meow3.mp3',
];

async function precacheCode() {
  const cache = await caches.open(CODE_CACHE);
  await cache.addAll(APP_SHELL);
}

// メディアは無いものだけ取る。ここで入れたものはそのまま使われ続ける（cache-first）ので、
// HTTP キャッシュの古い版を焼かないよう必ずサーバへ確かめる（変わっていなければ 304 で済む）。
async function precacheMedia() {
  const cache = await caches.open(MEDIA_CACHE);
  const have = new Set((await cache.keys()).map((r) => r.url));
  const missing = MEDIA_SHELL.filter((p) => !have.has(new URL(p, self.location.href).href));
  await cache.addAll(missing.map((p) => new Request(p, { cache: 'no-cache' })));
}

self.addEventListener('install', (event) => {
  event.waitUntil(Promise.all([precacheCode(), precacheMedia()]).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  const keep = [CODE_CACHE, MEDIA_CACHE];
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !keep.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// メディアの URL に版は付かないが、MEDIA_CACHE の名前は全メディア（precache しない動画も含む・#318）の
// 中身から作るので、内容が変われば別キャッシュになり、旧キャッシュは activate で破棄される
// ＝ cache-first でも古い版は返らない。動画は precache せず、初回再生時にここで入る（#227/#303）。
// JS/HTML/CSS は import に版が付かず古い版が残るため network-first を維持する。
const SCOPE_PATH = new URL('./', self.location.href).pathname;
const isMedia = (pathname) =>
  pathname.startsWith(SCOPE_PATH) && /^(?:img|icons|sounds|video)\//.test(pathname.slice(SCOPE_PATH.length));

// キーは URL 文字列にする。<video> は Range 付きで要求してくるので、Request のままだと
// キャッシュを取りこぼす（保存できるのは 200 だけ）。
async function mediaFirst(url) {
  const cache = await caches.open(MEDIA_CACHE);
  const cached = await cache.match(url.href);
  if (cached) return cached;
  const response = await fetch(url.href, { cache: 'no-cache' });
  if (response.ok) cache.put(url.href, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (url.origin === self.location.origin && isMedia(url.pathname)) {
    event.respondWith(mediaFirst(url));
    return;
  }

  if (url.origin === self.location.origin) {
    // cache:'reload' でブラウザのHTTPキャッシュをバイパスし常に最新を取得。
    // （ESモジュール import にはバージョン文字列が付かず古い版が残るため）
    event.respondWith(
      fetch(request, { cache: 'reload' })
        .then((response) => {
          // 保存するのは ok なレスポンスだけ（5xx/404 を焼くとオフライン時だけ白画面になる・#317）
          if (response.ok) {
            const copy = response.clone();
            caches.open(CODE_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() =>
          caches.match(request).then((cached) => {
            if (cached) return cached;
            if (request.mode === 'navigate') return caches.match('./index.html');
            return Response.error();
          })
        )
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request))
  );
});
