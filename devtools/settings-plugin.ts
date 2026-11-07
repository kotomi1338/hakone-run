// 開発サーバー専用：管理画面の「現在の設定で保存」から送られた設定を src/game/settings.json に書き込む。
// configureServer は vp dev のときだけ動くので、ビルドや公開版には含まれない。

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

export const SETTINGS_ENDPOINT = "/__dev/settings";
const SETTINGS_FILE = fileURLToPath(new URL("../src/game/settings.json", import.meta.url));
const MAX_BODY_BYTES = 16 * 1024;

export function devSettingsPlugin(): Plugin {
  return {
    name: "hakone-run:dev-settings",
    apply: "serve",
    enforce: "pre",
    configureServer(server) {
      server.middlewares.use(SETTINGS_ENDPOINT, (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }
        let body = "";
        req.on("data", (chunk: Buffer) => {
          body += chunk;
          if (body.length > MAX_BODY_BYTES) req.destroy();
        });
        req.on("end", async () => {
          try {
            const settings = JSON.parse(body);
            if (!isSettings(settings)) throw new Error("設定の形式が正しくありません");
            await writeFile(SETTINGS_FILE, `${JSON.stringify(settings, null, 2)}\n`);
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: true }));
          } catch (error) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: false, error: String(error) }));
          }
        });
      });
    },
  };
}

/** { course, run, score, slope } がどれも {名前: 数値} の形かどうか */
function isSettings(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const { course, run, score, slope } = value as Record<string, unknown>;
  return [course, run, score, slope].every(
    (group) =>
      typeof group === "object" &&
      group !== null &&
      Object.values(group).length > 0 &&
      Object.values(group).every((v) => typeof v === "number" && Number.isFinite(v)),
  );
}
