import { describe, it, expect } from 'vitest';
import { filterTasks } from '../utils/filter.js';

const sampleTasks = [
  { id: '1', title: '買い物',     categoryId: 'c1', priority: 'high',   status: 'todo',       deadline: '2025-05-18', tags: ['private'] },
  { id: '2', title: '会議資料',   categoryId: 'c2', priority: 'medium', status: 'inprogress', deadline: '2025-05-20', tags: ['work'],    description: '来週のMTG用' },
  { id: '3', title: '掃除',       categoryId: 'c1', priority: 'low',    status: 'done',       deadline: '2025-05-10', tags: ['private'] },
  { id: '4', title: 'コーディング', categoryId: 'c2', priority: 'high',   status: 'todo',       deadline: null,         tags: ['work'] },
  { id: '5', title: '請求書送付', categoryId: 'c2', priority: 'high',   status: 'todo',       deadline: '2025-05-15', tags: ['work', 'urgent'] },
];

describe('filterTasks', () => {
  const today = '2025-05-18';

  it('絞り込みなしなら全件返す', () => {
    expect(filterTasks(sampleTasks, {}, today)).toHaveLength(5);
  });

  it('categoryIdで絞り込める', () => {
    const result = filterTasks(sampleTasks, { categoryId: 'c1' }, today);
    expect(result.map(t => t.id)).toEqual(['1', '3']);
  });

  it('priorityで絞り込める', () => {
    const result = filterTasks(sampleTasks, { priority: 'high' }, today);
    expect(result.map(t => t.id)).toEqual(['1', '4', '5']);
  });

  it('statusで絞り込める', () => {
    const result = filterTasks(sampleTasks, { status: 'todo' }, today);
    expect(result.map(t => t.id)).toEqual(['1', '4', '5']);
  });

  it('hideCompletedで完了タスクが除外される', () => {
    const result = filterTasks(sampleTasks, { hideCompleted: true }, today);
    expect(result.find(t => t.id === '3')).toBeUndefined();
  });

  it('preset=today: 今日が期限のタスクだけ返す', () => {
    const result = filterTasks(sampleTasks, { preset: 'today' }, today);
    expect(result.map(t => t.id)).toEqual(['1']);
  });

  it('preset=week: 今日から7日以内のタスクを返す', () => {
    const result = filterTasks(sampleTasks, { preset: 'week' }, today);
    expect(result.map(t => t.id).sort()).toEqual(['1', '2']);
  });

  it('preset=overdue: 期限切れかつ未完了のタスクだけ返す', () => {
    const result = filterTasks(sampleTasks, { preset: 'overdue' }, today);
    expect(result.map(t => t.id)).toEqual(['5']);
  });

  it('search: タイトルの部分一致', () => {
    const result = filterTasks(sampleTasks, { search: '会議' }, today);
    expect(result.map(t => t.id)).toEqual(['2']);
  });

  it('search: descriptionにマッチする', () => {
    const result = filterTasks(sampleTasks, { search: 'MTG' }, today);
    expect(result.map(t => t.id)).toEqual(['2']);
  });

  it('search: #タグで完全一致検索', () => {
    const result = filterTasks(sampleTasks, { search: '#urgent' }, today);
    expect(result.map(t => t.id)).toEqual(['5']);
  });

  it('複合条件: priority=high かつ hideCompleted', () => {
    const result = filterTasks(sampleTasks, { priority: 'high', hideCompleted: true }, today);
    expect(result.map(t => t.id)).toEqual(['1', '4', '5']);
  });

  it('元の配列を破壊しない', () => {
    const before = [...sampleTasks];
    filterTasks(sampleTasks, { priority: 'high' }, today);
    expect(sampleTasks).toEqual(before);
  });
});
