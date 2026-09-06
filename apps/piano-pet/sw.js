// ===== Service Worker（ネットワーク優先＋オフラインフォールバック） =====
const CACHE = 'piano-pet-67fec20e';

const APP_SHELL = [
  './',
  './index.html',
  './css/cat.css?v=67fec20e',
  './css/style.css?v=67fec20e',
  './js/account.js',
  './js/analytics.js',
  './js/app.js?v=67fec20e',
  './js/backup.js',
  './js/badges.js',
  './js/cat-image.js',
  './js/cat-snapshot.js',
  './js/cat-video.js',
  './js/child-profile.js',
  './js/cloud-queue.js',
  './js/cloud.js',
  './js/dressup.js',
  './js/feed.js',
  './js/firebase-config.js',
  './js/game.js',
  './js/history.js',
  './js/html.js',
  './js/monitoring-config.js',
  './js/onboarding.js',
  './js/record-form.js',
  './js/router.js',
  './js/sentry.js',
  './js/shop.js',
  './js/song-color.js',
  './js/sound.js',
  './js/storage.js',
  './manifest.json',
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
  './img/cat/items/bell.webp',
  './img/cat/items/beret.webp',
  './img/cat/items/bowtie.webp',
  './img/cat/items/cape.webp',
  './img/cat/items/collar.webp',
  './img/cat/items/crown.webp',
  './img/cat/items/flower.webp',
  './img/cat/items/flowerCrown.webp',
  './img/cat/items/glasses.webp',
  './img/cat/items/hat.webp',
  './img/cat/items/ribbon.webp',
  './img/cat/items/scarf.webp',
  './img/cat/items/sunglasses.webp',
  './img/cat/items/wings.webp',
  './img/cat/scene/cushion.webp',
  './img/cat/scene/yarnBall.webp',
  './sounds/hiss1.mp3',
  './sounds/meow1.mp3',
  './sounds/meow2.mp3',
  './sounds/meow3.mp3',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 記録クリップ（#227/#300）は同名で上書きしない規約なので、URL が同じなら中身も同じ。
// network-first のままだと再生のたびに全量（106〜172KB）を取り直し、cat-video.js の prime も
// 効かない（キャッシュを読むのがオフライン時だけのため）。1秒の再生タイムアウトに間に合わず
// 演出が出ないので cache-first にする（#303）。JS/HTML/CSS は import に版が付かず古い版が残る
// ため network-first を維持する。
const isClip = (pathname) => /\/video\/[^/]+\.mp4$/.test(pathname);

// 同一オリジン: network-first（オンラインは常に最新、失敗時のみキャッシュ）。
// 取得成功時にキャッシュを更新するので、オフラインでも直近の内容で動く。
// クリップのみ cache-first（上記）。外部オリジン（フォント等）: cache-first。
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (url.origin === self.location.origin && isClip(url.pathname)) {
    // <video> は Range 付きで要求してくる。キーを URL 文字列にして Range の有無で
    // キャッシュを取りこぼさないようにする（保存できるのは 200 だけ）。
    event.respondWith(
      caches.open(CACHE).then((cache) =>
        cache.match(url.href).then((cached) => {
          if (cached) return cached;
          return fetch(url.href).then((response) => {
            if (response.ok) cache.put(url.href, response.clone());
            return response;
          });
        })
      )
    );
    return;
  }

  if (url.origin === self.location.origin) {
    // cache:'reload' でブラウザのHTTPキャッシュをバイパスし常に最新を取得。
    // （ESモジュール import にはバージョン文字列が付かず古い版が残るため）
    event.respondWith(
      fetch(request, { cache: 'reload' })
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
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
