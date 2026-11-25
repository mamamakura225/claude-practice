import { test, expect, ymd, session, makeState, seed, readLocal, fixRandom, gotoHome, openSettings, importJson, backupOf, record, skipCoinPopup } from './helpers.js';

// 誤操作の取り消し（#398）：買う前の確認・記録の削除・レッスン日・読み込みの前へ戻す。
const STASH = 'piano-pet-backup-before-restore';
const cards = (page) => page.locator('.history-card:visible');
const deleteFirst = async (page) => {
  page.once('dialog', (d) => d.accept());
  await cards(page).first().locator('[data-action="delete-session"]').click();
  await expect(page.locator('#undoToast')).toBeVisible();
};

test.describe('購入の確認（#421）', () => {
  test('のこりコインを見せて確認し、やめるなら買わない。かうなら取り消しは出さない', async ({ page }) => {
    await seed(page, makeState({ pet: { coins: 200 } }));
    await page.goto('/#/shop');
    await page.click('.shop-btn[data-action="buy"][data-id="ribbon"]');
    const ask = page.getByRole('dialog', { name: 'あかい リボン を かう？' });
    await expect(page.locator('#buyCoins')).toHaveText('🪙 200 → のこり 175');
    await expect(ask.getByRole('button', { name: 'やめる' })).toBeFocused();   // 既定は安全なほう
    await ask.getByRole('button', { name: 'やめる' }).click();
    await expect(ask).toBeHidden();
    expect((await readLocal(page)).inventory).toEqual([]);

    await page.click('.shop-btn[data-action="buy"][data-id="ribbon"]');
    await page.click('#buyOkBtn');
    await expect(ask).toBeHidden();
    await expect(page.locator('#shopCoins')).toHaveText('175');
    expect((await readLocal(page)).inventory).toEqual(['ribbon']);
    expect(await page.locator('#undoToast').isVisible()).toBe(false);
  });
});

test.describe('記録の削除（猶予5秒）', () => {
  test('「もとに もどす」で戻り、取り消しの間は保存も墓標も変わらない', async ({ page }) => {
    await seed(page, makeState({ sessions: [session(1)] }));
    await page.goto('/#/history');
    await deleteFirst(page);
    await expect(cards(page)).toHaveCount(0);
    let st = await readLocal(page);
    expect(st.sessions).toHaveLength(1);
    expect(st.deletedDates ?? []).toEqual([]);

    await page.click('#undoToastBtn');
    await expect(cards(page)).toHaveCount(1);
    await page.reload();
    await expect(cards(page)).toHaveCount(1);
    st = await readLocal(page);
    expect(st.deletedDates ?? []).toEqual([]);
  });

  test('取り消さなければ、猶予のあとに確定する', async ({ page }) => {
    await page.clock.install();
    await seed(page, makeState({ sessions: [session(1)] }));
    await page.goto('/#/history');
    await deleteFirst(page);
    await page.clock.fastForward(4000);
    await expect(page.locator('#undoToast')).toBeVisible();
    await page.clock.fastForward(2000);
    await expect(page.locator('#undoToast')).toBeHidden();
    const st = await readLocal(page);
    expect(st.sessions).toHaveLength(0);
    expect(st.deletedDates).toContain(ymd(1));
  });

  test('けしたあと同じ画面で別の保存が走ると、その保存に重ねて確定し、一覧も数字も描き直る（#428）', async ({ page }) => {
    await seed(page, makeState({
      badges: ['first_practice', 'practice_again', 'streak_3'],
      sessions: [session('2026-01-03', 4), session('2026-01-02', 3), session('2026-01-01', 2)],
    }));
    await page.goto('/#/history');
    await expect(cards(page)).toHaveCount(3);
    await deleteFirst(page);   // 2026-01-03
    await page.click('#view-history .child-avatar');
    await page.click('.avatar-grid__btn[data-avatar="rabbit"]');   // アバターの変更（commitState）が確定させる
    await expect(page.locator('#undoToast')).toBeHidden();
    await page.click('#avatarOverlay .settings-btn');
    const st = await readLocal(page);
    expect(st.pet.childAvatar).toBe('rabbit');
    expect(st.sessions.map((s) => s.date)).toEqual(['2026-01-02', '2026-01-01']);
    expect(st.deletedDates).toContain('2026-01-03');
    expect(await page.locator('#historyStreakBest').textContent()).toBe('2');

    await page.locator('.history-card[data-date="2026-01-02"] [data-action="edit-session"]').click();   // 押した日の記録が開く
    await expect(page.locator('#recordDate')).toHaveValue('2026-01-02');
    await expect(page.locator('#recordTotal')).toHaveText('3');
  });

  test('今日の記録を消してすぐ記録画面へ行っても、消した回数がフォームに戻らない', async ({ page }) => {
    await fixRandom(page, 0.999);
    await seed(page, makeState({ badges: ['first_practice'] }));
    await gotoHome(page);
    await record(page, 4);   // 画面から記録して、当日ぶんの下書きも作られた状態にする
    await skipCoinPopup(page);
    await page.click('.nav-btn[data-nav="history"]');
    await deleteFirst(page);
    await page.click('.nav-btn[data-nav="home"]');   // 画面を移ると確定
    await page.click('#goRecordBtn');
    await expect(page.locator('#recordTotal')).toHaveText('0');
    const st = await readLocal(page);
    expect(st.sessions).toHaveLength(0);
    expect(st.deletedDates).toContain(ymd());
  });
});

test.describe('せってい', () => {
  test('レッスン日の × は「もとに もどす」で戻せる', async ({ page }) => {
    await seed(page, makeState({ pet: { lessonDates: [ymd()] } }));
    await gotoHome(page);
    await openSettings(page);
    const del = page.locator('#lessonList .lesson-del');
    await del.click();
    await expect(del).toHaveCount(0);
    await page.click('#undoToastBtn');
    await expect(del).toHaveCount(1);
    expect((await readLocal(page)).pet.lessonDates).toEqual([ymd()]);
  });

  test('ファイルを読み込むと反映され、前のデータは「ひとつ まえの データに もどす」で戻せて行き来できる', async ({ page }) => {
    await seed(page, makeState({ pet: { coins: 55 } }));
    page.on('dialog', (d) => d.accept());
    const coins = page.locator('#statCoins');
    await gotoHome(page);
    await openSettings(page);
    await expect(page.locator('#restorePrevBtn')).toBeHidden();   // まだ退避が無い
    await importJson(page, backupOf(makeState({ pet: { coins: 9 } })));
    await expect(coins).toHaveText('9', { timeout: 10000 });

    await openSettings(page);
    await page.click('#restorePrevBtn');
    await expect(coins).toHaveText('55', { timeout: 10000 });
    const stash = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), STASH);
    expect(stash.pet.coins).toBe(9);   // いまの データと入れ替わりで退避される
  });

  test('別アカウントで退避したデータには戻すボタンを出さない', async ({ page }) => {
    await seed(page, makeState(), {
      [STASH]: JSON.stringify(makeState()),
      [`${STASH}:meta`]: JSON.stringify({ account: 'test', doc: null, at: Date.now() }),
    });
    await gotoHome(page);
    await openSettings(page);
    await expect(page.locator('#restorePrevBtn')).toBeHidden();
  });
});
