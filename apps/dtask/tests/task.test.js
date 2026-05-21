import { describe, it, expect } from 'vitest';
import { normalizeTask, calculateSubtaskProgress } from '../utils/task.js';

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

describe('calculateSubtaskProgress', () => {
  it('サブタスクが0件のとき total=0, done=0, percent=0', () => {
    expect(calculateSubtaskProgress([])).toEqual({ total: 0, done: 0, percent: 0 });
  });

  it('undefined/nullでも0件と同じ結果', () => {
    expect(calculateSubtaskProgress(undefined)).toEqual({ total: 0, done: 0, percent: 0 });
    expect(calculateSubtaskProgress(null)).toEqual({ total: 0, done: 0, percent: 0 });
  });

  it('4件中2件完了で50%', () => {
    const subtasks = [
      { title: 'a', done: true },
      { title: 'b', done: true },
      { title: 'c', done: false },
      { title: 'd', done: false },
    ];
    expect(calculateSubtaskProgress(subtasks)).toEqual({ total: 4, done: 2, percent: 50 });
  });

  it('全完了で100%', () => {
    const subtasks = [
      { title: 'a', done: true },
      { title: 'b', done: true },
    ];
    expect(calculateSubtaskProgress(subtasks)).toEqual({ total: 2, done: 2, percent: 100 });
  });

  it('3件中1件完了で33%（小数は丸める）', () => {
    const subtasks = [
      { title: 'a', done: true },
      { title: 'b', done: false },
      { title: 'c', done: false },
    ];
    expect(calculateSubtaskProgress(subtasks)).toEqual({ total: 3, done: 1, percent: 33 });
  });
});
