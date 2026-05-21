export function formatDate(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split('-');
  return `${y}/${m}/${d}`;
}

export function isOverdue(dateStr) {
  if (!dateStr) return false;
  return new Date(dateStr) < new Date(new Date().toDateString());
}

export function addDays(dateStr, n) {
  const d = dateStr ? new Date(dateStr) : new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export function addMonths(dateStr, n) {
  const d = dateStr ? new Date(dateStr) : new Date();
  d.setMonth(d.getMonth() + n);
  return d.toISOString().slice(0, 10);
}

export function nextRecurrenceDeadline(deadline, recurrence) {
  const base = deadline || new Date().toISOString().slice(0, 10);
  if (recurrence.type === 'daily')   return addDays(base, 1);
  if (recurrence.type === 'weekly')  return addDays(base, 7);
  if (recurrence.type === 'monthly') return addMonths(base, 1);
  return base;
}
