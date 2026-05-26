// ===== ランタイム設定の生成（環境変数注入） =====
// dtask / piano-pet が読み込む設定モジュールを環境変数から生成する。
//   - firebase-config.js  : Firebase 接続設定（env: FIREBASE_*）
//   - monitoring-config.js: Sentry など監視ツールの公開キー（env: SENTRY_DSN）
// ビルド工程のない静的アプリなので、デプロイ前にこのスクリプトで env を流し込み、
// 環境ごと（本番 / 将来のステージング）に向き先を切り替えられる継ぎ目を作る。
//
// クライアント用 Firebase 設定や Sentry DSN は本来公開情報（アクセス制御は別レイヤ）。
// よって env 未設定時はフォールバック（Firebase=現行本番値 / 監視=空=無効）になり、
// ローカル開発・テスト・プレビューはそのまま動く（監視は DSN 空なら no-op）。
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

// 監視・計測ツールの公開キー。env 未設定時は空（= 各アプリ側で no-op）。
const MONITORING_ENV_KEYS = {
  sentryDsn: 'SENTRY_DSN',
  posthogKey: 'POSTHOG_KEY',
  posthogHost: 'POSTHOG_HOST',
};

function resolveFromEnv(envKeys, defaults = {}) {
  const out = {};
  for (const [key, envName] of Object.entries(envKeys)) {
    const v = process.env[envName];
    out[key] = v && v.trim() !== '' ? v : (defaults[key] ?? '');
  }
  return out;
}

function renderModule(exportName, obj) {
  const body = Object.entries(obj)
    .map(([k, v]) => `  ${k}: ${JSON.stringify(v)},`)
    .join('\n');
  return [
    '// このファイルは scripts/gen-firebase-config.mjs が生成する。直接編集しないこと。',
    '// 値は環境変数から注入され、未設定時はフォールバック値になる。',
    `export const ${exportName} = {`,
    body,
    '};',
    '',
  ].join('\n');
}

const stripEol = (s) => s.replace(/\r\n/g, '\n');

const firebaseCfg = resolveFromEnv(ENV_KEYS, DEFAULTS);
const monitoringCfg = resolveFromEnv(MONITORING_ENV_KEYS);

// 生成先グループ（両アプリで同一内容を共有）。POSIX 相対で持つ。
const GROUPS = [
  {
    content: renderModule('firebaseConfig', firebaseCfg),
    files: ['apps/dtask/firebase-config.js', 'apps/piano-pet/js/firebase-config.js'],
  },
  {
    content: renderModule('monitoringConfig', monitoringCfg),
    files: ['apps/dtask/monitoring-config.js', 'apps/piano-pet/js/monitoring-config.js'],
  },
];

const summary = `projectId=${firebaseCfg.projectId}, sentry=${monitoringCfg.sentryDsn ? 'on' : 'off'}, posthog=${monitoringCfg.posthogKey ? 'on' : 'off'}`;

if (CHECK) {
  const stale = [];
  for (const g of GROUPS) {
    for (const rel of g.files) {
      let current = '';
      try {
        current = readFileSync(path.join(ROOT, rel), 'utf8');
      } catch {
        stale.push(rel);
        continue;
      }
      if (stripEol(current) !== stripEol(g.content)) stale.push(rel);
    }
  }
  if (stale.length) {
    console.error('✗ 生成済み設定が古い/欠落しています。再生成してコミットしてください:');
    for (const rel of stale) console.error(`  - ${rel}`);
    console.error('  実行: npm run gen-config');
    process.exit(1);
  }
  console.log(`✓ 設定は最新です (${summary})`);
} else {
  let changed = 0;
  for (const g of GROUPS) {
    for (const rel of g.files) {
      let current = '';
      try {
        current = readFileSync(path.join(ROOT, rel), 'utf8');
      } catch {
        /* 新規作成 */
      }
      if (current !== g.content) {
        writeFileSync(path.join(ROOT, rel), g.content);
        console.log(`updated ${rel}`);
        changed++;
      }
    }
  }
  console.log(`done (${summary}${changed ? '' : ', 変更なし'})`);
}
