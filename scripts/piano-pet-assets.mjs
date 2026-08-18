// ===== piano-pet の配信アセット列挙（唯一の正） =====
// gen-sw.mjs（SW プリキャッシュ一覧）と perf-budget.mjs（サイズ計測）が同じ集合を見るための共有モジュール。
//
// 以前は両者が同じ規則を**別々に**書いており、#234 の PNG→WebP 移行で gen-sw だけが追随した結果、
// perf-budget の画像カテゴリが 0 件（実体 3.6 MiB）になっても CI は緑のまま通っていた。
// 列挙をここ 1 箇所に集約して、この種のドリフトを構造的に起こらなくする。

import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const APP_DIR = path.resolve(__dirname, '..', 'apps', 'piano-pet');
export const INDEX = 'index.html';
export const SW = 'sw.js';

// 配信アセット（アプリディレクトリ相対・POSIX 区切り）を決まった順で集める。
// sw.js 自身は生成物なので含めない。
export function listAssets() {
  const assets = [INDEX];
  collectDir('css', ['.css']);
  collectDir('js', ['.js']);
  assets.push('manifest.json');
  collectDir('icons', ['.svg', '.png']);
  collectDir('img/cat', ['.webp']);         // 猫本体は WebP（#234）
  collectDir('img/cat/items', ['.webp']);   // 装着アイテム
  collectDir('img/cat/scene', ['.webp']);   // 置物・小物系（#226）
  collectDir('sounds', ['.mp3', '.ogg', '.wav']);
  return assets;

  function collectDir(dir, exts) {
    let entries;
    try {
      entries = readdirSync(path.join(APP_DIR, dir));
    } catch {
      return;
    }
    for (const name of entries.sort()) {
      const full = path.join(APP_DIR, dir, name);
      if (statSync(full).isFile() && exts.includes(path.extname(name))) {
        assets.push(`${dir}/${name}`);
      }
    }
  }
}
