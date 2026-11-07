import Phaser from "phaser";
import { GAME_HEIGHT, GAME_WIDTH, RunScene } from "./RunScene";

export function createGame(parent: HTMLElement): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    backgroundColor: "#bfe3ff",
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    // キー入力は RunScene が window で直接扱う
    input: { keyboard: false },
    scene: [RunScene],
  });
}
