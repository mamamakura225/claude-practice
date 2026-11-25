import { test, expect, makeState, seed, readLocal, gotoHome } from './helpers.js';

// ショップ：購入・装備・置物・えさ・なかよし・絞り込み。買う前の確認（#421）は undo.spec.js。
// えさやりクリップ（#294）は再生中ポップアップが全画面でタップを受けるので、クリップを見るテスト
// （openShopWithClips）以外は読めなくして、静止ポップアップ（フォールバック）の経路に固定する。
const FEED_CLIP_URL = '**/video/*_feed_*.mp4';

const item = (page, name) => page.locator('.shop-card', { hasText: name });
const coins = (page) => page.locator('#shopCoins');
const feedBtn = (food) => `.shop-btn[data-action="feed"][data-id="${food}"]`;
const badgeName = (page) => page.locator('#badgePopupName');

async function openShop(page, pet = {}, rest = {}) {
  await page.route(FEED_CLIP_URL, (route) => route.abort());
  const state = makeState({ pet: { coins: 200, ...pet }, badges: ['first_outfit'], ...rest });   // 購入でバッジが出て操作を遮らないように
  await seed(page, state);
  await page.goto('/#/shop');
  await expect(coins(page)).toHaveText(String(state.pet.coins), { timeout: 10000 });
}

async function buy(page, id) {
  await page.click(`.shop-btn[data-action="buy"][data-id="${id}"]`);
  await page.click('#buyOkBtn');
}

test.describe('購入と装備', () => {
  test('購入して装備するとホームの猫にアイテムが乗る', { tag: '@compat' }, async ({ page }) => {
    await openShop(page);
    await buy(page, 'ribbon');   // 25コイン
    await expect(coins(page)).toHaveText('175');
    await page.click('.shop-btn[data-action="toggle"][data-id="ribbon"]');
    await expect(item(page, 'あかい リボン').locator('.shop-card__badge')).toBeVisible();

    await page.click('.nav-btn[data-nav="home"]');
    await expect(page.locator('#catStage .cat__front > g')).toHaveCount(1);
  });

  test('置物を買って「おく」とホームのシーンレイヤーに乗る（#226）', async ({ page }) => {
    await openShop(page);
    await buy(page, 'yarnBall');   // 40コイン・前面
    await expect(coins(page)).toHaveText('160');
    await page.click('.shop-btn[data-action="place"][data-id="yarnBall"]');
    await expect(item(page, 'けいとだま').locator('.shop-card__badge')).toBeVisible();

    await page.click('.nav-btn[data-nav="home"]');
    await expect(page.locator('#catStage .cat__scene--front .cat__item[data-item="yarnBall"]')).toHaveCount(1);
    await expect(page.locator('#catStage .cat__front > g')).toHaveCount(0);   // 装着の層は空
  });

  // #396: 購入直後は同じ商品のボタンが「みにつける」に替わる。しばらく押せなくして連打の2打目で進ませない
  test('「かう」の直後に同じ商品のボタンを押しても、勝手に みにつけられない', async ({ page }) => {
    await openShop(page);
    await page.click('.shop-btn[data-action="buy"][data-id="ribbon"]');
    await expect(page.locator('#buyOkBtn')).toBeVisible();
    await page.evaluate(() => {
      document.getElementById('buyOkBtn').click();
      document.querySelector('#shopList .shop-btn[data-id="ribbon"]').click();
    });
    const st = await readLocal(page);
    expect(st.inventory).toContain('ribbon');
    expect(st.pet.equippedItems).not.toContain('ribbon');
  });

  test('コインが足りないアイテムとえさは「あと ○ コイン」で押せない（#360）', async ({ page }) => {
    await openShop(page, { coins: 3, affinity: 50 });   // 王冠（150・Lv8）は解放済み＝コインだけが足りない
    for (const [name, text] of [['おうかん', 'あと 147 コイン'], ['ミルク', 'あと 4 コイン']]) {
      const btn = item(page, name).locator('.shop-btn');
      await expect(btn).toBeDisabled();
      await expect(btn).toHaveText(text);
    }
  });

  test('なかよしLv未到達のアイテムはロック表示で、買うボタンが無い（#126）', async ({ page }) => {
    await openShop(page);   // なかよしLv1
    const scarf = item(page, 'マフラー');   // Lv4
    await expect(scarf.locator('.shop-btn')).toBeDisabled();
    await expect(scarf.locator('.shop-btn')).toHaveText('なかよしLv4で あえる');
    await expect(scarf.locator('.shop-card__badge--locked')).toHaveCount(0);   // ロックはボタンだけで示す（#399）
    await expect(scarf.locator('.shop-btn[data-action="buy"]')).toHaveCount(0);
    await expect(item(page, 'あかい リボン').locator('.shop-btn[data-action="buy"]')).toBeVisible();
  });

  test('カテゴリで絞り込め、買っても絞り込みが戻らない（#299）', async ({ page }) => {
    await openShop(page);
    const cards = page.locator('#shopList .shop-card');
    const all = await cards.count();
    await page.click('.shop-cat[data-cat="head"]');
    await expect(page.locator('.shop-cat[data-cat="head"]')).toHaveAttribute('aria-pressed', 'true');
    const head = await cards.count();
    expect(head).toBeLessThan(all);
    await expect(item(page, 'むぎわら ぼうし')).toBeVisible();
    await expect(item(page, 'あかい リボン')).toHaveCount(0);

    await buy(page, 'hat');
    await expect(coins(page)).toHaveText('160');
    expect(await cards.count()).toBe(head);
    await page.click('.shop-cat[data-cat="all"]');
    expect(await cards.count()).toBe(all);
  });

  test('320px でも、名前が1文字ずつ縦に並ばず（#359）、ロック中のボタンで横スクロールしない（#396）', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await openShop(page);
    await expect(page.locator('#shopList .shop-btn--locked').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    expect(await page.evaluate(() => getComputedStyle(document.body).wordBreak)).toBe('keep-all');   // 語の途中で改行しない
    const lines = await page.locator('#shopList .shop-card__name').evaluateAll((els) => els.map((el) => {
      const lh = parseFloat(getComputedStyle(el).lineHeight) || parseFloat(getComputedStyle(el).fontSize) * 1.5;
      return Math.round(el.getBoundingClientRect().height / lh);
    }));
    expect(Math.max(...lines)).toBeLessThanOrEqual(2);
  });
});

test.describe('えさと なかよし', () => {
  test('えさをあげるとコインが減り、なかよし度がショップとホームで上がる', async ({ page }) => {
    await openShop(page);
    await page.click(feedBtn('fish'));   // 5コイン・なかよし+1
    await expect(coins(page)).toHaveText('195');
    await expect(page.locator('#feedAffinity')).toHaveText('1');
    await page.click('.nav-btn[data-nav="home"]');
    await expect(page.locator('#statAffinity')).toHaveText('1');
  });

  test('なかよしレベルの名前・エンブレム・ごほうびの解放が表示される（#124）', async ({ page }) => {
    await seed(page, makeState({ pet: { affinity: 7 } }));   // Lv3「だいすき」
    await gotoHome(page);
    await expect(page.locator('#statBondLevel')).toHaveText('3');
    await expect(page.locator('#statBondName')).toHaveText('だいすき');
    await expect(page.locator('#catStage .cat__bond')).toBeVisible();

    await page.click('.nav-btn[data-nav="shop"]');
    await expect(page.locator('#bondRewards .bond-reward')).toHaveCount(8);
    await expect(page.locator('#bondRewards .bond-reward:not(.is-locked)')).toHaveCount(3);
    await expect(page.locator('#feedBondName')).toHaveText('だいすき');
  });

  // 給餌はショップ（#catStage が隠れている）で行うので、ホームへ戻った瞬間に再生する（#347）
  test('なかよしMAX到達で、バッジが付き、ホームに戻ると猫の特別演出が出る（#309）', async ({ page }) => {
    await openShop(page, { affinity: 41 });   // あと1
    await page.click(feedBtn('fish'));
    await expect(page.locator('#feedAffinity')).toHaveText('42');
    await page.click('.nav-btn[data-nav="home"]');
    const cat = page.locator('#catStage .cat');
    await expect(cat).toHaveClass(/cat--celebrate/);
    await expect(cat).not.toHaveClass(/cat--celebrate/, { timeout: 3000 });
    await expect(badgeName(page)).toHaveText('ねこと だいの なかよし');
  });

  // バッジ告知を静止カードの onHidden に結び付けると、張り替えで失われる
  test('なかよしMAXのえさの直後に次のえさを押しても、バッジ告知は出る（#294）', async ({ page }) => {
    await openShop(page, { affinity: 41 });
    await page.click(feedBtn('fish'));
    await expect(page.locator('#feedAffinity')).toHaveText('42');
    await page.click(feedBtn('milk'));
    await expect(badgeName(page)).toHaveText('ねこと だいの なかよし', { timeout: 6000 });
  });

  // #396: ポップアップは全画面でタップを受けるので、ページ内で直接押して重なる状況を作る
  test('購入のバッジ表示は、続けて えさをあげると畳まれて重ならない', async ({ page }) => {
    await openShop(page, {}, { badges: [] });
    await buy(page, 'ribbon');   // はじめての衣装＝300ms 後にバッジ
    await expect(page.locator('#badgePopup')).toBeVisible();
    await page.locator(feedBtn('fish')).dispatchEvent('click');
    await expect(page.locator('#feedPopup')).toBeVisible();
    expect(await page.locator('#badgePopup').isHidden()).toBe(true);   // 2.2秒で自然に消えるので、待たずに見る
  });

  test('購入のバッジに畳まれた えさやりカードの後続（バッジ告知）は失われず、あとで出る', async ({ page }) => {
    await openShop(page, { affinity: 41 }, { badges: [] });   // あと1で なかよしMAX
    await page.click('.shop-btn[data-action="buy"][data-id="ribbon"]');
    await expect(page.locator('#buyOkBtn')).toBeVisible();
    await page.evaluate((sel) => {   // バッジが出る（300ms 後）より先に えさやりカードを出す
      document.getElementById('buyOkBtn').click();
      document.querySelector(sel).click();
    }, feedBtn('fish'));
    await expect(badgeName(page)).toHaveText('おきがえ じょうず');
    await expect(badgeName(page)).toHaveText('ねこと だいの なかよし', { timeout: 8000 });
  });

  // #261: showPopup は要素ごとに前回のタイマー・transitionend を解除する。解除を外すと、1回目の
  // フェードアウト開始〜完了の間（約250ms）に2回目を出したとき、残ったリスナーが2回目を即座に隠す。
  // 窓が狭いので、--show が外れた瞬間をページ内で捕まえて撃ち、消えるまでの時間もページ内で測る。
  test('えさやり連打の2回目も最後まで表示される（#261）', async ({ page }) => {
    await openShop(page);
    const elapsedMs = await page.evaluate((sel) => new Promise((resolve, reject) => {
      const el = document.getElementById('feedPopup');
      const feed = () => document.querySelector(sel).click();   // 給餌のたびに再描画されるので毎回引く
      const timeout = setTimeout(() => reject(new Error('timeout: feedPopup not observed')), 8000);
      new MutationObserver((_, classObserver) => {
        if (el.classList.contains('coin-popup--show')) return;
        classObserver.disconnect();   // 1回目のフェードアウト開始
        setTimeout(() => {            // 同一タスクで撃つとリスナーが付く前で再現しない
          feed();
          const t0 = performance.now();
          new MutationObserver(() => {
            if (el.hidden) { clearTimeout(timeout); resolve(performance.now() - t0); }
          }).observe(el, { attributes: true, attributeFilter: ['hidden'] });
        }, 50);
      }).observe(el, { attributes: true, attributeFilter: ['class'] });
      feed();
    }), feedBtn('fish'));
    expect(elapsedMs).toBeGreaterThan(1200);   // 正常は約2050ms、壊れていると130〜230ms（実測）
  });
});

// 再生の positive 確認は Chromium のみ（WebKit は playing を出さない・clip.spec.js 冒頭）
test.describe('えさやりクリップ（#294）', () => {
  const popup = (page) => page.locator('#feedPopup');
  const IN_CLIP = /coin-popup--clip/;
  const tapToSkip = (page) => popup(page).click({ position: { x: 10, y: 10 } });

  // 先読み（3本）が済むまで待つ。待たずに押すと、遅い環境では静止カードが閉じた後に再生が始まる
  // 分岐（クリップを出さない）に入る。
  async function openShopWithClips(page, pet) {
    const requested = new Set();
    page.on('request', (req) => { if (/_feed_/.test(req.url())) requested.add(new URL(req.url()).pathname.split('/').pop()); });
    await seed(page, makeState({ pet: { coins: 200, ...pet } }));
    await page.goto('/#/shop');
    await expect.poll(() => requested.size, { timeout: 8000 }).toBeGreaterThanOrEqual(3);
    return requested;
  }

  test('えさ別のクリップが静止カードより長く出て、タップで閉じる。成立したバッジは閉じてから告知する', async ({ page }) => {
    await openShopWithClips(page, { affinity: 41 });
    await page.click(feedBtn('treat'));   // +3 で なかよしMAX
    await expect(popup(page)).toHaveClass(IN_CLIP);
    await expect(page.locator('#feedClip video')).toHaveAttribute('src', /cat_tora_feed_cake.mp4$/);
    await expect(page.locator('#feedPopupGain')).toHaveText('+3');

    await page.waitForTimeout(2600);   // 静止カードの尺（1800ms＋フェード）を過ぎても
    await expect(popup(page)).toHaveClass(IN_CLIP);
    expect(await popup(page).isVisible()).toBe(true);
    expect(await page.locator('#badgePopup').isVisible()).toBe(false);

    await tapToSkip(page);
    await expect(popup(page)).toBeHidden();
    await expect(page.locator('#feedClip')).toBeHidden();
    await expect(badgeName(page)).toHaveText('ねこと だいの なかよし', { timeout: 3000 });
  });

  test('先読みはいまの猫スタイルの3本だけで、そのスタイルのクリップを出し、見終わる（ended）と閉じる', async ({ page }) => {
    const requested = await openShopWithClips(page, { catStyle: 'shiro' });
    await page.click(feedBtn('fish'));
    await expect(popup(page)).toHaveClass(IN_CLIP);
    await expect(page.locator('#feedClip video')).toHaveAttribute('src', /cat_shiro_feed_fish.mp4$/);
    expect([...requested].sort()).toEqual(['cat_shiro_feed_cake.mp4', 'cat_shiro_feed_fish.mp4', 'cat_shiro_feed_milk.mp4']);
    // 実尺（8秒）を待つと保険タイマーでも閉じて ended の経路を区別できないので、直接撃つ
    await page.$eval('#feedClip video', (v) => v.dispatchEvent(new Event('ended')));
    await expect(popup(page)).toBeHidden({ timeout: 1500 });
  });

  test('モジュール読込が遅れ、静止カードが閉じてから再生できるようになっても開き直さない', async ({ page }) => {
    let arrive;
    const late = new Promise((r) => { arrive = r; });
    await page.route('**/js/cat-video.js*', async (route) => { await late; await route.continue(); });
    await seed(page, makeState({ pet: { coins: 200 } }));
    await page.goto('/#/shop');
    await popup(page).evaluate((el) => {
      window.__clipSeen = false;
      new MutationObserver(() => { if (el.classList.contains('coin-popup--clip')) window.__clipSeen = true; })
        .observe(el, { attributes: true, attributeFilter: ['class'] });
    });
    await page.click(feedBtn('fish'));
    await expect(popup(page)).toBeVisible();
    await expect(popup(page)).toBeHidden({ timeout: 3000 });   // 静止カードは通常どおり閉じる

    const clipLoaded = page.waitForResponse(/_feed_fish\.mp4/);
    arrive();
    await clipLoaded;                                           // ここから再生が始まりうる
    await expect(page.locator('#feedClip')).toBeHidden();
    await page.waitForTimeout(1000);
    expect(await page.evaluate(() => window.__clipSeen)).toBe(false);
    await expect(popup(page)).toBeHidden();
  });

  test('reduced-motion では先読みも再生もしない', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const requested = [];
    page.on('request', (req) => { if (/_feed_/.test(req.url())) requested.push(req.url()); });
    const moduleLoaded = page.waitForResponse(/\/js\/cat-video\.js/);   // 先読みするならこの直後
    await seed(page, makeState({ pet: { coins: 200 } }));
    await page.goto('/#/shop');
    await moduleLoaded;
    await page.click(feedBtn('fish'));
    await expect(popup(page)).toBeVisible();
    await expect(popup(page)).toBeHidden({ timeout: 4000 });
    await expect(popup(page)).not.toHaveClass(IN_CLIP);
    expect(requested).toEqual([]);
  });

  test('クリップが読めないときは従来の静止ポップアップで閉じる', { tag: '@compat' }, async ({ page }) => {
    await openShop(page);   // クリップは abort 済み
    await page.click(feedBtn('fish'));
    await expect(popup(page)).toBeVisible();
    await expect(popup(page)).not.toHaveClass(IN_CLIP);
    await expect(popup(page)).toBeHidden({ timeout: 4000 });
    await expect(page.locator('#feedClip')).toBeHidden();
  });
});
