// ===== 初回オンボーディングの画面（#141・遅延読込 #365） =====
// 紙芝居の文面・ステップ送り・DOM。初回起動の1回しか使わないので、app.js は
// 「まだ見ていない」ときだけ動的 import する（見た端末では一度も読まない）。
import { setOnboarded } from './onboarding.js';

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

// 与えたステップ番号が最後の画面か（「つぎへ」を「はじめる！」に切り替える判定に使う）。
export function isLastStep(index) {
  return index >= ONBOARD_STEPS.length - 1;
}

// 「つぎへ」で進む次のステップ番号。最後なら範囲内に留める（呼び出し側で完了処理に分岐）。
export function nextStepIndex(index) {
  return Math.min(index + 1, ONBOARD_STEPS.length - 1);
}

const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
let step = 0;

function renderStep() {
  const s = ONBOARD_STEPS[step];
  setText('onboardingEmoji', s.emoji);
  setText('onboardingTitle', s.title);
  setText('onboardingBody', s.body);
  const dotsEl = document.getElementById('onboardingDots');
  if (dotsEl) {
    dotsEl.innerHTML = ONBOARD_STEPS
      .map((_, i) => `<span class="onboarding__dot${i === step ? ' is-active' : ''}"></span>`)
      .join('');
  }
  setText('onboardingNext', isLastStep(step) ? 'はじめる！' : 'つぎへ');
}

// 完了（スキップ／はじめる いずれも）：フラグを立てて二度と出さない。
function finish() {
  setOnboarded();
  const el = document.getElementById('onboardingOverlay');
  if (el) el.hidden = true;
}

// catHtml はホームと同じ猫描画（新規アセットなし）。app.js が catMarkup で組んで渡す。
export function showOnboarding(catHtml) {
  const el = document.getElementById('onboardingOverlay');
  if (!el) return;
  step = 0;
  const catEl = document.getElementById('onboardingCat');
  if (catEl) catEl.innerHTML = catHtml;
  renderStep();
  document.getElementById('onboardingNext')?.addEventListener('click', () => {
    if (isLastStep(step)) { finish(); return; }
    step = nextStepIndex(step);
    renderStep();
  });
  document.getElementById('onboardingSkip')?.addEventListener('click', finish);
  el.hidden = false;
}
