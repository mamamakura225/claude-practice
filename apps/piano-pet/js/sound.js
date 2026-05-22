// ===== 効果音（Web Audio API・音声ファイル不要のシンセSE） =====
// 音色は周波数/タイミングのデータ（SOUND_SPECS）として定義し、再生は
// AudioContext を遅延生成して鳴らす。AudioContext はユーザー操作後に
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
