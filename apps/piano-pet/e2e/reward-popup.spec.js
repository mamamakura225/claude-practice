import { test, expect } from '@playwright/test';

// 記録後の報酬ポップアップ群（おまけ/お休み券/レベルアップ）のDOM配線を検証する（#323）。
// この領域は過去に同型のバグを踏んでいる（#261）：使い回しオーバーレイの遅延cleanupが、
// 失敗直後の再演出で新しい要素を掴んで壊すクラス。#261の修正本体は showPopup（app.js）の
// popupCycles WeakMap によるタイマー / transitionend の張り替え。#261の退行ガードは
// shop.spec.js のえさやり連打テストで見る（4本目）。
test.describe('報酬ポップアップ群（#323）', () => {
  test.beforeEach(async ({ page }) => {
    // 本番Firestoreへの読み書きと干渉を防ぐためFirebase関連を全てブロック。
    await page.route('**/www.gstatic.com/firebasejs/**', (route) => route.abort());
    await page.route('**/firestore.googleapis.com/**', (route) => route.abort());
    await page.route('**/firebase.googleapis.com/**', (route) => route.abort());
    await page.route('**/identitytoolkit.googleapis.com/**', (route) => route.abort());
    await page.addInitScript(() => {
      try { localStorage.setItem('piano-pet-onboarded', '1'); } catch { /* 無視 */ }
    });
  });

  async function recordStamps(page, count) {
    await page.click('#goRecordBtn');
    await expect(page.locator('#view-record')).toBeVisible();
    await page.fill('#newSongInput', 'きらきらぼし');
    await page.click('#addSongBtn');
    for (let i = 0; i < count; i += 1) await page.click('#stampCard');
    await page.click('#recordSubmitBtn');
    await expect(page.locator('#view-home')).toBeVisible();
  }

  test('お休み券で連続を守った記録は、コイン→お休み券→バッジの順で直列表示される', async ({ page }) => {
    // 昨日ではなく一昨日に練習済み＝1日抜けている。freezes=1 でちょうど救済できる境目
    // （missed=1, freezes>=missed）。sessions に既存日を1件入れておき、今日の記録で
    // 2日目＝practice_again が新規に成立するようにする（badgeCount>0 でバッジポップアップが出る）。
    // badges は空で始める：['first_practice'] を残すと today の記録で新規成立するのが
    // practice_again の1件だけになり、showBadgePopup の showNext チェーンを1件目で切る退行
    // （バッジが2件以上あるときだけ表出する）を検出できない。空で始めれば first_practice /
    // practice_again の2件が同時に新規成立し、チェーンの実効性を検証できる。
    await page.addInitScript(() => {
      Math.random = () => 0.999; // Math.random()=1 は [0,1) の定義域外＝cat-video.js の
      // Fisher-Yates が範囲外スワップでバッグを壊す（未定義の穴が入る）。0.999 なら
      // きょうのおまけ・確率クリップは同様に外れつつ定義域内に収まる。
      const p = (n) => String(n).padStart(2, '0');
      const day = (back) => {
        const d = new Date(); d.setDate(d.getDate() - back);
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
      };
      localStorage.setItem('piano-pet', JSON.stringify({
        pet: { name: 'きーちゃん', level: 1, xp: 0, coins: 0, equippedItems: [], catStyle: 'shiro' },
        inventory: [],
        streak: { current: 1, best: 1, lastPracticeDate: day(2), freezes: 1 },
        badges: [],
        sessions: [{ date: day(2), songs: [{ name: 'きらきらぼし', count: 3 }], totalCount: 3 }],
      }));
    });
    await page.goto('/');
    await expect(page.locator('#goRecordBtn')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#statFreezes')).toHaveText('1');   // 記録前

    await recordStamps(page, 3);

    const coin = page.locator('#coinPopup');
    const freeze = page.locator('#freezePopup');
    const badge = page.locator('#badgePopup');

    // 「出た」の判定はクラス（`.coin-popup--show`）、「消えた」の判定は `toBeHidden()`
    // に振り分ける。`.coin-popup[hidden]{display:none}` の是正で `toBeHidden()` は
    // フェード完了まで正しく待てるようになったが、`toBeVisible()` は opacity を見ないため
    // `hidden` 属性が外れただけ（＝`opacity:0` の非表示状態）でも true になり、
    // `--show` が付かない退行（演出が一切見えなくなる）を検出できない。
    await expect(coin).toHaveClass(/coin-popup--show/);
    await expect(coin).toBeHidden();
    await expect(page.locator('#statFreezes')).toHaveText('0');   // お休み券が1枚消費された
    // お休み券が出ている「その瞬間」にバッジはまだ出ていない（直列化 nextDelay+=2200 のガード）。
    // `nextDelay` は表示 duration にしか合っておらずフェード分（約250〜300ms）を見込んで
    // いないため、`hidden` 属性ベースの isVisible() だとその重なり窓を拾って誤検出することが
    // 実測で分かった。`--show` クラスの有無なら旧実装と同じ厳密な排他条件で判定できる。
    await expect(freeze).toHaveClass(/coin-popup--show/);
    expect(await badge.evaluate((el) => el.className.includes('coin-popup--show')),
      'お休み券の表示中はまだバッジを出さない').toBe(false);
    await expect(freeze).toBeHidden();

    // バッジ2件（はじめての れんしゅう→また れんしゅうしたね）が showNext チェーンで
    // 順番に表示される。1件目だけで止まる退行（チェーン切断）は2件目の検証で捕まる。
    await expect(badge).toHaveClass(/coin-popup--show/);
    await expect(page.locator('#badgePopupName')).toHaveText('はじめての れんしゅう');
    await expect(badge).toBeHidden();
    // 2件目は「表示中の一瞬」を toHaveClass で捕まえるのではなく、#badgePopupName の
    // 最終的な値で確認する（CIの低速環境で表示ウィンドウを取りこぼす実測があったため。
    // 2200ms 表示され続ける実測は取れているが、CI側のポーリング遅延が重なると
    // ローカルより明らかに長い揺れが乗ることがある）。テキストは非表示後も保持される値で、
    // showNext のチェーンが2件目まで進んだことの直接証拠になる
    await expect(page.locator('#badgePopupName')).toHaveText('また れんしゅうしたね', { timeout: 15000 });
  });

  test('きょうのおまけが当たると+3コインのポップアップが出る', async ({ page }) => {
    await page.addInitScript(() => { Math.random = () => 0; }); // rollDailyBonus(0) は必ず当選
    await page.goto('/');
    await expect(page.locator('#goRecordBtn')).toBeVisible({ timeout: 10000 });

    // その日の初回記録（同日既存なし）でのみ抽選（#148）
    await recordStamps(page, 3);

    // #bonusPopupAmount の文言はHTML側に静的デフォルト値（+3）が入っているため、テキスト一致
    // だけでは showBonusPopup が実際に呼ばれたことを証明できない。`--show` クラスの有無で
    // 表示イベント自体を確認する（toBeVisible は opacity を見ないため `--show` が付かない
    // 退行＝演出が視覚的に一切出ない状態でも成立してしまい使えない）。
    await expect(page.locator('#bonusPopup')).toHaveClass(/coin-popup--show/);
    await expect(page.locator('#bonusPopupAmount')).toHaveText('+3');
    // テキストのトートロキー（HTML静的デフォルトと同値）を避けるため、コイン実額でも裏を取る：
    // 記録3回（3コイン）＋おまけ3コイン＝6。おまけの配線が壊れていれば3のまま止まる。
    await expect(page.locator('#statCoins')).toHaveText('6');
  });

  test('レベル境界をまたぐ記録でレベルアップのポップアップが出る', async ({ page }) => {
    await page.addInitScript(() => {
      Math.random = () => 0.999; // きょうのおまけ・確率クリップを外す（1は定義域外）
      localStorage.setItem('piano-pet', JSON.stringify({
        pet: { name: 'きーちゃん', level: 1, xp: 16, coins: 0, equippedItems: [], catStyle: 'shiro' },
        inventory: [],
        streak: { current: 0, best: 0, lastPracticeDate: null, freezes: 0 },
        badges: ['first_practice'],
        sessions: [],
      }));
    });
    await page.goto('/');
    await expect(page.locator('#goRecordBtn')).toBeVisible({ timeout: 10000 });

    // 5回記録：xp 16+5=21 ≧ xpForLevel(2)=20 でレベル2へ（totalCount<10なので目標ボーナス無し）
    await recordStamps(page, 5);

    await expect(page.locator('#coinPopup')).toHaveClass(/coin-popup--show/);
    // #coinPopupLevelUp は素の <span hidden> で opacity 制御を持たないため toBeVisible のまま
    const levelUp = page.locator('#coinPopupLevelUp');
    await expect(levelUp).toBeVisible();
    await expect(levelUp).toContainText('レベル 2 に アップ！');
  });
});

// prefers-reduced-motion の退行ガード：`transition: none`（css/style.css）だと opacity 遷移が
// 起きず transitionend が永久に来ない。showPopup の保険タイマー（duration + 300ms）が無いと、
// (1) hidden が立たず role="status" の全画面オーバーレイがアクセシブルツリーに残り続ける
// (2) showBadgePopup の showNext チェーンが1件目で止まり2件目のバッジが出ない。
test.describe('報酬ポップアップ群 @ prefers-reduced-motion', () => {
  // test.use({ reducedMotion: 'reduce' }) はこのPlaywrightバージョン/ブラウザ組み合わせでは
  // 実際のメディア特性に反映されない（matchMedia が false のまま・実測）。
  // page.emulateMedia() は CDP 経由で確実に反映される（matchMedia が true・
  // transitionDuration が 0s になることを実測済み）。
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.route('**/www.gstatic.com/firebasejs/**', (route) => route.abort());
    await page.route('**/firestore.googleapis.com/**', (route) => route.abort());
    await page.route('**/firebase.googleapis.com/**', (route) => route.abort());
    await page.route('**/identitytoolkit.googleapis.com/**', (route) => route.abort());
    await page.addInitScript(() => {
      try { localStorage.setItem('piano-pet-onboarded', '1'); } catch { /* 無視 */ }
    });
  });

  test('reduced-motionでもバッジ2件が順に出て、最終的にhiddenへ戻る', async ({ page }) => {
    await page.addInitScript(() => {
      Math.random = () => 0.999;
      const p = (n) => String(n).padStart(2, '0');
      const day = (back) => {
        const d = new Date(); d.setDate(d.getDate() - back);
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
      };
      localStorage.setItem('piano-pet', JSON.stringify({
        pet: { name: 'きーちゃん', level: 1, xp: 0, coins: 0, equippedItems: [], catStyle: 'shiro' },
        inventory: [],
        streak: { current: 1, best: 1, lastPracticeDate: day(2), freezes: 1 },
        badges: [],
        sessions: [{ date: day(2), songs: [{ name: 'きらきらぼし', count: 3 }], totalCount: 3 }],
      }));
    });
    await page.goto('/');
    await expect(page.locator('#goRecordBtn')).toBeVisible({ timeout: 10000 });

    await page.click('#goRecordBtn');
    await expect(page.locator('#view-record')).toBeVisible();
    await page.fill('#newSongInput', 'きらきらぼし');
    await page.click('#addSongBtn');
    for (let i = 0; i < 3; i += 1) await page.click('#stampCard');
    await page.click('#recordSubmitBtn');
    await expect(page.locator('#view-home')).toBeVisible();

    // チェーンが2件目まで進み、最終的にすべて hidden へ戻ることを確認する
    // （保険タイマーが無いと "また れんしゅうしたね" に到達しないまま止まる）
    await expect(page.locator('#badgePopupName')).toHaveText('また れんしゅうしたね', { timeout: 15000 });
    await expect(page.locator('#coinPopup')).toBeHidden();
    await expect(page.locator('#freezePopup')).toBeHidden();
    await expect(page.locator('#badgePopup')).toBeHidden();
  });
});
