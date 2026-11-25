import { test, expect, session, makeState, seed, readLocal, gotoHome } from './helpers.js';

// きろく一覧からの編集・削除・スタンプ付与（#145 はなまる / #239 ようす）。
// 一覧は日付降順に並べ、操作の対象はカードの data-date で引く。ずれると「別の記録を消す・別の記録に
// スタンプが付く」になるので、表示順と元配列の並びが逆になる配置（日付昇順）で確かめる。
test.describe('きろくの編集・削除・スタンプ', () => {
  test.beforeEach(({ page }) => seed(page, makeState({
    badges: ['first_practice', 'streak_3'],   // 3日連続なので checkBadges 済みの形で置く
    sessions: [
      session('2026-01-01', 2, 'ふるいきょく'),
      session('2026-01-02', 3, 'まんなか'),
      session('2026-01-03', 4, 'あたらしいきょく'),
    ],
  })));

  const cards = (page) => page.locator('#historyList .history-card');
  const nav = (page, view) => page.click(`.nav-btn[data-nav="${view}"]`);

  async function openHistory(page, count = 3) {
    await nav(page, 'history');
    await expect(cards(page)).toHaveCount(count);
  }

  // 消したあと画面を移ると、取り消しの猶予（5秒）を待たずに確定する（#398）
  async function deleteCard(page, card) {
    page.once('dialog', (d) => d.accept());
    await card.locator('[data-action="delete-session"]').click();
    await expect(page.locator('#undoToast')).toBeVisible();
    await nav(page, 'home');
  }

  test('一覧は新しい順。消した日だけが消え、コインが再計算され、資格を失ったバッジは剥がれる', async ({ page }) => {
    await gotoHome(page);
    await openHistory(page);
    await expect(page.locator('#historyList .history-card__day')).toHaveText(['1月3日（土）', '1月2日（金）', '1月1日（木）']);

    page.once('dialog', (d) => d.dismiss());   // 確認をやめたら消えない
    await cards(page).first().locator('[data-action="delete-session"]').click();
    await expect(cards(page)).toHaveCount(3);
    await expect(page.locator('#undoToast')).toBeHidden();

    await deleteCard(page, cards(page).first());   // 最新（元配列では末尾）
    let st = await readLocal(page);
    expect(st.sessions.map((s) => s.date)).toEqual(['2026-01-01', '2026-01-02']);
    expect(st.pet.coins).toBe(5);   // 2 + 3

    await openHistory(page, 2);
    await deleteCard(page, cards(page).last());   // 最古（元配列では先頭）
    st = await readLocal(page);
    expect(st.sessions.map((s) => s.date)).toEqual(['2026-01-02']);
    expect(st.pet.coins).toBe(3);

    const firstBadge = page.locator('#badgeGrid .badge-card').first();   // はじめての れんしゅう
    await nav(page, 'badges');
    await expect(firstBadge).not.toHaveClass(/badge-card--locked/);
    await openHistory(page, 1);
    await deleteCard(page, cards(page).first());
    await nav(page, 'badges');
    await expect(firstBadge).toHaveClass(/badge-card--locked/);
    await expect(page.locator('#badgesCount')).toHaveText(/^0 \/ \d+ こ ゲット！$/);
  });

  test('編集すると対象の記録だけが更新され、コインが再計算される', async ({ page }) => {
    await gotoHome(page);
    await openHistory(page);
    await cards(page).nth(1).locator('[data-action="edit-session"]').click();   // 2026-01-02
    await expect(page.locator('#recordDate')).toHaveValue('2026-01-02');
    await expect(page.locator('#recordTotal')).toHaveText('3');

    await page.click('#stampCard');           // 3 → 4 かい
    await expect(page.locator('#recordTotal')).toHaveText('4');
    await page.click('#recordSubmitBtn');
    await expect(page.locator('#view-history')).toBeVisible();

    const st = await readLocal(page);
    expect(Object.fromEntries(st.sessions.map((s) => [s.date, s.totalCount])))
      .toEqual({ '2026-01-01': 2, '2026-01-02': 4, '2026-01-03': 4 });
    expect(st.pet.coins).toBe(20);   // 2+4+4 に、3日連続のボーナス +10
  });

  test('はなまると ようすは押した記録にだけ付き、もう一度押すとその1つだけ外れる', async ({ page }) => {
    await gotoHome(page);
    await openHistory(page);
    const middle = cards(page).nth(1);   // 2026-01-02
    const praise = middle.locator('.praise-stamp').first();
    const tempo = middle.locator('.tempo-stamp').last();
    const byDate = async () => Object.fromEntries((await readLocal(page)).sessions.map((s) => [s.date, s]));

    await praise.click();
    await expect(praise).toHaveAttribute('aria-pressed', 'true');
    await tempo.click();
    await expect(tempo).toHaveAttribute('aria-pressed', 'true');
    let st = await byDate();
    expect(st['2026-01-02']).toMatchObject({ praise: 'hanamaru', tempo: 'fast' });
    expect(st['2026-01-01'].praise ?? null).toBeNull();
    expect(st['2026-01-03'].praise ?? null).toBeNull();

    await praise.click();
    await expect(praise).toHaveAttribute('aria-pressed', 'false');
    st = await byDate();
    expect(st['2026-01-02']).toMatchObject({ praise: null, tempo: 'fast' });

    await page.reload();   // 描き直しても保存どおり
    await expect(tempo).toHaveAttribute('aria-pressed', 'true');
    await expect(praise).toHaveAttribute('aria-pressed', 'false');
  });

  // #320: 次の練習記録を待たず、スタンプを押したその場で判定する
  test('3種の ようすが そろったその場でバッジが付き、外しても剥がれない（#320）', async ({ page }) => {
    await gotoHome(page);
    await openHistory(page);
    const badge = page.locator('#badgeGrid .badge-card').filter({ hasText: 'さんしょく テンポ' });
    await cards(page).nth(0).locator('.tempo-stamp').nth(0).click();
    await cards(page).nth(1).locator('.tempo-stamp').nth(1).click();
    await nav(page, 'badges');
    await expect(badge).toHaveClass(/badge-card--locked/);   // 2種ではまだ

    await nav(page, 'history');
    const last = cards(page).nth(2).locator('.tempo-stamp').nth(2);
    await last.click();
    await expect(page.locator('#badgePopup')).toContainText('さんしょく テンポ');
    await page.locator('#badgePopup').click();
    await last.click();   // 外す
    await expect(last).toHaveAttribute('aria-pressed', 'false');
    expect((await readLocal(page)).badges).toContain('tempo_all3');
    await nav(page, 'badges');
    await expect(badge).not.toHaveClass(/badge-card--locked/);
  });
});
