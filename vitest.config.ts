// テスト専用の設定。vite.config.ts の Void プラグイン（Cloudflare Workers で動かす）は読み込まず、
// ゲームのロジック（Phaser に依存しない部分）を Node でテストする。
import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
