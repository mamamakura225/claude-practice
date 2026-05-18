export const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

export function sortTasks(tasks, sortType) {
  return [...tasks].sort((a, b) => {
    // 完了タスクは選択中のソート種別に関わらず常に末尾
    const aDone = a.status === 'done' ? 1 : 0;
    const bDone = b.status === 'done' ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;

    if (sortType === 'manual') {
      return (a.order ?? 0) - (b.order ?? 0);
    }
    if (sortType === 'deadline') {
      const da = a.deadline || '9999-99-99';
      const db = b.deadline || '9999-99-99';
      return da.localeCompare(db);
    }
    if (sortType === 'priority') {
      return (PRIORITY_ORDER[a.priority] ?? 1) - (PRIORITY_ORDER[b.priority] ?? 1);
    }
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
}
