import { addDays } from './date.js';

export function filterTasks(tasks, filters, today) {
  let result = tasks;

  if (filters.categoryId) {
    result = result.filter(t => t.categoryId === filters.categoryId);
  }
  if (filters.priority) {
    result = result.filter(t => t.priority === filters.priority);
  }
  if (filters.status) {
    result = result.filter(t => t.status === filters.status);
  }
  if (filters.hideCompleted) {
    result = result.filter(t => t.status !== 'done');
  }
  if (filters.preset) {
    if (filters.preset === 'today') {
      result = result.filter(t => t.deadline === today);
    } else if (filters.preset === 'week') {
      const weekEnd = addDays(today, 6);
      result = result.filter(t => t.deadline && t.deadline >= today && t.deadline <= weekEnd);
    } else if (filters.preset === 'overdue') {
      result = result.filter(t => t.deadline && t.deadline < today && t.status !== 'done');
    }
  }
  if (filters.search) {
    const raw = filters.search.trim();
    if (raw.startsWith('#') && raw.length > 1) {
      const tagQuery = raw.slice(1).toLowerCase();
      result = result.filter(t =>
        (t.tags || []).some(tag => tag.toLowerCase() === tagQuery)
      );
    } else {
      const q = raw.toLowerCase();
      result = result.filter(t =>
        t.title.toLowerCase().includes(q) ||
        (t.description && t.description.toLowerCase().includes(q)) ||
        (t.tags || []).some(tag => tag.toLowerCase().includes(q))
      );
    }
  }

  return result;
}
