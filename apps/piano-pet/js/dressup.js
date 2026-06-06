// ===== きせかえ：衣装のドラッグ＋スナップ自由配置（#168） =====
// ホームの「きせかえ」編集モード中だけ、猫に乗った衣装(.cat__item)を pointer で動かせる。
// ドロップ時、その衣装の既定アンカー位置の近く（閾値内）なら定位置にスナップ（layoutから外して
// フォールバック描画に戻す）、遠ければ自由配置として layout に %座標を記録する。
// 座標はステージ(.cat / #catStage)基準の %。完全自由だと5歳児には絵が崩れやすいので吸着で補正する。
import { itemAnchorPct } from './cat-image.js';

const SNAP_THRESHOLD_PCT = 12;  // 既定アンカーへ吸着する距離（%・猫サイズ基準）

function clampPct(v) {
  return Math.max(0, Math.min(100, v));
}

// pointer 座標をステージ内の % に変換（はみ出しは 0-100 にclamp）。
function eventToPct(e, rect) {
  return {
    x_pct: clampPct(((e.clientX - rect.left) / rect.width) * 100),
    y_pct: clampPct(((e.clientY - rect.top) / rect.height) * 100),
  };
}

// <g> の transform を指定 %（→viewBox 0 0 200 200 系）に更新（scale は data-scale を維持）。
function setItemPos(el, x_pct, y_pct) {
  const s = el.dataset.scale || '1';
  el.setAttribute('transform', `translate(${(x_pct * 2).toFixed(1)} ${(y_pct * 2).toFixed(1)}) scale(${s})`);
}

/**
 * ステージに対して衣装ドラッグを有効化する。戻り値は解除関数。
 * stageEl  : #catStage（再描画されても不変な親。リスナはここと window に付ける）
 * getLayout: () => 現在の itemLayout（{ id: {x_pct,y_pct} }）
 * onCommit : (layout) => 確定した layout を渡す（app 側で state 保存＆再描画）
 */
export function enableDressup(stageEl, getLayout, onCommit) {
  let drag = null;

  function onDown(e) {
    const item = e.target.closest('.cat__item');
    if (!item || !stageEl.contains(item)) return;
    drag = { id: item.dataset.item, el: item, rect: stageEl.getBoundingClientRect(), cur: null };
    item.classList.add('cat__item--grabbing');
    e.preventDefault();
  }

  function onMove(e) {
    if (!drag) return;
    drag.cur = eventToPct(e, drag.rect);
    setItemPos(drag.el, drag.cur.x_pct, drag.cur.y_pct);
    e.preventDefault();
  }

  function onUp() {
    if (!drag) return;
    drag.el.classList.remove('cat__item--grabbing');
    if (drag.cur) {
      const anchor = itemAnchorPct(drag.id);
      const dist = anchor
        ? Math.hypot(drag.cur.x_pct - anchor.x_pct, drag.cur.y_pct - anchor.y_pct)
        : Infinity;
      const layout = { ...getLayout() };
      if (dist <= SNAP_THRESHOLD_PCT) {
        delete layout[drag.id];        // 既定アンカーへスナップ（フォールバック描画に戻す）
      } else {
        layout[drag.id] = drag.cur;    // 自由配置として記録
      }
      onCommit(layout);
    }
    drag = null;
  }

  stageEl.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);

  return function disable() {
    stageEl.removeEventListener('pointerdown', onDown);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    drag = null;
  };
}
