// 演出：キラキラ、紙吹雪、土ぼこり、水しぶき、大きな文字のポップ、物が飛んでいく動き、スピード線。

import Phaser from "phaser";
import { FONT, GAME_HEIGHT, GAME_WIDTH } from "../layout";

export const EFFECT_DEPTH = 50;
/** 大きな文字は HUD（画面の表示）より手前に出す */
const BIG_TEXT_DEPTH = 120;
const CONFETTI_COLORS = [0xe74c3c, 0xf1c40f, 0x2ecc71, 0x3498db, 0x9b59b6, 0xff7a00];

export class Effects {
  private readonly scene: Phaser.Scene;
  private readonly spark: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly confettiEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly dustEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly splashEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly streaks: Phaser.GameObjects.Image[];

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.spark = scene.add
      .particles(0, 0, "spark", {
        speed: { min: 120, max: 340 },
        angle: { min: 0, max: 360 },
        scale: { start: 1.1, end: 0 },
        rotate: { min: 0, max: 360 },
        lifespan: 650,
        gravityY: 250,
        emitting: false,
      })
      .setDepth(EFFECT_DEPTH);
    this.confettiEmitter = scene.add
      .particles(0, 0, "dot", {
        speed: { min: 150, max: 420 },
        angle: { min: 220, max: 320 },
        scaleX: { min: 0.5, max: 1.2 },
        scaleY: { min: 0.3, max: 0.7 },
        rotate: { min: 0, max: 360 },
        lifespan: 1400,
        gravityY: 420,
        tint: CONFETTI_COLORS,
        emitting: false,
      })
      .setDepth(EFFECT_DEPTH);
    this.dustEmitter = scene.add
      .particles(0, 0, "dot", {
        speed: { min: 30, max: 110 },
        angle: { min: 190, max: 350 },
        scale: { start: 1.6, end: 0.2 },
        alpha: { start: 0.7, end: 0 },
        lifespan: 700,
        tint: 0xb9a88f,
        emitting: false,
      })
      .setDepth(EFFECT_DEPTH);
    this.splashEmitter = scene.add
      .particles(0, 0, "dot", {
        speed: { min: 80, max: 220 },
        angle: { min: 200, max: 340 },
        scale: { start: 0.9, end: 0.2 },
        lifespan: 600,
        gravityY: 500,
        tint: [0x4aa3ff, 0xbfe3ff, 0xffffff],
        emitting: false,
      })
      .setDepth(EFFECT_DEPTH);
    this.streaks = Array.from({ length: 14 }, () =>
      scene.add.image(0, 0, "streak").setDepth(EFFECT_DEPTH - 1).setVisible(false),
    );
  }

  sparkle(x: number, y: number, count = 14, tint = 0xffe066): void {
    this.spark.setParticleTint(tint);
    this.spark.explode(count, x, y);
  }

  confetti(x: number, y: number, count = 40): void {
    this.confettiEmitter.explode(count, x, y);
  }

  dust(x: number, y: number, count = 12): void {
    this.dustEmitter.explode(count, x, y);
  }

  splash(x: number, y: number, count = 16): void {
    this.splashEmitter.explode(count, x, y);
  }

  /** 大きな文字がポンと出て、少し上に浮いて消える */
  bigText(text: string, x: number, y: number, color: string, size = 40): void {
    const t = this.scene.add
      .text(x, y, text, {
        fontFamily: FONT,
        fontSize: `${size}px`,
        color,
        fontStyle: "bold",
        stroke: "#ffffff",
        strokeThickness: 7,
      })
      .setOrigin(0.5)
      .setDepth(BIG_TEXT_DEPTH)
      .setScale(0.3);
    this.scene.tweens.add({ targets: t, scale: 1, duration: 220, ease: "Back.Out" });
    this.scene.tweens.add({
      targets: t,
      y: y - 36,
      alpha: 0,
      delay: 650,
      duration: 450,
      onComplete: () => t.destroy(),
    });
  }

  /** 画像を (fromX, fromY) から (toX, toY) へ放物線を描いて飛ばす */
  fly(texture: string, fromX: number, fromY: number, toX: number, toY: number, durationMs = 550, onDone?: () => void): void {
    const img = this.scene.add.image(fromX, fromY, texture).setDepth(EFFECT_DEPTH + 1);
    const arc = Math.min(160, Math.abs(toX - fromX) * 0.4 + 60);
    const state = { t: 0 };
    this.scene.tweens.add({
      targets: state,
      t: 1,
      duration: durationMs,
      ease: "Sine.InOut",
      onUpdate: () => {
        const t = state.t;
        img.setPosition(fromX + (toX - fromX) * t, fromY + (toY - fromY) * t - Math.sin(t * Math.PI) * arc);
        img.setAngle(t * 360);
        img.setScale(1 + Math.sin(t * Math.PI) * 0.5);
      },
      onComplete: () => {
        img.destroy();
        onDone?.();
      },
    });
  }

  /**
   * スピード線：速さ（平地の最高速度を 1）が 1 を超えると、進む向きと逆に白い線が流れる。
   * dir は進む向き
   */
  updateStreaks(speed: number, dir: 1 | -1, timeMs: number): void {
    const strength = Phaser.Math.Clamp((speed - 1.02) / 0.4, 0, 1);
    this.streaks.forEach((s, i) => {
      if (strength <= 0) {
        s.setVisible(false);
        return;
      }
      const lane = (i * 0.618) % 1;
      const y = 60 + lane * (GAME_HEIGHT - 140);
      const speedPx = 1.2 + lane;
      const x = GAME_WIDTH - (((timeMs * speedPx + i * 173) % (GAME_WIDTH + 200)) - 100);
      s.setVisible(true)
        .setPosition(dir === 1 ? x : GAME_WIDTH - x, y)
        .setFlipX(dir === -1)
        .setScale(1 + lane * 2, 1)
        .setAlpha(strength * (0.25 + lane * 0.35));
    });
  }
}
