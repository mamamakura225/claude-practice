// ===== パフォーマンス予算（bundle / asset サイズ）チェック =====
// piano-pet の配信アセットの合計サイズを計測し、予算（BUDGETS）を超えたら失敗する。
// 「アプリを重くしない」方針を仕組みで担保するための回帰ガード（#147）。
//
// 使い方:
//   node scripts/perf-budget.mjs           レポート表示のみ（常に成功）
//   node scripts/perf-budget.mjs --check    予算超過があれば非ゼロ終了（CI用）
//
// 測るのは**最小化後**（minify.mjs ＝ 本番の dist/ と同じ変換・#430）の大きさ。コメントは数字に乗らない。
// 計測対象は gen-sw の precache と同一の列挙（scripts/piano-pet-assets.mjs の listAssets()）
// ＝ SW がプリキャッシュする配信アセット全部を仕分けたもの。gen-sw のキャッシュハッシュは
// これに加えて listHashOnlyAssets()（video/*.mp4・#318）も見るが、そちらは判定対象外（下記）。
// 予算は HTML/CSS/JS（コード・マークアップのアプリシェル）と
// その合計に対して gzip 後のサイズで設ける。icons / img / sounds はバイナリで変更頻度が低く、
// 配信時も再圧縮されない（mp3・webp 等）ため、レポートには出すが予算判定からは除外する。

import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { minifyFile } from './minify.mjs';
import { APP_DIR, INDEX, classifyJs, listAssets } from './piano-pet-assets.mjs';

const CHECK = process.argv.includes('--check');

// 予算（最小化後の gzip KiB）。「肥大化の回帰」を捕まえるための上限で、細かなサイズを縛る目的ではない。
// 値は 2026-11 の実測に 1 割ほどの余白を足したもの。過去の引き上げの経緯は git の履歴を見る。
// 超えたら、本当に必要な増加か見直すか、根拠とともに引き上げる（CLAUDE.md ④）。
// 厳しく縛るのは起動をブロックするぶん（html + css + js-entry = total）。js-lazy には操作するまで読まない
// ものと idle で必ず読むもの（cloud.js）が混ざるが、どちらも起動はブロックしないので total に入れない（#284）。
const BUDGETS_KIB = {
  html: 7,          // 実測 6.4
  css: 10,          // 実測 8.7
  'js-entry': 36,   // 実測 32.2（#440 で設定を遅延へ移して 34.1 から減ったぶん締めた）
  'js-lazy': 21,    // 実測 19.0（#440 で設定 settings.js が入って 16.4 から増えた）
  total: 53,        // 実測 47.3（html + css + js-entry）
};

const KIB = 1024;

// 計測対象は gen-sw の precache と**同一の列挙**（piano-pet-assets.mjs の listAssets()）を
// 仕分けたもの。以前は同じ規則を各スクリプトに別々に書いており、#234 の PNG→WebP 移行で
// perf-budget だけが取り残されて画像カテゴリが 0 件（実体 3.6 MiB）になっていた。
const ASSETS = listAssets();
const under = (prefix) => ASSETS.filter((rel) => rel.startsWith(prefix));

// 初回ロード／遅延読込の切り分けはソースの import 文から導出する（piano-pet-assets.mjs）。
const JS = classifyJs();

const CATEGORIES = {
  html: [INDEX, 'manifest.json'],
  css: under('css/'),
  'js-entry': JS.entry,
  'js-lazy': JS.lazy,
  icons: under('icons/'),
  img: under('img/'),
  sounds: under('sounds/'),
};

// 死んだ JS の検知：配信しているのに app.js からも import() からも到達できないファイル。
// 予算に載らないまま SW プリキャッシュだけ太らせるので、消し忘れとして失敗させる。
if (JS.orphan.length) {
  console.error('✗ どこからも import されていない JS があります:');
  for (const rel of JS.orphan) console.error(`  - ${rel}`);
  console.error('  対応: 不要なら削除する。使うなら import して初回ロード/遅延読込のどちらかに載せる。');
  process.exit(1);
}

// 仕分け漏れの検知：配信アセットは必ずどれか1カテゴリに入る。分類規則とディレクトリ構成が
// ズレたときに「黙って計測から消える」ことを防ぐ（0件チェックでは部分的な取りこぼしを拾えない）。
const classified = new Set(Object.values(CATEGORIES).flat());
const unclassified = ASSETS.filter((rel) => !classified.has(rel));
if (unclassified.length) {
  console.error('✗ どのカテゴリにも入らない配信アセットがあります:');
  for (const rel of unclassified) console.error(`  - ${rel}`);
  console.error('  scripts/perf-budget.mjs の CATEGORIES を実体に合わせて更新してください。');
  process.exit(1);
}

// カテゴリの最小化後の raw / gzip 合計バイトを求める。
function measure(files) {
  let raw = 0;
  let gz = 0;
  for (const rel of files) {
    const buf = minifyFile(rel, readFileSync(path.join(APP_DIR, rel)));
    raw += buf.length;
    gz += gzipSync(buf).length;
  }
  return { raw, gz, count: files.length };
}

const kib = (bytes) => (bytes / KIB).toFixed(1);

const results = Object.fromEntries(
  Object.entries(CATEGORIES).map(([name, files]) => [name, measure(files)]),
);

// 起動をブロックする合計（遅延読込ぶんは含めない）。
const totalGz = results.html.gz + results.css.gz + results['js-entry'].gz;

// ---- レポート ----
console.log('piano-pet アセットサイズ（最小化後の raw / gzip）:');
for (const [name, r] of Object.entries(results)) {
  const budget = BUDGETS_KIB[name];
  const budgetNote = budget ? `  予算 ${budget} KiB` : '';
  console.log(
    `  ${name.padEnd(9)} ${String(r.count).padStart(2)}件  ` +
      `raw ${kib(r.raw).padStart(7)} KiB  gzip ${kib(r.gz).padStart(7)} KiB${budgetNote}`,
  );
}
console.log(`  ${'total'.padEnd(9)}     (html+css+js-entry) gzip ${kib(totalGz)} KiB  予算 ${BUDGETS_KIB.total} KiB`);

// ---- 予算判定 ----
const checks = [
  ['html', results.html.gz],
  ['css', results.css.gz],
  ['js-entry', results['js-entry'].gz],
  ['js-lazy', results['js-lazy'].gz],
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
