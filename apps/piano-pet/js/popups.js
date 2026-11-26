// ===== ごほうびのポップアップ・バッジ告知・記録の演出（#441 で app.js から分けた） =====
// 記録の確定（app.js）・えさやり・購入から呼ばれる。app.js は import しない（ホームにいるかは引数で受け取る）。
import { state } from './state.js';
import { setText } from './html.js';
import { playSound } from './sound.js';
import { playCelebrate, playHappy } from './cat-image.js';
import { affinity, affinityLevel, recordClipChance } from './feed.js';

// 連続日数の節目（このどれかに到達したら特別演出）。日常のお祝いと差をつける（#81）。
const STREAK_CELEBRATIONS = new Set([3, 7, 14, 30, 50, 100]);

// 記録・えさやり演出の動画モジュール（./cat-video.js・#227/#294）。記録ビューかショップへ入ったとき
// idle で読み込み、現スタイルのクリップを prefetch する。押されるまで＝記録が確定するまで不要なので動的 import（#284）。
// celebrateRecord は import 結果（or null）を待ってから再生判定するので、素早く記録しても取りこぼさない。
let catVideoPromise = null;
export const catVideo = () => catVideoPromise;
export function primeCatVideo(kind = 'record') {
  const primeKind = (m) => (kind === 'feed' ? m.primeFeed : m.prime)(state.pet.catStyle);
  if (catVideoPromise) { catVideoPromise.then((m) => m && primeKind(m)).catch(() => {}); return; }
  const load = () => import('./cat-video.js')
    .then((m) => { primeKind(m); return m; })
    .catch(() => null);   // オフライン等。読めなければ既存CSS演出のまま
  catVideoPromise = new Promise((resolve) => {
    const run = () => resolve(load());
    if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 2000 });
    else setTimeout(run, 200);
  });
}

// 記録直後の猫の演出を出し分ける。優先順位は 目標達成 > 節目 > 通常の確率。
// 目標にはじめて届いた記録は必ず動画、それ以外の通常記録だけ確率で動画を差し込む（節目は
// 既存の playCelebrate を温存）。動画が出せなければ既存のCSS演出にフォールバックする（#227）。
// isHome(): いまホームを表示しているか（読み込みを待つ間に離れたらクリップを畳む・#428）
export function celebrateRecord({ leveled, badgeCount, streakCurrent, streakAdvanced, goalReached, isHome }) {
  // 連続日数は「その値であるあいだ」ずっと真になる状態なので、`leveled` / `badgeCount` と同じく
  // **この記録で節目に到達したか**で見る。状態のまま見ると節目の日は全記録が節目扱いになり、
  // その日はクリップが一本も出なくなる（#305）。
  const milestone = leveled || badgeCount > 0 || (streakAdvanced && STREAK_CELEBRATIONS.has(streakCurrent));
  // catEl は fallback の中で取り直す。動画待ち（最大〜3秒）の間にクラウド onSnapshot →
  // renderHome() が挟まると #catStage は作り直され、先に掴んだノードは detach 済みになる。
  const fallback = () => {
    const catEl = document.querySelector('#catStage .cat');
    return milestone ? playCelebrate(catEl) : playHappy(catEl);
  };
  const level = affinityLevel(affinity(state)).level;
  const wantVideo = goalReached || (!milestone && Math.random() < recordClipChance(level));
  // 戻り値＝ポップアップを出してよい合図。動画のときは見終わるまで待つ（#400）
  if (!wantVideo || !catVideoPromise) { fallback(); return Promise.resolve(); }
  return new Promise((resolve) => {
    const noClip = () => { fallback(); resolve(); };
    catVideoPromise.then((m) => {
      if (!m) { noClip(); return; }
      return m.tryPlay(state.pet.catStyle, resolve).then((ok) => {
        if (!ok) noClip();
        else if (!isHome()) m.stopClip(document.getElementById('catVideo'));   // 読み込みを待つ間にホームを離れた（#428）
      });
    }).catch(noClip);
  });
}

// ごほうびのポップアップを 2.2秒おきに順番に出す
export function playRewardPopups(steps) {
  steps.filter(Boolean).forEach((show, i) => setTimeout(show, i * 2200));
}

// ポップアップ共通の単発表示。duration 後にフェードアウトし、transitionend で hidden に戻す。
// 素朴に once リスナーを張ると、連続表示（えさやり連打等）のときに前回のリスナーが残り、
// 表示アニメの transitionend で新しいポップアップを途中で hidden にしてしまう（#261 バグ修正）。
// 要素ごとに前回のタイマー・リスナーを張り替えて競合を断つ。onHidden は完全に消えた後に呼ぶ。
const popupCycles = new WeakMap();
// 別のポップアップが出るときは、残っている前のもの（購入時のバッジ等）を即座に畳む。
// 半透明で重なると両方とも読めない（#396）。畳んだものの onHidden（バッジ連鎖・えさやり後の
// バッジ告知）は捨てずに返し、新しく出したものが閉じたあとに回す。
// クリップ再生中のえさやりカードは動画ごと消えてしまうので畳まない。
function dismissOtherPopups(popup) {
  const carried = [];
  for (const other of document.querySelectorAll('.coin-popup.coin-popup--show')) {
    if (other === popup || other.classList.contains('coin-popup--clip')) continue;
    const c = popupCycles.get(other);
    if (c) {
      clearTimeout(c.timer);
      clearTimeout(c.fadeTimer);
      other.removeEventListener('transitionend', c.onEnd);
      popupCycles.delete(other);
      if (c.onHidden) carried.push(c.onHidden);
      carried.push(...c.deferred);
    }
    other.classList.remove('coin-popup--show');
    other.hidden = true;
  }
  return carried;
}
function showPopup(popup, duration, onHidden) {
  const carried = dismissOtherPopups(popup);
  const prev = popupCycles.get(popup);
  if (prev) {
    if (!prev.finished) carried.push(...prev.deferred);
    clearTimeout(prev.timer);
    clearTimeout(prev.fadeTimer);
    popup.removeEventListener('transitionend', prev.onEnd);
  }
  popup.hidden = false;
  void popup.getBoundingClientRect();   // リフローを挟んでアニメーションを確実に再生
  popup.classList.add('coin-popup--show');
  const cycle = { onHidden, deferred: carried, finished: false };
  const finish = () => {
    if (cycle.finished) return;
    cycle.finished = true;
    popup.removeEventListener('transitionend', cycle.onEnd);
    clearTimeout(cycle.fadeTimer);
    popup.hidden = true;
    onHidden?.();
    // onHidden が同じポップアップで続きを出した（バッジの連鎖）なら、回ってきた分はその後ろへ
    const next = popupCycles.get(popup);
    if (next && next !== cycle && !next.finished) next.deferred.push(...cycle.deferred);
    else cycle.deferred.forEach((f) => f());
  };
  cycle.onEnd = finish;
  const hide = () => {
    if (popupCycles.get(popup) !== cycle || cycle.hiding) return;   // 次の表示に張り替え済み／フェード中
    cycle.hiding = true;
    clearTimeout(cycle.timer);
    popup.classList.remove('coin-popup--show');
    popup.addEventListener('transitionend', cycle.onEnd);
    // prefers-reduced-motion（transition:none）だと opacity 遷移自体が起きず transitionend が
    // 永久に来ない。CSSの遷移時間（0.25s）に余裕を持たせた保険タイマーで確定させる
    // （放置すると showNext のバッジ連鎖が1件目で止まり、hidden も立たず role="status" の
    // 全画面オーバーレイがアクセシブルツリーに残り続ける）。400ms は cat-video.js の
    // 同種の保険タイマー（transition が効かない環境向け）と揃えた値。
    cycle.fadeTimer = setTimeout(finish, 400);
  };
  cycle.timer = setTimeout(hide, duration);
  popupCycles.set(popup, cycle);
  popup.onclick = hide;   // タップで次へ送る（#400）
  return hide;   // duration を待たずに閉じる（えさやりクリップの終了・スキップ・#294）
}

export function showCoinPopup({ coins, leveled, newLevel, fixed = false }) {
  const popup = document.getElementById('coinPopup');
  if (!popup) return;
  // 回数が増えていない再記録・減らした記録では「+0 コイン ゲット！」と祝わない（#396）
  if (!fixed) playSound('coin', state);       // コイン獲得音（ポップアップ表示に同期）
  setText('coinPopupIcon', fixed ? '✏️' : '🪙');
  setText('coinPopupLabel', fixed ? 'きろくを なおしたよ' : 'コイン ゲット！');
  document.getElementById('coinPopupAmount').hidden = fixed;
  document.getElementById('coinPopupAmount').textContent = `+${coins}`;
  const levelUpEl = document.getElementById('coinPopupLevelUp');
  if (levelUpEl) {
    levelUpEl.hidden = !leveled;
    levelUpEl.textContent = leveled ? `レベル ${newLevel} に アップ！🎉` : '';
  }
  if (leveled) playSound('levelup', state);   // 表示と同時に鳴らす（動画のあとに出るので・#400）
  showPopup(popup, 2000);
}

// えさやりのポップアップ（なかよし上昇）。まず従来の静止カード（もぐもぐ）を出し、えさやり
// クリップ（#294）の再生が始まったらカードをクリップ表示に切り替えて、見終わる／タップまで出し続ける。
// クリップが出せなければ従来どおり 1800ms で閉じる。onHidden は閉じきった後に呼ぶ（連打で前回の
// サイクルが張り替えられると前回分は呼ばれないので、呼び出し側はキューを吐く冪等なものを渡す）。
export function showFeedPopup(food, onHidden) {
  const popup = document.getElementById('feedPopup');
  const host = document.getElementById('feedClip');
  if (!popup) return;
  setText('feedPopupIcon', food.icon);
  setText('feedPopupGain', `+${food.affinity}`);
  popup.classList.remove('coin-popup--clip');
  let closed = false;
  showPopup(popup, 1800, () => { closed = true; onHidden?.(); });
  if (!host || !catVideoPromise) return;
  let hide = null;
  catVideoPromise
    .then((m) => m?.playFeedClip(host, state.pet.catStyle, food.id, () => hide?.()).then((ok) => {
      if (!ok) return;
      // モジュール読み込みが遅く、静止カードが閉じきってから再生が始まったら出さずに畳む
      // （開き直すと onHidden＝バッジ告知が2回走る）
      if (closed) { m.stopClip(host); return; }
      popup.classList.add('coin-popup--clip');
      hide = showPopup(popup, FEED_CLIP_MAX_MS, () => {
        popup.classList.remove('coin-popup--clip');
        onHidden?.();
      });
    }))
    .catch(() => {});
}
// クリップ（8秒）の ended／保険タイマーで閉じるので、これは両方が来なかったときの上限。
const FEED_CLIP_MAX_MS = 12000;

// バッジ獲得ポップアップ（前のフェードアウト完了を待って順番に表示）。表示中に次の獲得が来ても、
// 出ているものを置き換えず後ろに並べる（置き換えると読む前に消え、続きの連鎖も失われる・#428）。
const badgeQueue = [];
let badgeShowing = false;
export function showBadgePopup(badges) {
  // 3つ以上は2つ目以降を1枚にまとめる（#400）
  if (badges.length > 2) {
    const rest = badges.slice(1);
    badges = [badges[0], { icon: rest.slice(0, 3).map((b) => b.icon).join(''), name: rest.map((b) => b.name).join('・') }];
  }
  badgeQueue.push(...badges);
  if (!badgeShowing) showNextBadge();
}
function showNextBadge() {
  const b = badgeQueue.shift();
  badgeShowing = !!b;
  if (!b) return;
  setText('badgePopupIcon', b.icon);
  setText('badgePopupName', b.name);
  playSound('levelup', state);
  showPopup(document.getElementById('badgePopup'), 2200, showNextBadge);
}

// きょうのおまけ（#148）：練習した日だけ低確率でもらえるプチ報酬のポップアップ
export function showBonusPopup(amount) {
  const popup = document.getElementById('bonusPopup');
  if (!popup) return;
  setText('bonusPopupAmount', `+${amount}`);
  playSound('coin', state);
  showPopup(popup, 2200);
}

// お休み券で連続を守ったときのポップアップ
export function showFreezePopup() {
  const popup = document.getElementById('freezePopup');
  if (!popup) return;
  playSound('coin', state);
  showPopup(popup, 2200);
}
