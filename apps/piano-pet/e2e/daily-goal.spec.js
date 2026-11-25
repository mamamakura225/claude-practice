import { test, expect, readLocal, fixRandom, gotoHome, openSettings, closeSettings, record } from './helpers.js';

// 1日の目標回数を親が調整（#238）。ホーム・記録画面・達成判定へ一貫して効き、達成ボーナスには影響しない。
test.describe('目標回数の調整（#238）', () => {
  async function setGoal(page, value) {
    await page.fill('#goalTargetInput', value);
    await page.locator('#goalTargetInput').blur();
  }

  test('既定は10。親が15に変えるとホームと記録画面に反映され、20を超える値は20に丸まる', async ({ page }) => {
    await gotoHome(page);
    await expect(page.locator('#statGoalTarget')).toHaveText('10');

    await openSettings(page);
    await expect(page.locator('#goalTargetInput')).toHaveValue('10');
    await setGoal(page, '99');
    await expect(page.locator('#goalTargetInput')).toHaveValue('20');
    expect((await readLocal(page)).pet.dailyGoal).toBe(20);
    await setGoal(page, '15');
    await closeSettings(page);

    await expect(page.locator('#statGoalTarget')).toHaveText('15');
    await expect(page.locator('#statGoalbar')).toHaveAttribute('aria-valuemax', '15');
    await page.click('#goRecordBtn');
    await expect(page.locator('#stampCard .stamp-cell')).toHaveCount(15);
    await expect(page.locator('#recordGoalTarget')).toHaveText('15');
    await expect(page.locator('#stampCard .stamp-cell').nth(14)).toHaveClass(/is-goal/);
  });

  test('目標を5に下げると5回で達成になり、必ず動画が出る。ボーナスのコインは増えない（#322）', async ({ page }) => {
    await fixRandom(page, 0.999);
    await gotoHome(page);
    await openSettings(page);
    await setGoal(page, '5');
    await closeSettings(page);
    await expect(page.locator('#goalBlock')).not.toHaveClass(/goal-block--done/);

    await record(page, 5);
    // 達成の判定（crossedDailyGoal）にも目標が渡っている＝抽選に外れても動画が出る
    await expect(page.locator('#catVideo')).toHaveClass(/cat-video--show/);
    await expect(page.locator('#statGoalCount')).toHaveText('5');
    await expect(page.locator('#statGoalMsg')).toHaveText('もくひょう たっせい！🎉');
    await expect(page.locator('#goalBlock')).toHaveClass(/goal-block--done/);
    await expect(page.locator('#statGoalbar')).toHaveAttribute('aria-valuenow', '5');
    await expect(page.locator('#statGoalFill')).toHaveAttribute('style', /width:\s*100%/);
    await expect(page.locator('#statCoins')).toHaveText('5');   // 達成ボーナスは10回で固定
  });

  test('丸めた結果がいまの目標と同じでも、欄の表示が直る（#428）', async ({ page }) => {
    await gotoHome(page);
    await openSettings(page);
    for (const typed of ['5', '2']) {   // 5 にしてから、5 に丸まる 2 を入れる
      await setGoal(page, typed);
      await expect(page.locator('#goalTargetInput')).toHaveValue('5');
    }
  });
});
