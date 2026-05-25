// ===== Firebase 設定の生成（環境変数注入） =====
// dtask / piano-pet が読み込む firebase-config.js を環境変数から生成する。
// ビルド工程のない静的アプリなので、デプロイ前にこのスクリプトで env を流し込み、
// 環境ごと（本番 / 将来のステージング）に向き先を切り替えられる継ぎ目を作る。
//
// クライアント用 Firebase 設定は本来公開情報（アクセス制御は Firestore ルール）。
// よって env 未設定時は下記 DEFAULTS（現行の本番値）にフォールバックし、
// ローカル開発・テスト・プレビューはそのまま動く。
//
// 使い方:
//   node scripts/gen-firebase-config.mjs           生成（ファイルを書き換える）
//   node scripts/gen-firebase-config.mjs --check   差分があれば非ゼロ終了（CIのドリフト検知用）

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CHECK = process.argv.includes('--check');

// env 未設定時のフォールバック（= 現行の本番プロジェクト dtask-d08b6 の公開値）
const DEFAULTS = {
  apiKey: 'AIzaSyBEN2Cd1CGzC3aN9hHS4m8o1MCnF6z5oBk',
  authDomain: 'dtask-d08b6.firebaseapp.com',
  projectId: 'dtask-d08b6',
  storageBucket: 'dtask-d08b6.firebasestorage.app',
  messagingSenderId: '459534305297',
  appId: '1:459534305297:web:f30a96b68d3fc2dc3e49b0',
};

const ENV_KEYS = {
  apiKey: 'FIREBASE_API_KEY',
  authDomain: 'FIREBASE_AUTH_DOMAIN',
  projectId: 'FIREBASE_PROJECT_ID',
  storageBucket: 'FIREBASE_STORAGE_BUCKET',
  messagingSenderId: 'FIREBASE_MESSAGING_SENDER_ID',
  appId: 'FIREBASE_APP_ID',
};

// 生成先（両アプリで同一内容を共有）。POSIX 相対で持つ。
const TARGETS = ['apps/dtask/firebase-config.js', 'apps/piano-pet/js/firebase-config.js'];

function resolveConfig() {
  const cfg = {};
  for (const [key, envName] of Object.entries(ENV_KEYS)) {
    const v = process.env[envName];
    cfg[key] = v && v.trim() !== '' ? v : DEFAULTS[key];
  }
  return cfg;
}

function render(cfg) {
  const body = Object.entries(cfg)
    .map(([k, v]) => `  ${k}: ${JSON.stringify(v)},`)
    .join('\n');
  return [
    '// このファイルは scripts/gen-firebase-config.mjs が生成する。直接編集しないこと。',
    '// 値は環境変数（FIREBASE_*）から注入され、未設定時は本番のフォールバック値になる。',
    'export const firebaseConfig = {',
    body,
    '};',
    '',
  ].join('\n');
}

const stripEol = (s) => s.replace(/\r\n/g, '\n');

const cfg = resolveConfig();
const next = render(cfg);

if (CHECK) {
  const stale = TARGETS.filter((rel) => {
    let current = '';
    try {
      current = readFileSync(path.join(ROOT, rel), 'utf8');
    } catch {
      return true;
    }
    return stripEol(current) !== stripEol(next);
  });
  if (stale.length) {
    console.error('✗ firebase-config.js が古い/欠落しています。再生成してコミットしてください:');
    for (const rel of stale) console.error(`  - ${rel}`);
    console.error('  実行: npm run gen-config');
    process.exit(1);
  }
  console.log(`✓ firebase-config.js は最新です (projectId=${cfg.projectId})`);
} else {
  let changed = 0;
  for (const rel of TARGETS) {
    let current = '';
    try {
      current = readFileSync(path.join(ROOT, rel), 'utf8');
    } catch {
      /* 新規作成 */
    }
    if (current !== next) {
      writeFileSync(path.join(ROOT, rel), next);
      console.log(`updated ${rel}`);
      changed++;
    }
  }
  console.log(`done (projectId=${cfg.projectId}${changed ? '' : ', 変更なし'})`);
}
