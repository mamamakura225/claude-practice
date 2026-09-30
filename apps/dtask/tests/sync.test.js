import { describe, it, expect } from 'vitest';
import { mergeFallbackChanges } from '../utils/sync.js';

const t = (id, title = id) => ({ id, title });

describe('mergeFallbackChanges', () => {
  it('ローカル変更が無ければクラウドをそのまま採用する', () => {
    const base = [t('a')];
    const r = mergeFallbackChanges(base, [t('a')], [t('a', 'A-cloud'), t('c')]);
    expect(r.items).toEqual([t('a', 'A-cloud'), t('c')]);
    expect(r.hasLocalChanges).toBe(false);
  });

  it('ローカル追加分をクラウドの末尾に足す（クラウド側の追加も残す）', () => {
    const r = mergeFallbackChanges([t('a')], [t('a'), t('b')], [t('a'), t('c')]);
    expect(r.items.map(x => x.id)).toEqual(['a', 'c', 'b']);
    expect(r.hasLocalChanges).toBe(true);
  });

  it('ローカルで編集した要素はローカル版で置き換える', () => {
    const r = mergeFallbackChanges([t('a')], [t('a', 'A-local')], [t('a', 'A-cloud'), t('c')]);
    expect(r.items).toEqual([t('a', 'A-local'), t('c')]);
  });

  it('ローカルで削除した要素はクラウドからも除く', () => {
    const r = mergeFallbackChanges([t('a'), t('b')], [t('b')], [t('a'), t('b'), t('c')]);
    expect(r.items.map(x => x.id)).toEqual(['b', 'c']);
    expect(r.hasLocalChanges).toBe(true);
  });

  it('空のフォールバックから起動してもクラウドの既存データを消さない (#349)', () => {
    const cloud = [t('a'), t('b')];
    const r = mergeFallbackChanges([], [], cloud);
    expect(r.items).toEqual(cloud);
    expect(r.hasLocalChanges).toBe(false);
  });

  it('引数が undefined でも落ちない', () => {
    expect(mergeFallbackChanges(undefined, undefined, undefined).items).toEqual([]);
  });
});
