// ===== アプリ全体の state の置き場所（#439） =====
// app.js から分けたモジュールが app.js を import せずに state を読み書きできるよう、ここに寄せる
// （循環 import を作らない）。`state` は live binding なので、読む側は常にいまの値を見る。
// 代入は setState だけ（import した側で `state = …` と書くと TypeError になる）。
import { recomputeState } from './game.js';
import { spentTotal } from './shop.js';

export let state = null;

// 保存・送信・描画を伴わない差し替え
export function setState(next) {
  state = next;
}

// いまの state に patch を重ねて全再計算したもの
export function recomputed(patch) {
  return recomputeState({ ...state, ...patch }, spentTotal(state));
}

// 保存〜送信〜描画までの確定は app.js が登録する（取り消し待ちの削除・トーストと絡むため・#442）
let commit = null;
export function onCommit(fn) {
  commit = fn;
}
export function commitState(next) {
  commit(next);
}
