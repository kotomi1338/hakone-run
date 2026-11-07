import { sql } from "void/db";
import { index, integer, sqliteTable, text } from "void/schema-d1";

// void init で作られたサンプルのテーブル（routes/api/hello.ts のひな形と対になっている）
export const messages = sqliteTable("messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  text: text("text").notNull(),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});

/**
 * ランキング。名前・最終ポイント・合計タイムだけを保存する（プレイヤーの情報や区間ごとの記録は持たない）。
 * 並び順：points の多い順 → time_ms の速い順 → id の小さい順（先に登録した順）
 */
export const rankings = sqliteTable(
  "rankings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    points: integer("points").notNull(),
    timeMs: integer("time_ms").notNull(),
    createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  },
  (t) => [index("rankings_order_idx").on(t.points, t.timeMs, t.id)],
);
