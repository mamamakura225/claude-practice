// ===== クラウド書き込みの遅延バッチキュー（firebase 非依存・#146 / #313） =====
// cloud.js は firebase CDN を静的 import するため単体テスト不可。debounce/flush の
// キュー部分だけを純粋ロジックとして切り出し、pushCloud を引数で受け取ってテスト可能にする。
//
// #313: 保留データは「呼び出し時点の state のスナップショット」ではなく thunk で持つ。
// 値で焼き付けると、保留中に applyRemoteState 等で state が差し替わっても古い内容を送ってしまい、
// 他端末が確定済みの記録を巻き戻す。thunk なら送信時点の最新が常に正になり、
// visibilitychange / pagehide の flush が古い state を送る問題も同時に消える。

export function createCloudQueue(pushCloud, { defaultDelay = 2000 } = {}) {
  let saveTimer = null;
  let pending = null; // () => data ｜ null

  function pushCloudDebounced(getData, delay = defaultDelay) {
    pending = getData;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushCloud, delay);
  }

  // 保留中の書き込みがあれば即送る（記録確定・タブ非アクティブ/離脱時に呼ぶ）。何も保留していなければ no-op。
  // オフライン中は pushCloud が握りつぶすため pending を消さずに保持し、次の flush で送り直す（#288）。
  function flushCloud() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (pending == null) return undefined;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return undefined;
    const getData = pending;
    pending = null;
    return pushCloud(typeof getData === 'function' ? getData() : getData);
  }

  return { pushCloudDebounced, flushCloud };
}
