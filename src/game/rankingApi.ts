// ランキング API の呼び出し（ブラウザから）

import { fetch, FetchError } from "void/client";
import type { RankingSubmission } from "./ranking";

export interface RankedEntry {
  id: number;
  name: string;
  points: number;
  timeMs: number;
  createdAt: string;
  rank: number;
}

export async function fetchRankings(limit: number): Promise<{ entries: RankedEntry[]; total: number }> {
  const result = await fetch("/api/rankings", { query: { limit: String(limit) } });
  if (!result.entries) throw new Error("ランキングを取得できませんでした");
  return { entries: result.entries, total: result.total };
}

/** その記録を今登録したら何位になるか（登録はしない）。total は今の登録件数 */
export async function fetchRankFor(points: number, timeMs: number): Promise<{ rank: number; total: number }> {
  const result = await fetch("/api/rankings", { query: { points: String(points), timeMs: String(Math.round(timeMs)) } });
  if (result.rank === undefined) throw new Error("順位を取得できませんでした");
  return { rank: result.rank, total: result.total };
}

/** 記録を登録する。サーバーに弾かれたら、その理由をメッセージにした Error を投げる */
export async function submitRanking(submission: RankingSubmission): Promise<{ entry: RankedEntry; total: number }> {
  try {
    const result = await fetch("/api/rankings", { method: "POST", body: submission });
    if ("error" in result) throw new Error(String(result.error));
    return result;
  } catch (error) {
    if (error instanceof FetchError) {
      const data = error.data as { error?: string } | undefined;
      throw new Error(data?.error ?? `登録できませんでした（${error.status}）`);
    }
    throw error;
  }
}
