// ===== piano-pet の配信アセット列挙（唯一の正） =====
// gen-sw.mjs（SW プリキャッシュ一覧）と perf-budget.mjs（サイズ計測）が同じ集合を見るための共有モジュール。
//
// 以前は両者が同じ規則を**別々に**書いており、#234 の PNG→WebP 移行で gen-sw だけが追随した結果、
// perf-budget の画像カテゴリが 0 件（実体 3.6 MiB）になっても CI は緑のまま通っていた。
// 列挙をここ 1 箇所に集約して、この種のドリフトを構造的に起こらなくする。

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const APP_DIR = path.resolve(__dirname, '..', 'apps', 'piano-pet');
export const INDEX = 'index.html';
export const SW = 'sw.js';

// dir 配下の対象拡張子ファイルを名前順で out に積む（listAssets / listHashOnlyAssets 共通の心臓部）。
function collectInto(out, dir, exts) {
  let entries;
  try {
    entries = readdirSync(path.join(APP_DIR, dir));
  } catch {
    return;
  }
  for (const name of entries.sort()) {
    const full = path.join(APP_DIR, dir, name);
    if (statSync(full).isFile() && exts.includes(path.extname(name))) {
      out.push(`${dir}/${name}`);
    }
  }
}

// 配信アセット（アプリディレクトリ相対・POSIX 区切り）を決まった順で集める。
// sw.js 自身は生成物なので含めない。
export function listAssets() {
  const assets = [INDEX];
  collectInto(assets, 'css', ['.css']);
  collectInto(assets, 'js', ['.js']);
  assets.push('manifest.json');
  collectInto(assets, 'icons', ['.svg', '.png']);
  collectInto(assets, 'img/cat', ['.webp']);         // 猫本体は WebP（#234）
  collectInto(assets, 'img/cat/items', ['.webp']);   // 装着アイテム
  collectInto(assets, 'img/cat/scene', ['.webp']);   // 置物・小物系（#226）
  collectInto(assets, 'sounds', ['.mp3', '.ogg', '.wav']);
  return assets;
}

// SW の precache（APP_SHELL）にも perf-budget のカテゴリにも入れないが、差し替えでキャッシュ名が
// 変わるようハッシュにだけ載せるアセット（#318）。precache に入れない理由は #227（1.37 MiB を
// install 時に全部落とすと初回起動が重い）、予算に入れない理由も同じ（判定対象は起動をブロック
// するテキスト資産）。perf-budget.mjs の orphan 検知（js/ だけが対象）には混ぜないこと。
export function listHashOnlyAssets() {
  const out = [];
  collectInto(out, 'video', ['.mp4']);
  return out;
}

// ===== 初回ロード JS と遅延読込 JS の判定（#284） =====
// index.html が読むのは js/app.js だけ。そこから**静的 import** で到達できる集合が
// 「起動時に必ず落ちてきてパースされる JS」で、`import()` の先にしか現れないものが
// 「押されたとき／アイドル時に初めて読む JS」。perf-budget はこの2つを別カテゴリで測る。
//
// 手書きのリストにしないのは、遅延読込へ移したのにリストの更新を忘れて数字が実体から
// ズレるのを防ぐため（#234 の列挙ドリフトと同じ轍）。ソースの import 文を唯一の正とする。
export const JS_ENTRY = 'js/app.js';

// `import x from './y.js'` / `export ... from './y.js'` / `import './y.js'`
// 空白は 0 個も許す（`import{x}from'./y.js'`）。取りこぼすと静的 import を lazy と
// 誤判定し、予算が甘くなる方向に間違えるため。
const STATIC_SPEC = /(?:^\s*import\s*|\bfrom\s*)['"](\.[^'"]*\.js)['"]/gm;
// `import('./y.js')`（CDN 等の絶対 URL は対象外）
const DYNAMIC_SPEC = /\bimport\s*\(\s*['"](\.[^'"]*\.js)['"]\s*\)/g;

// { entry, lazy, orphan } を配信アセットの順で返す。orphan はどこからも import されない
// js/（＝配信しているのに誰も読まない死んだファイル）で、perf-budget 側で失敗させる。
export function classifyJs() {
  const jsFiles = listAssets().filter((rel) => rel.startsWith('js/'));
  const known = new Set(jsFiles);
  const entry = new Set();
  const dynamicRoots = new Set();
  visit(JS_ENTRY, entry);

  // 動的 import の先も、そこから静的に到達するぶんまで遅延側に数える。
  // Set の for..of は反復中に追加した要素も拾うので、入れ子の import() も辿れる。
  const lazy = new Set();
  for (const root of dynamicRoots) visit(root, lazy);
  for (const rel of entry) lazy.delete(rel);   // 両方から届くものは初回ロード側に数える

  const inOrder = (set) => jsFiles.filter((rel) => set.has(rel));
  return {
    entry: inOrder(entry),
    lazy: inOrder(lazy),
    orphan: jsFiles.filter((rel) => !entry.has(rel) && !lazy.has(rel)),
  };

  function visit(rel, seen) {
    if (!known.has(rel) || seen.has(rel)) return;
    seen.add(rel);
    const src = readFileSync(path.join(APP_DIR, rel), 'utf8');
    const { static: statics, dynamic } = importSpecs(src);
    for (const spec of statics) visit(resolveSpec(rel, spec), seen);
    for (const spec of dynamic) dynamicRoots.add(resolveSpec(rel, spec));
  }
}

// ソース1本から相対 import の指定子を取り出す（分類の心臓部なので単体テストから叩く）。
export function importSpecs(src) {
  return { static: specs(src, STATIC_SPEC), dynamic: specs(src, DYNAMIC_SPEC) };
}

function specs(src, re) {
  re.lastIndex = 0;
  return [...src.matchAll(re)].map((m) => m[1]);
}

function resolveSpec(fromRel, spec) {
  return path.posix.join(path.posix.dirname(fromRel), spec);
}
