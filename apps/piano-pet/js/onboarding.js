// ===== 初回オンボーディング（猫の吹き出し紙芝居・#141） =====
// 初回起動時に、何をするアプリかを猫（きーちゃん）の吹き出し3画面で案内する。
// 表示制御は localStorage の単独フラグのみ。新規アセットは持たず既存の猫SVGを流用する。
// 起動時に要るのはフラグだけなので、文面と画面は onboarding-ui.js に分けて未表示のときだけ読む（#365）。

// オンボーディング完了フラグの保存キー。端末ローカルの体験なのでクラウド同期(state)には
// 載せない（storage.js の state とは別キー）。新しい端末では改めて案内を出したい。
export const ONBOARD_KEY = 'piano-pet-onboarded';

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
