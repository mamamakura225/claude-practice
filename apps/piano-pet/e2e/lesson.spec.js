import { test, expect } from '@playwright/test';

// レッスン日（#393）。親ゲート内で今日を登録すると、その日が練習した日になり、
// 連続+1・コイン10が付く。解除すれば元に戻る。
test.describe('レッスン日の登録（#393）', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/www.gstatic.com/firebasejs/**', (route) => route.abort());
    await page.route('**/firestore.googleapis.com/**', (route) => route.abort());
    await page.route('**/firebase.googleapis.com/**', (route) => route.abort());
    await page.route('**/identitytoolkit.googleapis.com/**', (route) => route.abort());
    await page.addInitScript(() => {
      try { localStorage.setItem('piano-pet-onboarded', '1'); } catch { /* 無視 */ }
    });
  });

  async function passGate(page) {
    await page.click('#settingsToggle');
    await expect(page.locator('#settingsGate')).toBeVisible();
    const a = Number(await page.locator('#gateA').textContent());
    const b = Number(await page.locator('#gateB').textContent());
    await page.fill('#gateAnswer', String(a * b));
    await page.click('#gateSubmit');
    await expect(page.locator('#settingsMenu')).toBeVisible();
  }

  test('今日を登録すると連続1・コイン10・ホーム表示、解除で元に戻る', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#goRecordBtn')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#statLessonToday')).toBeHidden();
    await expect(page.locator('#statStreak')).toHaveText('0');

    const today = await page.evaluate(() => {
      const d = new Date();
      const p = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    });

    await passGate(page);
    await page.fill('#lessonDateInput', today);
    await page.click('#lessonAddBtn');
    await expect(page.locator('#lessonList li')).toHaveCount(1);
    await page.click('#settingsMenu [data-action="close-settings"]');

    await expect(page.locator('#statLessonToday')).toBeVisible();
    await expect(page.locator('#statStreak')).toHaveText('1');
    await expect(page.locator('#statCoins')).toHaveText('10');

    // リロードしても残る
    await page.reload();
    await expect(page.locator('#statLessonToday')).toBeVisible();
    await expect(page.locator('#statCoins')).toHaveText('10');

    // 解除すると元に戻る
    await passGate(page);
    await page.click('#lessonList .lesson-del');
    await expect(page.locator('#lessonList li')).toHaveCount(0);
    await page.click('#settingsMenu [data-action="close-settings"]');
    await expect(page.locator('#statLessonToday')).toBeHidden();
    await expect(page.locator('#statStreak')).toHaveText('0');
    await expect(page.locator('#statCoins')).toHaveText('0');
  });

  test('昨日がレッスン日なら起動時に取りこまれ、今日の練習で連続が3日になる', async ({ page }) => {
    await page.addInitScript(() => {
      const p = (n) => String(n).padStart(2, '0');
      const day = (back) => {
        const d = new Date(); d.setDate(d.getDate() - back);
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
      };
      localStorage.setItem('piano-pet', JSON.stringify({
        pet: { name: 'きーちゃん', level: 1, xp: 3, coins: 3, equippedItems: [], catStyle: 'shiro', lessonDates: [day(1)] },
        inventory: [],
        streak: { current: 1, best: 1, lastPracticeDate: day(2), freezes: 0 },
        badges: ['first_practice'],
        sessions: [{ date: day(2), songs: [{ name: 'きらきらぼし', count: 3 }], totalCount: 3 }],
      }));
    });
    await page.goto('/');
    await expect(page.locator('#goRecordBtn')).toBeVisible({ timeout: 10000 });
    // 昨日のレッスンが練習した日として連続に入り、コイン10が加わる（おやすみけんは減らない）
    await expect(page.locator('#statStreak')).toHaveText('2');
    await expect(page.locator('#statCoins')).toHaveText('13');
    await expect(page.locator('#statFreezes')).toHaveText('0');

    await page.click('#goRecordBtn');
    await expect(page.locator('#view-record')).toBeVisible();
    await page.fill('#newSongInput', 'きらきらぼし');
    await page.click('#addSongBtn');
    for (let i = 0; i < 3; i += 1) await page.click('#stampCard');
    await page.click('#recordSubmitBtn');
    await expect(page.locator('#view-home')).toBeVisible();
    await expect(page.locator('#statStreak')).toHaveText('3');
  });

  test('開いたまま日付をまたいだ記録でも、先に来たレッスン日が連続・コインに入る', async ({ page }) => {
    // 起動時（D 12:00）は D+1 のレッスンが先の予定。時計を D+1 へ進めてから記録すると、
    // 逐次更新ではなく全再計算で確定され、レッスンの分が入る（コイン 3 + 3 + 10）。
    const base = new Date(); base.setHours(12, 0, 0, 0);
    const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const next = new Date(base); next.setDate(next.getDate() + 1);
    await page.clock.install({ time: base });
    await page.addInitScript(({ today, tomorrow }) => {
      localStorage.setItem('piano-pet', JSON.stringify({
        pet: { name: 'きーちゃん', level: 1, xp: 3, coins: 3, equippedItems: [], catStyle: 'shiro', lessonDates: [tomorrow] },
        inventory: [],
        streak: { current: 1, best: 1, lastPracticeDate: today, freezes: 0 },
        badges: ['first_practice'],
        sessions: [{ date: today, songs: [{ name: 'きらきらぼし', count: 3 }], totalCount: 3 }],
      }));
    }, { today: fmt(base), tomorrow: fmt(next) });
    await page.goto('/');
    await expect(page.locator('#goRecordBtn')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#statCoins')).toHaveText('3');

    await page.clock.setSystemTime(next);
    await page.click('#goRecordBtn');
    await expect(page.locator('#view-record')).toBeVisible();
    await page.fill('#newSongInput', 'きらきらぼし');
    await page.click('#addSongBtn');
    for (let i = 0; i < 3; i += 1) await page.click('#stampCard');
    await page.click('#recordSubmitBtn');
    await expect(page.locator('#view-home')).toBeVisible();
    await expect(page.locator('#statStreak')).toHaveText('2');
    await expect(page.locator('#statCoins')).toHaveText('16');
  });

  test('レッスン当日に練習も記録しても、おやすみけんは二重に付かない', async ({ page }) => {
    await page.addInitScript(() => {
      const p = (n) => String(n).padStart(2, '0');
      const day = (back) => {
        const d = new Date(); d.setDate(d.getDate() - back);
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
      };
      localStorage.setItem('piano-pet', JSON.stringify({
        pet: { name: 'きーちゃん', level: 1, xp: 6, coins: 6, equippedItems: [], catStyle: 'shiro', lessonDates: [day(0)] },
        inventory: [],
        streak: { current: 2, best: 2, lastPracticeDate: day(1), freezes: 0 },
        badges: ['first_practice', 'practice_again'],
        sessions: [
          { date: day(1), songs: [{ name: 'きらきらぼし', count: 3 }], totalCount: 3 },
          { date: day(2), songs: [{ name: 'きらきらぼし', count: 3 }], totalCount: 3 },
        ],
      }));
    });
    await page.goto('/');
    await expect(page.locator('#goRecordBtn')).toBeVisible({ timeout: 10000 });
    // 今日のレッスンが取りこまれ、3日目の節目でお休み券が1枚
    await expect(page.locator('#statStreak')).toHaveText('3');
    await expect(page.locator('#statFreezes')).toHaveText('1');

    await page.click('#goRecordBtn');
    await expect(page.locator('#view-record')).toBeVisible();
    await page.fill('#newSongInput', 'きらきらぼし');
    await page.click('#addSongBtn');
    for (let i = 0; i < 3; i += 1) await page.click('#stampCard');
    await page.click('#recordSubmitBtn');
    await expect(page.locator('#view-home')).toBeVisible();
    await expect(page.locator('#statStreak')).toHaveText('3');
    await expect(page.locator('#statFreezes')).toHaveText('1');
  });
});
