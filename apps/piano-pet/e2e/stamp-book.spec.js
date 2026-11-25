import { test, expect, ymd, session, makeState, seed, readLocal, openSettings, closeSettings } from './helpers.js';

// ねこスタンプちょう（#409）：1日10回で1こ。子が肉球で押し、うまったら親が「ごほうびを あげた」で次へ。
const base = ({ sessions = [], stampBook } = {}) => makeState({ sessions, pet: stampBook && { stampBook } });
const card = (over = {}) => ({ id: 1, startDate: ymd(20), size: 5, reward: 'どうぶつえん', emoji: '🎡', ...over });
test.describe('ねこスタンプちょう（#409）', () => {
  test('カードが無いときは案内だけ。親がカードを作るとホームに進捗が出る', async ({ page }) => {
    await seed(page, base({ sessions: [session(0, 10)] }));
    await page.goto('/#/stamp');
    await expect(page.locator('#stampBook')).toContainText('まだ カードが ないよ');
    await page.click('.nav-btn[data-nav="home"]');
    await expect(page.locator('#stampHomeLink')).toBeHidden();

    await openSettings(page);
    await page.click('#stampSaveBtn');   // ごほうびが空なら作らない
    await expect(page.locator('#stampSettings')).toContainText('ごほうびの なかみを いれてね');
    await page.fill('#stampRewardInput', 'アイス');
    await page.click('.stamp-emoji__btn[data-emoji="🍦"]');
    await page.fill('#stampSizeInput', '7');
    await page.click('#stampSaveBtn');
    await expect(page.locator('#stampSettings')).toContainText('カードを つくりました');
    await closeSettings(page);

    // 今日10回ひいている＝今日から1こ（押すまでは 0/7）
    await expect(page.locator('#stampHomeLink')).toHaveText('🐾 スタンプを おしてね！（0/7）');
    await page.click('#stampHomeLink');
    await page.locator('.sb-press').click();
    await expect(page.locator('.sb-cell--done')).toHaveCount(1);
    await page.click('.nav-btn[data-nav="home"]');
    await expect(page.locator('#stampHomeLink')).toHaveText('🐾 スタンプ 1/7 ・ 🍦 アイス');
    const st = await readLocal(page);
    expect(st.pet.stampBook.card).toMatchObject({ reward: 'アイス', emoji: '🍦', size: 7, startDate: ymd(0) });
  });

  test('10回の日だけ押せる。肉球で押すと保存され、リロードしても残る', async ({ page }) => {
    await seed(page, base({ sessions: [session(0, 9), session(1, 10), session(2, 30)], stampBook: { card: card() } }));
    await page.goto('/#/stamp');
    await expect(page.locator('.sb-press')).toHaveCount(2);   // 9回の今日は押せない
    await expect(page.locator('.sb-grid .sb-cell')).toHaveCount(5);

    await page.locator('.sb-press').first().click();
    await expect(page.locator('.sb-cell--done')).toHaveCount(1);
    await expect(page.locator('.sb-paw')).toHaveCount(1);     // ぺたっの肉球
    // 画面いっぱいに「ぽんっ」と押す（マスの中だけで済ませない）。終わればマスへ収まって消える
    expect(await page.locator('.sb-cell--peta').evaluate((e) => e.getBoundingClientRect().width / innerWidth)).toBeGreaterThan(0.6);
    await expect(page.locator('.sb-cell--peta')).toHaveCount(0);
    await expect(page.locator('.sb-cell--done')).toBeVisible();
    // 絵柄の画像が読めている（#410）。肉球は演出後に消えるので、描き直し後のスタンプを見る
    await expect(page.locator('.sb-paw')).toHaveCount(0);
    await expect.poll(() => page.locator('.sb-cell--done img.sb-stamp').evaluate((e) => e.naturalWidth)).toBe(192);
    await expect(page.locator('.sb-press')).toHaveCount(1);
    expect((await readLocal(page)).pet.stampBook.pressed).toEqual([ymd(2)]);   // 古い日から並ぶ

    await page.reload();
    await expect(page.locator('.sb-cell--done')).toHaveCount(1);
    await expect(page.locator('.sb-count')).toHaveText('1 / 5 こ');
    await expect(page.locator('.sb-msg')).toHaveText('スタンプを おしてね！');
  });

  test('最後の1こで ごほうび ゲット。親が「ごほうびを あげた」でおわったカードへ', async ({ page }) => {
    const days = [5, 4, 3, 2, 1];
    await seed(page, base({
      sessions: days.map((b) => session(b, 12)),
      stampBook: { card: card(), pressed: days.slice(0, 4).map(ymd) },
    }));
    await page.goto('/#/stamp');
    await page.locator('.sb-press').click();
    await expect(page.locator('#sbGoal')).toContainText('ごほうび ゲット！');
    // 全画面のお祝い（#419）。ごほうびの中身が出て、「やったね！」で閉じる
    const party = page.getByRole('dialog', { name: 'ごほうび ゲット' });
    await expect(party).toContainText('どうぶつえん');
    await expect(party.getByRole('button', { name: 'やったね！' })).toBeFocused();
    await party.getByRole('button', { name: 'やったね！' }).click();
    await expect(party).toHaveCount(0);

    await page.click('.nav-btn[data-nav="home"]');   // ⚙️ はホームのヘッダにある
    await openSettings(page);
    await page.click('#stampRedeemBtn');
    await expect(page.locator('#stampSettings')).toContainText('つぎの カードを つくってね');
    await expect(page.locator('#stampSaveBtn')).toHaveText('カードを つくる');
    await closeSettings(page);

    const st = await readLocal(page);
    expect(st.pet.stampBook.card).toBeNull();
    expect(st.pet.stampBook.done).toHaveLength(1);
    expect(st.pet.stampBook.done[0].dates).toEqual(days.map(ymd));
    await page.click('.nav-btn[data-nav="stamp"]');
    await expect(page.locator('.sb-done summary')).toHaveText('おわった カード（1）');
  });

  test('320px でも5列のマスと5つめのタブが収まる', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await seed(page, base({ sessions: [session(1, 10)], stampBook: { card: card({ size: 60 }) } }));
    await page.goto('/#/stamp');
    await expect(page.locator('.sb-grid .sb-cell')).toHaveCount(60);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const nav = await page.locator('.nav-btn[data-nav="stamp"]').boundingBox();
    expect(nav.x + nav.width).toBeLessThanOrEqual(320);
  });
});
