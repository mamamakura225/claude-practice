import { test, expect } from '@playwright/test';

// ねこスタンプちょう（#409）：1日10回で1こ。子が肉球で押し、うまったら親が「ごほうびを あげた」で次へ。
const ymd = (back) => {
  const d = new Date(); d.setDate(d.getDate() - back);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const session = (back, n) => ({ date: ymd(back), songs: [{ name: 'きらきらぼし', count: n }], totalCount: n });

async function boot(page, state) {
  await page.route('**/www.gstatic.com/firebasejs/**', (route) => route.abort());
  await page.route('**/firestore.googleapis.com/**', (route) => route.abort());
  await page.route('**/firebase.googleapis.com/**', (route) => route.abort());
  await page.route('**/identitytoolkit.googleapis.com/**', (route) => route.abort());
  await page.addInitScript((s) => {
    if (sessionStorage.getItem('seeded')) return;   // reload で seed し直さない（保存結果を見る）
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('piano-pet-onboarded', '1');
    localStorage.setItem('piano-pet', JSON.stringify(s));
  }, state);
}

const base = ({ sessions = [], stampBook } = {}) => ({
  pet: { name: 'きーちゃん', level: 1, xp: 0, coins: 0, equippedItems: [], ...(stampBook && { stampBook }) },
  inventory: [],
  streak: { current: 0, best: 0, lastPracticeDate: null },
  badges: [],
  sessions,
});
const card = (over = {}) => ({ id: 1, startDate: ymd(20), size: 5, reward: 'どうぶつえん', emoji: '🎡', ...over });
const saved = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('piano-pet')));

async function passGate(page) {
  await page.click('.nav-btn[data-nav="home"]');   // ⚙️ はホームのヘッダにある
  await page.click('#settingsToggle');
  await expect(page.locator('#settingsGate')).toBeVisible();
  const a = Number(await page.locator('#gateA').textContent());
  const b = Number(await page.locator('#gateB').textContent());
  await page.fill('#gateAnswer', String(a * b));
  await page.click('#gateSubmit');
  await expect(page.locator('#settingsMenu')).toBeVisible();
}

test.describe('ねこスタンプちょう（#409）', () => {
  test('カードが無いときは案内だけ。親がカードを作るとホームに進捗が出る', async ({ page }) => {
    await boot(page, base({ sessions: [session(0, 10)] }));
    await page.goto('/#/stamp');
    await expect(page.locator('#stampBook')).toContainText('まだ カードが ないよ');
    await page.click('.nav-btn[data-nav="home"]');
    await expect(page.locator('#stampHomeLink')).toBeHidden();

    await passGate(page);
    await page.click('#stampSaveBtn');   // ごほうびが空なら作らない
    await expect(page.locator('#stampSettings')).toContainText('ごほうびの なかみを いれてね');
    await page.fill('#stampRewardInput', 'アイス');
    await page.click('.stamp-emoji__btn[data-emoji="🍦"]');
    await page.fill('#stampSizeInput', '7');
    await page.click('#stampSaveBtn');
    await expect(page.locator('#stampSettings')).toContainText('カードを つくりました');
    await page.click('#settingsMenu [data-action="close-settings"]');

    // 今日10回ひいている＝今日から1こ（押すまでは 0/7）
    await expect(page.locator('#stampHomeLink')).toHaveText('🐾 スタンプを おしてね！（0/7）');
    await page.click('#stampHomeLink');
    await page.locator('.sb-press').click();
    await expect(page.locator('.sb-cell--done')).toHaveCount(1);
    await page.click('.nav-btn[data-nav="home"]');
    await expect(page.locator('#stampHomeLink')).toHaveText('🐾 スタンプ 1/7 ・ 🍦 アイス');
    const st = await saved(page);
    expect(st.pet.stampBook.card).toMatchObject({ reward: 'アイス', emoji: '🍦', size: 7, startDate: ymd(0) });
  });

  test('10回の日だけ押せる。肉球で押すと保存され、リロードしても残る', async ({ page }) => {
    await boot(page, base({ sessions: [session(0, 9), session(1, 10), session(2, 30)], stampBook: { card: card() } }));
    await page.goto('/#/stamp');
    await expect(page.locator('.sb-press')).toHaveCount(2);   // 9回の今日は押せない
    await expect(page.locator('.sb-grid .sb-cell')).toHaveCount(5);

    await page.locator('.sb-press').first().click();
    await expect(page.locator('.sb-cell--done')).toHaveCount(1);
    await expect(page.locator('.sb-paw')).toHaveCount(1);     // ぺたっの肉球
    // 絵柄の画像が実際に読めている（#410）。肉球は演出後に消えるので、描き直し後のスタンプだけを見る
    // （肉球の画像があることはユニットテストで確認）
    await expect(page.locator('.sb-paw')).toHaveCount(0);
    await expect.poll(() => page.locator('.sb-cell--done img.sb-stamp').evaluate((e) => e.naturalWidth)).toBe(192);
    await expect(page.locator('.sb-press')).toHaveCount(1);
    expect((await saved(page)).pet.stampBook.pressed).toEqual([ymd(2)]);   // 古い日から並ぶ

    await page.reload();
    await expect(page.locator('.sb-cell--done')).toHaveCount(1);
    await expect(page.locator('.sb-count')).toHaveText('1 / 5 こ');
    await expect(page.locator('.sb-msg')).toHaveText('スタンプを おしてね！');
  });

  test('最後の1こで ごほうび ゲット。親が「ごほうびを あげた」でおわったカードへ', async ({ page }) => {
    const days = [5, 4, 3, 2, 1];
    await boot(page, base({
      sessions: days.map((b) => session(b, 12)),
      stampBook: { card: card(), pressed: days.slice(0, 4).map(ymd) },
    }));
    await page.goto('/#/stamp');
    await page.locator('.sb-press').click();
    await expect(page.locator('#sbGoal')).toContainText('ごほうび ゲット！');

    await passGate(page);
    await page.click('#stampRedeemBtn');
    await expect(page.locator('#stampSettings')).toContainText('つぎの カードを つくってね');
    await expect(page.locator('#stampSaveBtn')).toHaveText('カードを つくる');
    await page.click('#settingsMenu [data-action="close-settings"]');

    const st = await saved(page);
    expect(st.pet.stampBook.card).toBeNull();
    expect(st.pet.stampBook.done).toHaveLength(1);
    expect(st.pet.stampBook.done[0].dates).toEqual(days.map(ymd));
    await page.click('.nav-btn[data-nav="stamp"]');
    await expect(page.locator('.sb-done summary')).toHaveText('おわった カード（1）');
  });

  test('320px でも5列のマスと5つめのタブが収まる', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await boot(page, base({ sessions: [session(1, 10)], stampBook: { card: card({ size: 60 }) } }));
    await page.goto('/#/stamp');
    await expect(page.locator('.sb-grid .sb-cell')).toHaveCount(60);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const nav = await page.locator('.nav-btn[data-nav="stamp"]').boundingBox();
    expect(nav.x + nav.width).toBeLessThanOrEqual(320);
  });
});
