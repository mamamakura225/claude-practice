// ねこスタンプちょう（#409）の画面（遅延読込）
import { escapeHtml } from './html.js';
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
  return new Promise((resolve) => setTimeout(() => {
    const to = cell.getBoundingClientRect();
    const from = big.getBoundingClientRect();
    const move = `translate(${to.x + to.width / 2 - from.x - from.width / 2}px,${to.y + to.height / 2 - from.y - from.height / 2}px) scale(${to.width / from.width})`;
    big.animate([{ transform: 'none' }, { transform: move }], { duration: 300, easing: 'ease-in', fill: 'forwards' });
    veil.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: 'forwards' });
    setTimeout(() => { veil.remove(); cell.style.visibility = ''; resolve(); }, 300);
  }, 750));
}
