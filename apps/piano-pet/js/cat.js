// ===== 猫SVG生成（スコティッシュフォールド・正面向きちびキャラ） =====
// パーツ構成：頭・胴体・尻尾を独立グループ化（参考図パターン1準拠・横長/前足なし）
import { catStage } from './game.js';

// ----- カラーパレット（参考図パターン1：茶トラ・シンプル） -----
const FUR      = '#e6a455';  // メイン毛色（茶トラのゴールデンオレンジ）
const FUR_DARK = '#7d5223';  // 輪郭線（はっきりした温かみのブラウン）
const STRIPE   = '#c97f30';  // 縞模様（額・しっぽのキジトラ柄）
const BELLY    = '#f6ecc8';  // お腹・マズル・足先のクリーム
const EAR_IN   = '#d2925a';  // 耳の内側（折れ耳の影・ラスト系）
const BLUSH    = '#efb079';  // ほっぺ（控えめな温かみ）
const PUPIL    = '#3a2e26';  // 黒目（ツヤのある黒に近いブラウン）
const EYE_HIGH = '#ffffff';  // 目のハイライト
const NOSE     = '#8a5a3c';  // 鼻（小さなブラウン）
const WHISKER  = '#e3cf9a';  // ひげ（明るいクリーム）

// ----- ステージ別パラメータ（viewBox 0 0 200 236） -----
// 横長の丸い体＋短いカール尻尾（前足なし）。
const STAGES = {
  // 子猫（lv 1-5）：頭でっかち・丸くコンパクト
  kitten: {
    head: { cx: 100, cy: 94, r: 50 },
    ears: { lx: 72, rx: 128, ty: 58, erx: 20, ery: 16, rot: 16 },
    body: { cx: 100, cy: 176, rx: 58, ry: 50 },
    belly: { cx: 100, cy: 186, rx: 34, ry: 32 },
    tail:  { d: 'M150 182 Q182 180 182 152 Q182 130 158 136', w: 16 },
    anchors: { neck: {x:100,y:148,s:0.74}, head: {x:100,y:48,s:0.76}, back: {x:100,y:160,s:0.78} },
  },
  // 若猫（lv 6-15）：バランスの良い体型
  young: {
    head: { cx: 100, cy: 88, r: 55 },
    ears: { lx: 70, rx: 130, ty: 50, erx: 22, ery: 18, rot: 15 },
    body: { cx: 100, cy: 172, rx: 64, ry: 56 },
    belly: { cx: 100, cy: 184, rx: 38, ry: 38 },
    tail:  { d: 'M158 180 Q192 178 192 148 Q192 124 166 132', w: 18 },
    anchors: { neck: {x:100,y:142,s:0.86}, head: {x:100,y:36,s:0.90}, back: {x:100,y:156,s:0.92} },
  },
  // 成猫（lv 16+）：どっしりした風格
  adult: {
    head: { cx: 100, cy: 84, r: 60 },
    ears: { lx: 68, rx: 132, ty: 46, erx: 24, ery: 19, rot: 14 },
    body: { cx: 100, cy: 170, rx: 70, ry: 60 },
    belly: { cx: 100, cy: 182, rx: 42, ry: 42 },
    tail:  { d: 'M166 178 Q198 176 198 146 Q198 122 172 130', w: 20 },
    anchors: { neck: {x:100,y:148,s:1.00}, head: {x:100,y:30,s:1.04}, back: {x:100,y:154,s:1.08} },
  },
};

// ----- パーツ描画ヘルパー -----

function n(v, d = 1) {
  return parseFloat(v.toFixed(d));
}

// 目（開）: ツヤのある黒目＋小さな白ハイライト1つ（シンプルでかわいく）
function eyeOpen(cx, cy, r) {
  return `<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(r * 0.84)}" ry="${n(r)}" fill="${PUPIL}"/>
          <circle cx="${n(cx - r * 0.26)}" cy="${n(cy - r * 0.30)}" r="${n(r * 0.26)}" fill="${EYE_HIGH}"/>`;
}

// 目（閉）: アーチ型の線
function eyeClosed(cx, cy, r) {
  const x1 = n(cx - r * 0.78);
  const x2 = n(cx + r * 0.78);
  const yc = n(cy);
  const yb = n(cy + r * 0.82);
  return `<path d="M${x1} ${yc} Q${n(cx)} ${yb} ${x2} ${yc}" fill="${PUPIL}" stroke="${PUPIL}" stroke-width="1.5"/>`;
}

// ひげ（鼻の両側から伸びる3本ずつ）
function whiskersMarkup(cx, cy, r) {
  const wy  = n(cy + r * 0.14);
  const wx  = n(cx - r * 0.20);  // 内端X（左）
  const ex1 = n(cx - r * 0.82);  // 外端X（上）
  const ex2 = n(cx - r * 0.86);  // 外端X（中）
  const ex3 = n(cx - r * 0.82);  // 外端X（下）
  return `<g stroke="${WHISKER}" stroke-width="1.5" stroke-linecap="round" opacity="0.85">
    <line x1="${wx}"         y1="${n(wy - r*0.07)}" x2="${ex1}"              y2="${n(wy - r*0.14)}"/>
    <line x1="${wx}"         y1="${wy}"              x2="${ex2}"              y2="${wy}"/>
    <line x1="${wx}"         y1="${n(wy + r*0.07)}" x2="${ex3}"              y2="${n(wy + r*0.14)}"/>
    <line x1="${n(cx+r*0.20)}" y1="${n(wy - r*0.07)}" x2="${n(cx+r*0.82)}"  y2="${n(wy - r*0.14)}"/>
    <line x1="${n(cx+r*0.20)}" y1="${wy}"              x2="${n(cx+r*0.86)}"  y2="${wy}"/>
    <line x1="${n(cx+r*0.20)}" y1="${n(wy + r*0.07)}" x2="${n(cx+r*0.82)}"  y2="${n(wy + r*0.14)}"/>
  </g>`;
}

// 頭部グループ（折れ耳・丸顔・表情レイヤー）
function headGroup(cfg) {
  const { head: h, ears: e } = cfg;
  const eyeR  = h.r * 0.23;
  const eyeY  = h.cy - h.r * 0.02;
  const eyeLX = h.cx - h.r * 0.33;
  const eyeRX = h.cx + h.r * 0.33;
  const noseY = h.cy + h.r * 0.22;
  const noseH = h.r * 0.09;
  const noseW = h.r * 0.085;

  return `
  <g class="cat__head">
    <!-- 折れ耳（外）耳は頭円の後ろに描き、頭でベースを隠す -->
    <ellipse cx="${e.lx}" cy="${e.ty}" rx="${e.erx}" ry="${e.ery}" fill="${FUR}" stroke="${FUR_DARK}" stroke-width="1.2" transform="rotate(-${e.rot},${e.lx},${e.ty})"/>
    <ellipse cx="${e.rx}" cy="${e.ty}" rx="${e.erx}" ry="${e.ery}" fill="${FUR}" stroke="${FUR_DARK}" stroke-width="1.2" transform="rotate(${e.rot},${e.rx},${e.ty})"/>
    <!-- 折れ耳（内側） -->
    <ellipse cx="${e.lx}" cy="${n(e.ty+4)}" rx="${e.erx-6}" ry="${e.ery-5}" fill="${EAR_IN}" transform="rotate(-${e.rot},${e.lx},${n(e.ty+4)})"/>
    <ellipse cx="${e.rx}" cy="${n(e.ty+4)}" rx="${e.erx-6}" ry="${e.ery-5}" fill="${EAR_IN}" transform="rotate(${e.rot},${e.rx},${n(e.ty+4)})"/>
    <!-- 頭（耳のベースを隠す） -->
    <circle cx="${h.cx}" cy="${h.cy}" r="${h.r}" fill="${FUR}" stroke="${FUR_DARK}" stroke-width="1.5"/>
    <!-- 額のキジトラ縞（3本） -->
    <g stroke="${STRIPE}" stroke-width="${n(h.r*0.10)}" stroke-linecap="round" fill="none" opacity="0.70">
      <path d="M${h.cx} ${n(h.cy - h.r*0.74)} L${h.cx} ${n(h.cy - h.r*0.50)}"/>
      <path d="M${n(h.cx - h.r*0.22)} ${n(h.cy - h.r*0.70)} L${n(h.cx - h.r*0.26)} ${n(h.cy - h.r*0.48)}"/>
      <path d="M${n(h.cx + h.r*0.22)} ${n(h.cy - h.r*0.70)} L${n(h.cx + h.r*0.26)} ${n(h.cy - h.r*0.48)}"/>
    </g>
    <!-- 顔下部のクリームのマズル -->
    <ellipse cx="${h.cx}" cy="${n(h.cy + h.r*0.26)}" rx="${n(h.r*0.48)}" ry="${n(h.r*0.36)}" fill="${BELLY}" opacity="0.55"/>
    <!-- ほっぺ -->
    <circle cx="${n(h.cx - h.r*0.46)}" cy="${n(h.cy + h.r*0.26)}" r="${n(h.r*0.21)}" fill="${BLUSH}" opacity="0.38"/>
    <circle cx="${n(h.cx + h.r*0.46)}" cy="${n(h.cy + h.r*0.26)}" r="${n(h.r*0.21)}" fill="${BLUSH}" opacity="0.38"/>
    <!-- 目：開 -->
    <g class="cat__eyes cat__eyes--open">
      ${eyeOpen(eyeLX, eyeY, eyeR)}
      ${eyeOpen(eyeRX, eyeY, eyeR)}
    </g>
    <!-- 目：閉（睡眠時） -->
    <g class="cat__eyes cat__eyes--closed">
      ${eyeClosed(eyeLX, eyeY, eyeR)}
      ${eyeClosed(eyeRX, eyeY, eyeR)}
    </g>
    <!-- 鼻（三角形） -->
    <path d="M${h.cx} ${n(noseY)} l-${n(noseW)} -${n(noseH)} h${n(noseW*2)} z" fill="${NOSE}"/>
    <!-- 口 -->
    <path d="M${h.cx} ${n(noseY)} Q${n(h.cx-h.r*0.15)} ${n(noseY+h.r*0.13)} ${n(h.cx-h.r*0.26)} ${n(noseY+h.r*0.07)} M${h.cx} ${n(noseY)} Q${n(h.cx+h.r*0.15)} ${n(noseY+h.r*0.13)} ${n(h.cx+h.r*0.26)} ${n(noseY+h.r*0.07)}" fill="none" stroke="${FUR_DARK}" stroke-width="2" stroke-linecap="round"/>
    <!-- ひげ -->
    ${whiskersMarkup(h.cx, h.cy, h.r)}
  </g>`;
}

// 胴体グループ（ボディ本体＋お腹のクリームエリア）
function bodyGroup({ body: b, belly: bl }) {
  return `
  <g class="cat__body">
    <ellipse cx="${b.cx}" cy="${b.cy}" rx="${b.rx}" ry="${b.ry}" fill="${FUR}" stroke="${FUR_DARK}" stroke-width="1.5"/>
    <ellipse cx="${bl.cx}" cy="${bl.cy}" rx="${bl.rx}" ry="${bl.ry}" fill="${BELLY}" opacity="0.85"/>
  </g>`;
}

// 尻尾グループ（太いストロークの曲線＋縞模様レイヤー）
function tailGroup({ tail }) {
  return `
  <g class="cat__tail">
    <path d="${tail.d}" fill="none" stroke="${FUR_DARK}" stroke-width="${tail.w + 2}" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="${tail.d}" fill="none" stroke="${FUR}" stroke-width="${tail.w}" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="${tail.d}" fill="none" stroke="${STRIPE}" stroke-width="${tail.w}" stroke-linecap="butt" stroke-dasharray="6 13" opacity="0.85"/>
  </g>`;
}

// ----- アイテムSVG（前向きデザイン、原点(0,0)基準） -----
// アンカー位置に translate+scale で配置される
const ITEMS = {
  ribbon: () => `
    <g>
      <path d="M0 0 L-28 -16 L-28 16 Z" fill="#ff5d7a"/>
      <path d="M0 0 L28 -16 L28 16 Z"  fill="#ff5d7a"/>
      <path d="M-28 -16 Q-8 0 -28 16 Z" fill="#e23f5e"/>
      <path d="M28 -16 Q8 0 28 16 Z"   fill="#e23f5e"/>
      <circle r="9" fill="#e23f5e"/>
    </g>`,

  collar: () => `
    <g>
      <path d="M-40 -7 Q0 -20 40 -7 L40 7 Q0 20 -40 7 Z" fill="#7fc6ff"/>
      <path d="M0 7 l8 14 -8 6 -8 -6 z" fill="#ffd34d" stroke="#e0a91f" stroke-width="1.5"/>
    </g>`,

  hat: () => `
    <g>
      <ellipse cy="2" rx="50" ry="13" fill="#e8c270"/>
      <path d="M-32 2 Q0 -50 32 2" fill="#f0d089"/>
      <rect x="-32" y="-4" width="64" height="10" rx="5" fill="#c8783c"/>
    </g>`,

  cape: () => `
    <g>
      <path d="M-50 -6 Q0 -24 50 -6 L46 70 Q0 88 -46 70 Z" fill="#9b6bff"/>
      <path d="M-50 -6 Q0 -24 50 -6 L44 12 Q0 28 -44 12 Z" fill="#6f3fd6"/>
      <path d="M-50 -6 Q0 -24 50 -6" fill="none" stroke="#c9a0ff" stroke-width="4"/>
    </g>`,

  crown: () => `
    <g>
      <path d="M-36 18 L-36 -12 L-18 6 L0 -18 L18 6 L36 -12 L36 18 Z" fill="#ffd34d" stroke="#e0a91f" stroke-width="2"/>
      <rect x="-36" y="14" width="72" height="8" rx="4" fill="#e0a91f"/>
      <circle cy="2"  r="6" fill="#ff5d7a"/>
      <circle cx="-22" cy="10" r="5" fill="#7fc6ff"/>
      <circle cx="22"  cy="10" r="5" fill="#7fc6ff"/>
    </g>`,
};

const ITEM_ANCHOR_TYPE = {
  ribbon: 'neck',
  collar: 'neck',
  hat:    'head',
  crown:  'head',
  cape:   'back',
};

export const ITEM_IDS = Object.keys(ITEMS);

function itemsGroup(anchors, equippedItems) {
  const parts = equippedItems
    .filter((id) => ITEMS[id] && ITEM_ANCHOR_TYPE[id])
    .map((id) => {
      const a = anchors[ITEM_ANCHOR_TYPE[id]];
      return `<g transform="translate(${a.x} ${a.y}) scale(${a.s})">${ITEMS[id]()}</g>`;
    });
  return `<g class="cat__items">${parts.join('')}</g>`;
}

// ハートグループ（喜ぶ時に浮かびあがる）
function heartsGroup() {
  const heart = 'M0 4 C -8 -7 -22 4 0 20 C 22 4 8 -7 0 4 Z';
  const hearts = [
    { x: 64,  y: 68, delay: 0    },
    { x: 100, y: 48, delay: 0.22 },
    { x: 136, y: 68, delay: 0.44 },
  ];
  const paths = hearts.map(
    (p) =>
      `<path class="cat__heart" d="${heart}" fill="#ff7a93" transform="translate(${p.x} ${p.y})" style="animation-delay:${p.delay}s"/>`
  ).join('');
  return `<g class="cat__hearts" aria-hidden="true">${paths}</g>`;
}

// Zzzグループ（寝ている時）
function zzzGroup() {
  return `
  <g class="cat__zzz" aria-hidden="true" fill="#b0a3a3">
    <text x="160" y="72" font-size="20" font-family="'Mochiy Pop One',sans-serif">Z</text>
    <text x="178" y="56" font-size="14" font-family="'Mochiy Pop One',sans-serif">z</text>
  </g>`;
}

// ----- 公開API -----

/**
 * catMarkup({ stage, mood, equippedItems, name })
 * stage : 'kitten' | 'young' | 'adult'
 * mood  : 'idle' | 'happy' | 'sleep'
 */
export function catMarkup({ stage = 'kitten', mood = 'idle', equippedItems = [], name = 'ねこ' } = {}) {
  const cfg = STAGES[stage] || STAGES.kitten;

  // 描画順：奥→手前（尻尾→胴体→頭→アイテム→エフェクト）
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 236"
    class="cat cat--${stage} cat--${mood}" role="img" aria-label="${name}" overflow="visible">
    ${tailGroup(cfg)}
    ${bodyGroup(cfg)}
    ${headGroup(cfg)}
    ${itemsGroup(cfg.anchors, equippedItems)}
    ${heartsGroup()}
    ${zzzGroup()}
  </svg>`;
}

/** レベルから直接描画 */
export function catMarkupForLevel(level, opts = {}) {
  return catMarkup({ stage: catStage(level), ...opts });
}

/** 喜ぶアニメーションを単発再生（Epic 5 から呼ぶ） */
export function playHappy(svgEl) {
  if (!svgEl) return;
  svgEl.classList.remove('cat--happy');
  void svgEl.getBoundingClientRect();
  svgEl.classList.add('cat--happy');
  svgEl.addEventListener('animationend', () => svgEl.classList.remove('cat--happy'), { once: true });
}
