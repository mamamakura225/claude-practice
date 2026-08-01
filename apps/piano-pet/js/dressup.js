// ===== きせかえ：衣装のドラッグ自由配置（#168）＋2本指ピンチ拡縮（#205） =====
// ホームの「きせかえ」編集モード中だけ、猫に乗った衣装(.cat__item)を pointer で動かせる。
// 1本指＝ドラッグで移動、2本指＝ピンチで拡縮。
// ドロップ時は常に自由配置として layout に %座標(+scale)を記録する（#214 で位置スナップ廃止）。
// 座標はステージ(.cat / #catStage)基準の %。サイズだけは基準スケールへの吸着を残す（#205）。
import { itemAnchorPct, itemAnchorScale } from './cat-image.js';

const SCALE_MIN = 0.3;          // ピンチ下限（#205）
const SCALE_MAX = 3.0;          // ピンチ上限（#205）
const SCALE_SNAP_RATIO = 0.05;  // 基準スケールの ±5% 以内なら「元のサイズ」へ吸着
const PINCH_DEADZONE_PX = 10;   // 2指間距離がこの px を超えるまで拡縮を始めない（誤操作・ガタつき防止）

function clampPct(v) {
  return Math.max(0, Math.min(100, v));
}

function round3(v) {
  return parseFloat(v.toFixed(3));
}

// pointer 座標をステージ内の % に変換（はみ出しは 0-100 にclamp）。
function eventToPct(e, rect) {
  return {
    x_pct: clampPct(((e.clientX - rect.left) / rect.width) * 100),
    y_pct: clampPct(((e.clientY - rect.top) / rect.height) * 100),
  };
}

// 2点間のピクセル距離（ピンチの基準/現在距離に使う）。
function dist2(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// <g> の transform を指定 %（→viewBox 0 0 200 200 系）と絶対スケールに更新。
function setItemPos(el, x_pct, y_pct, scale) {
  el.dataset.scale = String(round3(scale));
  el.setAttribute('transform', `translate(${(x_pct * 2).toFixed(1)} ${(y_pct * 2).toFixed(1)}) scale(${round3(scale)})`);
}

/**
 * ステージに対して衣装ドラッグ／ピンチを有効化する。戻り値は解除関数。
 * stageEl  : #catStage（再描画されても不変な親。リスナはここと window に付ける）
 * getLayout: () => 現在の itemLayout（{ id: {x_pct,y_pct,scale?} | {scale} }）
 * onCommit : (layout) => 確定した layout を渡す（app 側で state 保存＆再描画）
 */
export function enableDressup(stageEl, getLayout, onCommit) {
  let drag = null;                  // 掴み中の衣装。{ id, el, rect, pointerId, pos, baseScale, curScale, dirty, pinch }
  const pointers = new Map();       // pointerId -> {x,y}（ステージ上で追跡中の全ポインタ）

  function onDown(e) {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // まだ何も掴んでいない → アイテム上で始まった指だけが掴みを開始する。
    if (!drag) {
      const item = e.target.closest('.cat__item');
      if (!item || !stageEl.contains(item)) { pointers.delete(e.pointerId); return; }
      const style = stageEl.querySelector('.cat')?.dataset.style;
      const id = item.dataset.item;
      const lpos = getLayout()[id];
      const anchor = itemAnchorPct(id, style);
      const pos = (lpos && lpos.x_pct != null)
        ? { x_pct: lpos.x_pct, y_pct: lpos.y_pct }
        : { ...(anchor ?? { x_pct: 50, y_pct: 50 }) };
      const baseScale = itemAnchorScale(id, style) ?? 1;
      drag = {
        id, el: item, rect: stageEl.getBoundingClientRect(), pointerId: e.pointerId,
        pos, baseScale, curScale: parseFloat(item.dataset.scale) || baseScale,
        dirty: false, pinch: null,
      };
      item.classList.add('cat__item--grabbing');
      e.preventDefault();
      return;
    }

    // 掴み中に2本目の指 → ピンチ開始（初期距離 d0・開始scale s0 を記録、デッドゾーン未通過）。
    if (!drag.pinch && pointers.size >= 2) {
      const idB = [...pointers.keys()].find((id) => id !== drag.pointerId);
      if (idB != null) {
        drag.pinch = {
          idA: drag.pointerId, idB,
          d0: dist2(pointers.get(drag.pointerId), pointers.get(idB)),
          s0: drag.curScale, active: false,
        };
        e.preventDefault();
      }
    }
  }

  function onMove(e) {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!drag) return;

    // ピンチ中（2指が揃っている）：位置は固定しスケールのみ更新する。
    const p = drag.pinch;
    if (p && pointers.has(p.idA) && pointers.has(p.idB)) {
      const d = dist2(pointers.get(p.idA), pointers.get(p.idB));
      if (!p.active) {
        if (Math.abs(d - p.d0) <= PINCH_DEADZONE_PX) { e.preventDefault(); return; }
        p.active = true; p.d0 = d; p.s0 = drag.curScale;   // 通過時に基準を取り直しジャンプを防ぐ
      }
      let s = Math.max(SCALE_MIN, Math.min(SCALE_MAX, p.s0 * (d / p.d0)));
      if (Math.abs(s - drag.baseScale) <= drag.baseScale * SCALE_SNAP_RATIO) s = drag.baseScale;
      drag.curScale = s;
      drag.dirty = true;
      setItemPos(drag.el, drag.pos.x_pct, drag.pos.y_pct, s);
      e.preventDefault();
      return;
    }

    // 1本指ドラッグ：掴んだ指の移動だけを位置に反映する。
    if (e.pointerId !== drag.pointerId) return;
    drag.pos = eventToPct(e, drag.rect);
    drag.dirty = true;
    setItemPos(drag.el, drag.pos.x_pct, drag.pos.y_pct, drag.curScale);
    e.preventDefault();
  }

  function onUp(e) {
    pointers.delete(e.pointerId);
    if (!drag) return;

    // ピンチの片指が離れたらピンチ終了（残った指はドラッグ継続可）。
    if (drag.pinch && (!pointers.has(drag.pinch.idA) || !pointers.has(drag.pinch.idB))) {
      drag.pinch = null;
    }
    if (pointers.size > 0) return;   // まだ指が残っている → ジェスチャ継続

    drag.el.classList.remove('cat__item--grabbing');
    if (drag.dirty) {
      // 位置スナップは廃止（#214）：常にドロップ座標を自由配置として記録する。
      // サイズは基準スケールなら座標のみ、変えていれば scale も持つ。
      const sc = drag.curScale;
      const atBase = Math.abs(sc - drag.baseScale) < 0.001;
      const layout = { ...getLayout() };
      const xy = { x_pct: drag.pos.x_pct, y_pct: drag.pos.y_pct };
      // エントリは作り直す（基準サイズに戻したら scale を残さない）が、前後レイヤー（#270）は
      // 位置の確定で失われないよう明示的に引き継ぐ。
      const keep = layout[drag.id]?.layer ? { layer: layout[drag.id].layer } : {};
      layout[drag.id] = atBase ? { ...keep, ...xy } : { ...keep, ...xy, scale: round3(sc) };
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
    pointers.clear();
    drag = null;
  };
}
