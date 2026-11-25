import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { APP_DIR, classifyJs, importSpecs, JS_ENTRY, listAssets, listHashOnlyAssets } from '../../../scripts/piano-pet-assets.mjs';
import { minifyFile, minifyHtml } from '../../../scripts/minify.mjs';

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
    for (const rel of ['js/cloud.js', 'js/backup.js', 'js/dressup.js', 'js/cat-snapshot.js', 'js/history.js', 'js/onboarding-ui.js', 'js/history-view.js']) {
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

// video/*.mp4 は precache・予算のどちらにも入れず、gen-sw のハッシュにだけ載せる（#318）。
// リストではなく実体（readdirSync）を正にして突き合わせる——リストを正にすると、
// クリップを追加したのに列挙し忘れた事故が構造的に見えなくなる。
describe('listHashOnlyAssets（#318）', () => {
  it('video/*.mp4 を実体と1件も過不足なく列挙する', () => {
    const actual = readdirSync(path.join(APP_DIR, 'video'))
      .filter((f) => f.endsWith('.mp4'))
      .sort()
      .map((f) => `video/${f}`);
    // 実体側もリストも0件で一致すると空振りになる（例: 将来 webm フォールバックだけが
    // 追加され、この行の拡張子フィルタが両方とも取りこぼす場合）。0件一致を弾く。
    expect(actual.length).toBeGreaterThan(0);
    expect(listHashOnlyAssets()).toEqual(actual);
  });

  it('listAssets()（precache・予算対象）とは重ならない', () => {
    const assets = new Set(listAssets());
    for (const rel of listHashOnlyAssets()) {
      expect(assets.has(rel)).toBe(false);
    }
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

// 配信物はファイル単位で最小化する（#430）。SW のプリキャッシュ・遅延読込の分類・E2E の差し替えは
// 「ファイル名と import の形がソースと同じ」ことに乗っているので、そこが変わらないことを確かめる。
describe('minify（#430）', () => {
  it('js/ の全ファイルで import の指定子がソースと変わらない', () => {
    const js = listAssets().filter((rel) => rel.startsWith('js/'));
    expect(js.length).toBeGreaterThan(0);
    for (const rel of js) {
      const src = readFileSync(path.join(APP_DIR, rel));
      const before = importSpecs(src.toString());
      const after = importSpecs(minifyFile(rel, src).toString());
      expect({ rel, static: after.static.sort(), dynamic: after.dynamic.sort() })
        .toEqual({ rel, static: before.static.sort(), dynamic: before.dynamic.sort() });
    }
  });

  it('JS は日本語を文字コードに逃がさず、sw.js（非モジュール）のトップレベル名は残す', () => {
    const min = (rel, code) => minifyFile(rel, Buffer.from(code)).toString().trim();
    expect(min('js/x.js', "export const a = 'ねこ'; // メモ")).toMatch(/"ねこ".*export\{.* as a\}/);
    expect(min('sw.js', 'const CACHE_NAME = 1; self.x = CACHE_NAME;')).toContain('CACHE_NAME');
  });

  it('解釈できない JS は黙って通さず失敗する', () => {
    expect(() => minifyFile('js/x.js', Buffer.from('const = 1;'))).toThrow();
  });

  it('HTML はコメントと行頭の空白だけ落とし、要素間の空白と script/pre/textarea の中身は残す', () => {
    const raw = ['<script>', '  const s = "<!-- 残す -->";', '</script>', '<pre>', '  x', '</pre>', '<textarea>', '  y</textarea>'];
    const html = ['<p>', '  <!-- 消す', '  複数行 -->', '  <b>a</b>', '  <i>b</i> c', '</p>', ...raw, '  <em>z</em>'].join('\n');
    expect(minifyHtml(html)).toBe(['<p>', '<b>a</b>', '<i>b</i> c', '</p>', ...raw, '<em>z</em>'].join('\n'));
  });
});
