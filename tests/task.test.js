import { describe, it, expect } from 'vitest';
import { normalizeTask } from '../utils/task.js';

describe('normalizeTask', () => {
  it('空オブジェクトにデフォルト値を補完する', () => {
    const result = normalizeTask({});
    expect(result.tags).toEqual([]);
    expect(result.subtasks).toEqual([]);
    expect(result.recurrence).toBeNull();
    expect(result.order).toBe(0);
  });

  it('既存の値は上書きされない', () => {
    const result = normalizeTask({ tags: ['work'], order: 5 });
    expect(result.tags).toEqual(['work']);
    expect(result.order).toBe(5);
  });

  it('タスクの全フィールドが保持される', () => {
    const task = { id: 'abc', title: 'テスト', status: 'todo' };
    const result = normalizeTask(task);
    expect(result.id).toBe('abc');
    expect(result.title).toBe('テスト');
    expect(result.status).toBe('todo');
  });
});
