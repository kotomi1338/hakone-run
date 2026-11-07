import { defineHead } from "void";

// Phaser はブラウザでしか動かないので、サーバーでは描画しない
export const ssr = false;

export const head = defineHead(() => ({
  title: "箱根駅伝 連打ラン",
}));
