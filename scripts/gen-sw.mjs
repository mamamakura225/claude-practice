// ===== Service Worker / キャッシュバスティング自動生成 =====
// piano-pet の実ファイル内容から2つのコンテンツハッシュ（コード／メディア・#259）を算出し、
//   - sw.js の CODE_CACHE / MEDIA_CACHE 名と APP_SHELL / MEDIA_SHELL 一覧
//   - index.html の参照アセットに付く ?v=<コードのhash>
// を自動で同期する。手動で版を上げる箇所をなくし、追加ファイルの入れ忘れも防ぐ。
//
// 使い方:
//   node scripts/gen-sw.mjs           生成（ファイルを書き換える）
//   node scripts/gen-sw.mjs --check   差分があれば非ゼロ終了（CIのドリフト検知用）
//
// ハッシュは ?v=... を除去し EOL を正規化してから計算する（版文字列による循環や
// CRLF/LF 差異での不一致を避けるため）。sw.js 自身はハッシュを含むので対象外。

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { APP_DIR, INDEX, SW, listCodeAssets, listMediaAssets, listHashOnlyAssets } from './piano-pet-assets.mjs';

const CHECK = process.argv.includes('--check');

function read(rel) {
  return readFileSync(path.join(APP_DIR, rel), 'utf8');
}

// テキスト系は版除去・EOL正規化してから、バイナリ（音声・PNG等）は生バイトでハッシュする。
const TEXT_EXT = new Set(['.html', '.css', '.js', '.json', '.svg']);
const stripEol = (s) => s.replace(/\r\n/g, '\n');
const stripVer = (s) => s.replace(/\?v=[A-Za-z0-9]+/g, '');

// アセット内容（テキストは版除去・EOL正規化）からハッシュを算出
function computeHash(assets) {
  const h = createHash('sha256');
  for (const rel of [...assets].sort()) {
    h.update(rel + '\0');
    if (TEXT_EXT.has(path.extname(rel))) {
      h.update(stripVer(stripEol(read(rel))) + '\0');
    } else {
      h.update(readFileSync(path.join(APP_DIR, rel)));  // 生バイト
      h.update('\0');
    }
  }
  return h.digest('hex').slice(0, 8);
}

// index.html から ?v= を付けるべき参照（css / js）を抽出
function entryRefs(html) {
  const refs = new Set();
  const re = /(?:href|src)="((?:css|js)\/[^"?]+\.(?:css|js))(?:\?v=[^"]*)?"/g;
  for (let m; (m = re.exec(html)); ) refs.add(m[1]);
  return refs;
}

// index.html の css/js 参照に ?v=<hash> を付与（既存の版は置換）
function stampHtml(html, hash) {
  return html.replace(
    /((?:href|src)="(?:css|js)\/[^"?]+\.(?:css|js))(?:\?v=[^"]*)?(")/g,
    (_, pre, post) => `${pre}?v=${hash}${post}`,
  );
}

// APP_SHELL の配列を組み立てる。index.html で版付き参照されるものだけ ?v= を付ける
function buildShell(assets, refs, hash) {
  const shell = ['./', './index.html'];
  for (const rel of assets) {
    if (rel === INDEX) continue;
    shell.push(`./${rel}${refs.has(rel) ? `?v=${hash}` : ''}`);
  }
  return shell;
}

const listBlock = (name, items) => `const ${name} = [\n${items.map((s) => `  '${s}',`).join('\n')}\n];`;

// 置換先が見つからないまま「変更なし」で通ると、古い版の SW が配られ続けるので失敗させる。
function replaceOnce(text, re, next) {
  if (!re.test(text)) throw new Error(`sw.js に生成先がありません: ${re}`);
  return text.replace(re, () => next);
}

function renderSw(sw, { codeHash, mediaHash, appShell, mediaShell }) {
  let out = replaceOnce(sw, /const CODE_CACHE = '[^']*';/, `const CODE_CACHE = 'piano-pet-code-${codeHash}';`);
  out = replaceOnce(out, /const MEDIA_CACHE = '[^']*';/, `const MEDIA_CACHE = 'piano-pet-media-${mediaHash}';`);
  out = replaceOnce(out, /const APP_SHELL = \[[\s\S]*?\];/, listBlock('APP_SHELL', appShell));
  return replaceOnce(out, /const MEDIA_SHELL = \[[\s\S]*?\];/, listBlock('MEDIA_SHELL', mediaShell));
}

// ---- 実行 ----
const codeAssets = listCodeAssets();
const mediaAssets = listMediaAssets();
const hash = computeHash(codeAssets);
// video/*.mp4（#318）はメディアのハッシュにだけ載せる。precache（MEDIA_SHELL）には入れない。
const mediaHash = computeHash([...mediaAssets, ...listHashOnlyAssets()]);
const htmlRaw = read(INDEX);
const swRaw = read(SW);

const refs = entryRefs(htmlRaw);
const newHtml = stampHtml(htmlRaw, hash);
const newSw = renderSw(swRaw, {
  codeHash: hash,
  mediaHash,
  appShell: buildShell(codeAssets, refs, hash),
  mediaShell: mediaAssets.map((rel) => `./${rel}`),
});

const targets = [
  { rel: INDEX, current: htmlRaw, next: newHtml },
  { rel: SW, current: swRaw, next: newSw },
];

if (CHECK) {
  const stale = targets.filter((t) => stripEol(t.current) !== stripEol(t.next));
  if (stale.length) {
    console.error(`✗ キャッシュ版が古いです (code=${hash}, media=${mediaHash})。次を再生成してコミットしてください:`);
    for (const t of stale) console.error(`  - apps/piano-pet/${t.rel}`);
    console.error('  実行: npm run gen-sw');
    process.exit(1);
  }
  console.log(`✓ キャッシュ版は最新です (code=${hash}, media=${mediaHash})`);
} else {
  let changed = 0;
  for (const t of targets) {
    if (t.current !== t.next) {
      writeFileSync(path.join(APP_DIR, t.rel), t.next);
      console.log(`updated apps/piano-pet/${t.rel}`);
      changed++;
    }
  }
  console.log(`done (code=${hash}, media=${mediaHash}${changed ? '' : ', 変更なし'})`);
}
