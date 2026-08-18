import { describe, it, expect } from 'vitest';
import { pickHappyVariant, catMarkup, tierFromBond, catImageSrc, itemAnchorPct, itemAnchorScale, isSceneItem, SCENE_IDS, itemLayer, defaultItemLayer } from '../js/cat-image.js';

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
    expect(catImageSrc('tora', 'mid', 'happy')).toBe('img/cat/cat_tora_mid_happy.webp');
    expect(catImageSrc('shiro', 'high', 'sleep')).toBe('img/cat/cat_shiro_high_sleep.webp');
    expect(catImageSrc('russianblue', 'low', 'idle')).toBe('img/cat/cat_russianblue_low_idle.webp');
  });

  it('未知の style / tier / mood は tora / low / idle にフォールバック', () => {
    expect(catImageSrc(undefined, 'mid', 'happy')).toBe('img/cat/cat_tora_mid_happy.webp');
    expect(catImageSrc('bogus', 'bogus', 'happy')).toBe('img/cat/cat_tora_low_happy.webp');
    expect(catImageSrc('tora', 'mid', 'bogus')).toBe('img/cat/cat_tora_mid_idle.webp');
  });

  it('威嚇（hiss・#187）も既知 mood としてパスを組む', () => {
    expect(catImageSrc('tora', 'low', 'hiss')).toBe('img/cat/cat_tora_low_hiss.webp');
    expect(catImageSrc('shiro', 'high', 'hiss')).toBe('img/cat/cat_shiro_high_hiss.webp');
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
  // #210: 追加アイテムが想定アンカーに割り当てられている
  it('追加アイテム（#210）のアンカー', () => {
    expect(itemAnchorPct('beret')).toEqual({ x_pct: 50, y_pct: 23 });       // head
    expect(itemAnchorPct('sunglasses')).toEqual({ x_pct: 50, y_pct: 36 });  // face x100/2, y72/2
    expect(itemAnchorPct('bell')).toEqual({ x_pct: 50, y_pct: 50 });        // neck x100/2, y100/2
    expect(itemAnchorPct('wings')).toEqual({ x_pct: 50, y_pct: 54 });       // back x100/2, y108/2
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
  it('装備アイテムは img/cat/items/{id}.webp を <image> で描画する', () => {
    const html = catMarkup({ equippedItems: ['ribbon'] });
    expect(html).toContain('<image href="img/cat/items/ribbon.webp"');
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
    expect(catMarkup({ bond: 1 })).toContain('img/cat/cat_tora_low_idle.webp');
    expect(catMarkup({ bond: 8, mood: 'sleep' })).toContain('img/cat/cat_tora_high_sleep.webp');
  });
});

// 猫スタイル切り替え（#66）：style で本体画像と data-style が変わる。未知値は tora。
describe('catMarkup の style', () => {
  it('style 指定で本体画像と data-style が切り替わる', () => {
    const html = catMarkup({ style: 'shiro' });
    expect(html).toContain('img/cat/cat_shiro_low_idle.webp');
    expect(html).toContain('data-style="shiro"');
  });

  it('未指定・未知の style は tora にフォールバック（既存ユーザー後方互換）', () => {
    expect(catMarkup()).toContain('data-style="tora"');
    expect(catMarkup({ style: 'bogus' })).toContain('img/cat/cat_tora_low_idle.webp');
  });
});

// 置物・小物系（シーン配置型・#226）：ステージ正方枠に置く新カテゴリ。
describe('置物アイテム（#226）', () => {
  it('isSceneItem / SCENE_IDS', () => {
    expect(SCENE_IDS).toEqual(['cushion', 'yarnBall']);
    expect(isSceneItem('cushion')).toBe(true);
    expect(isSceneItem('crown')).toBe(false);   // 装着系は置物でない
    expect(isSceneItem('bogus')).toBe(false);
  });

  it('itemAnchorPct/Scale は置物の既定（足元寄り・等倍）を返す', () => {
    expect(itemAnchorPct('cushion')).toEqual({ x_pct: 50, y_pct: 64 });  // SCENE_DEFAULT_PCT
    expect(itemAnchorScale('yarnBall')).toBe(1);
  });

  it('placedItems を layer 別の scene SVG に振り分けて描く', () => {
    const html = catMarkup({ placedItems: ['cushion', 'yarnBall'] });
    // back レイヤーに cushion、front レイヤーに yarnBall の image が入る
    const back = html.match(/cat__scene--back[^]*?<\/svg>/)[0];
    const front = html.match(/cat__scene--front[^]*?<\/svg>/)[0];
    expect(back).toContain('img/cat/scene/cushion.webp');
    expect(back).not.toContain('yarnBall');
    expect(front).toContain('img/cat/scene/yarnBall.webp');
    expect(front).not.toContain('cushion');
  });

  it('未配置の置物は描かれない', () => {
    const html = catMarkup({ placedItems: [] });
    expect(html).not.toContain('img/cat/scene/');
  });

  it('置物の座標は itemLayout を共用（既定位置 50,64→100,128 / 指定座標も反映）', () => {
    const def = catMarkup({ placedItems: ['cushion'] });
    expect(def).toContain('translate(100 128)');                                   // 既定: 50%,64% → ×2
    const moved = catMarkup({ placedItems: ['cushion'], itemLayout: { cushion: { x_pct: 30, y_pct: 80 } } });
    expect(moved).toContain('translate(60 160)');                                  // 指定座標 ×2
  });

  it('置物も .cat__item クラスで dressup が掴める', () => {
    const html = catMarkup({ placedItems: ['yarnBall'] });
    expect(html).toContain('class="cat__item" data-item="yarnBall"');
  });
});

// 前後レイヤーの切り替え（#270）：アイテムごとに「まえ／うしろ」を選べる。
const backSvg = (html) => html.match(/cat__scene--back[^]*?<\/svg>/)[0];
const frontSvg = (html) => html.match(/cat__scene--front[^]*?<\/svg>/)[0];
const wornSvg = (html) => html.match(/cat__front[^]*?<\/svg>/)[0];

describe('itemLayer / defaultItemLayer（#270）', () => {
  it('既定は装着＝前面（#211）・置物＝SCENE_BOX の layer', () => {
    expect(defaultItemLayer('cape')).toBe('front');
    expect(defaultItemLayer('crown')).toBe('front');
    expect(defaultItemLayer('cushion')).toBe('back');
    expect(defaultItemLayer('yarnBall')).toBe('front');
  });

  it('itemLayout の layer が既定より優先される', () => {
    expect(itemLayer('cape', { cape: { layer: 'back' } })).toBe('back');
    expect(itemLayer('cushion', { cushion: { layer: 'front' } })).toBe('front');
  });

  it('未設定・未知値は既定に落ちる（既存ユーザー後方互換）', () => {
    expect(itemLayer('crown')).toBe('front');
    expect(itemLayer('crown', {})).toBe('front');
    expect(itemLayer('crown', { crown: { x_pct: 10, y_pct: 20 } })).toBe('front');
    expect(itemLayer('cushion', { cushion: { layer: 'bogus' } })).toBe('back');
  });
});

describe('catMarkup の前後レイヤー（#270）', () => {
  it('layer 未設定なら装着は前面のまま（既存ユーザーの見た目は不変）', () => {
    const html = catMarkup({ equippedItems: ['wings', 'crown'] });
    expect(wornSvg(html)).toContain('items/wings.webp');
    expect(wornSvg(html)).toContain('items/crown.webp');
    expect(backSvg(html)).not.toContain('items/');
  });

  it('うしろにした装着アイテムは背面SVGへ移り、前面からは消える', () => {
    const html = catMarkup({ equippedItems: ['wings', 'crown'], itemLayout: { wings: { layer: 'back' } } });
    expect(backSvg(html)).toContain('items/wings.webp');
    expect(wornSvg(html)).not.toContain('items/wings.webp');
    expect(wornSvg(html)).toContain('items/crown.webp');   // 指定していないものは前面のまま
  });

  it('置物も layer で前後を上書きできる（既定と逆にできる）', () => {
    const html = catMarkup({
      placedItems: ['cushion', 'yarnBall'],
      itemLayout: { cushion: { layer: 'front' }, yarnBall: { layer: 'back' } },
    });
    expect(frontSvg(html)).toContain('scene/cushion.webp');
    expect(backSvg(html)).toContain('scene/yarnBall.webp');
    expect(backSvg(html)).not.toContain('scene/cushion.webp');
    expect(frontSvg(html)).not.toContain('scene/yarnBall.webp');
  });

  it('背面でも「cape が最下層 → アクセサリ」の順で、装備した順序に左右されない', () => {
    const layout = { cape: { layer: 'back' }, crown: { layer: 'back' } };
    const order = (equippedItems) => {
      const back = backSvg(catMarkup({ equippedItems, itemLayout: layout }));
      return [back.indexOf('items/cape.webp'), back.indexOf('items/crown.webp')];
    };
    for (const equipped of [['cape', 'crown'], ['crown', 'cape']]) {
      const [cape, crown] = order(equipped);
      expect(cape).toBeGreaterThan(-1);
      expect(cape).toBeLessThan(crown);   // 先に描く＝下に来る
    }
  });

  it('背面へ送っても座標・スケール・ヒット矩形はそのまま（掴んで動かせる）', () => {
    const html = catMarkup({
      equippedItems: ['crown'],
      itemLayout: { crown: { x_pct: 30, y_pct: 40, scale: 1.5, layer: 'back' } },
    });
    const back = backSvg(html);
    expect(back).toContain('class="cat__item" data-item="crown"');
    expect(back).toContain('translate(60 80) scale(1.5)');
    expect(back).toContain('cat__item-hit');
  });
});

// name は state 由来＝信頼できない入力（認証なしの Firestore doc・取り込んだバックアップ JSON から
// 任意の値が入る）。innerHTML に載る唯一の外部由来テキストなので、属性を割られないことを固定する。
describe('catMarkup の名前エスケープ（#274）', () => {
  it('属性を割る文字列を渡しても aria-label の外へ出ない', () => {
    const html = catMarkup({ name: 'x" onload="alert(1)' });
    expect(html).not.toContain('onload="alert(1)"');
    expect(html).toContain('aria-label="x&quot; onload=&quot;alert(1)"');
  });

  it('タグを閉じて別要素を注入できない', () => {
    const html = catMarkup({ name: '"><img src=x onerror=alert(1)>' });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('通常の名前はそのまま表示される（既存の見た目は不変）', () => {
    expect(catMarkup({ name: 'きーちゃん' })).toContain('aria-label="きーちゃん"');
  });
});
