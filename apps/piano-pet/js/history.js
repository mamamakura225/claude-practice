// ===== 記録履歴の純粋ロジック =====
import { todayStr } from './game.js';

const WEEKDAYS_JA = ['日', '月', '火', '水', '木', '金', '土'];

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

// 今週（月曜起点）のふりかえりサマリ（#144）。回数・きょく数・れんしゅうした日数を集計。
export function weeklySummary(sessions, today = todayStr()) {
  const current = weekStart(today);
  const songs = new Set();
  const days = new Set();
  let count = 0;
  for (const s of sessions ?? []) {
    if (weekStart(s.date) !== current) continue;
    count += Number(s.totalCount) || 0;
    days.add(s.date);
    for (const song of s.songs ?? []) {
      const name = String(song?.name ?? '').trim();
      if (name && (Math.floor(Number(song.count)) || 0) > 0) songs.add(name);
    }
  }
  return { weekStart: current, count, songCount: songs.size, dayCount: days.size };
}

// ふりかえりカードの共有テキスト（#144）。Web Share / クリップボードで送る本文。
// 曲名は載せない（送信は最小限）。共有はユーザーの明示操作だが、内容は簡潔に保つ。
export function reviewShareText({ petName, count, songCount, dayCount, streak } = {}) {
  const lines = [
    `🎹 ${petName || 'ねこ'}と ピアノれんしゅう ふりかえり`,
    `今週は ${count}かい・${songCount}きょく・${dayCount}日 れんしゅうしたよ！`,
  ];
  if (streak > 0) lines.push(`れんぞく ${streak}日 つづいてるよ 🔥`);
  return lines.join('\n');
}

// ===== 月間カレンダー（草式ヒートマップ・#236） =====
// sessions からの導出のみ（保存フィールドなし）。曜日は日曜起点。

// 日付ごとの合計回数を Map(date -> count) にまとめる（同日複数レコードは合算）。
export function dailyCountMap(sessions) {
  const m = new Map();
  for (const s of sessions ?? []) {
    if (!s || s.date == null) continue;
    m.set(s.date, (m.get(s.date) || 0) + (Number(s.totalCount) || 0));
  }
  return m;
}

// その日の回数を4段階の濃淡レベル(0〜3)に写す（#236）。
// 0＝なし / 1＝目標の半分未満 / 2＝半分以上目標未満 / 3＝目標達成。閾値は可変目標に追従（#238）。
export function heatLevel(count, goal = 10) {
  const n = Number(count) || 0;
  const g = Math.max(1, Number(goal) || 1);
  if (n <= 0) return 0;
  if (n >= g) return 3;
  return n < g / 2 ? 1 : 2;
}

// year/month(1-12) を delta か月ずらして {year, month} を返す。
export function shiftMonth(year, month, delta) {
  const idx = year * 12 + (month - 1) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

// "YYYY年M月" ラベル。
export function monthLabel(year, month) {
  return `${year}年${month}月`;
}

// 月間カレンダーの週配列を返す（日曜起点・前後は null 埋め）。各セルは
// { date:'YYYY-MM-DD', day, count, level, isToday, isFuture }。sessions 導出のみ。
export function monthGrid(year, month, sessions, { today = todayStr(), goal = 10 } = {}) {
  const counts = dailyCountMap(sessions);
  const startPad = new Date(Date.UTC(year, month - 1, 1)).getUTCDay(); // 0=日
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells = [];
  for (let i = 0; i < startPad; i += 1) cells.push(null);
  for (let d = 1; d <= daysInMonth; d += 1) {
    const date = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const count = counts.get(date) || 0;
    cells.push({ date, day: d, count, level: heatLevel(count, goal), isToday: date === today, isFuture: date > today });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

// 記録リスト用に "M月D日（曜）" 形式へ整形する
export function formatDateJa(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const w = WEEKDAYS_JA[d.getUTCDay()];
  return `${m}月${day}日（${w}）`;
}
