// ===== 効果音（Web Audio API） =====
// 多くのSEは音声ファイル不要のシンセ（SOUND_SPECS：周波数/タイミングのデータ）。
// なでた時の鳴き声だけは本物の猫の録音サンプル（MEOW_SOUNDS / playMeow）を使う。
// 再生は AudioContext を遅延生成して鳴らし、AudioContext はユーザー操作後に
// 初期化される（自動再生ポリシー対策）。テストからは pure な
// isSoundOn / toggleSound のみ利用する（AudioContext には触れない）。

// ----- 設定（pure） -----
export function isSoundOn(state) {
  return state?.settings?.soundOn !== false;
}

export function toggleSound(state) {
  const soundOn = !isSoundOn(state);
  return { ...state, settings: { ...(state.settings ?? {}), soundOn } };
}

// ----- 音色データ（音名: 音符の並び） -----
// note = { f: 周波数Hz, t: 開始秒, d: 長さ秒, type: 波形, g: 音量 }
const N = (f, t, d, g = 0.2, type = 'sine') => ({ f, t, d, g, type });

export const SOUND_SPECS = {
  // コイン獲得：高めの2連符
  coin: [N(988, 0, 0.08, 0.18, 'square'), N(1319, 0.08, 0.12, 0.18, 'square')],
  // レベルアップ：上昇アルペジオ
  levelup: [
    N(523, 0, 0.1, 0.2, 'triangle'),
    N(659, 0.1, 0.1, 0.2, 'triangle'),
    N(784, 0.2, 0.1, 0.2, 'triangle'),
    N(1047, 0.3, 0.22, 0.22, 'triangle'),
  ],
  // 練習記録完了：やわらかいチャイム
  record: [N(784, 0, 0.14, 0.18, 'sine'), N(1047, 0.12, 0.26, 0.18, 'sine')],
  // アイテム購入：軽い2音（カチン）
  purchase: [N(660, 0, 0.07, 0.18, 'square'), N(880, 0.07, 0.16, 0.18, 'square')],
  // ハンコを押す：やわらかい「ポン」
  stamp: [N(440, 0, 0.05, 0.16, 'triangle'), N(294, 0.03, 0.12, 0.18, 'sine')],
};

// なでた時の鳴き声は録音サンプル（本物の猫の声）。シンセSEとは別系統で扱う。
// 複数からランダムに鳴らすので、なでるたび少し違って飽きにくい。パスは
// import.meta.url 基準で解決し、ページの <base> や配信パスに依存させない。
export const MEOW_SOUNDS = [
  new URL('../sounds/meow1.mp3', import.meta.url).href,
  new URL('../sounds/meow2.mp3', import.meta.url).href,
];

// ----- 再生エンジン（ブラウザのみ） -----
let ctx = null;

function getCtx() {
  if (typeof window === 'undefined') return null;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

// ユーザー操作ハンドラ内で呼ぶと AudioContext を解錠できる
export function unlockAudio() {
  getCtx();
}

// name の効果音を鳴らす。サウンドOFF・未対応環境では何もしない。
export function playSound(name, state) {
  if (!isSoundOn(state)) return;
  const spec = SOUND_SPECS[name];
  if (!spec) return;
  const audio = getCtx();
  if (!audio) return;

  const now = audio.currentTime;
  for (const note of spec) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = note.type;
    osc.frequency.value = note.f;
    // 短いアタック＋指数フェードでプチノイズを抑える
    const start = now + note.t;
    const end = start + note.d;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(note.g, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    osc.connect(gain).connect(audio.destination);
    osc.start(start);
    osc.stop(end + 0.02);
  }
}

// デコード済み AudioBuffer のキャッシュ（URL -> Promise<AudioBuffer>）。
// 初回だけ fetch + デコードし、2回目以降は即再生できるようにする。
const sampleCache = new Map();

function loadSample(url, audio) {
  let p = sampleCache.get(url);
  if (!p) {
    p = fetch(url)
      .then((res) => res.arrayBuffer())
      .then((buf) => audio.decodeAudioData(buf));
    sampleCache.set(url, p);
  }
  return p;
}

// なでた時の鳴き声を MEOW_SOUNDS からランダムに1つ再生する。
// サウンドOFF・未対応環境・取得失敗時は無音（猫のリアクション演出は別途出る）。
export function playMeow(state) {
  if (!isSoundOn(state)) return;
  if (typeof fetch !== 'function') return;
  const audio = getCtx();
  if (!audio || typeof audio.decodeAudioData !== 'function') return;

  const url = MEOW_SOUNDS[Math.floor(Math.random() * MEOW_SOUNDS.length)];
  loadSample(url, audio)
    .then((buffer) => {
      const src = audio.createBufferSource();
      src.buffer = buffer;
      const gain = audio.createGain();
      gain.gain.value = 0.9;
      src.connect(gain).connect(audio.destination);
      src.start();
    })
    .catch(() => {});  // ネットワーク/デコード失敗は握りつぶす（演出は継続）
}
