// ===== モーダル共通の操作（#397） =====
// せってい・じぶんの アイコン・オンボーディングの3つで共有する。開いたら中へフォーカスを移し、
// Tab は中で循環、Esc とブラウザの戻る（hashchange）で閉じ、閉じたら開いたボタンへフォーカスを戻す。
// 閉じ方（保存・フラグ立て）は各モーダルで違うので onClose に任せ、onClose が closeDialog を呼ぶ。

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';
const stack = [];

function focusables(el) {
  return [...el.querySelectorAll(FOCUSABLE)].filter((f) => f.getClientRects().length > 0);
}

// 中の最初の操作要素（または initial）へフォーカスを移す。中身を切り替えたとき（ゲート→メニュー）にも使う。
export function focusIn(el, initial) {
  (initial ?? focusables(el)[0])?.focus();
}

export function openDialog(el, { onClose, initial } = {}) {
  wire();
  if (!stack.some((d) => d.el === el)) stack.push({ el, onClose, opener: document.activeElement });
  el.hidden = false;
  focusIn(el, initial);
}

export function closeDialog(el) {
  el.hidden = true;
  const i = stack.findIndex((d) => d.el === el);
  if (i < 0) return;
  const [d] = stack.splice(i, 1);
  if (d.opener?.isConnected) d.opener.focus();
}

const requestClose = (d) => (d.onClose ? d.onClose() : closeDialog(d.el));

function onKeydown(e) {
  const top = stack.at(-1);
  if (!top || top.el.hidden) return;
  if (e.isComposing || e.keyCode === 229) return;   // 日本語変換の取り消しの Esc で閉じない
  if (e.key === 'Escape') {
    e.preventDefault();
    requestClose(top);
  } else if (e.key === 'Tab') {
    const list = focusables(top.el);
    if (!list.length) return;
    const first = list[0];
    const last = list[list.length - 1];
    const inside = top.el.contains(document.activeElement);
    if (e.shiftKey && (document.activeElement === first || !inside)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (document.activeElement === last || !inside)) { e.preventDefault(); first.focus(); }
  }
}

// Android の戻る等で画面が変わったら、開いているモーダルを閉じる（背面だけ遷移して残らないように）
function onHashChange() {
  for (const d of [...stack].reverse()) requestClose(d);
}

// リスナーは最初に開いたときに張る（読み込むだけで document に触れない＝node のテストからも読める）
let wired = false;
function wire() {
  if (wired) return;
  wired = true;
  document.addEventListener('keydown', onKeydown);
  window.addEventListener('hashchange', onHashChange);
}
