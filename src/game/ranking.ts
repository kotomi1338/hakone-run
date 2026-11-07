// ランキングのルール。ゲーム（ブラウザ）とサーバー（API）の両方で使う。画面（Phaser）に依存しない。
//
// 保存するのは名前・最終ポイント・合計タイムだけ。
// 並び順：ポイントが多い順 → 同点ならタイムが速い順 → それでも同点なら先に登録した順。

export const NAME_MAX_LENGTH = 20;

export interface RankingSubmission {
  name: string;
  points: number;
  timeMs: number;
}

export interface RankingEntry {
  id: number;
  name: string;
  points: number;
  timeMs: number;
  createdAt: string;
}

/** 並び順の比較（負なら a が上位）。id は登録順 */
export function compareEntries(a: Pick<RankingEntry, "id" | "points" | "timeMs">, b: Pick<RankingEntry, "id" | "points" | "timeMs">): number {
  if (a.points !== b.points) return b.points - a.points;
  if (a.timeMs !== b.timeMs) return a.timeMs - b.timeMs;
  return a.id - b.id;
}

/** 名前を整える（前後の空白を除く・連続する空白を1つに）。使えない名前なら理由を返す */
export function normalizeName(raw: string): { ok: true; name: string } | { ok: false; error: string } {
  const name = raw.normalize("NFC").replace(/\s+/g, " ").trim();
  if (name.length === 0) return { ok: false, error: "名前を入力してください" };
  if ([...name].length > NAME_MAX_LENGTH) return { ok: false, error: `名前は${NAME_MAX_LENGTH}文字までです` };
  // 制御文字や改行は使えない
  if (/\p{Cc}|\p{Cf}/u.test(name)) return { ok: false, error: "使えない文字が含まれています" };
  return { ok: true, name };
}

function isInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

/** 送られてきた記録の形を確かめ、名前を整える */
export function validateSubmission(
  input: RankingSubmission,
): { ok: true; name: string; points: number; timeMs: number } | { ok: false; error: string } {
  const name = normalizeName(input.name);
  if (!name.ok) return name;
  if (!isInt(input.points) || !isInt(input.timeMs)) return { ok: false, error: "記録の形式が正しくありません" };
  return { ok: true, name: name.name, points: input.points, timeMs: input.timeMs };
}

/** 走り終えたレースから、ランキングに送る記録を作る（10区間すべて走っていなければ null） */
export function buildSubmission(
  race: { allConnected: boolean; totalMs: () => number; breakdown: () => { total: number } },
  name: string,
): RankingSubmission | null {
  if (!race.allConnected) return null;
  return { name, points: race.breakdown().total, timeMs: Math.round(race.totalMs()) };
}
