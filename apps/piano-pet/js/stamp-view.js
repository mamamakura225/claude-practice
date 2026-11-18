// ねこスタンプちょう（#409）の画面（遅延読込）
import { escapeHtml } from './html.js';
import { openDialog, closeDialog } from './dialog.js';
import { STAMP_THRESHOLD, cardStatus, normalizeRewardEmoji } from './stamp-book.js';

export * from './stamp-book.js';

const md = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`;
const rewardText = (c) => `${normalizeRewardEmoji(c.emoji)} ${escapeHtml(c.reward || 'ごほうび')}`;

export const stampFace = (design, date) =>
  `<img class="sb-stamp" src="img/stamp/${design.id}.webp" alt="${design.name}（${md(date)}）">`;

function cellMarkup(slot, i, card) {
  if (slot?.pressed) return `<li class="sb-cell sb-cell--done">${stampFace(slot.design, slot.date)}</li>`;
  if (slot) {
    return `<li class="sb-cell sb-cell--ready"><button type="button" class="sb-press" data-date="${slot.date}"`
      + ` aria-label="${md(slot.date)} の スタンプを おす"><span class="sb-press__paw" aria-hidden="true">🐾</span>おしてね</button></li>`;
  }
  const last = i === card.size - 1;
  return `<li class="sb-cell${last ? ' sb-cell--goal' : ''}"><span class="sb-num">${last ? normalizeRewardEmoji(card.emoji) : i + 1}</span></li>`;
}

function message(st, today) {
  const left = st.card.size - st.slots.length;
  if (st.full) return '';
  if (st.pendingCount) return 'スタンプを おしてね！';
  if (st.card.startDate > today) return 'あしたから また あつめよう！';
  if (st.todayStamped) return `きょうの スタンプ もらったよ！ あと ${left} こ で ごほうび`;
  return `きょうは あと ${STAMP_THRESHOLD - Math.min(st.todayCount, STAMP_THRESHOLD)} かい ひくと スタンプ！`;
}

function doneMarkup(done) {
  if (!done.length) return '';
  const rows = [...done].reverse()
    .map((c) => `<li>${rewardText(c)}（${c.dates.length}こ${c.redeemedOn ? `・${md(c.redeemedOn)}` : ''}）</li>`).join('');
  return `<details class="sb-done"><summary>おわった カード（${done.length}）</summary><ul>${rows}</ul></details>`;
}

export function bookMarkup(state, today) {
  const st = cardStatus(state, today);
  const done = doneMarkup(state.pet.stampBook.done);
  if (!st.card) {
    return `<div class="sb-card sb-card--empty"><p class="sb-empty__icon" aria-hidden="true">🐱</p>`
      + '<p>まだ カードが ないよ。<br>おうちの ひとに ごほうびを きめて もらおう！</p></div>' + done;
  }
  const cells = Array.from({ length: st.card.size }, (_, i) => cellMarkup(st.slots[i], i, st.card)).join('');
  return `<div class="sb-card">
    <p class="sb-head">${rewardText(st.card)}</p>
    <p class="sb-count"><b>${st.pressedCount}</b> / ${st.card.size} こ</p>
    ${st.full ? '<p class="sb-goal" id="sbGoal">🎉 ごほうび ゲット！<br>おうちの ひとに みせてね</p>' : `<p class="sb-msg">${message(st, today)}</p>`}
    <ol class="sb-grid">${cells}</ol>
  </div>${done}`;
}

export function homeSummary(state, today) {
  const st = cardStatus(state, today);
  if (!st.card) return null;
  const count = `${st.pressedCount}/${st.card.size}`;
  const reward = `${normalizeRewardEmoji(st.card.emoji)} ${st.card.reward || 'ごほうび'}`;
  if (st.full) return { text: `🎉 ごほうび ゲット！（${reward}）`, ready: true };
  if (st.pendingCount) return { text: `🐾 スタンプを おしてね！（${count}）`, ready: true };
  return { text: `🐾 スタンプ ${count} ・ ${reward}`, ready: false };
}

// 画面いっぱいに押してから、マスへ縮んで収まる（features.md #ねこスタンプちょう）
export function animatePress(btn, design, date) {
  const cell = btn.closest('.sb-cell');
  if (!cell) return Promise.resolve();
  cell.className = 'sb-cell sb-cell--done';
  cell.innerHTML = stampFace(design, date);
  cell.style.visibility = 'hidden';
  const veil = document.createElement('div');
  veil.style.cssText = 'position:fixed;inset:0;z-index:80;display:grid;place-items:center;pointer-events:none;background:rgb(0 0 0/.35)';
  veil.innerHTML = `<div class="sb-cell--peta" style="position:relative;display:grid;place-items:center;width:min(80vw,60vh)">`
    + `${stampFace(design, date)}<img class="sb-paw" src="img/stamp/paw.webp" alt=""></div>`;
  document.body.append(veil);
  const big = veil.firstChild;
  veil.getAnimations({ subtree: true }).forEach((a) => { a.playbackRate = 0.6; });   // ゆっくり押す
  return new Promise((resolve) => setTimeout(() => {
    const to = cell.getBoundingClientRect();
    const from = big.getBoundingClientRect();
    const move = `translate(${to.x + to.width / 2 - from.x - from.width / 2}px,${to.y + to.height / 2 - from.y - from.height / 2}px) scale(${to.width / from.width})`;
    big.animate([{ transform: 'none' }, { transform: move }], { duration: 350, easing: 'ease-in', fill: 'forwards' });
    veil.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 350, fill: 'forwards' });
    setTimeout(() => { veil.remove(); cell.style.visibility = ''; resolve(); }, 350);
  }, 1250));
}

// ごほうび ゲット：全画面で文字が跳ねて紙吹雪が降る。どこをタップしても閉じる（features.md）
const CONFETTI = ['#e0574f', '#3d86d4', '#3a9e68', '#9563cc', '#f2b33d'];
export function celebrateGoal(card) {
  const veil = document.createElement('div');
  veil.className = 'sb-party';
  veil.setAttribute('role', 'dialog');
  veil.setAttribute('aria-modal', 'true');
  veil.setAttribute('aria-label', 'ごほうび ゲット');
  veil.style.cssText = 'position:fixed;inset:0;z-index:80;display:grid;place-content:center;justify-items:center;gap:10px;overflow:hidden;'
    + 'background:rgb(0 0 0/.6);color:#fff;text-align:center;font-weight:700;padding:16px';
  veil.innerHTML = `<p style="margin:0;font:2.4rem 'Mochiy Pop One',sans-serif">ごほうび ゲット！</p>`
    + `<p style="margin:0;font-size:1.2rem">${escapeHtml(card.reward || 'ごほうび')}<br>おうちの ひとに みせてね</p>`
    + '<button type="button" style="margin-top:8px;padding:12px 32px;border:none;border-radius:999px;background:var(--pink-fill);color:#fff;font:700 1.1rem sans-serif">やったね！</button>';
  veil.firstChild.animate([{ transform: 'scale(0)' }, { transform: 'scale(1.25)', offset: 0.6 }, { transform: 'none' }],
    { duration: 800, easing: 'ease-out' });
  for (let i = 0; i < 40; i++) {
    const bit = document.createElement('i');
    bit.style.cssText = `position:absolute;top:-24px;left:${Math.random() * 100}%;width:10px;height:16px;border-radius:2px;background:${CONFETTI[i % 5]}`;
    veil.append(bit);
    bit.animate([{ transform: 'none' }, { transform: `translateY(${innerHeight + 48}px) rotate(${(Math.random() - 0.5) * 1080}deg)` }],
      { duration: 2400 + Math.random() * 1600, delay: Math.random() * 1500, iterations: Infinity });
  }
  const close = () => { closeDialog(veil); veil.remove(); };
  veil.addEventListener('click', close);
  document.body.append(veil);
  openDialog(veil, { onClose: close, initial: veil.querySelector('button') });
}
