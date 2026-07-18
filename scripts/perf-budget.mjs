// ===== パフォーマンス予算（bundle / asset サイズ）チェック =====
// piano-pet の配信アセットの合計サイズを計測し、予算（BUDGETS）を超えたら失敗する。
// 「アプリを重くしない」方針を仕組みで担保するための回帰ガード（#147）。
//
// 使い方:
//   node scripts/perf-budget.mjs           レポート表示のみ（常に成功）
//   node scripts/perf-budget.mjs --check    予算超過があれば非ゼロ終了（CI用）
//
// 計測対象は gen-sw と同じ列挙（index.html / css / js / manifest / icons / sounds）。
// 予算は HTML/CSS/JS（コード・マークアップのアプリシェル）とその合計に対して gzip 後の
// サイズで設ける。icons / sounds はバイナリで変更頻度が低く、配信時も再圧縮されない（mp3 等）
// ため、レポートには出すが予算判定からは除外する。

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(__dirname, '..', 'apps', 'piano-pet');
const CHECK = process.argv.includes('--check');

// 予算（gzip 後の KiB）。現状値に十分な余裕（≈25%）を載せ、「肥大化の回帰」を捕まえる
// ための上限であって、細かなサイズを縛る目的ではない。機能追加で超えたら、本当に必要か
// 見直すか、根拠とともにこの値を引き上げる。
const BUDGETS_KIB = {
  html: 8,
  css: 12,
  js: 75,    // #226 で 70→72（置物ロジック）、#252 で 72→73。#238（目標回数の親調整＝親ゲートUI・音程再配分・進捗結線）と #239（質メモ）の機能追加で最小構成でも 73→75
  total: 92, // html + css + js の合計（#210 で 85→88、#226 で 88→90。#238/#239 の js 増に伴い 90→92）
};

const KIB = 1024;

// gen-sw と同じ規則でカテゴリ別にアセットを集める。
function collect(dir, exts) {
  let entries;
  try {
    entries = readdirSync(path.join(APP_DIR, dir));
  } catch {
    return [];
  }
  return entries
    .sort()
    .filter((name) => exts.includes(path.extname(name)))
    .filter((name) => statSync(path.join(APP_DIR, dir, name)).isFile())
    .map((name) => `${dir}/${name}`);
}

const CATEGORIES = {
  html: ['index.html'],
  css: collect('css', ['.css']),
  js: collect('js', ['.js']),
  icons: collect('icons', ['.svg', '.png']),
  img: collect('img/cat', ['.png']),
  sounds: collect('sounds', ['.mp3', '.ogg', '.wav']),
};

// カテゴリの raw / gzip 合計バイトを求める。
function measure(files) {
  let raw = 0;
  let gz = 0;
  for (const rel of files) {
    const buf = readFileSync(path.join(APP_DIR, rel));
    raw += buf.length;
    gz += gzipSync(buf).length;
  }
  return { raw, gz, count: files.length };
}

const kib = (bytes) => (bytes / KIB).toFixed(1);

const results = Object.fromEntries(
  Object.entries(CATEGORIES).map(([name, files]) => [name, measure(files)]),
);

// 予算対象（html+css+js）の合計。
const totalGz = results.html.gz + results.css.gz + results.js.gz;

// ---- レポート ----
console.log('piano-pet アセットサイズ（raw / gzip）:');
for (const [name, r] of Object.entries(results)) {
  const budget = BUDGETS_KIB[name];
  const budgetNote = budget ? `  予算 ${budget} KiB` : '';
  console.log(
    `  ${name.padEnd(7)} ${String(r.count).padStart(2)}件  ` +
      `raw ${kib(r.raw).padStart(7)} KiB  gzip ${kib(r.gz).padStart(7)} KiB${budgetNote}`,
  );
}
console.log(`  ${'total'.padEnd(7)}       (html+css+js) gzip ${kib(totalGz)} KiB  予算 ${BUDGETS_KIB.total} KiB`);

// ---- 予算判定 ----
const checks = [
  ['html', results.html.gz],
  ['css', results.css.gz],
  ['js', results.js.gz],
  ['total', totalGz],
];

const over = checks.filter(([name, gz]) => gz > BUDGETS_KIB[name] * KIB);

if (over.length) {
  console.error('\n✗ パフォーマンス予算を超過しました:');
  for (const [name, gz] of over) {
    console.error(`  - ${name}: gzip ${kib(gz)} KiB > 予算 ${BUDGETS_KIB[name]} KiB`);
  }
  console.error('  対応: 本当に必要な増加か見直す。妥当なら scripts/perf-budget.mjs の BUDGETS_KIB を根拠とともに更新。');
  if (CHECK) process.exit(1);
} else {
  console.log('\n✓ すべて予算内です。');
}
