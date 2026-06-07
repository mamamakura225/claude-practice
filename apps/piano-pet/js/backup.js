// ===== データのバックアップ/復元（JSON 書き出し・読み込み・#140） =====
// 認証なし・匿名クラウド同期のため、端末故障やブラウザデータ削除でデータが消えるリスクがある。
// 親が state を JSON で手元に保存（export）し、いつでも復元（import）できるようにする安全弁。
// このモジュールは純粋関数のみに保つ（ダウンロード/ファイル選択/クラウドpush/リロードは app.js 側）。
import { SCHEMA_VERSION, migrate, normalizeState } from './storage.js';

// バックアップファイルが piano-pet のものだと識別するためのマーカー。
const APP_MARKER = 'piano-pet';

// 復元直前の現行データを退避する localStorage キー。誤った古いファイルを読み込んでも
// 端末内に直前の状態が残るため、最後の手段として復旧できる（設計レビュー D1）。
export const RESTORE_BACKUP_KEY = 'piano-pet-backup-before-restore';

// 現在の state を、アプリ識別マーカー＋スキーマ版＋書き出し日時でラップした pretty JSON にする。
export function exportState(state, now = new Date()) {
  return JSON.stringify(
    {
      app: APP_MARKER,
      schemaVersion: SCHEMA_VERSION,
      exportedAt: now.toISOString(),
      state,
    },
    null,
    2,
  );
}

// バックアップファイル名（piano-pet-backup-YYYY-MM-DD.json）。
export function backupFilename(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `piano-pet-backup-${y}-${m}-${d}.json`;
}

// バックアップ JSON 文字列を検証して取り込み用 state を返す純粋関数。
// 戻り値: { ok: true, state } | { ok: false, reason }
//   reason: 'parse'  … JSON として壊れている
//           'marker' … piano-pet のファイルではない（別アプリ・マーカー不一致）
//           'shape'  … 必須データ構造（pet / streak）が欠落している
//           'future' … 現行アプリより新しいスキーマ版（ダウングレード破損を防ぐため拒否）
// マーカーと必須キーを通った場合のみ migrate()→normalizeState() で現行スキーマに整える。
export function parseBackup(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'parse' };
  }
  if (!obj || typeof obj !== 'object' || obj.app !== APP_MARKER) {
    return { ok: false, reason: 'marker' };
  }
  const inner = obj.state;
  const isObj = (v) => typeof v === 'object' && v !== null;
  if (!isObj(inner) || !isObj(inner.pet) || !isObj(inner.streak)) {
    return { ok: false, reason: 'shape' };
  }
  const sv = Number(obj.schemaVersion);
  if (Number.isInteger(sv) && sv > SCHEMA_VERSION) {
    return { ok: false, reason: 'future' };
  }
  return { ok: true, state: normalizeState(migrate(inner)) };
}

// 復元失敗理由を 5歳児＋親向けのひらがなメッセージにする。
export function importErrorMessage(reason) {
  switch (reason) {
    case 'parse':
      return 'ファイルが こわれているみたい。よみこめませんでした。';
    case 'marker':
      return 'これは ピアノペットの ファイルじゃ ないみたい。';
    case 'shape':
      return 'ファイルの なかみが たりないみたい。よみこめませんでした。';
    case 'future':
      return 'あたらしい バージョンの ファイルです。アプリを さいしんに してね。';
    default:
      return 'よみこめませんでした。';
  }
}

// ペアレンタルゲート用の掛け算問題を作る（1桁×1桁・九九）。足し算より子の突破を防ぐ。
// rng を差し替え可能にしてテストしやすくする。
export function makeGateProblem(rng = Math.random) {
  const a = Math.floor(rng() * 9) + 1; // 1..9
  const b = Math.floor(rng() * 9) + 1; // 1..9
  return { a, b, answer: a * b };
}
