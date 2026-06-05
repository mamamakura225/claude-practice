// ===== 宿題（きょうの きょく）の純粋ロジック・#143 =====
// 親が「きょう／こんしゅう 弾く曲＋目標回数」を設定し、ホームに大きく表示する。
// 達成判定は既存の sessions を唯一の正として集計する（別途フラグを持たない）。
import { weekStart } from './history.js';

// assignment が「有効な宿題」を持つか（items が1件以上）。
// クリアは items:[] のトゥームストーンで表すので、ここで false になる。
export function hasAssignment(assignment) {
  return !!(assignment && Array.isArray(assignment.items) && assignment.items.length > 0);
}

// MVP は単一曲。配列の先頭だけを対象にする（スキーマは将来の複数曲拡張に備え配列）。
export function primaryItem(assignment) {
  return hasAssignment(assignment) ? assignment.items[0] : null;
}

// period を 'day' | 'week' に正規化（既定 'day'）。
function normPeriod(period) {
  return period === 'week' ? 'week' : 'day';
}

// セッションが対象期間に入るか。'day'=当日、'week'=今週（月曜始まり・既存週次グラフに追従）。
function inPeriod(session, period, today) {
  if (period === 'week') return weekStart(session.date) === weekStart(today);
  return session.date === today;
}

// 宿題の進捗を返す。対象曲名の period 内合計 count を集計する。
// 返り値: { name, target, count, remaining, achieved, ratio, period } または null（宿題なし）。
export function assignmentProgress(sessions, assignment, today) {
  const item = primaryItem(assignment);
  if (!item) return null;
  const name = String(item.name ?? '').trim();
  const target = Math.max(1, Math.floor(Number(item.target)) || 1);
  const period = normPeriod(assignment.period);
  let count = 0;
  for (const s of sessions ?? []) {
    if (!inPeriod(s, period, today)) continue;
    for (const song of s.songs ?? []) {
      if (String(song?.name ?? '').trim() === name) {
        count += Math.max(0, Math.floor(Number(song?.count)) || 0);
      }
    }
  }
  return {
    name,
    target,
    count,
    period,
    remaining: Math.max(0, target - count),
    achieved: count >= target,
    ratio: target > 0 ? Math.min(1, count / target) : 0,
  };
}

// 親の入力から assignment オブジェクトを作る。name 空ならクリア（items:[] のトゥームストーン）。
// setAt は LWW 用に常に現在時刻を入れるので、設定もクリアも他端末へ正しく伝播する。
export function makeAssignment({ name, target, period }, now = new Date()) {
  const trimmed = String(name ?? '').trim();
  const items = trimmed
    ? [{ name: trimmed, target: Math.max(1, Math.floor(Number(target)) || 1) }]
    : [];
  return { items, period: normPeriod(period), setAt: now.toISOString() };
}
