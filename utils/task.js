export function normalizeTask(t) {
  return {
    tags: [],
    subtasks: [],
    recurrence: null,
    order: 0,
    ...t,
  };
}

export function calculateSubtaskProgress(subtasks) {
  const total = subtasks?.length || 0;
  if (total === 0) {
    return { total: 0, done: 0, percent: 0 };
  }
  const done = subtasks.filter(s => s.done).length;
  const percent = Math.round((done / total) * 100);
  return { total, done, percent };
}
