import { describe, it, expect } from 'vitest';
import { pickHappyVariant, catMarkup, tierFromBond, catImageSrc, itemAnchorPct, itemAnchorScale } from '../js/cat-image.js';

// 日常のお祝い演出のバリエーション選択（#81）。
// 描画・アニメ自体は CSS / DOM 依存なので、ここでは純粋な選択ロジックだけ検証する。
describe('pickHappyVariant', () => {
  const VARIANTS = ['', 'hop', 'spin'];

  it('返り値は必ず既知のバリエーションのいずれか', () => {
    for (let i = 0; i < 100; i++) {
      expect(VARIANTS).toContain(pickHappyVariant());
    }
  });

  it('rng の値に応じて決定的にバリエーションを選ぶ', () => {
    expect(pickHappyVariant(() => 0)).toBe('');     // floor(0 * 3) = 0
    expect(pickHappyVariant(() => 0.5)).toBe('hop'); // floor(1.5) = 1
    expect(pickHappyVariant(() => 0.99)).toBe('spin'); // floor(2.97) = 2
  });
});

// なつき度3段階(tier)：既存5なかよしレベル(#124)を集約する（新閾値を作らない）。
describe('tierFromBond', () => {
  it('なかよしレベル 1-2 は low、3-7 は mid、8 は high（#216 8段階）', () => {
    expect(tierFromBond(1)).toBe('low');
    expect(tierFromBond(2)).toBe('low');
    expect(tierFromBond(3)).toBe('mid');
    expect(tierFromBond(7)).toBe('mid');
    expect(tierFromBond(8)).toBe('high');
  });

  it('不正値は low にフォールバック', () => {
    expect(tierFromBond(0)).toBe('low');
    expect(tierFromBond(undefined)).toBe('low');
  });
});

// 画像セレクタ：style×tier×mood からファイルパスを決定的に組む（#66）。
describe('catImageSrc', () => {
  it('style・tier・mood からパスを組む', () => {
    expect(catImageSrc('tora', 'mid', 'happy')).toBe('img/cat/cat_tora_mid_happy.png');
    expect(catImageSrc('shiro', 'high', 'sleep')).toBe('img/cat/cat_shiro_high_sleep.png');
    expect(catImageSrc('russianblue', 'low', 'idle')).toBe('img/cat/cat_russianblue_low_idle.png');
  });

  it('未知の style / tier / mood は tora / low / idle にフォールバック', () => {
    expect(catImageSrc(undefined, 'mid', 'happy')).toBe('img/cat/cat_tora_mid_happy.png');
    expect(catImageSrc('bogus', 'bogus', 'happy')).toBe('img/cat/cat_tora_low_happy.png');
    expect(catImageSrc('tora', 'mid', 'bogus')).toBe('img/cat/cat_tora_mid_idle.png');
  });

  it('威嚇（hiss・#187）も既知 mood としてパスを組む', () => {
    expect(catImageSrc('tora', 'low', 'hiss')).toBe('img/cat/cat_tora_low_hiss.png');
    expect(catImageSrc('shiro', 'high', 'hiss')).toBe('img/cat/cat_shiro_high_hiss.png');
  });
});

// 衣装の自由配置（#168）：スナップ吸着点と layout による座標反映。
describe('itemAnchorPct（#168 スナップ吸着点）', () => {
  it('アイテムの既定アンカーを % で返す（viewBox 200系の座標/2）', () => {
    expect(itemAnchorPct('crown')).toEqual({ x_pct: 50, y_pct: 23 });  // head x100/2, y46/2
    expect(itemAnchorPct('cape')).toEqual({ x_pct: 50, y_pct: 54 });   // back x100/2, y108/2
  });
  it('未知アイテムは null', () => {
    expect(itemAnchorPct('bogus')).toBeNull();
  });
});

describe('catMarkup の itemLayout（#168 自由配置）', () => {
  it('layout があればその座標（%→viewBox200系）で配置する', () => {
    const html = catMarkup({ equippedItems: ['crown'], itemLayout: { crown: { x_pct: 30, y_pct: 40 } } });
    expect(html).toContain('data-item="crown"');
    expect(html).toContain('translate(60 80)');   // 30*2, 40*2
  });
  it('layout が無ければ既定アンカーで配置する（フォールバック）', () => {
    const html = catMarkup({ equippedItems: ['crown'] });
    expect(html).toContain('translate(100 46)');   // head アンカー
  });

  // #196: 衣装は水彩透過PNGを <image> で重ねる（手書きSVG path から移行）
  it('装備アイテムは img/cat/items/{id}.png を <image> で描画する', () => {
    const html = catMarkup({ equippedItems: ['ribbon'] });
    expect(html).toContain('<image href="img/cat/items/ribbon.png"');
  });
});

// #205 ピンチ拡縮：scale は絶対値。layout の scale を transform/data-scale 両方へ反映する。
describe('catMarkup の scale（#205 ピンチ拡縮）', () => {
  it('scale 未指定なら基準スケール a.s（crown=head=0.9）で描画する', () => {
    const html = catMarkup({ equippedItems: ['crown'] });
    expect(html).toContain('data-scale="0.9"');
    expect(html).toContain('scale(0.9)');
  });
  it('layout の scale を絶対値で transform と data-scale に適用する', () => {
    const html = catMarkup({ equippedItems: ['crown'], itemLayout: { crown: { x_pct: 30, y_pct: 40, scale: 1.5 } } });
    expect(html).toContain('data-scale="1.5"');
    expect(html).toContain('translate(60 80) scale(1.5)');
  });
  it('座標を持たず scale のみの layout は既定アンカー位置＋指定 scale で描画する（スナップ時サイズ保持）', () => {
    const html = catMarkup({ equippedItems: ['crown'], itemLayout: { crown: { scale: 2 } } });
    expect(html).toContain('translate(100 46) scale(2)');   // head アンカー位置のまま、サイズだけ保持
  });
});

// #215 ピンチで縮小しても掴めるよう、各アイテムに逆スケールの透明ヒット矩形を内包する。
describe('catMarkup の最小タッチ領域（#215 ヒット矩形）', () => {
  const hitWidth = (html) => Number(html.match(/cat__item-hit"[^>]*\bwidth="([\d.]+)"/)[1]);

  it('全アイテムに透明ヒット矩形(cat__item-hit)を内包する', () => {
    const html = catMarkup({ equippedItems: ['crown'] });
    expect(html).toContain('class="cat__item-hit"');
    expect(html).toContain('pointer-events="all"');
  });
  it('小さく縮小すると逆スケールでヒット矩形を拡大する（crown box.w=72 < 44/0.3≈146.7）', () => {
    const html = catMarkup({ equippedItems: ['crown'], itemLayout: { crown: { x_pct: 50, y_pct: 50, scale: 0.3 } } });
    expect(hitWidth(html)).toBeGreaterThan(140);   // max(72, 146.7) = 146.7
  });
  it('基準スケール付近ではヒット矩形は box サイズのまま（44/0.9≈48.9 < 72）', () => {
    const html = catMarkup({ equippedItems: ['crown'] });   // crown=head a.s=0.9
    expect(hitWidth(html)).toBe(72);
  });
});

describe('itemAnchorScale（#205 基準スケール）', () => {
  it('アイテムの基準スケール a.s を返す（crown=head=0.9 / cape=back=0.92）', () => {
    expect(itemAnchorScale('crown')).toBe(0.9);
    expect(itemAnchorScale('cape')).toBe(0.92);
  });
  it('未知アイテムは null', () => {
    expect(itemAnchorScale('bogus')).toBeNull();
  });
});

// なかよしエンブレム（#124）：bond レベルで猫の隅のハートしるしを出し分ける。
describe('catMarkup の なかよしエンブレム', () => {
  it('bond 未指定（0〜1）ではエンブレムを出さない', () => {
    expect(catMarkup()).not.toContain('cat__bond');
    expect(catMarkup({ bond: 1 })).not.toContain('cat__bond');
  });

  it('bond 2以上でハートのエンブレムが付く', () => {
    expect(catMarkup({ bond: 2 })).toContain('cat__bond');
  });

  it('bond 5以上できらきらが加わる（#216 8段階で再マップ）', () => {
    expect(catMarkup({ bond: 4 })).not.toContain('cat__bond-sparkle');
    expect(catMarkup({ bond: 5 })).toContain('cat__bond-sparkle');
  });

  it('bond レベルから tier を導出して本体画像を選ぶ', () => {
    expect(catMarkup({ bond: 1 })).toContain('img/cat/cat_tora_low_idle.png');
    expect(catMarkup({ bond: 8, mood: 'sleep' })).toContain('img/cat/cat_tora_high_sleep.png');
  });
});

// 猫スタイル切り替え（#66）：style で本体画像と data-style が変わる。未知値は tora。
describe('catMarkup の style', () => {
  it('style 指定で本体画像と data-style が切り替わる', () => {
    const html = catMarkup({ style: 'shiro' });
    expect(html).toContain('img/cat/cat_shiro_low_idle.png');
    expect(html).toContain('data-style="shiro"');
  });

  it('未指定・未知の style は tora にフォールバック（既存ユーザー後方互換）', () => {
    expect(catMarkup()).toContain('data-style="tora"');
    expect(catMarkup({ style: 'bogus' })).toContain('img/cat/cat_tora_low_idle.png');
  });
});
