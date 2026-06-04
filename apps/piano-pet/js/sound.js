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
};
// ハンコ音は固定SEではなく playStamp(index) でドレミ…と音程を変えて鳴らす(#139)。

// ----- スタンプ音階（ドレミフィードバック・#139） -----
// スタンプを押すたびに音程が上がり、目標マス（最後の1マス）で高いド＝オクターブに
// 解決する。基準は ド=C4。追加アセット0で、周波数を平均律で計算して鳴らすだけ。
export const STAMP_BASE_FREQ = 261.63; // ド（C4）

// Cメジャー音階 ド レ ミ ファ ソ ラ シ の半音オフセット。
const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];

// index(0始まり) のスタンプが鳴らす半音オフセットを返す（pure）。
// ドレミ…と上がり、目標達成のマス（index === goal-1）は高いド(+12)で締める。
// 設計判断: issue #139 の実装例は半音上昇(2^(i/12))だが、それでは「ドレミの音程感覚を
// 養う」狙いが満たせないため、ダイアトニック（メジャー音階）を採用。目標マスは headline
// 通り高いドへ解決させる（レ→ド の終止感を優先し、厳密な単調増加は要件としない）。
export function stampSemitone(index, goal = 10) {
  const i = Math.max(0, Math.floor(index) || 0);
  if (goal > 0 && i >= goal - 1) return 12; // 目標マスは高いド（オクターブ）
  return MAJOR_SCALE[i % MAJOR_SCALE.length] + 12 * Math.floor(i / MAJOR_SCALE.length);
}

// index のスタンプの周波数(Hz)。ド=C4 基準の平均律（pure）。
export function stampFrequency(index, goal = 10) {
  return STAMP_BASE_FREQ * 2 ** (stampSemitone(index, goal) / 12);
}

// なでた時の鳴き声は録音サンプル（本物の猫の声）。シンセSEとは別系統で扱う。
// 基本は MEOW_SOUNDS からランダム、たまに HISS_SOUNDS（威嚇）に切り替わる。
// パスは import.meta.url 基準で解決し、ページの <base> や配信パスに依存させない。
export const MEOW_SOUNDS = [
  new URL('../sounds/meow1.mp3', import.meta.url).href,
  new URL('../sounds/meow2.mp3', import.meta.url).href,
  new URL('../sounds/meow3.mp3', import.meta.url).href,
];

// 威嚇（シャー）。基本は鳴き声で、たまにこれが混ざるくらいの低頻度に抑える。
export const HISS_SOUNDS = [
  new URL('../sounds/hiss1.mp3', import.meta.url).href,
];

// 1回のなでなでで威嚇になる確率（残りは MEOW_SOUNDS）。
const HISS_CHANCE = 0.15;

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

// 効果音が鳴り終わってからアイドルで AudioContext を suspend するまでの猶予(ms)。
// running のままだと音声ハードウェアが起きっぱなしでモバイルのバッテリを食うため、
// 最後の再生からこの時間で自動 suspend する。次の再生で getCtx() が resume するので
// 体感の遅延はない（#146）。
const IDLE_SUSPEND_MS = 3000;
let idleTimer = null;

// 再生のたびに呼び、アイドルが続いたら AudioContext を休ませる。
function scheduleIdleSuspend() {
  if (typeof window === 'undefined') return;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(suspendAudio, IDLE_SUSPEND_MS);
}

// AudioContext を休ませる（running のときだけ）。タブ非アクティブ時やアイドル時に呼ぶ。
// 次の再生で getCtx() が resume するため、状態は失わない。
export function suspendAudio() {
  if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {});
}

// 休止中の AudioContext を起こす（タブ復帰時に呼ぶ）。解錠済み（一度ユーザー操作で
// 生成済み）の ctx を resume するだけなので自動再生ポリシーには抵触しない。
export function resumeAudio() {
  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
}

// note 配列（SOUND_SPECS の1エントリ形式）をオシレータで鳴らす。
// 短いアタック＋指数フェードでプチノイズを抑える。再生エンジン共通の中核。
function playNotes(audio, notes) {
  const now = audio.currentTime;
  for (const note of notes) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = note.type;
    osc.frequency.value = note.f;
    const start = now + note.t;
    const end = start + note.d;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(note.g, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    osc.connect(gain).connect(audio.destination);
    osc.start(start);
    osc.stop(end + 0.02);
  }
  scheduleIdleSuspend();   // 鳴り終わったらアイドルで休ませる（#146）
}

// name の効果音を鳴らす。サウンドOFF・未対応環境では何もしない。
export function playSound(name, state) {
  if (!isSoundOn(state)) return;
  const spec = SOUND_SPECS[name];
  if (!spec) return;
  const audio = getCtx();
  if (!audio) return;
  playNotes(audio, spec);
}

// 目標マスかどうか（最後の1マス）。stampSemitone と同じ index 正規化・しきい値を使う。
function isGoalStamp(index, goal) {
  return goal > 0 && (Math.max(0, Math.floor(index) || 0) >= goal - 1);
}

// index のスタンプで鳴らす note 配列を組み立てる（pure・テスト可能）。
// 通常マスは主音＋1オクターブ下のボディの2音でやわらかい「ポン」。
// 目標マス（最後の1マス）は単音ではなく Cメジャー主和音（ド・ミ・ソ）＋ボディで
// 「シャラーン」と解決させ、達成を豪華なごほうびにする(#154)。和音は音数が増えるぶん
// 各 gain を下げて濁りを防ぎ、余韻が次のレベルアップ音に被るよう少し長めに鳴らす。
export function stampNotes(index, goal = 10) {
  const f = stampFrequency(index, goal); // 主音（目標マスは高いド）
  if (isGoalStamp(index, goal)) {
    return [
      N(f, 0, 0.3, 0.16, 'triangle'),               // ド（主音）
      N((f * 5) / 4, 0.01, 0.3, 0.13, 'triangle'),  // ミ（長三度）
      N((f * 3) / 2, 0.02, 0.3, 0.13, 'triangle'),  // ソ（完全五度）
      N(f / 2, 0.02, 0.16, 0.12, 'sine'),           // ボディ（1オクターブ下）
    ];
  }
  return [
    N(f, 0, 0.18, 0.18, 'triangle'),
    N(f / 2, 0.02, 0.12, 0.14, 'sine'),
  ];
}

// スタンプ押下音。index に応じてドレミ…と音程が上がり、目標マスは主和音で解決する(#139, #154)。
// サウンドOFF・未対応環境では無音（既存トグルに従う）。
export function playStamp(index, state, goal = 10) {
  if (!isSoundOn(state)) return;
  const audio = getCtx();
  if (!audio) return;
  playNotes(audio, stampNotes(index, goal));
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

// なで反応の種類 'meow' | 'hiss' を抽選する（音設定・環境に依存しない純粋関数）。
// 'hiss'＝威嚇。喜び演出の出し分け（威嚇なら止める）と鳴き声の再生で同じ抽選結果を
// 共有させるため、抽選を再生から切り離している。これにより**サウンドOFFでも**威嚇による
// 演出抑制が一貫して効く（再生側に抽選を埋めると、ミュート時に抽選自体が走らず
// 抑制が機能しなくなる）。
export function rollCatVoice() {
  return Math.random() < HISS_CHANCE ? 'hiss' : 'meow';
}

// rollCatVoice() が返した種類の鳴き声サンプルを再生する（音だけを担う）。
// サウンドOFF・未対応環境・該当サンプルなし・取得失敗時は無音。演出の出し分けは
// 呼び出し側が rollCatVoice の戻り値で判断する。
export function playCatVoice(state, kind) {
  if (!isSoundOn(state)) return;
  if (typeof fetch !== 'function') return;
  const audio = getCtx();
  if (!audio || typeof audio.decodeAudioData !== 'function') return;

  const pool = kind === 'hiss' ? HISS_SOUNDS : MEOW_SOUNDS;
  if (pool.length === 0) return;
  const url = pool[Math.floor(Math.random() * pool.length)];
  loadSample(url, audio)
    .then((buffer) => {
      const src = audio.createBufferSource();
      src.buffer = buffer;
      const gain = audio.createGain();
      gain.gain.value = 0.9;
      src.connect(gain).connect(audio.destination);
      src.start();
      scheduleIdleSuspend();   // 鳴き終わったらアイドルで休ませる（#146）
    })
    .catch(() => {});  // ネットワーク/デコード失敗は握りつぶす
}
