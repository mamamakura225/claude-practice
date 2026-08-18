// ===== HTML エスケープ（innerHTML へ載せる前の共通処理・#274） =====
// state の中身は信頼できない入力（→ requirements.md「受容しているリスク」）。innerHTML を
// 組み立てる箇所は、テキストでも属性値でも必ずここを通すこと。app.js と cat-image.js が使う。
export function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}
