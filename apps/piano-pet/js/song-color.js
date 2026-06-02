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

// 曲名 → 色セット。fill=濃い代表色 / tint=淡い背景 / ink=濃い文字・枠線。
// 名前が空のときは無彩色（グレー）で返す。
export function songColor(name) {
  const hue = songHue(name);
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
