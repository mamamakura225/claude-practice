// ===== 配信物（dist/）の生成（#430） =====
// ルートの index.html と apps/* を、最小化しながら dist/ へ写す。ソースは決して書き換えない
// （出力先は dist/ 固定。ローカルで実行しても安全）。sourcemap は作らない。
//
//   npm run build     → dist/ を作り直す
//
// vercel.json の buildCommand / outputDirectory がこれを指す。CI の E2E と Lighthouse も dist/ を見る
// ので、本番と同じものを検証できる。docs・テストはここで落とすので本番には載らない。

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { minifyFile } from './minify.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

// 配信しないもの（apps/<app>/ 直下のディレクトリ名）。
const SKIP_DIRS = new Set(['docs', 'e2e', 'tests']);

function listAppFiles(app) {
  const base = path.join(ROOT, 'apps', app);
  return readdirSync(base, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && !e.name.startsWith('.') && !e.name.endsWith('.md'))
    .map((e) => path.relative(base, path.join(e.parentPath ?? e.path, e.name)).split(path.sep).join('/'))
    .filter((rel) => !SKIP_DIRS.has(rel.split('/')[0]))
    .map((rel) => `apps/${app}/${rel}`);
}

const apps = readdirSync(path.join(ROOT, 'apps'), { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name);
const files = ['index.html', ...apps.flatMap(listAppFiles)];

rmSync(DIST, { recursive: true, force: true });
let before = 0;
let after = 0;
for (const rel of files) {
  const src = readFileSync(path.join(ROOT, rel));
  const out = minifyFile(rel, src);
  const dest = path.join(DIST, rel);
  mkdirSync(path.dirname(dest), { recursive: true });
  writeFileSync(dest, out);
  before += src.length;
  after += out.length;
}
const kib = (n) => (n / 1024).toFixed(0);
console.log(`dist/ に ${files.length} 件（${kib(before)} → ${kib(after)} KiB）`);
