// せってい：ねこスタンプちょうの ごほうび（#409・遅延読込）
import { escapeHtml } from './html.js';
import {
  REWARD_EMOJIS, REWARD_MAX_LEN, CARD_MIN, CARD_MAX, STAMP_THRESHOLD,
  cardStatus, saveCard, redeemCard, clampCardSize, normalizeRewardEmoji, normalizeReward,
} from './stamp-book.js';

export function initStampSettings({ getState, today, save }) {
  const el = document.getElementById('stampSettings');
  let emoji = REWARD_EMOJIS[0];
  let note = '';

  const render = () => {
    if (!el) return;
    const state = getState();
    const st = cardStatus(state, today());
    const head = `<h2 class="settings-panel__title" id="stampSetTitle">ねこスタンプちょう（ごほうび）</h2>
      <p class="settings-menu__desc">1日 ${STAMP_THRESHOLD}かい いじょう ひいた ひに スタンプが 1こ もらえます（レッスンびは かぞえません）。きめた かずが あつまったら ごほうびです。</p>`;
    if (st.full) {
      el.innerHTML = `${head}<p class="settings-menu__desc">カードが うまりました：${normalizeRewardEmoji(st.card.emoji)} ${escapeHtml(st.card.reward)}。ごほうびを あげたら おしてください。つぎの カードを つくれます。</p>
        <button type="button" class="settings-btn settings-btn--block" id="stampRedeemBtn" data-card="${st.card.id}">ごほうびを あげた</button>`;
      return;
    }
    const card = st.card;
    emoji = normalizeRewardEmoji(card?.emoji ?? emoji);
    el.innerHTML = `${head}
      ${card ? `<p class="settings-menu__desc">いまの カード：${st.pressedCount} / ${card.size}こ</p>` : ''}
      <input type="text" id="stampRewardInput" class="field-input" maxlength="${REWARD_MAX_LEN}" placeholder="れい：どうぶつえん" aria-label="ごほうびの なかみ" value="${escapeHtml(card?.reward ?? '')}">
      <div class="stamp-emoji" role="group" aria-label="ごほうびの えもじ">${REWARD_EMOJIS.map((e) => `<button type="button" class="stamp-emoji__btn" data-emoji="${e}" aria-pressed="${e === emoji}">${e}</button>`).join('')}</div>
      <div class="settings-goal__row">
        <button type="button" class="settings-btn settings-btn--ghost goal-step" data-step="-1" aria-label="かずを へらす">−</button>
        <input type="number" id="stampSizeInput" class="field-input settings-goal__input" inputmode="numeric" min="${CARD_MIN}" max="${CARD_MAX}" step="1" value="${card?.size ?? 10}" aria-label="なんこで ごほうび">
        <button type="button" class="settings-btn settings-btn--ghost goal-step" data-step="1" aria-label="かずを ふやす">＋</button>
      </div>
      <button type="button" class="settings-btn settings-btn--block" id="stampSaveBtn" data-card="${card?.id ?? ''}">${card ? 'なおす' : 'カードを つくる'}</button>
      <p class="settings-menu__desc stamp-set-note" role="status">${note}</p>`;
    note = '';
  };

  el?.addEventListener('click', (e) => {
    const sizeEl = document.getElementById('stampSizeInput');
    const pick = e.target.closest('.stamp-emoji__btn');
    if (pick) {
      emoji = pick.dataset.emoji;
      el.querySelectorAll('.stamp-emoji__btn').forEach((b) => b.setAttribute('aria-pressed', String(b === pick)));
      return;
    }
    const step = e.target.closest('[data-step]');
    if (step && sizeEl) {
      sizeEl.value = String(clampCardSize(Number(sizeEl.value) + Number(step.dataset.step)));
      return;
    }
    const state = getState();
    // 開いたあとに別の端末でカードが替わっていたら、古い画面のまま確定しない（描き直すだけ）
    const act = e.target.closest('[data-card]');
    if (act && act.dataset.card !== String(state.pet.stampBook.card?.id ?? '')) {
      note = 'カードが かわったので よみなおしました';
      render();
      return;
    }
    if (e.target.closest('#stampRedeemBtn')) {
      const next = redeemCard(state, today());
      if (next !== state.pet.stampBook) save(next);
      note = next.card ? '' : 'つぎの カードを つくってね';
      render();
      return;
    }
    if (e.target.closest('#stampSaveBtn')) {
      const reward = normalizeReward(document.getElementById('stampRewardInput')?.value);
      if (!reward) {
        el.querySelector('.stamp-set-note').textContent = 'ごほうびの なかみを いれてね';
        return;
      }
      const editing = Boolean(state.pet.stampBook.card);
      save(saveCard(state.pet.stampBook, { reward, emoji, size: sizeEl?.value }, today()));
      note = editing ? 'なおしました' : 'カードを つくりました';
      render();
    }
  });

  return render;
}
