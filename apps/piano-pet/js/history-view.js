// ===== 「きろく」画面の HTML 組み立て（遅延読込・#382） =====
// きろくビューでしか使わない純粋な文字列組み立て。データ側の history.js（#324）と合わせて
// このモジュール1つを app.js が「きろく」に入ったときだけ読む（js-entry の予算確保）。
import { escapeHtml } from './html.js';
import { combineSongs, isSongMaster, PRAISE_STAMPS, normalizePraise, TEMPO_STAMPS, normalizeTempo } from './record-form.js';
import { songColor } from './song-color.js';
import { formatDateJa } from './history.js';

export * from './history.js';

// 週ごとの合計回数を SVG の棒グラフにする
export function weeklyChartSvg(bars) {
  const N = bars.length;
  const W = N * 30;
  const H = 120;
  const topPad = 12;     // 値ラベルの余白
  const baseline = H - 16; // 棒の下端（この下に週ラベル）
  const barMaxH = baseline - topPad;
  const slotW = W / N;
  const barW = slotW * 0.58;

  const parts = bars.map((b, i) => {
    const x = i * slotW + (slotW - barW) / 2;
    const cx = x + barW / 2;
    const h = b.total > 0 ? Math.max(3, Math.round(b.ratio * barMaxH)) : 0;
    const y = baseline - h;
    const value = b.total > 0
      ? `<text class="bar-value" x="${cx.toFixed(1)}" y="${(y - 3).toFixed(1)}">${b.total}</text>`
      : '';
    return `${value}<rect class="bar" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h}" rx="3"/>` +
      `<text class="bar-label" x="${cx.toFixed(1)}" y="${H - 3}">${b.label}</text>`;
  });

  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">` +
    `<defs><linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0%" stop-color="#ffd06a"/><stop offset="100%" stop-color="#ff7a93"/>` +
    `</linearGradient></defs>${parts.join('')}</svg>`;
}

// 記録カードのワンタップ・スタンプ行（はなまる #145 / 練習の質メモ #239）。
// 同型（Session の単一フィールドに id を1つ・再タップで解除）なので設定駆動で共通化する。
const SESSION_MARKS = {
  praise: { stamps: PRAISE_STAMPS, normalize: normalizePraise, cls: 'praise-stamp', row: 'praise-row', label: 'はなまるスタンプ' },
  tempo: { stamps: TEMPO_STAMPS, normalize: normalizeTempo, cls: 'tempo-stamp', row: 'tempo-row', label: 'れんしゅうの ようす' },
};

// スタンプ行のマークアップ：選択中のものを強調。タップで付与／同じものを再タップで解除。
function markRowMarkup(kind, session, index) {
  const m = SESSION_MARKS[kind];
  const current = m.normalize(session[kind]);
  const buttons = m.stamps.map((p) => {
    const on = p.id === current;
    return `<button type="button" class="${m.cls}${on ? ` ${m.cls}--on` : ''}"` +
      ` data-action="set-mark" data-mark="${kind}" data-index="${index}" data-id="${p.id}"` +
      ` aria-pressed="${on}" title="${p.label}" aria-label="${p.label}">${p.emoji}</button>`;
  }).join('');
  return `<div class="${m.row}" role="group" aria-label="${m.label}">${buttons}</div>`;
}

export function historyCardMarkup(session, index) {
  // 同日同曲が複数行に分かれた既存データも1行に合算して表示する（#186）
  const songs = combineSongs(session.songs)
    .map((s) => `<li><span class="song-title">${escapeHtml(s.name)}</span>` +
      `<span class="song-times">${Number(s.count) || 0}かい</span></li>`)
    .join('');
  return `<div class="history-card">
    <div class="history-card__date">
      <span class="history-card__day">${formatDateJa(session.date)}</span>
      <span class="history-card__total">ごうけい <b>${Number(session.totalCount) || 0}</b> かい</span>
    </div>
    <ul class="history-songs">${songs}</ul>
    ${markRowMarkup('praise', session, index)}
    ${markRowMarkup('tempo', session, index)}
    <div class="history-card__actions">
      <button type="button" class="history-action" data-action="edit-session" data-index="${index}" aria-label="この きろくを なおす">✏️ なおす</button>
      <button type="button" class="history-action history-action--del" data-action="delete-session" data-index="${index}" aria-label="この きろくを けす">🗑️ けす</button>
    </div>
  </div>`;
}

// 曲別コレクション：曲ごとの色スウォッチ＋累計回数を多い順に並べる（#122）。colors は app.js の衝突回避済みマップ
export function songCollectionMarkup(totals, colors) {
  return totals
    .map((t) => {
      const c = colors.get(t.name) ?? songColor(t.name);
      const crown = isSongMaster(t.count)
        ? '<span class="song-collection__crown" title="マスター" aria-label="マスター">👑</span>'
        : '';
      return `<li class="song-collection__item">
        <span class="song-collection__swatch" style="background:${c.fill}" aria-hidden="true">🐾</span>
        <span class="song-collection__name">${escapeHtml(t.name)}</span>
        ${crown}
        <span class="song-collection__count">${t.count}かい</span>
      </li>`;
    })
    .join('');
}

// 月間カレンダーのセル（#236）。weeks は monthGrid の戻り値、month は title 用。
export function calendarCellsMarkup(weeks, month) {
  return weeks.map((week) => week.map((cell) => {
    if (!cell) return '<span class="cal-cell cal-cell--pad" aria-hidden="true"></span>';
    const cls = `cal-cell${cell.isToday ? ' cal-cell--today' : ''}${cell.isFuture ? ' cal-cell--future' : ''}`;
    const title = `${month}/${cell.day}：${cell.count}かい`;
    return `<span class="${cls}" data-level="${cell.level}" title="${title}"><span class="cal-cell__day">${cell.day}</span></span>`;
  }).join('')).join('');
}
