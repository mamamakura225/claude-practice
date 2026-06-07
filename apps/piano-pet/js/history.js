// ===== 記録履歴の純粋ロジック =====
import { todayStr } from './game.js';

const WEEKDAYS_JA = ['日', '月', '火', '水', '木', '金', '土'];

// はなまるスタンプ（#145）：親がワンタップで記録に付ける固定の評価。
// session.praise に id を保存。字が読めない子にも絵文字で褒められたことが伝わる。
export const PRAISE_OPTIONS = [
  { id: 'hanamaru', emoji: '💮', label: 'はなまる' },
  { id: 'jouzu', emoji: '🌟', label: 'じょうず' },
  { id: 'ganbatta', emoji: '👍', label: 'がんばった' },
];

// praise id から選択肢を引く（未設定・不正値は null）。
export function praiseById(id) {
  return PRAISE_OPTIONS.find((p) => p.id === id) ?? null;
}

// 日付文字列を n 日ずらして返す（UTC基準でタイムゾーン非依存）
function shiftDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// その日が属する週の開始日（月曜）を YYYY-MM-DD で返す
export function weekStart(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const offset = (d.getUTCDay() + 6) % 7; // 月曜=0 になるよう補正
  return shiftDays(dateStr, -offset);
}

// 記録を日付の新しい順に並べる（同日内は元の順序を保つ）
export function sortByDateDesc(sessions) {
  return [...sessions].sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

// 直近 weeks 週ぶんの合計回数を古い順に返す。記録のない週も 0 で埋める。
export function weeklyTotals(sessions, { weeks = 8, today = todayStr() } = {}) {
  const currentWeek = weekStart(today);
  const buckets = new Map();
  for (let i = weeks - 1; i >= 0; i--) {
    buckets.set(shiftDays(currentWeek, -7 * i), 0);
  }
  for (const s of sessions) {
    const ws = weekStart(s.date);
    if (buckets.has(ws)) buckets.set(ws, buckets.get(ws) + (Number(s.totalCount) || 0));
  }
  return [...buckets.entries()].map(([ws, total]) => ({ weekStart: ws, total }));
}

// 棒グラフ描画用に各週へ最大値比（0〜1）とラベルを付与する
export function weeklyChartModel(weeks) {
  const max = Math.max(1, ...weeks.map((w) => w.total));
  return weeks.map((w) => ({
    weekStart: w.weekStart,
    total: w.total,
    label: weekLabel(w.weekStart),
    ratio: w.total / max,
  }));
}

// 週開始日を "M/D" 形式の短いラベルにする
export function weekLabel(dateStr) {
  const [, m, d] = dateStr.split('-');
  return `${Number(m)}/${Number(d)}`;
}

// 記録リスト用に "M月D日（曜）" 形式へ整形する
export function formatDateJa(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const w = WEEKDAYS_JA[d.getUTCDay()];
  return `${m}月${day}日（${w}）`;
}
