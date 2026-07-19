// ===== 写真モード：きせかえ猫のスナップ画像生成（#237） =====
// ホームの .cat（本体WebP＋装備・置物）を canvas に合成して1枚の画像にする。
// - 端末内完結・サーバ不要。曲名・こども名など PII は一切含めない。
// - 演出SVG（ハート/きらきら/Zzz/エンブレム＝cat__fx）は初期スコープ外。
// - 位置/スケールは画面と一致させるため、cat-image.js のレイアウト数式を再実装せず
//   「実際に描画されている DOM の <g transform> と <image> の box」をそのまま読み取る。

const VIEWBOX = 200; // catMarkup の SVG viewBox は 0 0 200 200

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`snapshot image load failed: ${src}`));
    img.src = src;
  });
}

// <g transform="translate(tx ty) scale(sc)"> を数値に分解（未指定は単位変換）。
export function parseItemTransform(g) {
  const t = g?.getAttribute?.('transform') || '';
  const tr = /translate\(\s*([-\d.]+)[ ,]+([-\d.]+)\s*\)/.exec(t);
  const sc = /scale\(\s*([-\d.]+)\s*\)/.exec(t);
  return {
    tx: tr ? parseFloat(tr[1]) : 0,
    ty: tr ? parseFloat(tr[2]) : 0,
    sc: sc ? parseFloat(sc[1]) : 1,
  };
}

// 1つの overlay SVG 内の <image> を、その <g> 変換込みで canvas に描く。
async function drawSvgImages(ctx, svg, k) {
  if (!svg) return;
  for (const image of svg.querySelectorAll('image')) {
    const href = image.getAttribute('href') || image.getAttribute('xlink:href');
    if (!href) continue;
    const bx = parseFloat(image.getAttribute('x')) || 0;
    const by = parseFloat(image.getAttribute('y')) || 0;
    const bw = parseFloat(image.getAttribute('width')) || 0;
    const bh = parseFloat(image.getAttribute('height')) || 0;
    if (bw <= 0 || bh <= 0) continue;
    const { tx, ty, sc } = parseItemTransform(image.closest('g'));
    // 画像の縦横比は box と一致（xMidYMid meet で歪みなし）＝box にそのまま描けば画面と一致。
    const img = await loadImage(href);
    ctx.drawImage(img, (tx + sc * bx) * k, (ty + sc * by) * k, sc * bw * k, sc * bh * k);
  }
}

// catEl（.cat）の現在の見た目を size×size の canvas に合成して返す。
// 描画順は画面の z 順：背面置物(z1) → 本体(z2) → 装備(z3) → 前面置物(z5)。fx(z4) は除外。
export async function renderCatCanvas(catEl, size = 600, background = '#fff6ee') {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const k = size / VIEWBOX;

  // 透過のまま共有すると環境によって黒背景になるため、アプリのクリーム色で塗る。
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, size, size);

  await drawSvgImages(ctx, catEl.querySelector('.cat__scene--back'), k);

  const body = catEl.querySelector('.cat__body');
  if (body && body.getAttribute('src')) {
    const bodyImg = body.complete && body.naturalWidth ? body : await loadImage(body.src);
    ctx.drawImage(bodyImg, 0, 0, size, size); // 本体は正方キャンバス全面
  }

  await drawSvgImages(ctx, catEl.querySelector('.cat__front'), k);
  await drawSvgImages(ctx, catEl.querySelector('.cat__scene--front'), k);
  return canvas;
}

export function canvasToBlob(canvas, type = 'image/png') {
  return new Promise((resolve) => canvas.toBlob(resolve, type));
}
