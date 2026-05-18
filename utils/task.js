export function normalizeTask(t) {
  return {
    tags: [],
    subtasks: [],
    recurrence: null,
    order: 0,
    ...t,
  };
}
