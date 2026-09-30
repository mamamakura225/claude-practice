/* 日付は端末のローカル日付の 'YYYY-MM-DD' 文字列で扱う (#350)。
 * toISOString() は UTC なので、日本時間 0:00〜8:59 に前日になる。'YYYY-MM-DD' を new Date() に
 * 渡すと UTC 0時として解釈されるため、分解してローカル日付として組み立てる。 */
export function toDateStr(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function todayStr() {
  return toDateStr(new Date());
}

export function parseDateStr(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function formatDate(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split('-');
  return `${y}/${m}/${d}`;
}

export function isOverdue(dateStr) {
  if (!dateStr) return false;
  return dateStr < todayStr();
}

export function addDays(dateStr, n) {
  const d = dateStr ? parseDateStr(dateStr) : new Date();
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

export function addMonths(dateStr, n) {
  const d = dateStr ? parseDateStr(dateStr) : new Date();
  d.setMonth(d.getMonth() + n);
  return toDateStr(d);
}

/* 2つの 'YYYY-MM-DD' の日数差（to - from）。夏時間のある地域でも丸めで吸収する */
export function daysBetween(from, to) {
  return Math.round((parseDateStr(to) - parseDateStr(from)) / 86_400_000);
}

export function nextRecurrenceDeadline(deadline, recurrence) {
  const base = deadline || todayStr();
  if (recurrence.type === 'daily')   return addDays(base, 1);
  if (recurrence.type === 'weekly')  return addDays(base, 7);
  if (recurrence.type === 'monthly') return addMonths(base, 1);
  return base;
}
