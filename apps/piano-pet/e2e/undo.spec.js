import { test, expect } from '@playwright/test';

// 誤操作の取り消し（#398）：購入・記録の削除・レッスン日の取り消し、記録済みの過去日の案内、
// 読み込み／初期化の前へ戻す。
const ymd = (back) => {
  const d = new Date(); d.setDate(d.getDate() - back);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

async function boot(page, state, { extra } = {}) {
  await page.route('**/www.gstatic.com/firebasejs/**', (route) => route.abort());
  await page.route('**/firestore.googleapis.com/**', (route) => route.abort());
  await page.route('**/firebase.googleapis.com/**', (route) => route.abort());
  await page.route('**/identitytoolkit.googleapis.com/**', (route) => route.abort());
  await page.addInitScript(([s, ex]) => {
    // reload で seed し直さない（取り消しの結果が保存されているかを reload 後に見る）
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('piano-pet-onboarded', '1');
    localStorage.setItem('piano-pet', JSON.stringify(s));
    for (const [k, v] of Object.entries(ex ?? {})) localStorage.setItem(k, v);
  }, [state, extra]);
  await page.addInitScript(() => { Math.random = () => 0.999; });
}

const base = (over = {}) => ({
  pet: { name: 'きーちゃん', level: 1, xp: 0, coins: 200, equippedItems: [], ...over.pet },
  inventory: [],
  streak: { current: 0, best: 0, lastPracticeDate: null },
  badges: [],
  sessions: over.sessions ?? [],
});

const saved = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('piano-pet')));

async function passGate(page) {
  await page.click('#settingsToggle');
  await expect(page.locator('#settingsGate')).toBeVisible();
  const a = Number(await page.locator('#gateA').textContent());
  const b = Number(await page.locator('#gateB').textContent());
  await page.fill('#gateAnswer', String(a * b));
  await page.click('#gateSubmit');
  await expect(page.locator('#settingsMenu')).toBeVisible();
}

test.describe('取り消し（#398）', () => {
  test('ショップで買った直後に「やっぱり やめる」でコインが戻る', async ({ page }) => {
    await boot(page, base());
    await page.goto('/#/shop');
    await page.click('.shop-btn[data-action="buy"][data-id="ribbon"]');
    await expect(page.locator('#undoToast')).toBeVisible();
    await expect(page.locator('#undoToastMsg')).toHaveText('あかい リボン を かったよ');
    await page.click('#undoToastBtn');
    await expect(page.locator('#undoToast')).toBeHidden();
    const st = await saved(page);
    expect(st.inventory).toEqual([]);
    expect(st.pet.coins).toBe(200);
    await expect(page.locator('.shop-btn[data-action="buy"][data-id="ribbon"]')).toBeVisible();
  });

  test('記録を けしても「もとに もどす」で戻り、取り消しの間は保存も墓標も変わらない', async ({ page }) => {
    const sessions = [{ date: ymd(1), songs: [{ name: 'きらきらぼし', count: 3 }], totalCount: 3 }];
    await boot(page, base({ sessions }));
    page.on('dialog', (d) => d.accept());
    await page.goto('/#/history');
    await expect(page.locator('.history-card')).toHaveCount(1, { timeout: 10000 });
    await page.click('[data-action="delete-session"]');
    await expect(page.locator('#undoToast')).toBeVisible();
    await expect(page.locator('.history-card:visible')).toHaveCount(0);
    let st = await saved(page);
    expect(st.sessions).toHaveLength(1);
    expect(st.deletedDates ?? []).toEqual([]);
    await page.click('#undoToastBtn');
    await expect(page.locator('.history-card:visible')).toHaveCount(1);
    await page.reload();
    await expect(page.locator('.history-card')).toHaveCount(1, { timeout: 10000 });
    st = await saved(page);
    expect(st.deletedDates ?? []).toEqual([]);
  });

  test('取り消さなければ、猶予のあとに削除が確定する', async ({ page }) => {
    const sessions = [{ date: ymd(1), songs: [{ name: 'きらきらぼし', count: 3 }], totalCount: 3 }];
    await boot(page, base({ sessions }));
    page.on('dialog', (d) => d.accept());
    await page.goto('/#/history');
    await expect(page.locator('.history-card')).toHaveCount(1, { timeout: 10000 });
    await page.click('[data-action="delete-session"]');
    await expect(page.locator('#undoToast')).toBeHidden({ timeout: 8000 });
    const st = await saved(page);
    expect(st.sessions).toHaveLength(0);
    expect(st.deletedDates).toContain(ymd(1));
  });

  test('けしたあと別の操作で保存が走ると、その時点で削除が確定する', async ({ page }) => {
    const sessions = [{ date: ymd(5), songs: [{ name: 'かえるのうた', count: 100 }], totalCount: 100 }, { date: ymd(1), songs: [{ name: 'きらきらぼし', count: 3 }], totalCount: 3 }];
    await boot(page, base({ sessions }));
    page.on('dialog', (d) => d.accept());
    await page.goto('/#/history');
    await expect(page.locator('.history-card')).toHaveCount(2, { timeout: 10000 });
    await page.locator('.history-card').first().locator('[data-action="delete-session"]').click();
    await page.goto('/#/shop');
    await page.click('.shop-btn[data-action="buy"][data-id="ribbon"]');
    const st = await saved(page);
    expect(st.sessions).toHaveLength(1);
    expect(st.inventory).toContain('ribbon');
  });

  test('レッスン日の × は「もとに もどす」で戻せる', async ({ page }) => {
    await boot(page, base({ pet: { lessonDates: [ymd(0)] } }));
    await page.goto('/');
    await expect(page.locator('#settingsToggle')).toBeVisible({ timeout: 10000 });
    await passGate(page);
    await expect(page.locator('#lessonList .lesson-del')).toHaveCount(1);
    await page.click('#lessonList .lesson-del');
    await expect(page.locator('#lessonList .lesson-del')).toHaveCount(0);
    await expect(page.locator('#undoToast')).toBeVisible();
    await page.click('#undoToastBtn');
    await expect(page.locator('#lessonList .lesson-del')).toHaveCount(1);
    expect((await saved(page)).pet.lessonDates).toEqual([ymd(0)]);
  });

  test('記録済みの過去日を選ぶと、すでにある回数と「たしざん」になることが出る', async ({ page }) => {
    const sessions = [{ date: ymd(2), songs: [{ name: 'きらきらぼし', count: 11 }], totalCount: 11 }];
    await boot(page, base({ sessions }));
    await page.goto('/#/record');
    await expect(page.locator('#recordDate')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#recordDateNote')).toBeHidden();
    await page.fill('#recordDate', ymd(2));
    await page.locator('#recordDate').dispatchEvent('change');
    await expect(page.locator('#recordDateNote')).toBeVisible();
    await expect(page.locator('#recordDateNote')).toContainText('11かい');
    await page.fill('#recordDate', ymd(3));
    await page.locator('#recordDate').dispatchEvent('change');
    await expect(page.locator('#recordDateNote')).toBeHidden();
  });

  test('読み込み前に退避したデータへ「ひとつ まえの データに もどす」で戻せる（別アカウントの退避は出さない）', async ({ page }) => {
    const prev = JSON.stringify(base({ pet: { coins: 77 } }));
    await boot(page, base(), {
      extra: { 'piano-pet-backup-before-restore': prev, 'piano-pet-backup-before-restore:meta': JSON.stringify({ account: 'data', doc: null, at: Date.now() }) },
    });
    page.on('dialog', (d) => d.accept());
    await page.goto('/');
    await expect(page.locator('#settingsToggle')).toBeVisible({ timeout: 10000 });
    await passGate(page);
    await expect(page.locator('#restorePrevBtn')).toBeVisible();
    await page.click('#restorePrevBtn');
    await expect(page.locator('#statCoins')).toHaveText('77', { timeout: 10000 });
    // いまの データ（200）が退避され、行き来できる
    const stash = await page.evaluate(() => JSON.parse(localStorage.getItem('piano-pet-backup-before-restore')));
    expect(stash.pet.coins).toBe(200);
  });

  test('別アカウントで退避したデータには戻すボタンを出さない', async ({ page }) => {
    await boot(page, base(), {
      extra: { 'piano-pet-backup-before-restore': JSON.stringify(base()), 'piano-pet-backup-before-restore:meta': JSON.stringify({ account: 'test', doc: null, at: Date.now() }) },
    });
    await page.goto('/');
    await expect(page.locator('#settingsToggle')).toBeVisible({ timeout: 10000 });
    await passGate(page);
    await expect(page.locator('#restorePrevBtn')).toBeHidden();
  });
  test('今日の記録を消してすぐ記録画面へ行っても、消した回数がフォームに戻らない（画面を移ると確定）', async ({ page }) => {
    await boot(page, base());
    page.on('dialog', (d) => d.accept());
    await page.goto('/');
    // 画面から記録して、当日分のスタンプ下書きも作られた状態にする
    await page.click('#goRecordBtn');
    await page.fill('#newSongInput', 'きらきらぼし');
    await page.click('#addSongBtn');
    for (let i = 0; i < 4; i += 1) await page.click('#stampCard');
    await page.click('#recordSubmitBtn');
    await page.click('.nav-btn[data-nav="history"]');
    await expect(page.locator('.history-card')).toHaveCount(1, { timeout: 10000 });
    await page.click('[data-action="delete-session"]');
    await page.click('.nav-btn[data-nav="home"]');
    await page.click('#goRecordBtn');
    await expect(page.locator('#recordTotal')).toHaveText('0');
    const st = await saved(page);
    expect(st.sessions).toHaveLength(0);
    expect(st.deletedDates).toContain(ymd(0));
  });

  test('記録を消したあと、ショップで買って取り消しても、削除は巻き戻らない', async ({ page }) => {
    const sessions = [{ date: ymd(5), songs: [{ name: 'かえるのうた', count: 100 }], totalCount: 100 }, { date: ymd(1), songs: [{ name: 'きらきらぼし', count: 3 }], totalCount: 3 }];
    await boot(page, base({ sessions }));
    page.on('dialog', (d) => d.accept());
    await page.goto('/#/history');
    await expect(page.locator('.history-card')).toHaveCount(2, { timeout: 10000 });
    await page.locator('.history-card').first().locator('[data-action="delete-session"]').click();
    await page.click('.nav-btn[data-nav="shop"]');
    await page.click('.shop-btn[data-action="buy"][data-id="ribbon"]');
    await page.click('#undoToastBtn');
    const st = await saved(page);
    expect(st.inventory).toEqual([]);
    expect(st.sessions).toHaveLength(1);
    expect(st.deletedDates).toContain(ymd(1));
  });

  test('購入のあとに別の操作で保存が走ったら、取り消しのトーストは閉じる', async ({ page }) => {
    await boot(page, base());
    await page.goto('/#/shop');
    await page.click('.shop-btn[data-action="buy"][data-id="ribbon"]');
    await expect(page.locator('#undoToast')).toBeVisible();
    await page.click('.shop-btn[data-action="toggle"][data-id="ribbon"]');   // ガード（700ms）明けに みにつける
    await expect(page.locator('#undoToast')).toBeHidden();
    expect((await saved(page)).pet.equippedItems).toContain('ribbon');
  });

  test('ファイルを読み込むと前のデータが退避され、「ひとつ まえ」で戻せる', async ({ page }) => {
    await boot(page, base({ pet: { coins: 55 } }));
    page.on('dialog', (d) => d.accept());
    await page.goto('/');
    await expect(page.locator('#statCoins')).toHaveText('55', { timeout: 10000 });
    await passGate(page);
    const file = JSON.stringify({ app: 'piano-pet', schemaVersion: 2, exportedAt: new Date().toISOString(), state: base({ pet: { coins: 9 } }) });
    await page.setInputFiles('#importFile', { name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(file) });
    await expect(page.locator('#statCoins')).toHaveText('9', { timeout: 10000 });
    await passGate(page);
    await page.click('#restorePrevBtn');
    await expect(page.locator('#statCoins')).toHaveText('55', { timeout: 10000 });
  });
});
