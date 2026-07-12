// ===== 猫プリレンダ画像表示（#167） =====
// 猫本体を「なつき度3段階(tier) × 表情4種(mood) = 12枚」の透過PNGで差し替え表示する。
// 演出（ハート・きらきら・Zzz・なかよしエンブレム）と衣装は猫本体に依存しない
// オーバーレイSVG（viewBox 0 0 200 236）として画像の上に重ねる（#168きせかえの土台）。
// 衣装は全種を本体の前面（cat__front）に重ねる（#211：cape を含め背面描画は廃止）。
import { affinityLevel } from './feed.js';

// ----- 画像セレクタ -----
// スタイル＝猫種（#66）。未知値は 'tora'（茶トラ）にフォールバック＝既存ユーザー後方互換。
export const CAT_STYLES = ['tora', 'shiro', 'russianblue'];
export const IMG_TIERS = ['low', 'mid', 'high'];
// hiss はなで反応の威嚇（シャー）専用。恒常表示には使わず演出中の一時差し替えのみ（#187）。
export const IMG_MOODS = ['idle', 'happy', 'sleep', 'love', 'hiss'];

export function normalizeStyle(style) {
  return CAT_STYLES.includes(style) ? style : 'tora';
}

// 8段階「なかよしレベル」(#124・#216) を画像の3 tier に集約する。
// 新しい閾値は作らず affinityLevel().level からの導出に一本化（旧 high=Lv5/mid=Lv3 と
// 等価な affinity 値の新レベルへ再マップ：high は最上位 Lv8、mid は Lv3 以上）。
export function tierFromBond(bondLevel) {
  const lv = Number(bondLevel) || 1;
  if (lv >= 8) return 'high';   // えいえんのきずな
  if (lv >= 3) return 'mid';    // だいすき 〜 さいこうのなかま
  return 'low';                 // ともだち / なかよし
}

export function catImageSrc(style, tier, mood) {
  const s = normalizeStyle(style);
  const t = IMG_TIERS.includes(tier) ? tier : 'low';
  const m = IMG_MOODS.includes(mood) ? mood : 'idle';
  return `img/cat/cat_${s}_${t}_${m}.webp`;
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

// スタイル別アンカー補正（#66）。立ち耳のロシアンブルー等で頭頂位置がずれる場合に
// { russianblue: { head: { y: -6 } } } の形で加算する。値は納品画像の実測で決める
// （ズレが小さければ空のまま。手動ドラッグ（#168）でも調整可能なので過剰に作らない）。
export const STYLE_ANCHOR_OFFSETS = {};

function anchorFor(style, type) {
  const a = ANCHORS[type];
  const o = STYLE_ANCHOR_OFFSETS[normalizeStyle(style)]?.[type];
  return o ? { x: a.x + (o.x ?? 0), y: a.y + (o.y ?? 0), s: a.s } : a;
}

// アイテムの既定アンカー位置（%・.catコンテナ basis）。#168 のスナップ吸着点に使う。
// viewBox は 0 0 200 200 なので %換算は座標/2。
export function itemAnchorPct(id, style = 'tora') {
  if (isSceneItem(id)) return { ...SCENE_DEFAULT_PCT };  // 置物は装着アンカー非依存（#226）
  const type = ITEM_ANCHOR_TYPE[id];
  if (!type) return null;
  const a = anchorFor(style, type);
  return { x_pct: a.x / 2, y_pct: a.y / 2 };
}

// アイテムの基準スケール（アンカー種別の既定 a.s）。#205 ピンチ拡縮で「元のサイズ」吸着と
// スナップ時の atBase 判定に使う。未知 id は null。
export function itemAnchorScale(id, style = 'tora') {
  if (isSceneItem(id)) return 1;  // 置物の基準スケールは等倍（#226）
  const type = ITEM_ANCHOR_TYPE[id];
  if (!type) return null;
  return anchorFor(style, type).s;
}

function n(v, d = 1) {
  return parseFloat(v.toFixed(d));
}

// ----- 衣装アイテム（水彩透過PNG・原点(0,0)＝アンカー基準で <image> を重ねる・#196） -----
// 本体（プリレンダ水彩PNG）と画風を統一するため、手書きインラインSVGから水彩ラスターへ移行。
// 各 box は旧SVGの描画範囲（描画座標系・原点はアンカー）に対応し、画像はこの box の縦横比で
// `img/cat/items/{id}.webp`（透過・box×3＝#229・mood/tier 非依存で1 id 1枚）として作成する。
// 画像フォーマットは #234 で PNG→WebP に移行（対応率実質100%・フォールバック無し）。
// box を据え置くことで dressup の <g transform>・アンカー・スナップ（#168）は無改修。
const ITEM_BOX = {
  ribbon:      { x: -28, y: -16, w: 56,  h: 32 },
  collar:      { x: -40, y: -20, w: 80,  h: 47 },
  hat:         { x: -50, y: -50, w: 100, h: 65 },
  cape:        { x: -50, y: -24, w: 100, h: 112 },
  crown:       { x: -36, y: -18, w: 72,  h: 40 },
  bowtie:      { x: -26, y: -30, w: 52,  h: 64 },   // ループリボン（縦長・🎀蝶結びと形で差別化）#191
  scarf:       { x: -42, y: -24, w: 84,  h: 72 },
  glasses:     { x: -42, y: -15, w: 84,  h: 30 },   // レンズ透明＋猫の目を残す #191
  flower:      { x: -22, y: -22, w: 44,  h: 44 },
  flowerCrown: { x: -48, y: -24, w: 96,  h: 48 },   // 環状（半円アーチ）の花冠に縦幅拡張 #213
  beret:       { x: -44, y: -46, w: 88,  h: 54 },   // 斜めがけのベレー帽（麦わら帽より小ぶり）#210
  sunglasses:  { x: -44, y: -16, w: 88,  h: 34 },   // 色付きレンズのサングラス（めがねと差別化）#210
  bell:        { x: -38, y: -18, w: 76,  h: 46 },   // 鈴つきの首輪（星の首輪と差別化）#210
  wings:       { x: -60, y: -34, w: 120, h: 92 },   // 左右に広がる天使のはね（マントより横長）#210
};

function itemImage(id) {
  const b = ITEM_BOX[id];
  return `<image href="img/cat/items/${id}.webp" x="${b.x}" y="${b.y}" `+
    `width="${b.w}" height="${b.h}" preserveAspectRatio="xMidYMid meet" aria-hidden="true"/>`;
}

// ----- 最小タッチ領域（#215） -----
// アイテムは <g scale> で拡縮するため、ピンチで小さくすると <image> のヒット領域もそのまま縮み掴みにくい。
// 各アイテムに透明ヒット矩形を「逆スケール」で内包し、<g> の scale 適用後の画面サイズが常に
// MIN_HIT_UNITS 以上になるようにする（width = max(box, MIN_HIT_UNITS/scale)）。見た目（画像）は不変。
// viewBox 0 0 200 系・.cat は最大320pxなので ~44単位 ≒ 約66px の指サイズを確保する。
const MIN_HIT_UNITS = 44;

function hitRectMarkup(b, scale) {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const w = Math.max(b.w, MIN_HIT_UNITS / scale);
  const h = Math.max(b.h, MIN_HIT_UNITS / scale);
  return `<rect class="cat__item-hit" x="${n(cx - w / 2)}" y="${n(cy - h / 2)}" `+
    `width="${n(w)}" height="${n(h)}" fill="none" pointer-events="all" aria-hidden="true"/>`;
}

function itemHitRect(id, scale) {
  return hitRectMarkup(ITEM_BOX[id], scale);
}

const ITEMS = Object.fromEntries(
  Object.keys(ITEM_BOX).map((id) => [id, () => itemImage(id)])
);

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
  beret: 'head',
  sunglasses: 'face',
  bell: 'neck',
  wings: 'back',
};

export const ITEM_IDS = Object.keys(ITEMS);

// ----- 置物・小物系アイテム（シーン配置型・#226） -----
// 装着系（猫アンカー基準）と異なり、ステージ(.cat正方枠)の自由座標に置く新カテゴリ。
// 排他なし複数配置で、装備とは別配列 pet.placedItems で管理する（slot排他ロジックを汚さない）。
// box は中心原点（配置点へ translate して中央に描く）。layer で猫本体の前後どちらに描くかを振り分ける
// （back=cat__body より背面 / front=演出より手前）。viewBox は装着系と同じ 0 0 200 200・.cat 正方枠基準で、
// dressup のドラッグ／ピンチ（#168/#205）をそのまま流用する。画像は img/cat/scene/{id}.webp（透過・box×3＝#229・WebP＝#234）。
const SCENE_BOX = {
  cushion:  { x: -40, y: -25, w: 80, h: 50, layer: 'back'  },  // 背後に置く座布団（くつろぎ構図）
  yarnBall: { x: -30, y: -30, w: 60, h: 60, layer: 'front' },  // 足元に転がす毛糸玉（前面 z5 の実証）
};

// 置物の既定配置（%・.cat 正方枠基準）。装着アンカーが無いため、dressup の掴み開始位置と
// 描画の初期位置をこの一点に揃えて初回ドラッグ時のジャンプを防ぐ。猫の足元寄り。
const SCENE_DEFAULT_PCT = { x_pct: 50, y_pct: 64 };

export const SCENE_IDS = Object.keys(SCENE_BOX);

export function isSceneItem(id) {
  return Object.hasOwn(SCENE_BOX, id);
}

function sceneImage(id) {
  const b = SCENE_BOX[id];
  return `<image href="img/cat/scene/${id}.webp" x="${b.x}" y="${b.y}" `+
    `width="${b.w}" height="${b.h}" preserveAspectRatio="xMidYMid meet" aria-hidden="true"/>`;
}

// 指定 layer の置物だけを <g transform> で描く。layout に座標があればその%、無ければ既定位置。
// 各 <g> は装着系と同じ .cat__item クラスなので dressup.js が無改修で掴める。
function sceneSvg(placedItems, layer, layout = {}) {
  return (placedItems ?? [])
    .filter((id) => SCENE_BOX[id] && SCENE_BOX[id].layer === layer)
    .map((id) => {
      const pos = layout[id];
      const hasPos = pos && pos.x_pct != null;
      const x = (hasPos ? pos.x_pct : SCENE_DEFAULT_PCT.x_pct) * 2;
      const y = (hasPos ? pos.y_pct : SCENE_DEFAULT_PCT.y_pct) * 2;
      const sc = pos?.scale ?? 1;
      return `<g class="cat__item" data-item="${id}" data-scale="${n(sc, 3)}" `+
        `transform="translate(${n(x)} ${n(y)}) scale(${n(sc, 3)})">${hitRectMarkup(SCENE_BOX[id], sc)}${sceneImage(id)}</g>`;
    }).join('');
}

// 衣装を anchor 種別でフィルタして配置する（#211 以降は cape も含め全種を前面に重ねる）。
// layout に座標があればその %（→viewBox 200系）で、無ければ既定アンカーで配置する（#168）。
// scale は絶対値（#205）：layout に scale があればその値、無ければアンカー基準 a.s。
// スナップ時は座標を持たず scale のみ残す形があるため、位置の有無は x_pct で判定する。
// 各 <g> は data-item / data-scale を持ち、きせかえドラッグ／ピンチ（dressup.js）が掴んで動かす。
function itemsSvg(equippedItems, anchorTypes, layout = {}, style = 'tora') {
  const parts = (equippedItems ?? [])
    .filter((id) => ITEMS[id] && anchorTypes.includes(ITEM_ANCHOR_TYPE[id]))
    .map((id) => {
      const a = anchorFor(style, ITEM_ANCHOR_TYPE[id]);
      const pos = layout[id];
      const hasPos = pos && pos.x_pct != null;
      const x = hasPos ? pos.x_pct * 2 : a.x;
      const y = hasPos ? pos.y_pct * 2 : a.y;
      const sc = pos?.scale ?? a.s;
      return `<g class="cat__item" data-item="${id}" data-scale="${n(sc, 3)}" `+
        `transform="translate(${n(x)} ${n(y)}) scale(${n(sc, 3)})">${itemHitRect(id, sc)}${ITEMS[id]()}</g>`;
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

// なかよしエンブレム（#124・#216）：Lv2 で常時ハート、Lv5 以上できらきらが加わる
// （旧 Lv4 のきらきらは、8段階での「ハートがキラキラ」報酬 Lv5 に等価マップ）。
function bondEmblemGroup(level) {
  const lv = Number(level) || 0;
  if (lv < 2) return '';
  const heart = 'M0 4 C -8 -7 -22 4 0 20 C 22 4 8 -7 0 4 Z';
  const sparkles = lv >= 5
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
 * catMarkup({ mood, equippedItems, name, bond, style })
 * mood : 'idle' | 'happy' | 'sleep' | 'love'（恒常表示は idle/sleep、happy/love は演出時の一時差替）
 * bond : なかよしレベル(1-8)。tier の導出とエンブレム表示に使う。
 * style: 猫スタイル（#66）。未知値・未指定は 'tora'。
 * stage 引数は後方互換のため受け取るが無視する（成長段階は廃止）。
 */
export function catMarkup({ mood = 'idle', equippedItems = [], placedItems = [], name = 'ねこ', bond = 0, itemLayout = {}, style = 'tora' } = {}) {
  const s = normalizeStyle(style);
  const tier = tierFromBond(bond);
  const m = IMG_MOODS.includes(mood) ? mood : 'idle';
  // cape(back アンカー)も本体の前面に描画する（#211）。背面だと不透明な本体PNGに隠れて見えず掴めないため。
  // 前面内では cape を最初に描き、neck/head/face のアクセサリがその上に重なる順序にする。
  const capeLayer = itemsSvg(equippedItems, ['back'], itemLayout, s);
  const front = itemsSvg(equippedItems, ['neck', 'head', 'face'], itemLayout, s);
  const fx = `${heartsGroup()}${sparklesGroup()}${zzzGroup()}${bondEmblemGroup(bond)}`;
  // 置物（#226）：背面(z1)は本体PNGの背後、前面(z5)は演出の手前に重ねる。座標は装着系と同じ itemLayout を共用。
  const sceneBack = sceneSvg(placedItems, 'back', itemLayout);
  const sceneFront = sceneSvg(placedItems, 'front', itemLayout);
  // 演出クラスは .cat コンテナに付く。本体アニメは .cat__body、fx は内部要素に効く。
  return `<div class="cat cat--${m}" role="img" aria-label="${name}" data-mood="${m}" data-tier="${tier}" data-style="${s}">
    <svg class="cat__scene cat__scene--back" viewBox="0 0 200 200" aria-hidden="true" overflow="visible">${sceneBack}</svg>
    <img class="cat__body" src="${catImageSrc(s, tier, m)}" alt="" draggable="false" decoding="async">
    <svg class="cat__front" viewBox="0 0 200 200" aria-hidden="true" overflow="visible">${capeLayer}${front}</svg>
    <svg class="cat__fx" viewBox="0 0 200 200" aria-hidden="true" overflow="visible">${fx}</svg>
    <svg class="cat__scene cat__scene--front" viewBox="0 0 200 200" aria-hidden="true" overflow="visible">${sceneFront}</svg>
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

// 指定スタイル×tier の全mood分をまとめて先読みする（選択中スタイルのみ・#66）。
export function preloadTier(style, tier) {
  for (const m of IMG_MOODS) preloadSrc(catImageSrc(style, tier, m));
}

const idle = (cb) =>
  (typeof requestIdleCallback === 'function')
    ? requestIdleCallback(cb)
    : setTimeout(cb, 200);

// affinity 値が次 tier 境界の手前（2pt以内）に来たら、次 tier の4枚を
// バックグラウンドで先読みして mood/tier 切替時のガタつきを防ぐ。
// 境界: low→mid は なかよしLv3 (affinity 7)、mid→high は Lv8 (affinity 42)（#216）。
export function prefetchNextTier(style, affinityValue) {
  const v = Number(affinityValue) || 0;
  if (v >= 5 && v < 7) idle(() => preloadTier(style, 'mid'));
  else if (v >= 40 && v < 42) idle(() => preloadTier(style, 'high'));
}

// ----- 演出（単発再生） -----
// 演出中だけ本体画像を happy/love に一時差し替え、終了時に元の mood へ戻す。
const REACTION_CLASSES = [
  'cat--happy', 'cat--wiggle', 'cat--celebrate',
  'cat--happy-hop', 'cat--happy-spin', 'cat--hiss',
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
    body.src = catImageSrc(catEl.dataset.style, tier, reactionMood);
  }

  clearTimeout(catEl._catAnimTimer);
  catEl._catAnimTimer = setTimeout(() => {
    catEl.classList.remove(...classes);
    if (body && reactionMood) {
      const tier = catEl.dataset.tier || 'low';
      body.src = catImageSrc(catEl.dataset.style, tier, catEl.dataset.mood || 'idle');
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

/** 威嚇（シャー）の反応。喜び演出は出さず、威嚇表情への一時差し替えのみ（#187） */
export function playHiss(catEl) {
  playClasses(catEl, ['cat--hiss'], 1200, 'hiss');
}

/** 猫をなでた時の反応アニメーションを単発再生（#79 タッチ interaction） */
export function playReaction(catEl, rng = Math.random) {
  const mood = PET_MOODS[Math.floor(rng() * PET_MOODS.length)];
  if (mood === 'happy') playClasses(catEl, ['cat--happy'], 1200, 'love');
  else playClasses(catEl, ['cat--wiggle'], 1200, 'love');
}
