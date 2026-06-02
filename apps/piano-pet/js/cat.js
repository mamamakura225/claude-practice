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
  // 子猫（lv 1-5）：頭でっかち・もちもちで丸くコンパクト
  kitten: {
    head: { cx: 100, cy: 96, r: 50 },
    ears: { lx: 72, rx: 128, ty: 60, erx: 20, ery: 16, rot: 16 },
    body: { cx: 100, cy: 172, rx: 58, ry: 46 },
    belly: { cx: 100, cy: 178, rx: 38, ry: 28 },
    tail:  { d: 'M148 190 Q170 188 170 168 Q170 155 158 158', w: 16 },
    anchors: { neck: {x:100,y:150,s:0.74}, head: {x:100,y:50,s:0.76}, back: {x:100,y:156,s:0.78}, face: {x:100,y:95,s:0.83} },
  },
  // 若猫（lv 6-15）：バランスの良い体型
  young: {
    head: { cx: 100, cy: 90, r: 55 },
    ears: { lx: 70, rx: 130, ty: 52, erx: 22, ery: 18, rot: 15 },
    body: { cx: 100, cy: 168, rx: 64, ry: 52 },
    belly: { cx: 100, cy: 176, rx: 42, ry: 34 },
    tail:  { d: 'M153 188 Q177 186 177 164 Q177 149 164 153', w: 18 },
    anchors: { neck: {x:100,y:144,s:0.86}, head: {x:100,y:38,s:0.90}, back: {x:100,y:152,s:0.92}, face: {x:100,y:89,s:0.91} },
  },
  // 成猫（lv 16+）：どっしりした風格
  adult: {
    head: { cx: 100, cy: 86, r: 60 },
    ears: { lx: 68, rx: 132, ty: 48, erx: 24, ery: 19, rot: 14 },
    body: { cx: 100, cy: 166, rx: 70, ry: 56 },
    belly: { cx: 100, cy: 174, rx: 46, ry: 38 },
    tail:  { d: 'M158 188 Q184 185 184 161 Q184 146 170 149', w: 20 },
    anchors: { neck: {x:100,y:150,s:1.00}, head: {x:100,y:32,s:1.04}, back: {x:100,y:150,s:1.08}, face: {x:100,y:85,s:1.00} },
  },
};

// ----- パーツ描画ヘルパー -----

function n(v, d = 1) {
  return parseFloat(v.toFixed(d));
}

// 目（開）: ツヤのある黒目＋白ハイライト2点（大きい光＋小さなキラッでうるうる感）
function eyeOpen(cx, cy, rx, ry) {
  return `<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(rx)}" ry="${n(ry)}" fill="${PUPIL}"/>
          <circle cx="${n(cx - rx * 0.319)}" cy="${n(cy - ry * 0.294)}" r="${n(rx * 0.34)}" fill="${EYE_HIGH}"/>
          <circle cx="${n(cx + rx * 0.319)}" cy="${n(cy + ry * 0.229)}" r="${n(rx * 0.149)}" fill="${EYE_HIGH}"/>`;
}

// 目（閉）: アーチ型の線
function eyeClosed(cx, cy, rx, ry) {
  const x1 = n(cx - rx * 0.95);
  const x2 = n(cx + rx * 0.95);
  const yc = n(cy);
  const yb = n(cy + ry * 0.86);
  return `<path d="M${x1} ${yc} Q${n(cx)} ${yb} ${x2} ${yc}" fill="${PUPIL}" stroke="${PUPIL}" stroke-width="1.5"/>`;
}

// ひげ（頬から外へ長く伸びる3本ずつ）。内端は頬（鼻寄りでなく）、外端は顔の輪郭の外まで。
function whiskersMarkup(cx, cy, r) {
  const wy  = n(cy + r * 0.11);  // ひげの中心の高さ
  const ix  = r * 0.50;          // 内端Xオフセット（頬）
  const ox  = r * 1.12;          // 外端Xオフセット（上下のひげ）
  const ox2 = r * 1.16;          // 外端Xオフセット（中央のひげ）
  const dyI = r * 0.068;         // 内端の上下ひらき
  const dyO = r * 0.138;         // 外端の上下ひらき
  return `<g stroke="${WHISKER}" stroke-width="1.5" stroke-linecap="round" opacity="0.85">
    <line x1="${n(cx - ix)}" y1="${n(wy - dyI)}" x2="${n(cx - ox)}"  y2="${n(wy - dyO)}"/>
    <line x1="${n(cx - ix)}" y1="${wy}"          x2="${n(cx - ox2)}" y2="${wy}"/>
    <line x1="${n(cx - ix)}" y1="${n(wy + dyI)}" x2="${n(cx - ox)}"  y2="${n(wy + dyO)}"/>
    <line x1="${n(cx + ix)}" y1="${n(wy - dyI)}" x2="${n(cx + ox)}"  y2="${n(wy - dyO)}"/>
    <line x1="${n(cx + ix)}" y1="${wy}"          x2="${n(cx + ox2)}" y2="${wy}"/>
    <line x1="${n(cx + ix)}" y1="${n(wy + dyI)}" x2="${n(cx + ox)}"  y2="${n(wy + dyO)}"/>
  </g>`;
}

// 頭部グループ（折れ耳・丸顔・表情レイヤー）
function headGroup(cfg) {
  const { head: h, ears: e } = cfg;
  const eyeRx  = h.r * 0.188;        // 黒目の横半径
  const eyeRy  = h.r * 0.218;        // 黒目の縦半径
  const eyeY   = h.cy - h.r * 0.02;
  const eyeLX  = h.cx - h.r * 0.312; // 左右の目の中心X（やや中央寄り）
  const eyeRX  = h.cx + h.r * 0.312;
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
      ${eyeOpen(eyeLX, eyeY, eyeRx, eyeRy)}
      ${eyeOpen(eyeRX, eyeY, eyeRx, eyeRy)}
    </g>
    <!-- 目：閉（睡眠時） -->
    <g class="cat__eyes cat__eyes--closed">
      ${eyeClosed(eyeLX, eyeY, eyeRx, eyeRy)}
      ${eyeClosed(eyeRX, eyeY, eyeRx, eyeRy)}
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

// 5枚花弁の小さな花（中心(cx,cy)基準）。flower / flowerCrown で共用。
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
// 位置決めは外側の <g transform> で行い、浮き上がるアニメは内側の <path> に当てる。
// （path に直接 transform 属性を置くと、アニメの CSS transform に上書きされて
//   位置がずれてしまうため、配置とアニメを別要素に分離する）
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

// きらきらグループ（節目のお祝い playCelebrate 時だけ弾ける）
// ハート同様、配置は外側 <g transform>・アニメは内側 <path> に分離する。
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

// なかよしエンブレム（#124）：なかよしレベルのご褒美。Lv2 で猫の隅にハートの
// しるしが常時付き、Lv4 以上できらきらが加わる。affinity から導出した bond レベルで出し分ける。
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
export function catMarkup({ stage = 'kitten', mood = 'idle', equippedItems = [], name = 'ねこ', bond = 0 } = {}) {
  const cfg = STAGES[stage] || STAGES.kitten;

  // 描画順：奥→手前（尻尾→胴体→頭→アイテム→エフェクト）
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 236"
    class="cat cat--${stage} cat--${mood}" role="img" aria-label="${name}" overflow="visible">
    ${tailGroup(cfg)}
    ${bodyGroup(cfg)}
    ${headGroup(cfg)}
    ${itemsGroup(cfg.anchors, equippedItems)}
    ${bondEmblemGroup(bond)}
    ${heartsGroup()}
    ${sparklesGroup()}
    ${zzzGroup()}
  </svg>`;
}

/** レベルから直接描画 */
export function catMarkupForLevel(level, opts = {}) {
  return catMarkup({ stage: catStage(level), ...opts });
}

// 単発再生する演出クラス一覧（再生開始時にすべて剥がしてリセットする対象）
const REACTION_CLASSES = [
  'cat--happy', 'cat--wiggle', 'cat--celebrate',
  'cat--happy-hop', 'cat--happy-spin',
];

// 演出クラスを単発で再生。既存の演出を一旦消してリフローを挟み、連打でも毎回頭から
// 再生されるようにする。複数アニメ（体・ハート・きらきら）の最長に合わせて duration 後に
// クラスを剥がす（animationend だと最短アニメ終了で他が途中で切れるため）。
function playClasses(svgEl, classes, duration) {
  if (!svgEl) return;
  svgEl.classList.remove(...REACTION_CLASSES);
  void svgEl.getBoundingClientRect();
  svgEl.classList.add(...classes);
  clearTimeout(svgEl._catAnimTimer);
  svgEl._catAnimTimer = setTimeout(() => svgEl.classList.remove(...classes), duration);
}

// 日常のお祝い（通常の練習記録）。少数パターンをランダムで回し飽きを防ぐ。
// メリハリ設計：日常は軽く、節目（playCelebrate）に特別感を取っておく（#81）。
// '' は素の cat--happy（ぴょん）、'hop' は2段跳ね、'spin' はくるっと揺れ。
const HAPPY_VARIANTS = ['', 'hop', 'spin'];

/** 日常のお祝い演出のバリエーションを1つ選ぶ（rng 注入でテスト可能） */
export function pickHappyVariant(rng = Math.random) {
  return HAPPY_VARIANTS[Math.floor(rng() * HAPPY_VARIANTS.length)];
}

/** 喜ぶアニメーションを単発再生（通常の練習記録・なで反応から呼ぶ） */
export function playHappy(svgEl, rng = Math.random) {
  const variant = pickHappyVariant(rng);
  const classes = variant ? ['cat--happy', `cat--happy-${variant}`] : ['cat--happy'];
  playClasses(svgEl, classes, 1200);
}

/** 節目（レベルアップ／新バッジ／連続日数の節目）の特別演出。大ジャンプ＋ハート＋きらきら（#81） */
export function playCelebrate(svgEl) {
  playClasses(svgEl, ['cat--celebrate'], 1700);
}

// なでた時の反応。毎回同じだと飽きるので喜ぶ/しっぽふりをランダムに出す。
const PET_MOODS = ['happy', 'wiggle'];

/** 猫をなでた時の反応アニメーションを単発再生（#79 タッチ interaction） */
export function playReaction(svgEl, rng = Math.random) {
  const mood = PET_MOODS[Math.floor(rng() * PET_MOODS.length)];
  if (mood === 'happy') playHappy(svgEl, rng);
  else playClasses(svgEl, ['cat--wiggle'], 1200);
}
