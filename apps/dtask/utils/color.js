/* プロジェクト色（ユーザーが自由に選ぶ）からバッジの文字色を決める (#354)。
 * 固定の色では全ての色に対して WCAG AA を保証できないため、背景（色を薄く敷いた面）に対して
 * 4.5:1 を満たすまで黒（ライト）／白（ダーク）へ寄せた色を返す。 */
const HEX_RE = /^#[0-9a-f]{6}$/i;
export const FALLBACK_COLOR = '#6B7280';

export function safeColor(hex) {
  return HEX_RE.test(hex || '') ? hex : FALLBACK_COLOR;
}

function toRgb(hex) {
  return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
}

function toHex(rgb) {
  return '#' + rgb.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
}

function luminance(rgb) {
  const [r, g, b] = rgb.map(v => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(hexA, hexB) {
  const a = luminance(toRgb(hexA));
  const b = luminance(toRgb(hexB));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

/* color を alpha で surface に敷いた色（バッジ背景） */
export function tint(color, surface, alpha) {
  return toHex(mix(toRgb(surface), toRgb(safeColor(color)), alpha));
}

/* tint 背景の上で 4.5:1 以上になる文字色。元の色相をなるべく保つ */
export function readableTextColor(color, surface, alpha = 0.13, min = 4.5) {
  const base = toRgb(safeColor(color));
  const bg = tint(color, surface, alpha);
  const toward = luminance(toRgb(surface)) > 0.5 ? [0, 0, 0] : [255, 255, 255];
  for (let t = 0; t <= 1.0001; t += 0.05) {
    const candidate = toHex(mix(base, toward, Math.min(t, 1)));
    if (contrastRatio(candidate, bg) >= min) return candidate;
  }
  return toHex(toward);
}
