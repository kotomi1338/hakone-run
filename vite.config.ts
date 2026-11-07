import { defineConfig } from "vite";
import { voidPlugin } from "void";
import { voidReact } from "@void/react/plugin";
import { devSettingsPlugin } from "./devtools/settings-plugin";

export default defineConfig({
  plugins: [
    // 開発用の設定保存エンドポイント（/__dev/settings）を他より先に処理させる
    devSettingsPlugin(),
    voidPlugin(),
    voidReact({ react: { compiler: true } }),
  ],
});
