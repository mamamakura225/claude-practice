// ===== LocalStorage CRUD + 状態の正規化／クラウド射影 =====
import { getActiveAccountId, storageKeyFor } from './account.js';

// 有効アカウントの localStorage キー（マルチアカウント・#182）。アカウントごとに
// キャッシュを分離するため、固定値ではなく有効アカウントから都度導出する。
export function activeStorageKey() {
  return storageKeyFor(getActiveAccountId());
}

// localStorage に保存する state の現行スキーマバージョン。
// 構造を破壊的に変更したらここを +1 し、MIGRATIONS に移行ステップを追加する。
export const SCHEMA_VERSION = 2;

const DEFAULTS = {
  version: SCHEMA_VERSION,
  pet: {
    name: 'きーちゃん',
    level: 1,
    xp: 0,
    coins: 0,
    equippedItems: [],
    // 置物・小物系（シーン配置型・#226）。配置中の置物IDの配列。装備（equippedItems・slot排他）とは
    // 別管理で排他なし複数配置。座標は itemLayout を共用（置物IDは装着IDと重複しない）。
    placedItems: [],
    // 衣装・置物の自由配置座標（#168/#226）。{ itemId: { x_pct, y_pct } }。
    // 未登録のアイテムは cat-image.js が既定位置で描く（装着=アンカー / 置物=SCENE_DEFAULT_PCT）。
    itemLayout: {},
    affinity: 0,
    foodSpent: 0,
    // 1日の練習目標回数（#238）。親が 5〜20 で調整。既定10。進捗表示・スタンプのマス数/音程にのみ
    // 反映し、達成ボーナス閾値（game.js GOAL_BONUS_THRESHOLD=10・固定）とは分離する（過去コイン不変）。
    // pet 配下なので既存の cloud 同期にそのまま乗り、未設定の旧データは normalizeState が10で補完する。
    dailyGoal: 10,
    // 猫スタイル（#66）。'tora' | 'shiro' | 'russianblue'。未知値は表示側が tora にフォールバック。
    catStyle: 'tora',
    // こども本人のプロフィール（#121）。ヘッダ隅のアバターに使う。クラウド同期で別端末にも反映。
    // childAvatar は絵文字ID（child-profile.js）。未設定・未知IDは表示側が既定にフォールバック。
    childName: '',
    childAvatar: 'chick',
  },
  inventory: [],
  streak: {
    current: 0,
    best: 0,
    lastPracticeDate: null,
    freezes: 0,
  },
  badges: [],
  sessions: [],
  settings: {
    soundOn: true,
  },
};

// 各ステップは「v(index) の state を受け取り v(index+1) の形に変換して返す純粋関数」。
// version フィールドの付与は migrate() が行うので、ここでは構造変換だけを書く。
// 例: v1→v2 で sessions の形を変えるなら MIGRATIONS[1] に変換を追加する。
const MIGRATIONS = [
  // v0 (バージョン番号を持たないレガシーデータ) → v1: 構造変更なし。version 付与のみ。
  (s) => s,
  // v1 → v2: 衣装の自由配置 pet.itemLayout を導入（#168）。
  // 既定値の補完は normalizeState が行うため、ここでは version 付与のみ。
  (s) => s,
];

// 保存データのスキーマバージョンを現行 (SCHEMA_VERSION) まで順に引き上げる。
// version を持たない旧データは v0 とみなす。現行より新しいデータ
// (ダウングレード時など) はそのまま返し、バージョンを下げない。
export function migrate(saved) {
  let s = saved ?? {};
  let v = Number.isInteger(s.version) ? s.version : 0;
  while (v < SCHEMA_VERSION && MIGRATIONS[v]) {
    s = MIGRATIONS[v](s);
    v += 1;
  }
  return { ...s, version: v };
}

// クラウド(Firestore)へ保存するフィールド。settings は端末ローカル設定なので含めない。
// 旧 'assignment'（しゅくだい・#143）は機能削除（#261）に伴い同期対象から外した。
// 既存データに残る assignment フィールドは normalizeState の未知キー引き継ぎで無害に残り、
// クラウド doc からは次回 push（setDoc 置換）で自然に消える。
export const CLOUD_FIELDS = ['pet', 'inventory', 'streak', 'badges', 'sessions'];

// 配列であるべきフィールドを配列に矯正する（#272）。壊れた値は既定（空配列）へ倒す。
function asArray(value) {
  return Array.isArray(value) ? value : [];
}

// スプレッドで展開してよいプレーンオブジェクトか（配列・null・プリミティブを弾く・#272）。
function asObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 文字列 'abc' はスプレッドで ['a','b','c'] に化けるので name:'' として弾く。
function normalizeSong(v) {
  const o = asObject(v);
  return { name: String(o.name ?? ''), count: Number(o.count) || 0 };
}

// sessions 要素の中身を矯正する（#311・設計判断は docs/data-model.md）。
// date 不正は要素ごと落とし（既定で埋めると連続日数・ヒートマップが嘘になる）、
// totalCount / songs は安全な既定値へ倒して残す。
function normalizeSessions(value) {
  const objs = asArray(value).filter((v) => v !== null && typeof v === 'object' && !Array.isArray(v));
  const kept = objs.filter((v) => typeof v.date === 'string' && DATE_RE.test(v.date));
  if (objs.length > kept.length && typeof console !== 'undefined') {
    console.warn(`[piano-pet] normalizeState: 日付不正の記録を ${objs.length - kept.length} 件除外`);
  }
  return kept.map((v) => ({
    ...v,
    totalCount: Number(v.totalCount) || 0,
    songs: asArray(v.songs).map(normalizeSong).filter((x) => x.name !== ''),
  }));
}

// 保存値に DEFAULTS を補完してアプリが前提とする形に整える。
// localStorage の読み込みとクラウドデータの取り込みの両方で使う。
//
// 不足キーの補完だけでなく**型の矯正**まで行う（#272）。この関数は
// 「認証なし Firestore doc（#258 段階2 以前）／取り込んだバックアップ JSON」という
// 信頼できない入力に対する唯一の入口ガードであり、ここを通り抜けた型不正は
// app.js のモジュールトップ（mergeSameDaySessions）で throw して
// **アプリ全体を起動不能にする**（壊れた値は localStorage に残るためリロードでも直らない）。
export function normalizeState(saved) {
  const s = asObject(saved);
  const pet = asObject(s.pet);
  return {
    ...structuredClone(DEFAULTS),
    ...s,
    pet: {
      ...DEFAULTS.pet,
      ...pet,
      equippedItems: asArray(pet.equippedItems),
      placedItems: asArray(pet.placedItems),
      itemLayout: asObject(pet.itemLayout),
    },
    streak: { ...DEFAULTS.streak, ...asObject(s.streak) },
    settings: { ...DEFAULTS.settings, ...asObject(s.settings) },
    inventory: asArray(s.inventory),
    badges: asArray(s.badges),
    // 要素の中身まで矯正する（#311）。怠ると recomputeState で coins/xp が NaN 化、
    // mergeSameDaySessions が `[...s.songs]` で throw してアプリが起動不能になる。
    sessions: normalizeSessions(s.sessions),
  };
}

// state からクラウドに載せるフィールドだけを抜き出す。
export function cloudFields(state) {
  const out = {};
  for (const k of CLOUD_FIELDS) out[k] = state[k];
  return out;
}

// ローカル state にクラウドのデータフィールドを重ねる（realtime onSnapshot 経路: cloud-wins）。
// settings 等の端末ローカル値は cloud に無いので保持される。
// 初回 fetchCloud の取り込みは clobber を避けるため mergeCloudInitial を使う（#142）。
export function mergeCloud(local, cloud) {
  const picked = {};
  for (const k of CLOUD_FIELDS) {
    if (cloud && cloud[k] !== undefined) picked[k] = cloud[k];
  }
  return normalizeState({ ...local, ...picked });
}

// sessions を date をキーに 1 日 1 件へ解決する（keep-larger）。
// 両側に同じ日付があれば totalCount の大きい方をそのまま採用し、合算しない。
// 合算すると部分同期後の共有ベースを二重計上してコイン/XP が水増しされるため
// （record ID/vector clock が無い前提での安全側。設計合意 topic_1780534255497 / #142）。
// 並びはアプリ慣習に合わせ date 降順（新しい順）。tie（同回数）はローカル優先。
// 付与値（bonusCoins #148 / praise #145 / tempo #239）は衝突時も非nullを勝たせて救済する
// （失うと復元不能。coinsEarned/xpEarned は再計算できるので不問・#315。設計判断は docs）。
export function mergeSessionsKeepLarger(localSessions, cloudSessions) {
  const byDate = new Map();
  const consider = (s) => {
    if (!s || s.date == null) return;
    const prev = byDate.get(s.date);
    if (!prev) { byDate.set(s.date, { ...s }); return; }
    const chosen = (Number(s.totalCount) || 0) > (Number(prev.totalCount) || 0) ? s : prev;
    byDate.set(s.date, {
      ...chosen,
      bonusCoins: Math.max(Number(prev.bonusCoins) || 0, Number(s.bonusCoins) || 0),
      praise: prev.praise ?? s.praise ?? null,
      tempo: prev.tempo ?? s.tempo ?? null,
    });
  };
  for (const s of localSessions ?? []) consider(s);   // local を先に（tie でローカルが残る）
  for (const s of cloudSessions ?? []) consider(s);
  return [...byDate.values()].sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

// 初回クラウド同期専用の「ローカル優先」マージ（#142）。
// 起動直後にローカルで記録した内容を消さないよう、フィールドごとに無損失寄りで突き合わせる。
//   - sessions: mergeSessionsKeepLarger（keep-larger）
//   - inventory: 重複 ID を除いた union（所有は単調増加）
//   - equippedItems: 両端末の union のうちマージ後 inventory に含まれるものだけ
//   - pet.affinity / pet.foodSpent: sessions から導出されない累積値なので max
// pet.coins/xp/level・streak・badges は sessions から導出されるため、呼び出し側で
// recomputeState を通して再計算する（このモジュールは game ロジックに依存しない）。
export function mergeCloudInitial(local, cloud) {
  const l = normalizeState(local);
  if (!cloud) return l;
  const c = normalizeState(cloud);

  const inventory = [...new Set([...(l.inventory ?? []), ...(c.inventory ?? [])])];
  const owned = new Set(inventory);
  const equippedItems = [...new Set([...(l.pet.equippedItems ?? []), ...(c.pet.equippedItems ?? [])])]
    .filter((id) => owned.has(id));
  // 置物（#226）も装備と同じく union ∩ inventory（未所持の配置は残さない）。
  const placedItems = [...new Set([...(l.pet.placedItems ?? []), ...(c.pet.placedItems ?? [])])]
    .filter((id) => owned.has(id));

  return normalizeState({
    ...l,
    inventory,
    sessions: mergeSessionsKeepLarger(l.sessions, c.sessions),
    pet: {
      ...l.pet,
      equippedItems,
      placedItems,
      // 自由配置座標も union（cloud を土台にローカルで上書き）。placedItems だけ union して
      // itemLayout をローカル固定にすると、他端末が置いた置物が既定位置に戻ってしまうため（#242）。
      // 初回同期でも他端末の配置座標を取り込める（従来はローカルのみ参照で既定位置に落ちていた）。
      itemLayout: { ...(c.pet.itemLayout ?? {}), ...(l.pet.itemLayout ?? {}) },
      affinity: Math.max(l.pet.affinity ?? 0, c.pet.affinity ?? 0),
      foodSpent: Math.max(l.pet.foodSpent ?? 0, c.pet.foodSpent ?? 0),
    },
  });
}

export function loadState() {
  try {
    const raw = localStorage.getItem(activeStorageKey());
    if (!raw) return structuredClone(DEFAULTS);
    return normalizeState(migrate(JSON.parse(raw)));
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export function saveState(state) {
  localStorage.setItem(activeStorageKey(), JSON.stringify(state));
}
