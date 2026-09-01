// 練習記録の短尺動画クリップ演出（#227）。記録ビューに入ったとき app.js から動的 import される
// （#284 の js-lazy 側）。動画は SW の precache 対象外・初回再生時に取得（→ features.md）。

// 差し替え時はファイル名を _v2 に（CLIPS がハッシュ対象の本ファイルにあるのでキャッシュがバストされる）。
// 1スタイル1本なので bag shuffle は入れない（2本以上になった時点で pickClip に足す）。
export const CLIPS = {
  tora:        [{ id: 'record_v1', src: './video/cat_tora_record_v1.mp4' }],
  shiro:       [{ id: 'record_v1', src: './video/cat_shiro_record_v1.mp4' }],
  russianblue: [{ id: 'record_v1', src: './video/cat_russianblue_record_v1.mp4' }],
};

// 再生できないと判定するまでの上限。prefetch 済みなら数十msで playing が来る。詰めすぎると
// 目標達成の「必ず再生」を低速回線で取りこぼす。
const PLAY_TIMEOUT_MS = 1000;

const clipsFor = (style) => CLIPS[style] ?? CLIPS.tora;

/** そのスタイルのクリップを1本選ぶ。未知スタイルは tora にフォールバック（rng 注入でテスト可能）。 */
export function pickClip(style, rng = Math.random) {
  const pool = clipsFor(style);
  return pool[Math.floor(rng() * pool.length)];
}

const reducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const prefetched = new Set();

/** 現在の猫スタイルのクリップを idle 先読みする（記録フォーム入力の間に取得を終わらせる）。 */
export function prime(style) {
  if (reducedMotion()) return;
  for (const { src } of clipsFor(style)) {
    if (prefetched.has(src)) continue;
    prefetched.add(src);
    const v = document.createElement('video');
    v.preload = 'auto';
    v.muted = true;
    v.src = src;
  }
}

const overlay = () => document.getElementById('catVideo');

// 進行中のクリップのタイマー・リスナー・クラスを同期的に全部畳む。フェード解放（finish）の保険
// タイマー／transitionend も含める。残すと、外れた直後の再記録で前回の finish が新しい <video> を
// 破棄してしまう（世代トークンと二重で防ぐ）。
function teardown(host) {
  clearTimeout(host._clipTimer);
  clearTimeout(host._clipLoopTimer);
  clearTimeout(host._clipFadeTimer);
  if (host._clipSkip) host.removeEventListener('click', host._clipSkip);
  if (host._clipFade) host.removeEventListener('transitionend', host._clipFade);
  host._clipSkip = host._clipFade = null;
  host.querySelector('video')?.pause();
  host.classList.remove('cat-video--show');
  document.body.classList.remove('cat-clip-playing');
}

// クリップを畳んでオーバーレイを解放する。gen が古ければ（次のクリップが始まっていれば）何もしない。
function release(host, gen) {
  if (!host || gen !== host._clipGen || host._clipSettled) return;
  host._clipSettled = true;
  teardown(host);
  const finish = () => {
    host.removeEventListener('transitionend', finish);
    clearTimeout(host._clipFadeTimer);
    if (gen !== host._clipGen) return;
    host.hidden = true;
    const v = host.querySelector('video');
    if (v) { v.pause(); v.removeAttribute('src'); v.load(); }
    host.textContent = '';
  };
  host._clipFade = finish;
  host.addEventListener('transitionend', finish);
  host._clipFadeTimer = setTimeout(finish, 400);   // transition が効かない環境の保険
}

/**
 * 猫の上に <video> を重ねて再生する。再生できたら true、出せなければ false（呼び出し側が既存CSS
 * 演出へフォールバック）。false: reduced-motion / mp4 非対応 / play() 拒否 / 上限内に playing 不着。
 * 動画中の再記録は世代トークンで前のクリップを畳んで張り替える。
 */
export async function tryPlay(style) {
  const host = overlay();
  if (!host || reducedMotion()) return false;

  const video = document.createElement('video');
  if (!video.canPlayType('video/mp4')) return false;

  const gen = host._clipGen = (host._clipGen || 0) + 1;
  teardown(host);
  host._clipSettled = false;
  host.textContent = '';

  video.src = pickClip(style).src;
  video.autoplay = true;
  video.muted = true;                    // 音は常に muted（効果音は sound.js に任せる）
  video.setAttribute('muted', '');
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.preload = 'auto';
  host.appendChild(video);
  host.hidden = false;

  const started = await new Promise((resolve) => {
    const to = setTimeout(() => resolve(false), PLAY_TIMEOUT_MS);
    const stop = (ok) => { clearTimeout(to); resolve(ok); };
    video.addEventListener('playing', () => stop(true), { once: true });
    video.addEventListener('error', () => stop(false), { once: true });
    Promise.resolve(video.play()).catch(() => stop(false));
  });
  if (gen !== host._clipGen) return false;        // 待つ間に次のクリップが始まった
  if (!started) { release(host, gen); return false; }

  host.classList.add('cat-video--show');
  document.body.classList.add('cat-clip-playing');   // 再生中はコインポップアップ等をクリップの前に出さない
  host._clipSkip = () => release(host, gen);          // タップで即スキップ
  host.addEventListener('click', host._clipSkip);
  // #296: 1本が短くて見逃すので、2回ループしてから畳む。video.loop は使わない
  // （ended が飛ばず終了検知・世代管理が崩れる）。明示的に1回だけ巻き戻す。
  let looped = false;
  const rewindOnce = () => {
    if (looped || gen !== host._clipGen || host._clipSettled) return;
    looped = true;
    video.currentTime = 0;
    Promise.resolve(video.play()).catch(() => release(host, gen));
  };
  video.addEventListener('ended', () => {
    if (gen !== host._clipGen || host._clipSettled) return;
    if (!looped) { rewindOnce(); return; }
    release(host, gen);
  });
  const dur = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 4;
  // ended 不着の端末では最終フレームで固まるので、尺経過で明示的に巻き戻す（1周＋静止を避ける）
  host._clipLoopTimer = setTimeout(rewindOnce, (dur + 0.4) * 1000);
  host._clipTimer = setTimeout(() => release(host, gen), (dur * 2 + 1) * 1000);  // 2周ぶんの最終保険
  return true;
}
