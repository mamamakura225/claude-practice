// ===== 曲名 → 色の決定的マッピング（保存不要・#122） =====
// 曲名から決定的ハッシュで色相を割り当てる。保存しないので sessions さえあれば
// どの端末でも同じ曲は同じ色になる。彩度・明度は固定し、色相だけで曲を区別する。

// FNV-1a（32bit）。文字列のコードポイント列から安定したハッシュ値を作る。
// 決定的であればよく暗号強度は不要。Unicode（ひらがな等）でも崩れないよう
// codePointAt で1文字ずつ畳み込む。
function hashString(str) {
  let h = 0x811c9dc5;
  for (const ch of String(str)) {
    h ^= ch.codePointAt(0);
    // h * 16777619 を 32bit に収める（Math.imul でオーバーフローを正しく丸める）
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0; // 符号なし32bitへ
}

// 曲名 → 色相（0〜359）。空文字・空白のみは null（無彩色フォールバック用）。
export function songHue(name) {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) return null;
  return hashString(trimmed) % 360;
}

// 色相 → 色セット。fill=濃い代表色 / tint=淡い背景 / ink=濃い文字・枠線。
// hue が null（空名）のときは無彩色（グレー）。
function colorFromHue(hue) {
  if (hue === null) {
    return { hue: null, fill: '#c9bcbf', tint: '#f3eef0', ink: '#8a7d80' };
  }
  return {
    hue,
    fill: `hsl(${hue} 70% 60%)`,
    tint: `hsl(${hue} 78% 93%)`,
    ink: `hsl(${hue} 45% 38%)`,
  };
}

// 曲名 → 色セット（単体・衝突回避なし）。名前が空のときは無彩色で返す。
export function songColor(name) {
  return colorFromHue(songHue(name));
}

// ===== 衝突回避つきの色割り当て（#165） =====
// 決定的ハッシュだけだと別の曲の色相が近接し、スタンプ画面で同じ色に見えて
// 識別できないことがある。すでに割り当てた色相をスキャンし、近すぎる場合は
// 隣の色へずらして識別性を確保する。

// これ未満の色相差は「同じ色に見える」とみなす最小ギャップ（度）。
const MIN_HUE_GAP = 25;
// 衝突時に色相をずらす歩幅（度）。素数寄りにして循環の重なりを避ける。
const HUE_SHIFT_STEP = 47;

// 色相環上の最短距離（0〜180）。
function hueGap(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

// base 色相を、used のどれとも MIN_HUE_GAP 以上離れる位置まで step ずつずらして返す。
// 一周しても空きがなければ base を返す（混雑時は妥協）。
export function shiftHue(base, used) {
  if (base === null) return null;
  const steps = Math.ceil(360 / HUE_SHIFT_STEP);
  let hue = base;
  for (let i = 0; i <= steps; i += 1) {
    if (used.every((u) => hueGap(hue, u) >= MIN_HUE_GAP)) return hue;
    hue = (hue + HUE_SHIFT_STEP) % 360;
  }
  return base;
}

// 順序つきの曲名リストに、衝突回避込みで色を割り当てた Map<name, colorSet> を返す。
// 先頭から順に色相を決め、すでに使った色相に近すぎる曲は隣の色へずらす。
// 並びが決まれば結果は決定的（sessions さえ同じなら端末間で一致・#122/#165）。
export function assignSongColors(names) {
  const map = new Map();
  const used = [];
  for (const raw of names ?? []) {
    const name = String(raw ?? '').trim();
    if (!name || map.has(name)) continue;
    const hue = shiftHue(songHue(name), used);
    if (hue !== null) used.push(hue);
    map.set(name, colorFromHue(hue));
  }
  return map;
}
