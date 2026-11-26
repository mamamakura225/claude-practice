// ===== せってい：親ゲート・バックアップ／復元・がぞくコード・アカウント（#440 で app.js から分けた） =====
// 設定オーバーレイを開くまで要らないので、app.js が初めて開くときに読む（遅延読込・#284）。
// 記録画面の下書きなど app.js 側の仕事は openSettings で受け取る（app.js を import しない）。
import { escapeHtml, setText, downloadBlob } from './html.js';
import { state, setState } from './state.js';
import { saveState, cloudFields, normalizeState, activeStorageKey } from './storage.js';
import {
  getAccounts, getActiveAccountId, setActiveAccount,
  getCloudDocId, setCloudDocId, generateCloudDocId, isValidCloudDocId, legacyCloudDocIdFor,
} from './account.js';
import { getCloud, withinLimit, pushForOverwrite, stopCloudForOverwrite } from './cloud-sync.js';
import {
  makeGateProblem, exportState, backupFilename, readStash, parseBackup, importErrorMessage,
  stashBeforeOverwrite as stashState,
} from './backup.js';
import { openDialog, closeDialog, focusIn } from './dialog.js';

// ===== せってい：データのバックアップ/復元（#140） =====
const settingsOverlayEl = document.getElementById('settingsOverlay');
const settingsGateEl = document.getElementById('settingsGate');
const settingsMenuEl = document.getElementById('settingsMenu');
const gateAnswerEl = document.getElementById('gateAnswer');
const gateErrorEl = document.getElementById('gateError');
const importFileEl = document.getElementById('importFile');
const importStatusEl = document.getElementById('importStatus');

// app.js から受け取る { clearStampDraft, currentGoal, showLessonSettings, showStampSettings }
let app = null;

// ゲートの正解（openSettings のたびに作り直す）。
let gateExpected = null;

export function openSettings(deps) {
  app = deps;
  app.showLessonSettings();
  app.showStampSettings();
  const p = makeGateProblem();
  gateExpected = p.answer;
  setText('gateA', p.a);
  setText('gateB', p.b);
  if (gateAnswerEl) gateAnswerEl.value = '';
  if (gateErrorEl) gateErrorEl.hidden = true;
  if (importStatusEl) importStatusEl.hidden = true;
  if (settingsGateEl) settingsGateEl.hidden = false;   // 毎回ゲートから
  if (settingsMenuEl) settingsMenuEl.hidden = true;
  if (!settingsOverlayEl) return;
  openDialog(settingsOverlayEl, { onClose: closeSettings, initial: gateAnswerEl });
}

function closeSettings() {
  if (!settingsOverlayEl) return;
  closeDialog(settingsOverlayEl);
}

// 親ゲートの解答チェック。正解でメニューを開き、誤りなら再入力させる。
function submitGate() {
  if (Number(gateAnswerEl?.value) === gateExpected) {
    if (settingsGateEl) settingsGateEl.hidden = true;
    if (settingsMenuEl) settingsMenuEl.hidden = false;
    renderAccountList();                   // アカウント切替の現在値を反映（#182）
    const goalInput = document.getElementById('goalTargetInput');
    if (goalInput) goalInput.value = String(app.currentGoal());  // 目標回数の現在値を反映（#238）
    renderCloudSection();                  // クラウド保存先（がぞくコード）の現在値を反映（#233）
    renderRestorePrev();                   // 読み込み・初期化の前へ戻す（#398）
    if (settingsMenuEl) focusIn(settingsMenuEl);   // ゲートが消えてフォーカスが body に落ちないように（#397）
  } else if (gateErrorEl) {
    gateErrorEl.hidden = false;
    if (gateAnswerEl) gateAnswerEl.value = '';
    gateAnswerEl?.focus();
  }
}

function showImportStatus(msg, isError) {
  if (!importStatusEl) return;
  importStatusEl.textContent = msg;
  importStatusEl.hidden = false;
  importStatusEl.classList.toggle('settings-menu__note--error', !!isError);
}

// 現行 state を JSON 化して a[download] でローカル保存（無害なので確認不要）。
function downloadBackup() {
  // がぞくコード（#233）を同梱＝別端末で復元すると同じクラウド保存先に合流できる。
  const json = exportState(state, new Date(), getCloudDocId(getActiveAccountId()));
  downloadBlob(new Blob([json], { type: 'application/json' }), backupFilename());
  showImportStatus('ファイルを ほぞんしたよ！', false);
}

// 読み込み・初期化の直前のデータを退避し、「ひとつ まえの データに もどす」で戻せるようにする（#398）
const stashBeforeOverwrite = () => stashState(localStorage, activeStorageKey(), stashOwner());
const stashOwner = () => ({ account: getActiveAccountId(), doc: getCloudDocId(getActiveAccountId()) ?? null });
const readStashedState = () => readStash(localStorage, stashOwner());
function renderRestorePrev() {
  const btn = document.getElementById('restorePrevBtn');
  if (btn) btn.hidden = !readStashedState();
}
function restorePrevData() {
  const prev = readStashedState();
  if (!prev) return;
  const when = prev.at ? new Date(prev.at) : null;
  const label = when ? `${when.getMonth() + 1}がつ${when.getDate()}にち ${when.getHours()}:${String(when.getMinutes()).padStart(2, '0')} の` : 'まえの';
  if (!window.confirm(`${label} じょうたいに もどします（データを よみこむ・けす まえ）。そのあとに つけた きろくは きえます。いまの データと いれかわるので、もういちど おすと もどせます。よろしいですか？`)) return;
  applyImportedState(prev.state);   // いまの データは退避されるので、もう一度押せば行き来できる
}

// 取り込み確定：①直前データを退避 ②ローカル保存 ③クラウド購読を解除
// ④クラウドへ反映完了を待つ ⑤リロード。古いスナップショットの巻き戻しを断つ（#140 設計レビュー C/D）。
// ②が書けなければ何も変えずにやめる（クラウドだけ置き換わって端末が元のままになるのを防ぐ・#428）。
// code＝がぞくコード同梱の復元先（DATA_DOC は切替前の doc に固定のため・#358）。
async function applyImportedState(imported, code = null) {
  const revertStash = stashBeforeOverwrite();   // 誤読込からの復旧用。退避の素性を元の保存先で残すため、コードの切替より前に（#398）
  if (!saveState(imported)) {
    revertStash();
    showImportStatus('たんまつの あきが たりなくて ほぞんできませんでした。', true);
    return;
  }
  stopCloudForOverwrite();
  setState(imported);
  const docId = code && setCloudDocId(getActiveAccountId(), code) ? code : null;
  app.clearStampDraft();   // 前のデータの書きかけを、入れ替えたデータの記録にしない（#428）
  await pushForOverwrite(docId);
  window.location.reload();   // クリーンに再起動（状態変数の不整合・古い購読を一掃）
}

// ===== クラウド保存先の推測不能化（がぞくコード・#233 段階1） =====
// 旧 doc ID は固定・推測可能だったため、ランダムな doc ID（がぞくコード）へ移す。
// 自動移行にすると端末ごとに別コードが生まれて家族の同期が割れるので、**親が明示操作**で行い、
// 他端末はコード入力（またはバックアップJSON取り込み）で同じ保存先に合流する。

const MIGRATE_BACKUP_KEY = 'piano-pet-backup-before-migrate';

function showCloudStatus(msg, isError) {
  const el = document.getElementById('cloudStatus');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  el.classList.toggle('settings-menu__note--error', !!isError);
}

// 親ゲート内のクラウド保存先セクションの表示を現在値に合わせる。
function renderCloudSection() {
  const code = getCloudDocId(getActiveAccountId());
  const notEl = document.getElementById('cloudNotMigrated');
  const yesEl = document.getElementById('cloudMigrated');
  if (notEl) notEl.hidden = !!code;
  if (yesEl) yesEl.hidden = !code;
  setText('cloudCodeValue', code ?? '—');
  const status = document.getElementById('cloudStatus');
  if (status) status.hidden = true;
}

// 移行：①ローカルへ退避 ②コード生成 ③新 doc へ現行データをコピー ④コード保存 ⑤リロード。
// 旧 doc の中身はこの時点では消さない（他端末がまだ旧 doc を見ている可能性があるため、
// 空にするのは全端末の合流後に親が明示操作で行う）。
async function migrateCloudDoc() {
  const cloud = getCloud();
  if (!cloud) { showCloudStatus('オフラインの ときは うつせません。', true); return; }
  const accountId = getActiveAccountId();
  if (getCloudDocId(accountId)) return;
  try {
    const cur = localStorage.getItem(activeStorageKey());
    if (cur) localStorage.setItem(MIGRATE_BACKUP_KEY, cur);   // 移行前の自動退避
  } catch { /* 退避失敗は致命的でないので無視 */ }

  const newId = generateCloudDocId();
  const ok = await withinLimit(cloud.pushCloudDoc(newId, cloudFields(state)));   // 新 doc へコピー
  if (!ok) { showCloudStatus('うつせませんでした。つうしんを かくにんしてね。', true); return; }
  if (!setCloudDocId(accountId, newId)) { showCloudStatus('コードを ほぞんできませんでした。', true); return; }
  window.location.reload();   // cloud.js の購読 doc を貼り直す
}

// 他端末で発行されたコードに合流する。ローカルデータは消さず、次回同期で union マージされる。
function joinCloudDoc() {
  const input = document.getElementById('cloudCodeInput');
  const code = String(input?.value ?? '').trim();
  if (!isValidCloudDocId(code)) { showCloudStatus('コードの かたちが ちがうみたい。', true); return; }
  if (!setCloudDocId(getActiveAccountId(), code)) { showCloudStatus('コードを ほぞんできませんでした。', true); return; }
  window.location.reload();
}

// 旧（推測可能な）doc を空にする。全端末が合流済みであることが前提なので確認を挟む。
async function clearLegacyCloudDoc() {
  const cloud = getCloud();
  if (!cloud) { showCloudStatus('オフラインの ときは できません。', true); return; }
  const ok = window.confirm(
    'ふるい ばしょ（あてられる ID）の なかみを からに します。\n'
    + 'ほかの たんまつが まだ コードを いれていない ばあい、その たんまつは データを よみこめなく なります。\n'
    + 'すすめますか？',
  );
  if (!ok) return;
  const done = await withinLimit(cloud.pushCloudDoc(legacyCloudDocIdFor(getActiveAccountId()), {}));
  showCloudStatus(done ? 'ふるい ばしょを からに しました。' : 'できなかった かもしれません。つうしんを かくにんしてね。', !done);
}

// データ初期化（#183）：購入履歴・猫の状態・練習記録をすべて消して新品に戻す。
function resetData() {
  if (!window.confirm('ねこの じょうたい・アイテム・れんしゅうきろくが ぜんぶ きえて、さいしょから になります。よろしいですか？')) return;
  applyImportedState(normalizeState({}));
}

// 選択ファイルを読んで検証。OK なら確認のうえ復元、NG なら理由をひらがなで表示。
function handleImportFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const res = parseBackup(String(reader.result));
    if (!res.ok) {
      showImportStatus(importErrorMessage(res.reason), true);
      return;
    }
    if (!window.confirm('いまの データは きえて、ファイルの データに なります。よろしいですか？')) return;
    // バックアップに がぞくコード（#233）が入っていれば、同じクラウド保存先へ合流させる。
    applyImportedState(res.state, res.cloudDocId);
  };
  reader.onerror = () => showImportStatus(importErrorMessage('parse'), true);
  reader.readAsText(file);
}

// ===== せってい：アカウント切替（マルチアカウント・#182） =====
// 親ゲートの裏で、有効アカウント（娘／テスト用）を一覧表示し切り替える。切替は
// localStorage の有効アカウントを書き換えてからページをリロードし、storage の参照キーと
// cloud の購読 doc を新アカウントで貼り直す（import/reset と同じリロード方式）。
function renderAccountList() {
  const el = document.getElementById('accountList');
  if (!el) return;
  const activeId = getActiveAccountId();
  el.innerHTML = getAccounts().map((a) => {
    const isActive = a.id === activeId;
    const right = isActive
      ? '<span class="account-row__badge">いま これ ✓</span>'
      : `<button type="button" class="settings-btn settings-btn--ghost account-switch" data-account="${escapeHtml(a.id)}">きりかえる</button>`;
    return `<div class="account-row${isActive ? ' account-row--active' : ''}">
      <span class="account-row__name">${escapeHtml(a.name)}</span>
      ${right}
    </div>`;
  }).join('');
}

document.getElementById('accountList')?.addEventListener('click', (e) => {
  const btn = e.target.closest('.account-switch');
  if (!btn) return;
  if (setActiveAccount(btn.dataset.account)) window.location.reload();
});

settingsOverlayEl?.addEventListener('click', (e) => {
  if (e.target.closest('[data-action="close-settings"]')) closeSettings();
});
document.getElementById('gateSubmit')?.addEventListener('click', submitGate);
gateAnswerEl?.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  submitGate();
});
document.getElementById('exportBtn')?.addEventListener('click', downloadBackup);
// クラウド保存先（がぞくコード・#233）
document.getElementById('cloudMigrateBtn')?.addEventListener('click', migrateCloudDoc);
document.getElementById('cloudJoinBtn')?.addEventListener('click', joinCloudDoc);
document.getElementById('cloudClearLegacyBtn')?.addEventListener('click', clearLegacyCloudDoc);
document.getElementById('cloudCopyBtn')?.addEventListener('click', async () => {
  const code = getCloudDocId(getActiveAccountId());
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
    showCloudStatus('コードを コピーしたよ！', false);
  } catch {
    showCloudStatus('コピーできませんでした。てで うつしてね。', true);
  }
});

document.getElementById('importBtn')?.addEventListener('click', () => importFileEl?.click());
document.getElementById('resetBtn')?.addEventListener('click', resetData);
document.getElementById('restorePrevBtn')?.addEventListener('click', restorePrevData);
importFileEl?.addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (file) handleImportFile(file);
  e.target.value = '';   // 同じファイルを連続選択しても change が発火するように
});
