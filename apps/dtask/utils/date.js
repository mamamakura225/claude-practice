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

/* n か月後。日は day（省略時は元の日）とし、その月に無ければ月末に詰める（1/31 → 2/28。3/3 へあふれない #351） */
export function addMonths(dateStr, n, day) {
  const base = dateStr ? parseDateStr(dateStr) : new Date();
  const target = new Date(base.getFullYear(), base.getMonth() + n, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  const d = Number.isInteger(day) && day >= 1 ? day : base.getDate(); // 壊れた anchorDay は無視
  target.setDate(Math.min(d, lastDay));
  return toDateStr(target);
}

/* 2つの 'YYYY-MM-DD' の日数差（to - from）。夏時間のある地域でも丸めで吸収する */
export function daysBetween(from, to) {
  return Math.round((parseDateStr(to) - parseDateStr(from)) / 86_400_000);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/* recurrence.anchorDay（毎月のみ・任意）があれば、その日を基準に翌月を求める */
export function nextRecurrenceDeadline(deadline, recurrence) {
  const base = DATE_RE.test(deadline || '') ? deadline : todayStr();
  if (recurrence.type === 'daily')   return addDays(base, 1);
  if (recurrence.type === 'weekly')  return addDays(base, 7);
  if (recurrence.type === 'monthly') return addMonths(base, 1, recurrence.anchorDay);
  return base;
}
