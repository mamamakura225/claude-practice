// ===== 猫SVG生成（スコティッシュフォールド／折れ耳・丸顔） =====
// 顔の造形は icons/icon.svg の絵柄を踏襲。
// すべてSVG。ラスター画像は使わない。
import { catStage } from './game.js';

const FUR = '#fbe9da';
const FUR_SHADE = '#f3d9c6';
const FUR_STRIPE = '#e9cdb6';
const BELLY = '#fff6ee';
const EAR_INNER = '#ffb3c1';
const BLUSH = '#ffb3c1';
const EYE = '#4a3b3b';
const NOSE = '#ff7a93';
const WHISKER = '#d8c3b3';

// ----- ステージ別プロポーション（viewBox 0 0 240 240） -----
const STAGES = {
  // 子猫：頭が大きく丸い・小さい体・短足
  kitten: {
    head: { x: 120, y: 98, r: 60 },
    body: { x: 120, y: 178, rx: 52, ry: 42 },
    paws: [
      { x: 102, y: 214, rx: 15, ry: 10 },
      { x: 138, y: 214, rx: 15, ry: 10 },
    ],
    tail: { d: 'M162 188 q48 -2 50 -54', w: 22 },
    anchors: { neck: { x: 120, y: 150, s: 0.78 }, head: { x: 120, y: 50, s: 0.82 }, back: { x: 120, y: 168, s: 0.82 } },
  },
  // 若猫：少し大きくスリム
  young: {
    head: { x: 120, y: 88, r: 54 },
    body: { x: 120, y: 176, rx: 48, ry: 54 },
    paws: [
      { x: 102, y: 222, rx: 15, ry: 11 },
      { x: 138, y: 222, rx: 15, ry: 11 },
    ],
    tail: { d: 'M158 196 q58 -6 56 -70', w: 22 },
    anchors: { neck: { x: 120, y: 142, s: 0.8 }, head: { x: 120, y: 42, s: 0.84 }, back: { x: 120, y: 162, s: 0.9 } },
  },
  // 成猫：どっしり・風格
  adult: {
    head: { x: 120, y: 92, r: 66 },
    body: { x: 120, y: 174, rx: 68, ry: 54 },
    paws: [
      { x: 96, y: 220, rx: 18, ry: 12 },
      { x: 144, y: 220, rx: 18, ry: 12 },
    ],
    tail: { d: 'M178 192 q56 0 52 -62', w: 28 },
    anchors: { neck: { x: 120, y: 150, s: 0.98 }, head: { x: 120, y: 40, s: 1.04 }, back: { x: 120, y: 166, s: 1.12 } },
  },
};

// ----- 顔（icon.svg 由来。基準 rx140 を head.r に合わせて縮尺） -----
function headGroup({ x, y, r }) {
  const s = (r / 140).toFixed(4);
  return `
    <g class="cat__head">
      <g transform="translate(${x} ${y}) scale(${s})">
        <path d="M-118 -78 q-22 36 8 70 q26 -18 30 -54 z" fill="${FUR_SHADE}"/>
        <path d="M118 -78 q22 36 -8 70 q-26 -18 -30 -54 z" fill="${FUR_SHADE}"/>
        <path d="M-104 -64 q-14 24 4 50 q18 -12 20 -38 z" fill="${EAR_INNER}"/>
        <path d="M104 -64 q14 24 -4 50 q-18 -12 -20 -38 z" fill="${EAR_INNER}"/>
        <ellipse cx="0" cy="0" rx="140" ry="128" fill="${FUR}"/>
        <circle cx="-88" cy="42" r="26" fill="${BLUSH}" opacity="0.45"/>
        <circle cx="88" cy="42" r="26" fill="${BLUSH}" opacity="0.45"/>
        <g class="cat__eyes cat__eyes--open">
          <circle cx="-54" cy="-6" r="20" fill="${EYE}"/>
          <circle cx="54" cy="-6" r="20" fill="${EYE}"/>
          <circle cx="-47" cy="-13" r="6" fill="#fff"/>
          <circle cx="61" cy="-13" r="6" fill="#fff"/>
        </g>
        <g class="cat__eyes cat__eyes--closed">
          <path d="M-74 -4 q20 18 40 0" fill="none" stroke="${EYE}" stroke-width="6" stroke-linecap="round"/>
          <path d="M34 -4 q20 18 40 0" fill="none" stroke="${EYE}" stroke-width="6" stroke-linecap="round"/>
        </g>
        <path d="M0 30 l-13 -15 h26 z" fill="${NOSE}"/>
        <path d="M0 30 q-16 22 -34 10 M0 30 q16 22 34 10" fill="none" stroke="${EYE}" stroke-width="5" stroke-linecap="round"/>
        <g stroke="${WHISKER}" stroke-width="4" stroke-linecap="round">
          <path d="M-70 18 l-58 -10 M-70 36 l-56 8"/>
          <path d="M70 18 l58 -10 M70 36 l56 8"/>
        </g>
      </g>
    </g>`;
}

function bodyGroup({ body, paws }) {
  const pawSvg = paws
    .map((p) => `<ellipse cx="${p.x}" cy="${p.y}" rx="${p.rx}" ry="${p.ry}" fill="${FUR}"/>`)
    .join('');
  return `
    <g class="cat__body">
      ${pawSvg}
      <ellipse cx="${body.x}" cy="${body.y}" rx="${body.rx}" ry="${body.ry}" fill="${FUR}"/>
      <ellipse cx="${body.x}" cy="${(body.y + body.ry * 0.2).toFixed(1)}" rx="${(body.rx * 0.6).toFixed(1)}" ry="${(body.ry * 0.66).toFixed(1)}" fill="${BELLY}"/>
    </g>`;
}

function tailGroup({ tail }) {
  return `
    <g class="cat__tail">
      <path d="${tail.d}" fill="none" stroke="${FUR}" stroke-width="${tail.w}" stroke-linecap="round"/>
      <path d="${tail.d}" fill="none" stroke="${FUR_STRIPE}" stroke-width="${tail.w}" stroke-linecap="round" stroke-dasharray="9 26" opacity="0.7"/>
    </g>`;
}

// ----- アイテム（原点中心に描画し、ステージのアンカーで配置） -----
const ITEMS = {
  ribbon: () => `
    <g>
      <path d="M0 0 L-28 -15 L-28 15 Z" fill="#ff5d7a"/>
      <path d="M0 0 L28 -15 L28 15 Z" fill="#ff5d7a"/>
      <path d="M-28 -15 L-22 0 L-28 15 Z" fill="#e23f5e"/>
      <path d="M28 -15 L22 0 L28 15 Z" fill="#e23f5e"/>
      <circle r="9" fill="#e23f5e"/>
    </g>`,
  collar: () => `
    <g>
      <rect x="-34" y="-7" width="68" height="14" rx="7" fill="#7fc6ff"/>
      <path d="M0 6 l8 14 -8 6 -8 -6 z" fill="#ffd34d" stroke="#e0a91f" stroke-width="1.5"/>
    </g>`,
  hat: () => `
    <g>
      <ellipse cx="0" cy="10" rx="50" ry="13" fill="#e8c270"/>
      <path d="M-32 12 q32 -46 64 0 z" fill="#f0d089"/>
      <rect x="-32" y="6" width="64" height="9" rx="4" fill="#d98c5f"/>
    </g>`,
  cape: () => `
    <g>
      <path d="M-46 -8 q46 -22 92 0 l-12 70 q-34 16 -68 0 z" fill="#9b6bff"/>
      <path d="M-46 -8 q46 -22 92 0 l-3 16 q-43 -18 -86 0 z" fill="#6f3fd6"/>
    </g>`,
  crown: () => `
    <g>
      <path d="M-36 18 L-36 -12 L-18 6 L0 -18 L18 6 L36 -12 L36 18 Z" fill="#ffd34d" stroke="#e0a91f" stroke-width="2"/>
      <circle cx="0" cy="2" r="5" fill="#ff5d7a"/>
      <circle cx="-22" cy="10" r="4" fill="#7fc6ff"/>
      <circle cx="22" cy="10" r="4" fill="#7fc6ff"/>
    </g>`,
};

const ITEM_ANCHOR = { ribbon: 'neck', collar: 'neck', hat: 'head', crown: 'head', cape: 'back' };

export const ITEM_IDS = Object.keys(ITEMS);

function itemsGroup(stageCfg, equippedItems) {
  const parts = equippedItems
    .filter((id) => ITEMS[id])
    .map((id) => {
      const a = stageCfg.anchors[ITEM_ANCHOR[id]];
      return `<g transform="translate(${a.x} ${a.y}) scale(${a.s})">${ITEMS[id]()}</g>`;
    });
  return `<g class="cat__items">${parts.join('')}</g>`;
}

function heartsGroup() {
  const heart = 'M0 4 C -8 -7 -22 4 0 20 C 22 4 8 -7 0 4 Z';
  const positions = [
    { x: 70, y: 70, d: 0 },
    { x: 120, y: 50, d: 0.25 },
    { x: 170, y: 72, d: 0.5 },
  ];
  const hs = positions
    .map(
      (p) =>
        `<path class="cat__heart" d="${heart}" fill="#ff7a93" transform="translate(${p.x} ${p.y})" style="animation-delay:${p.d}s"/>`
    )
    .join('');
  return `<g class="cat__hearts" aria-hidden="true">${hs}</g>`;
}

function zzzGroup() {
  return `
    <g class="cat__zzz" aria-hidden="true" fill="#b0a3a3" font-family="'Mochiy Pop One', sans-serif">
      <text x="172" y="74" font-size="22">Z</text>
      <text x="192" y="56" font-size="16">z</text>
    </g>`;
}

// ----- 公開API -----
// catMarkup({ stage:'kitten'|'young'|'adult', mood:'idle'|'happy'|'sleep', equippedItems, name })
export function catMarkup({ stage = 'kitten', mood = 'idle', equippedItems = [], name = 'ねこ' } = {}) {
  const cfg = STAGES[stage] || STAGES.kitten;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" class="cat cat--${stage} cat--${mood}" role="img" aria-label="${name}" overflow="visible">
    ${tailGroup(cfg)}
    ${bodyGroup(cfg)}
    ${headGroup(cfg.head)}
    ${itemsGroup(cfg, equippedItems)}
    ${heartsGroup()}
    ${zzzGroup()}
  </svg>`;
}

// レベルから直接描く便利関数
export function catMarkupForLevel(level, opts = {}) {
  return catMarkup({ stage: catStage(level), ...opts });
}

// 喜ぶアニメーションを単発再生（Epic 5 から呼ぶ）
export function playHappy(svgEl) {
  if (!svgEl) return;
  svgEl.classList.remove('cat--happy');
  void svgEl.getBoundingClientRect(); // リフローしてアニメ再スタート
  svgEl.classList.add('cat--happy');
  svgEl.addEventListener(
    'animationend',
    () => svgEl.classList.remove('cat--happy'),
    { once: true }
  );
}
