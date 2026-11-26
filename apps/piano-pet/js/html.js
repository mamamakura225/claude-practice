// ===== HTML エスケープ（innerHTML へ載せる前の共通処理・#274） =====
// state の中身は信頼できない入力（→ requirements.md「受容しているリスク」）。innerHTML を
// 組み立てる箇所は、テキストでも属性値でも必ずここを通すこと。app.js と cat-image.js が使う。
export function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

// id の要素へ文字を出す（無ければ何もしない）
export function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

// Blob をファイルとして保存させる（a[download]）。バックアップの書き出しと写真モードが使う
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
