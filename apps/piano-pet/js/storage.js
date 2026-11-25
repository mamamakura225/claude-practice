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
    placedItems: [],       // 配置中の置物ID（#226）。座標は itemLayout を装備と共用
    itemLayout: {},        // { itemId: { x_pct, y_pct, scale?, layer? } }（#168/#205/#226/#270）
    affinity: 0,
    foodSpent: 0,
    dailyGoal: 10,         // 表示上の目標だけに効く。達成ボーナスの閾値とは別（#238）
    catStyle: 'tora',      // #66。未知値は表示側が tora に戻す
    childName: '',         // こどものプロフィール（#121）
    childAvatar: 'chick',
    lessonDates: [],       // レッスン日（#393）。YYYY-MM-DD の昇順・重複なし
    lessonRemoved: [],     // 解除したレッスン日（墓標・#393）
    // ねこスタンプちょう（#409・docs/data-model.md）
    stampBook: { card: null, pressed: [], done: [] },
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
  // 削除した記録の日付（tombstone・#319。設計判断は docs/data-model.md）
  deletedDates: [],
  settings: {
    soundOn: true,
  },
};

// 各ステップは「v(index) の state を受け取り v(index+1) の形に変換して返す純粋関数」。
// version フィールドの付与は migrate() が行うので、ここでは構造変換だけを書く。
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
export const CLOUD_FIELDS = ['pet', 'inventory', 'streak', 'badges', 'sessions', 'deletedDates'];

// 配列であるべきフィールドを配列に矯正する（#272）。壊れた値は既定（空配列）へ倒す。
function asArray(value) {
  return Array.isArray(value) ? value : [];
}

// スプレッドで展開してよいプレーンオブジェクトか（配列・null・プリミティブを弾く・#272）。
function asObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

// 実在する YYYY-MM-DD か。書式だけ正しい日付（2026-11-00 等）は、連続日数の計算（game.js prevDay の
// toISOString）が RangeError になり、記録の保存ごと止まる（#428）。
function isDate(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v);
}

// 有限の数値に矯正する。文字列の '5' のまま残すと加算が連結（'5'+1='51'）に化ける（#428）。
function asNumber(value, fallback = 0) {
  const n = value === null || value === '' ? NaN : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// 日付の配列の矯正。実在する日付だけ残し、重複を除いて昇順にそろえる（レッスン日 #393 ほか）。
export function normalizeLessonDates(value) {
  return [...new Set(asArray(value).filter(isDate))].sort();
}

// 自由配置の各エントリの矯正（#428）。数値でない scale は cat-image.js の toFixed で throw し、
// 起動直後の renderHome が落ちて画面が真っ白のままになる。
function normalizeItemLayout(value) {
  return Object.fromEntries(Object.entries(asObject(value)).map(([id, v]) => {
    const { x_pct, y_pct, scale, layer } = asObject(v);
    return [id, {
      ...(Number.isFinite(x_pct) && Number.isFinite(y_pct) ? { x_pct, y_pct } : {}),
      ...(Number.isFinite(scale) && scale > 0 ? { scale } : {}),
      ...(layer === 'front' || layer === 'back' ? { layer } : {}),
    }];
  }));
}

// スタンプちょうのカード（#409）。id・開始日が壊れていれば捨てる。5/60/10/20 は stamp-book.js の
// CARD_MIN/CARD_MAX/既定/REWARD_MAX_LEN と同じ値（entry を軽くするため import しない）
function normalizeStampCard(v) {
  const o = asObject(v);
  const id = Number(o.id);
  if (!Number.isFinite(id) || !isDate(o.startDate)) return null;
  return {
    id,
    startDate: o.startDate,
    size: Math.min(60, Math.max(5, Math.round(Number(o.size)) || 10)),
    reward: String(o.reward ?? '').trim().slice(0, 20),
    emoji: typeof o.emoji === 'string' ? o.emoji.slice(0, 8) : '',
  };
}

function normalizeStampBook(v) {
  const o = asObject(v);
  return {
    card: normalizeStampCard(o.card),
    pressed: normalizeLessonDates(o.pressed),
    done: asArray(o.done).map((c) => {
      const card = normalizeStampCard(c);
      return card && { ...card, dates: normalizeLessonDates(c.dates), redeemedOn: isDate(c.redeemedOn) ? c.redeemedOn : null };
    }).filter(Boolean),
  };
}

// レッスン日の初回マージ：登録の union − 解除の墓標の union。再登録は墓標を外して保存されるので、
// 同じ日が登録と墓標の両方にあるときは墓標を勝たせる（#393）。
function mergeLessonDates(l, c) {
  const removed = normalizeLessonDates([...l.lessonRemoved, ...c.lessonRemoved]);
  return {
    lessonDates: normalizeLessonDates([...l.lessonDates, ...c.lessonDates]).filter((d) => !removed.includes(d)),
    lessonRemoved: removed,
  };
}

// 初回マージ（#409）。規則は docs/data-model.md
function mergeStampBook(l, c) {
  const done = [...new Map([...c.done, ...l.done].map((x) => [x.id, x])).values()].sort((a, b) => a.id - b.id);
  const ended = new Set(done.map((x) => x.id));
  const cards = [l.card, c.card].filter((x) => x && !ended.has(x.id));
  return {
    card: cards.reduce((a, b) => (b.id > a.id ? b : a), cards[0] ?? null),
    pressed: normalizeLessonDates([...l.pressed, ...c.pressed]),
    done,
  };
}

// 文字列 'abc' はスプレッドで ['a','b','c'] に化けるので name:'' として弾く。
function normalizeSong(v) {
  const o = asObject(v);
  return { name: String(o.name ?? ''), count: asNumber(o.count) };
}

// sessions 要素の中身を矯正する（#311・設計判断は docs/data-model.md）。
// date 不正は要素ごと落とし（既定で埋めると連続日数・ヒートマップが嘘になる）、
// totalCount / bonusCoins / songs は安全な既定値へ倒して残す。
function normalizeSessions(value) {
  const objs = asArray(value).filter((v) => v !== null && typeof v === 'object' && !Array.isArray(v));
  const kept = objs.filter((v) => isDate(v.date));
  if (objs.length > kept.length) {
    console.warn(`[piano-pet] normalizeState: 日付不正の記録を ${objs.length - kept.length} 件除外`);
  }
  return kept.map((v) => ({
    ...v,
    totalCount: asNumber(v.totalCount),
    ...(v.bonusCoins === undefined ? {} : { bonusCoins: asNumber(v.bonusCoins) }),
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
  const streak = asObject(s.streak);
  return {
    ...structuredClone(DEFAULTS),
    ...s,
    pet: {
      ...DEFAULTS.pet,
      ...pet,
      level: asNumber(pet.level, 1),
      xp: asNumber(pet.xp),
      coins: asNumber(pet.coins),
      affinity: asNumber(pet.affinity),
      foodSpent: asNumber(pet.foodSpent),
      equippedItems: asArray(pet.equippedItems),
      placedItems: asArray(pet.placedItems),
      itemLayout: normalizeItemLayout(pet.itemLayout),
      lessonDates: normalizeLessonDates(pet.lessonDates),
      lessonRemoved: normalizeLessonDates(pet.lessonRemoved),
      stampBook: normalizeStampBook(pet.stampBook),
    },
    streak: {
      ...streak,
      current: asNumber(streak.current),
      best: asNumber(streak.best),
      lastPracticeDate: isDate(streak.lastPracticeDate) ? streak.lastPracticeDate : null,
      freezes: asNumber(streak.freezes),
    },
    settings: { ...DEFAULTS.settings, ...asObject(s.settings) },
    inventory: asArray(s.inventory),
    badges: asArray(s.badges),
    // 要素の中身まで矯正する（#311）。怠ると recomputeState で coins/xp が NaN 化、
    // mergeSameDaySessions が `[...s.songs]` で throw してアプリが起動不能になる。
    sessions: normalizeSessions(s.sessions),
    // 削除記録の墓標（#319）。日付形式のものだけ残す。
    deletedDates: [...new Set(asArray(s.deletedDates).filter(isDate))],
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
  const merged = normalizeState({ ...local, ...picked });
  // 墓標は union し、墓標のある日付の記録は取り込まない（#319）
  const gone = new Set([...(local?.deletedDates ?? []), ...merged.deletedDates]);
  merged.deletedDates = [...gone];
  merged.sessions = merged.sessions.filter((s) => !gone.has(s.date));
  return merged;
}

// sessions を date をキーに 1 日 1 件へ解決する（keep-larger）。
// 両側に同じ日付があれば totalCount の大きい方をそのまま採用し、合算しない。
// 合算すると部分同期後の共有ベースを二重計上してコイン/XP が水増しされるため
// （record ID/vector clock が無い前提での安全側。設計合意 topic_1780534255497 / #142）。
// 並びはアプリ慣習に合わせ date 降順（新しい順）。tie（同回数）はローカル優先。
// 付与値（bonusCoins #148 / praise #145 / tempo #239）は衝突時も非nullを勝たせて救済する
// （失うと復元不能。coinsEarned/xpEarned は再計算できるので不問・#315。設計判断は docs）。
export function mergeSessionsKeepLarger(localSessions, cloudSessions, deletedDates = []) {
  const gone = new Set(deletedDates);   // 片方で削除した日付は復活させない（tombstone・#319）
  const byDate = new Map();
  const consider = (s) => {
    if (!s || s.date == null || gone.has(s.date)) return;
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

  const union = (a, b) => [...new Set([...a, ...b])];
  const inventory = union(l.inventory, c.inventory);
  const owned = new Set(inventory);
  const equippedItems = union(l.pet.equippedItems, c.pet.equippedItems).filter((id) => owned.has(id));
  // 置物（#226）も装備と同じく union ∩ inventory（未所持の配置は残さない）。
  const placedItems = union(l.pet.placedItems, c.pet.placedItems).filter((id) => owned.has(id));

  // 墓標は両側の union（片方で消したものは消えたまま・#319）。
  const deletedDates = union(l.deletedDates, c.deletedDates);

  return normalizeState({
    ...l,
    inventory,
    deletedDates,
    sessions: mergeSessionsKeepLarger(l.sessions, c.sessions, deletedDates),
    pet: {
      ...l.pet,
      equippedItems,
      placedItems,
      // 座標も union（ローカル優先）。ローカル固定にすると、他端末が置いた置物が既定位置に戻る（#242）。
      itemLayout: { ...c.pet.itemLayout, ...l.pet.itemLayout },
      ...mergeLessonDates(l.pet, c.pet),
      stampBook: mergeStampBook(l.pet.stampBook, c.pet.stampBook),
      affinity: Math.max(l.pet.affinity, c.pet.affinity),
      foodSpent: Math.max(l.pet.foodSpent, c.pet.foodSpent),
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
