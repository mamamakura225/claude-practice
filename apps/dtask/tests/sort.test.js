import { describe, it, expect } from 'vitest';
import { sortTasks } from '../utils/sort.js';

describe('sortTasks', () => {
  it('完了タスクは常に末尾に並ぶ（manualソートでも）', () => {
    const tasks = [
      { id: 'a', status: 'done',     order: 0 },
      { id: 'b', status: 'todo',     order: 1 },
      { id: 'c', status: 'inprogress', order: 2 },
    ];
    const result = sortTasks(tasks, 'manual');
    expect(result.map(t => t.id)).toEqual(['b', 'c', 'a']);
  });

  it('manual: orderが小さい順', () => {
    const tasks = [
      { id: 'a', status: 'todo', order: 5 },
      { id: 'b', status: 'todo', order: 1 },
      { id: 'c', status: 'todo', order: 3 },
    ];
    const result = sortTasks(tasks, 'manual');
    expect(result.map(t => t.id)).toEqual(['b', 'c', 'a']);
  });

  it('deadline: 期限が早い順、期限なしは最後', () => {
    const tasks = [
      { id: 'a', status: 'todo', deadline: '2025-05-20' },
      { id: 'b', status: 'todo', deadline: null },
      { id: 'c', status: 'todo', deadline: '2025-05-10' },
    ];
    const result = sortTasks(tasks, 'deadline');
    expect(result.map(t => t.id)).toEqual(['c', 'a', 'b']);
  });

  it('priority: high → medium → low の順', () => {
    const tasks = [
      { id: 'a', status: 'todo', priority: 'low' },
      { id: 'b', status: 'todo', priority: 'high' },
      { id: 'c', status: 'todo', priority: 'medium' },
    ];
    const result = sortTasks(tasks, 'priority');
    expect(result.map(t => t.id)).toEqual(['b', 'c', 'a']);
  });

  it('デフォルト（createdAt）: 新しい順', () => {
    const tasks = [
      { id: 'a', status: 'todo', createdAt: '2025-01-01' },
      { id: 'b', status: 'todo', createdAt: '2025-05-01' },
      { id: 'c', status: 'todo', createdAt: '2025-03-01' },
    ];
    const result = sortTasks(tasks, undefined);
    expect(result.map(t => t.id)).toEqual(['b', 'c', 'a']);
  });

  it('元の配列を破壊しない', () => {
    const tasks = [
      { id: 'a', status: 'todo', order: 2 },
      { id: 'b', status: 'todo', order: 1 },
    ];
    const before = [...tasks];
    sortTasks(tasks, 'manual');
    expect(tasks).toEqual(before);
  });
});
