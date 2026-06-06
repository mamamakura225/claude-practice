// ===== 猫プリレンダ画像表示（#167） =====
// 猫本体を「なつき度3段階(tier) × 表情4種(mood) = 12枚」の透過PNGで差し替え表示する。
// 演出（ハート・きらきら・Zzz・なかよしエンブレム）と衣装は猫本体に依存しない
// オーバーレイSVG（viewBox 0 0 200 236）として画像の上に重ねる（#168きせかえの土台）。
import { affinityLevel } from './feed.js';

// ----- 画像セレクタ -----
export const IMG_TIERS = ['low', 'mid', 'high'];
export const IMG_MOODS = ['idle', 'happy', 'sleep', 'love'];

// 既存5段階「なかよしレベル」(#124) を画像の3 tier に集約する。
// 新しい閾値は作らず affinityLevel().level からの導出に一本化（#124温存）。
export function tierFromBond(bondLevel) {
  const lv = Number(bondLevel) || 1;
  if (lv >= 5) return 'high';   // きずな
  if (lv >= 3) return 'mid';    // だいすき / ベストフレンド
  return 'low';                 // ともだち / なかよし
}

export function catImageSrc(tier, mood) {
  const t = IMG_TIERS.includes(tier) ? tier : 'low';
  const m = IMG_MOODS.includes(mood) ? mood : 'idle';
  return `img/cat/cat_${t}_${m}.png`;
}

// ----- 衣装アイテムのアンカー（viewBox 0 0 200 200・正方画像基準・固定1セット） -----
// stage(成長段階)は廃止。プリレンダ画像は正方キャンバスに猫が中央やや下で描かれるため、
// 画像内の頭・首・背・顔の実位置に合わせた座標を1セット持つ（#168 のドラッグ配置で微調整可能）。
export const ANCHORS = {
  head: { x: 100, y: 46,  s: 0.90 },  // 頭頂（王冠・帽子・花）
  face: { x: 100, y: 72,  s: 0.85 },  // 顔中央（めがね）
  neck: { x: 100, y: 100, s: 0.80 },  // 首元（リボン・首輪・マフラー）
  back: { x: 100, y: 108, s: 0.92 },  // 背中（マント）
};

// アイテムの既定アンカー位置（%・.catコンテナ basis）。#168 のスナップ吸着点に使う。
// viewBox は 0 0 200 200 なので %換算は座標/2。
export function itemAnchorPct(id) {
  const a = ANCHORS[ITEM_ANCHOR_TYPE[id]];
  return a ? { x_pct: a.x / 2, y_pct: a.y / 2 } : null;
}

function n(v, d = 1) {
  return parseFloat(v.toFixed(d));
}

// ----- 衣装アイテムSVG（原点(0,0)基準・アンカーに translate+scale で配置） -----
// 5枚花弁の小さな花（flower / flowerCrown で共用）
function flowerSvg(cx, cy, scale, petalColor) {
  const r = n(7 * scale);
  const o = 9 * scale;
  return `<g transform="translate(${n(cx)} ${n(cy)})" fill="${petalColor}">
    <circle cx="0" cy="${n(-o)}" r="${r}"/>
    <circle cx="${n(o)}" cy="${n(-o * 0.3)}" r="${r}"/>
    <circle cx="${n(o * 0.6)}" cy="${n(o * 0.8)}" r="${r}"/>
    <circle cx="${n(-o * 0.6)}" cy="${n(o * 0.8)}" r="${r}"/>
    <circle cx="${n(-o)}" cy="${n(-o * 0.3)}" r="${r}"/>
    <circle cx="0" cy="0" r="${n(r * 0.7)}" fill="#ffd34d"/>
  </g>`;
}

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

  bowtie: () => `
    <g>
      <path d="M-4 0 L-30 -15 L-30 15 Z" fill="#6f8cff"/>
      <path d="M4 0 L30 -15 L30 15 Z"   fill="#6f8cff"/>
      <path d="M-30 -15 Q-12 0 -30 15 Z" fill="#4a63d8"/>
      <path d="M30 -15 Q12 0 30 15 Z"   fill="#4a63d8"/>
      <rect x="-7" y="-10" width="14" height="20" rx="4" fill="#4a63d8"/>
    </g>`,

  scarf: () => `
    <g>
      <path d="M-42 -9 Q0 -24 42 -9 L40 7 Q0 16 -40 7 Z" fill="#ff8a8a"/>
      <path d="M-40 7 Q0 16 40 7" fill="none" stroke="#e85d5d" stroke-width="3"/>
      <path d="M4 4 L20 4 L16 40 L8 40 Z" fill="#ff8a8a" stroke="#e85d5d" stroke-width="1.5"/>
      <g stroke="#e85d5d" stroke-width="2" stroke-linecap="round">
        <line x1="9"  y1="40" x2="9"  y2="48"/>
        <line x1="13" y1="40" x2="13" y2="48"/>
        <line x1="17" y1="40" x2="17" y2="48"/>
      </g>
    </g>`,

  glasses: () => `
    <g fill="none" stroke="#5a4632" stroke-width="3" stroke-linecap="round">
      <circle cx="-20" cy="0" r="13"/>
      <circle cx="20"  cy="0" r="13"/>
      <path d="M-7 -1 Q0 -5 7 -1"/>
      <path d="M-33 -3 L-42 -7"/>
      <path d="M33 -3 L42 -7"/>
    </g>`,

  flower: () => flowerSvg(0, 0, 1.3, '#ff9ec4'),

  flowerCrown: () => {
    const cols = ['#ff9ec4', '#c9a0ff', '#fff0a6', '#c9a0ff', '#ff9ec4'];
    const xs = [-38, -19, 0, 19, 38];
    const ys = [10, 2, -2, 2, 10];
    const band = `<path d="M-46 8 Q0 -8 46 8" fill="none" stroke="#8fd19a" stroke-width="5" stroke-linecap="round"/>`;
    const flowers = xs.map((x, i) => flowerSvg(x, ys[i], 0.62, cols[i])).join('');
    return `<g>${band}${flowers}</g>`;
  },
};

const ITEM_ANCHOR_TYPE = {
  ribbon: 'neck',
  collar: 'neck',
  hat:    'head',
  crown:  'head',
  cape:   'back',
  bowtie: 'neck',
  scarf:  'neck',
  glasses: 'face',
  flower: 'head',
  flowerCrown: 'head',
};

export const ITEM_IDS = Object.keys(ITEMS);

// 衣装を anchor 種別でフィルタして配置する（cape は背面、それ以外は前面）。
// layout に座標があればその %（→viewBox 200系）で、無ければ既定アンカーで配置する（#168）。
// 各 <g> は data-item / data-scale を持ち、きせかえドラッグ（dressup.js）が掴んで動かす。
function itemsSvg(equippedItems, anchorTypes, layout = {}) {
  const parts = (equippedItems ?? [])
    .filter((id) => ITEMS[id] && anchorTypes.includes(ITEM_ANCHOR_TYPE[id]))
    .map((id) => {
      const a = ANCHORS[ITEM_ANCHOR_TYPE[id]];
      const pos = layout[id];
      const x = pos ? pos.x_pct * 2 : a.x;
      const y = pos ? pos.y_pct * 2 : a.y;
      return `<g class="cat__item" data-item="${id}" data-scale="${a.s}" `+
        `transform="translate(${n(x)} ${n(y)}) scale(${a.s})">${ITEMS[id]()}</g>`;
    });
  return parts.join('');
}

// ----- 演出オーバーレイ（猫本体に非依存・viewBox 0 0 200 236） -----
// ハート（喜ぶ時に浮かびあがる）。配置は外側 <g>・アニメは内側 <path> に分離。
function heartsGroup() {
  const heart = 'M0 4 C -8 -7 -22 4 0 20 C 22 4 8 -7 0 4 Z';
  const hearts = [
    { x: 70,  y: 70, delay: 0    },
    { x: 100, y: 52, delay: 0.18 },
    { x: 130, y: 70, delay: 0.36 },
  ];
  const groups = hearts.map(
    (p) =>
      `<g class="cat__heart-pos" transform="translate(${p.x} ${p.y})">`+
      `<path class="cat__heart" d="${heart}" fill="#ff7a93" style="animation-delay:${p.delay}s"/>`+
      `</g>`
  ).join('');
  return `<g class="cat__hearts" aria-hidden="true">${groups}</g>`;
}

// きらきら（節目のお祝い playCelebrate 時だけ弾ける）
function sparklesGroup() {
  const star = (s) =>
    `M0 ${-s} L${n(s * 0.26)} ${n(-s * 0.26)} L${s} 0 L${n(s * 0.26)} ${n(s * 0.26)} `+
    `L0 ${s} L${n(-s * 0.26)} ${n(s * 0.26)} L${-s} 0 L${n(-s * 0.26)} ${n(-s * 0.26)} Z`;
  const sparkles = [
    { x: 48,  y: 60,  s: 10, delay: 0    },
    { x: 152, y: 56,  s: 12, delay: 0.12 },
    { x: 30,  y: 130, s: 8,  delay: 0.28 },
    { x: 170, y: 128, s: 9,  delay: 0.2  },
    { x: 100, y: 28,  s: 11, delay: 0.36 },
  ];
  const groups = sparkles.map(
    (p) =>
      `<g class="cat__sparkle-pos" transform="translate(${p.x} ${p.y})">`+
      `<path class="cat__sparkle" d="${star(p.s)}" fill="#ffd34d" style="animation-delay:${p.delay}s"/>`+
      `</g>`
  ).join('');
  return `<g class="cat__sparkles" aria-hidden="true">${groups}</g>`;
}

// なかよしエンブレム（#124）：Lv2 で常時ハート、Lv4 以上できらきらが加わる。
function bondEmblemGroup(level) {
  const lv = Number(level) || 0;
  if (lv < 2) return '';
  const heart = 'M0 4 C -8 -7 -22 4 0 20 C 22 4 8 -7 0 4 Z';
  const sparkles = lv >= 4
    ? `<g class="cat__bond-sparkle" fill="#ffd34d">
         <circle cx="-15" cy="-9" r="2.4"/>
         <circle cx="15" cy="-11" r="2"/>
         <circle cx="13" cy="13" r="2.2"/>
       </g>`
    : '';
  return `<g class="cat__bond" aria-hidden="true" transform="translate(32 34)">
    ${sparkles}
    <circle r="16" fill="#fff" stroke="#ffd0d9" stroke-width="2"/>
    <g transform="translate(0 -4) scale(0.5)"><path d="${heart}" fill="#ff7a93"/></g>
  </g>`;
}

// Zzz（寝ている時）
function zzzGroup() {
  return `
  <g class="cat__zzz" aria-hidden="true" fill="#b0a3a3">
    <text x="160" y="72" font-size="20" font-family="'Mochiy Pop One',sans-serif">Z</text>
    <text x="178" y="56" font-size="14" font-family="'Mochiy Pop One',sans-serif">z</text>
  </g>`;
}

// ----- 公開API：猫の描画 -----

/**
 * catMarkup({ mood, equippedItems, name, bond })
 * mood : 'idle' | 'happy' | 'sleep' | 'love'（恒常表示は idle/sleep、happy/love は演出時の一時差替）
 * bond : なかよしレベル(1-5)。tier の導出とエンブレム表示に使う。
 * stage 引数は後方互換のため受け取るが無視する（成長段階は廃止）。
 */
export function catMarkup({ mood = 'idle', equippedItems = [], name = 'ねこ', bond = 0, itemLayout = {} } = {}) {
  const tier = tierFromBond(bond);
  const m = IMG_MOODS.includes(mood) ? mood : 'idle';
  const back = itemsSvg(equippedItems, ['back'], itemLayout);
  const front = itemsSvg(equippedItems, ['neck', 'head', 'face'], itemLayout);
  const fx = `${heartsGroup()}${sparklesGroup()}${zzzGroup()}${bondEmblemGroup(bond)}`;
  // 演出クラスは .cat コンテナに付く。本体アニメは .cat__body、fx は内部要素に効く。
  return `<div class="cat cat--${m}" role="img" aria-label="${name}" data-mood="${m}" data-tier="${tier}">
    <svg class="cat__back" viewBox="0 0 200 200" aria-hidden="true" overflow="visible">${back}</svg>
    <img class="cat__body" src="${catImageSrc(tier, m)}" alt="" draggable="false" decoding="async">
    <svg class="cat__front" viewBox="0 0 200 200" aria-hidden="true" overflow="visible">${front}</svg>
    <svg class="cat__fx" viewBox="0 0 200 200" aria-hidden="true" overflow="visible">${fx}</svg>
  </div>`;
}

// ----- 画像プリロード（合意：現tierの4mood先行＋閾値2pt手前で次tierをprefetch） -----
const preloaded = new Set();

function preloadSrc(src) {
  if (preloaded.has(src)) return;
  preloaded.add(src);
  const img = new Image();
  img.decoding = 'async';
  img.src = src;
}

// 指定 tier の4mood分をまとめて先読みする。
export function preloadTier(tier) {
  for (const m of IMG_MOODS) preloadSrc(catImageSrc(tier, m));
}

const idle = (cb) =>
  (typeof requestIdleCallback === 'function')
    ? requestIdleCallback(cb)
    : setTimeout(cb, 200);

// affinity 値が次 tier 境界の手前（2pt以内）に来たら、次 tier の4枚を
// バックグラウンドで先読みして mood/tier 切替時のガタつきを防ぐ。
// 境界: low→mid は なかよしLv3 (affinity 15)、mid→high は Lv5 (affinity 50)。
export function prefetchNextTier(affinityValue) {
  const v = Number(affinityValue) || 0;
  if (v >= 13 && v < 15) idle(() => preloadTier('mid'));
  else if (v >= 48 && v < 50) idle(() => preloadTier('high'));
}

// ----- 演出（単発再生） -----
// 演出中だけ本体画像を happy/love に一時差し替え、終了時に元の mood へ戻す。
const REACTION_CLASSES = [
  'cat--happy', 'cat--wiggle', 'cat--celebrate',
  'cat--happy-hop', 'cat--happy-spin',
];

function bodyEl(catEl) {
  return catEl?.querySelector?.('.cat__body') ?? null;
}

// 演出クラスを単発再生。連打でも毎回頭から再生されるよう一旦リセットしてリフローを挟む。
// reactionMood 指定時は本体画像をその表情に差し替え、duration 後に data-mood の恒常表情へ戻す。
function playClasses(catEl, classes, duration, reactionMood) {
  if (!catEl) return;
  catEl.classList.remove(...REACTION_CLASSES);
  void catEl.getBoundingClientRect();
  catEl.classList.add(...classes);

  const body = bodyEl(catEl);
  if (body && reactionMood) {
    const tier = catEl.dataset.tier || 'low';
    body.src = catImageSrc(tier, reactionMood);
  }

  clearTimeout(catEl._catAnimTimer);
  catEl._catAnimTimer = setTimeout(() => {
    catEl.classList.remove(...classes);
    if (body && reactionMood) {
      const tier = catEl.dataset.tier || 'low';
      body.src = catImageSrc(tier, catEl.dataset.mood || 'idle');
    }
  }, duration);
}

// 日常のお祝い演出のバリエーション。'' はぴょん、'hop' は2段跳ね、'spin' はくるっと揺れ（#81）。
const HAPPY_VARIANTS = ['', 'hop', 'spin'];

/** 日常のお祝い演出のバリエーションを1つ選ぶ（rng 注入でテスト可能） */
export function pickHappyVariant(rng = Math.random) {
  return HAPPY_VARIANTS[Math.floor(rng() * HAPPY_VARIANTS.length)];
}

/** 喜ぶアニメーションを単発再生（通常の練習記録・なで反応から呼ぶ）。表情は happy。 */
export function playHappy(catEl, rng = Math.random) {
  const variant = pickHappyVariant(rng);
  const classes = variant ? ['cat--happy', `cat--happy-${variant}`] : ['cat--happy'];
  playClasses(catEl, classes, 1200, 'happy');
}

/** 節目（レベルアップ／新バッジ／連続日数の節目）の特別演出。大ジャンプ＋ハート＋きらきら（#81） */
export function playCelebrate(catEl) {
  playClasses(catEl, ['cat--celebrate'], 1700, 'happy');
}

// なでた時の反応。喜ぶ（だいすき表情）/ しっぽふりをランダムに出す。
const PET_MOODS = ['happy', 'wiggle'];

/** 猫をなでた時の反応アニメーションを単発再生（#79 タッチ interaction） */
export function playReaction(catEl, rng = Math.random) {
  const mood = PET_MOODS[Math.floor(rng() * PET_MOODS.length)];
  if (mood === 'happy') playClasses(catEl, ['cat--happy'], 1200, 'love');
  else playClasses(catEl, ['cat--wiggle'], 1200, 'love');
}
