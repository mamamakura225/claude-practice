import { test, expect } from '@playwright/test';

test.describe('タスク追加', () => {
  test.beforeEach(async ({ page }) => {
    // 本番Firebaseへの書き込みを防ぐためAPIを全てブロック
    // （SDK本体は gstatic から読み込ませる必要があるので止めない）
    await page.route('**/firestore.googleapis.com/**', (route) => route.abort());
    await page.route('**/firebase.googleapis.com/**', (route) => route.abort());
    await page.route('**/identitytoolkit.googleapis.com/**', (route) => route.abort());
  });

  test('新しいタスクを追加すると一覧に表示される', { tag: '@compat' }, async ({ page }) => {
    await page.goto('/');

    // アプリ初期化を待つ（追加ボタンが出現したらOK）
    await expect(page.locator('#addTaskBtn')).toBeVisible({ timeout: 10000 });

    // モーダルが開くまでリトライ（init() 完了＝クリックハンドラ登録完了を待つ）
    await expect(async () => {
      await page.click('#addTaskBtn');
      await expect(page.locator('#taskModal')).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 15000 });

    // ユニークなタイトル（衝突回避）
    const uniqueTitle = `E2Eテスト_${Date.now()}`;

    // タイトル入力
    await page.fill('#taskTitle', uniqueTitle);

    // 保存
    await page.locator('#taskForm button[type="submit"]').click();

    // モーダルが閉じることを確認
    await expect(page.locator('#taskModal')).toBeHidden();

    // タスク一覧に出現することを確認
    const taskList = page.locator('#taskList');
    await expect(taskList.locator('.task-card', { hasText: uniqueTitle })).toBeVisible();
  });
});
