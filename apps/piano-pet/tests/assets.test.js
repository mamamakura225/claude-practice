import { describe, it, expect } from 'vitest';
import { classifyJs, importSpecs, JS_ENTRY } from '../../../scripts/piano-pet-assets.mjs';

// 初回ロード JS / 遅延読込 JS の判定（#284）。perf-budget の予算はこの分類の上に乗るので、
// 遅延読込を静的 import に戻す変更（＝起動が重くなる変更）が入ったらここで落ちる。
describe('classifyJs', () => {
  const { entry, lazy, orphan } = classifyJs();

  it('index.html が読む app.js から静的に到達できるものは entry', () => {
    expect(entry).toContain(JS_ENTRY);
    expect(entry).toContain('js/storage.js');
    expect(entry).toContain('js/feed.js');
  });

  it('import() の先にしか現れないモジュールは lazy', () => {
    for (const rel of ['js/cloud.js', 'js/backup.js', 'js/dressup.js', 'js/cat-snapshot.js', 'js/history.js']) {
      expect(lazy).toContain(rel);
      expect(entry).not.toContain(rel);
    }
    // 遅延モジュールからしか import されないものも lazy 側（cloud.js → firebase-config.js）
    expect(lazy).toContain('js/firebase-config.js');
  });

  it('entry と lazy の両方から到達できるものは entry に数える', () => {
    // account.js は storage.js（entry）と cloud.js（lazy）の双方から import される
    expect(entry).toContain('js/account.js');
    expect(lazy).not.toContain('js/account.js');
  });

  it('どこからも import されない js/ は無い', () => {
    expect(orphan).toEqual([]);
  });
});

// 分類は import 文の走査に乗っているので、書き方の揺れで静的 import を取りこぼすと
// 「起動時に読むのに lazy に数える」＝予算が甘くなる方向に間違える。
describe('importSpecs', () => {
  it('書き方が違っても静的 import は静的として拾う', () => {
    expect(importSpecs("import { a } from './x.js';").static).toEqual(['./x.js']);
    expect(importSpecs("import{a}from'./x.js';").static).toEqual(['./x.js']);
    expect(importSpecs("import a from \"./x.js\";").static).toEqual(['./x.js']);
    expect(importSpecs("import './x.js';").static).toEqual(['./x.js']);
    expect(importSpecs("export { a } from './x.js';").static).toEqual(['./x.js']);
  });

  it('動的 import は dynamic 側にだけ入る', () => {
    const found = importSpecs("const m = await import('./x.js');");
    expect(found.dynamic).toEqual(['./x.js']);
    expect(found.static).toEqual([]);
  });

  it('CDN 等の絶対 URL は対象外', () => {
    expect(importSpecs("import { x } from 'https://cdn.example/x.js';").static).toEqual([]);
  });
});
