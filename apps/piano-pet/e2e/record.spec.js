import { test, expect, session, makeState, seed, fixRandom, gotoHome, addSong, record, skipCoinPopup } from './helpers.js';

// 練習記録 → ホーム・きろくへの反映。日付欄のふるまいは record-date.spec.js。
test.describe('練習記録', () => {
  test.beforeEach(({ page }) => fixRandom(page, 0.999));   // きょうのおまけ（#148）でコインが揺れないように

  test('記録するとホームのコインとストリークが増え、曲別コレクションに出る', { tag: '@compat' }, async ({ page }) => {
    await gotoHome(page);
    await expect(page.locator('#statCoins')).toHaveText('0');
    await record(page, 5);
    await expect(page.locator('#statCoins')).toHaveText('5');   // 1かい=1コイン、10未満なのでボーナス無し
    await expect(page.locator('#statStreak')).toHaveText('1');
    await expect(page.locator('#coinPopupAmount')).toHaveText('+5');
    await skipCoinPopup(page);

    await page.click('.nav-btn[data-nav="history"]');
    const item = page.locator('#songCollection .song-collection__item');
    await expect(item).toHaveCount(1);
    await expect(item.locator('.song-collection__name')).toHaveText('きらきらぼし');
    await expect(item.locator('.song-collection__count')).toHaveText('5かい');
  });

  test('まとめモードで曲×回数を入力して記録できる', async ({ page }) => {
    await gotoHome(page);
    await page.click('#goRecordBtn');
    await page.click('#modeBatchBtn');
    await expect(page.locator('#stampMode')).toBeHidden();

    const row = (i) => page.locator('.batch-row').nth(i);
    await row(0).locator('.batch-row__name').fill('きらきらぼし');
    await row(0).locator('.batch-row__count').fill('7');
    await page.click('#addBatchRowBtn');
    await row(1).locator('.batch-row__name').fill('ちょうちょ');
    await row(1).locator('.batch-row__count').fill('3');
    await expect(page.locator('#batchTotal')).toHaveText('10');
    await page.click('#recordSubmitBtn');

    await expect(page.locator('#view-home')).toBeVisible();
    await expect(page.locator('#statCoins')).toHaveText('15');   // 10かい + 目標達成ボーナス5
    await expect(page.locator('#statStreak')).toHaveText('1');
  });

  test('当日のスタンプはホームへ戻っても記録しても引き継がれ、同じ曲は1行に合算される（#164/#186）', async ({ page }) => {
    await seed(page, makeState({ badges: ['first_practice', 'practice_again'] }));
    await gotoHome(page);
    const total = page.locator('#recordTotal');
    await page.click('#goRecordBtn');
    await addSong(page, 'きらきらぼし');
    for (let i = 0; i < 2; i += 1) await page.click('#stampCard');

    // 記録せずホームへ戻っても 0 からやり直しにならない
    await page.click('.nav-btn[data-nav="home"]');
    await page.click('#goRecordBtn');
    await expect(total).toHaveText('2');
    await expect(page.locator('#stampCard .stamp-cell.is-filled')).toHaveCount(2);
    await page.click('#recordSubmitBtn');
    await skipCoinPopup(page);

    // 記録したあとも当日ぶんの続きから押せる
    await page.click('#goRecordBtn');
    await expect(total).toHaveText('2');
    await page.click('#stampCard');
    await expect(total).toHaveText('3');
    await page.click('#recordSubmitBtn');
    await skipCoinPopup(page);

    await page.click('.nav-btn[data-nav="history"]');
    const card = page.locator('.history-card');
    await expect(card).toHaveCount(1);
    await expect(card.locator('.history-card__total')).toContainText('3');
    await expect(card.locator('.history-songs li')).toHaveCount(1);
    await expect(card.locator('.history-songs li')).toContainText('3かい');
  });

  // 曲名は唯一の自由入力で、クラウド doc・取り込んだ JSON からも任意の値が入る（#325）
  test('曲名に HTML を入れられても、きろく・チップ・候補・まとめ入力で要素や属性にならない', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const evil = '"><img src=x onerror="window.__pwned=1">';
    // 最近ひいた順（#252）なので、累計の少ない evil がチップの先頭に来る
    await seed(page, makeState({ sessions: [session('2026-07-15', 2, evil), session('2026-01-05', 20, 'ふるいきょく')] }));
    await page.goto('/#/history');
    await expect(page.locator('#historyList .song-title').first()).toHaveText(evil, { timeout: 10000 });
    await expect(page.locator('#songCollection .song-collection__name').nth(1)).toHaveText(evil);

    await page.goto('/#/record');
    const chip = page.locator('#songChips .song-chip').first();
    await expect(chip).toHaveAttribute('data-song', evil);
    await expect(chip).toContainText(evil);
    await page.click('#stampCard');   // まとめ行は押したスタンプから作られる
    await page.click('#modeBatchBtn');
    await expect(page.locator('.batch-row__name').first()).toHaveValue(evil);
    const options = await page.locator('datalist option').evaluateAll((els) => els.map((el) => el.value));
    expect(options).toContain(evil);

    expect(await page.locator('img[src="x"]').count()).toBe(0);
    expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
    expect(errors).toEqual([]);
  });

  test('日本語変換を確定する Enter では曲を追加しない（#428）', async ({ page }) => {
    await page.goto('/#/record');
    await page.fill('#newSongInput', 'きらき');
    const press = (init) => page.locator('#newSongInput').evaluate((el, i) => {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...i }));
    }, init);
    await press({ isComposing: true });
    await expect(page.locator('.song-chip')).toHaveCount(0);
    await press({});
    await expect(page.locator('.song-chip')).toHaveText(['きらき']);
  });

  test('まとめモードの回数は99で止まり、99を超える記録は行を分けて減らさない（#428）', async ({ page }) => {
    await page.goto('/#/record');
    await page.click('#modeBatchBtn');
    const counts = page.locator('.batch-row__count');
    await page.locator('.batch-row__name').fill('きらきらぼし');
    await counts.fill('99999999');
    await expect(counts).toHaveValue('99');
    await page.click('.stepper__btn[data-step="1"]');
    await expect(counts).toHaveValue('99');

    await page.click('#addBatchRowBtn');
    await page.locator('.batch-row__name').nth(1).fill('きらきらぼし');
    await counts.nth(1).fill('21');
    await page.click('#recordSubmitBtn');
    await expect(page.locator('#statGoalCount')).toHaveText('120');
    await page.click('#goRecordBtn');          // 当日ぶんの復元（120かい）
    await page.click('#modeBatchBtn');
    await expect(page.locator('#batchTotal')).toHaveText('120');
    await expect(counts.nth(0)).toHaveValue('99');
    await expect(counts.nth(1)).toHaveValue('21');
  });

  test('端末に保存できないときも記録は画面に反映され、次の保存で書き込まれる（#428）', async ({ page }) => {
    await page.goto('/#/record');
    await page.evaluate(() => {
      window.__full = true;
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function setItem(k, v) {
        if (window.__full && k === 'piano-pet') throw new DOMException('full', 'QuotaExceededError');
        return set.call(this, k, v);
      };
    });
    await addSong(page, 'きらきらぼし');
    await page.click('#stampCard');
    await page.click('#recordSubmitBtn');
    await expect(page.locator('#view-home')).toBeVisible();
    await expect(page.locator('#statCoins')).toHaveText('1');
    await expect(page.locator('#undoToast')).toContainText('ほぞんできなかった');
    const draft = () => page.evaluate(() => JSON.parse(localStorage.getItem('piano-pet:stamp-draft'))?.stamps?.length ?? 0);
    expect(await draft()).toBe(1);   // 記録を書けていない間は下書きを残す
    const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('piano-pet'))?.sessions?.length ?? 0);
    expect(await stored()).toBe(0);

    await page.evaluate(() => {
      window.__full = false;                                  // 空きができた
      document.getElementById('soundToggle').click();         // 別の操作の保存
    });
    expect(await stored()).toBe(1);
  });
});
