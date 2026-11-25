// ===== 配信用の最小化（ファイル単位・バンドルしない・#430） =====
// ソースは読みやすいまま保ち、配信物（build.mjs が作る dist/）でだけ最小化する。
// perf-budget.mjs も同じ関数を通して「実際に配信される大きさ」を測る。
//
// バンドルしないのは、SW のプリキャッシュ（gen-sw）・遅延読込の分類（classifyJs）・E2E の
// モジュール差し替え（page.route）が、どれも「ファイル名と import の形がソースと同じ」ことに乗っているため。

import path from 'node:path';
import { transformSync } from 'esbuild';

const BASE = { minify: true, charset: 'utf8', legalComments: 'none' };

// 警告（未知の構文・変換できない構文）を握りつぶすと壊れたまま配信されるので失敗にする。
function transform(code, options, rel) {
  const { code: out, warnings } = transformSync(code, { ...BASE, sourcefile: rel, ...options });
  if (warnings.length) {
    throw new Error(`最小化で警告: ${rel}\n${warnings.map((w) => `  ${w.location?.line ?? '?'}: ${w.text}`).join('\n')}`);
  }
  return out;
}

// sw.js だけは ES モジュールではない。format: 'esm' にするとトップレベルの名前まで短縮される。
function minifyJs(code, rel) {
  const module = path.posix.basename(rel) !== 'sw.js';
  return transform(code, { loader: 'js', target: 'es2020', ...(module && { format: 'esm' }) }, rel);
}

// CSS は target を指定しない（新しい構文の展開や fallback 宣言の間引きをさせない）。
const minifyCss = (code, rel) => transform(code, { loader: 'css' }, rel);

// HTML はコメントと行頭の空白だけを落とす（改行は残す＝要素間の空白は消えない）。
// 中の空白・文字列に意味がある要素は、丸ごと触らない。
const HTML_RAW = /(<(script|style|pre|textarea)\b[\s\S]*?<\/\2>)/gi;
export function minifyHtml(html) {
  return html
    .split(HTML_RAW)
    // split はキャプチャ2つ（要素全体・タグ名）を挟むので、3つ組の [地の文, 要素, タグ名] で並ぶ。
    .map((part, i) => (i % 3 === 0 ? squeeze(part) : i % 3 === 1 ? part : ''))
    .join('');
}
const squeeze = (s) => s.replace(/<!--[\s\S]*?-->/g, '').replace(/\n\s+/g, '\n');

// rel（POSIX 区切り）の拡張子に応じて最小化した Buffer を返す。対象外は入力をそのまま返す。
export function minifyFile(rel, buf) {
  switch (path.posix.extname(rel)) {
    case '.js': return Buffer.from(minifyJs(buf.toString('utf8'), rel));
    case '.css': return Buffer.from(minifyCss(buf.toString('utf8'), rel));
    case '.html': return Buffer.from(minifyHtml(buf.toString('utf8')));
    case '.json': return Buffer.from(JSON.stringify(JSON.parse(buf.toString('utf8'))));
    default: return buf;
  }
}
