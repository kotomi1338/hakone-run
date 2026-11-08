// ランキング API
//   GET  /api/rankings?limit=20  … 上位の記録（ポイントの多い順 → タイムの速い順 → 先に登録した順）
//   GET  /api/rankings?points=12345&timeMs=67890 … その記録を今登録したら何位になるか（登録はしない）
//   POST /api/rankings           … 記録を登録する。サーバーでルールどおりの記録か確かめてから保存する

import { rankings } from "@schema";
import { defineHandler } from "void";
import { and, asc, count, db, desc, eq, gt, lt, lte, or } from "void/db";
import { z } from "zod";
import { validateSubmission } from "../../../src/game/ranking";

const MAX_LIMIT = 100;

const submissionSchema = z.object({
  name: z.string().max(100),
  points: z.number(),
  timeMs: z.number(),
});

const order = [desc(rankings.points), asc(rankings.timeMs), asc(rankings.id)];
const publicColumns = {
  id: rankings.id,
  name: rankings.name,
  points: rankings.points,
  timeMs: rankings.timeMs,
  createdAt: rankings.createdAt,
};

const digits = z.string().regex(/^\d+$/);

export const GET = defineHandler.withValidator({
  query: z.object({ limit: digits.optional(), points: digits.optional(), timeMs: digits.optional() }),
})(async (_c, { query }) => {
  if (query.points !== undefined && query.timeMs !== undefined) {
    // 同じポイント・同じタイムの記録がすでにあれば、先に登録したほうが上なので、その下になる
    const points = Number(query.points);
    const timeMs = Number(query.timeMs);
    const [{ above }] = await db
      .select({ above: count() })
      .from(rankings)
      .where(or(gt(rankings.points, points), and(eq(rankings.points, points), lte(rankings.timeMs, timeMs))));
    const [{ total }] = await db.select({ total: count() }).from(rankings);
    return { rank: above + 1, total };
  }
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(query.limit ?? 20)));
  const entries = await db.select(publicColumns).from(rankings).orderBy(...order).limit(limit);
  const [{ total }] = await db.select({ total: count() }).from(rankings);
  return { entries: entries.map((e, i) => ({ ...e, rank: i + 1 })), total };
});

export const POST = defineHandler.withValidator({
  body: submissionSchema,
})(async (c, { body }) => {
  const result = validateSubmission(body);
  if (!result.ok) return c.json({ error: result.error }, 400);

  const [created] = await db
    .insert(rankings)
    .values({ name: result.name, points: result.points, timeMs: result.timeMs })
    .returning(publicColumns);

  // 自分より上位の記録の数 + 1 が順位
  const [{ above }] = await db
    .select({ above: count() })
    .from(rankings)
    .where(
      or(
        gt(rankings.points, created.points),
        and(eq(rankings.points, created.points), lt(rankings.timeMs, created.timeMs)),
        and(eq(rankings.points, created.points), eq(rankings.timeMs, created.timeMs), lt(rankings.id, created.id)),
      ),
    );
  const [{ total }] = await db.select({ total: count() }).from(rankings);
  return { entry: { ...created, rank: above + 1 }, total };
});
