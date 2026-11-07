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
  return fetch("/api/rankings", { query: { limit: String(limit) } });
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
