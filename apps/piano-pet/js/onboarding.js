// ===== 初回オンボーディング（猫の吹き出し紙芝居・#141） =====
// 初回起動時に、何をするアプリかを猫（きーちゃん）の吹き出し3画面で案内する。
// 表示制御は localStorage の単独フラグのみ。新規アセットは持たず既存の猫SVGを流用する。

// オンボーディング完了フラグの保存キー。端末ローカルの体験なのでクラウド同期(state)には
// 載せない（storage.js の state とは別キー）。新しい端末では改めて案内を出したい。
export const ONBOARD_KEY = 'piano-pet-onboarded';

// 紙芝居の3画面。ひらがな主体・短文。emoji は吹き出しの見出しアイコン（新規画像を持たない方針）。
export const ONBOARD_STEPS = [
  {
    emoji: '🐾',
    title: 'れんしゅうを きろく',
    body: 'ピアノの れんしゅうが おわったら ハンコを ぽん！まいにち きろくしよう。',
  },
  {
    emoji: '🪙',
    title: 'ごほうびが もらえる',
    body: 'きろくすると コインが もらえて、きーちゃんが どんどん おおきく そだつよ。',
  },
  {
    emoji: '🎀',
    title: 'きせかえ・ごはん',
    body: 'コインで リボンや ぼうしを かったり、ごはんを あげて なかよしに なろう！',
  },
];

// 既にオンボーディングを見たか。読み取り失敗時（プライベートモード等）は「見た」とみなして
// 案内を出さない（毎回うるさく出すより無害な方に倒す）。
export function isOnboarded() {
  try {
    return localStorage.getItem(ONBOARD_KEY) === '1';
  } catch {
    return true;
  }
}

// オンボーディング完了を記録する。保存できなくてもアプリ本体は動くので握りつぶす。
export function setOnboarded() {
  try {
    localStorage.setItem(ONBOARD_KEY, '1');
  } catch { /* 保存不可でも致命的でない */ }
}

// 与えたステップ番号が最後の画面か（「つぎへ」を「はじめる！」に切り替える判定に使う）。
export function isLastStep(index) {
  return index >= ONBOARD_STEPS.length - 1;
}

// 「つぎへ」で進む次のステップ番号。最後なら範囲内に留める（呼び出し側で完了処理に分岐）。
export function nextStepIndex(index) {
  return Math.min(index + 1, ONBOARD_STEPS.length - 1);
}
