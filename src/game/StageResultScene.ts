import Phaser from "phaser";
import { createTextures } from "./art/textures";
import { bindGameKeys, formatTime } from "./input";
import { FONT, GAME_HEIGHT, GAME_WIDTH, TEXT_COLOR } from "./layout";
import { Race, sectionsOfStage, STAGE_NAMES, type Stage } from "./race";
import type { RunSceneData } from "./RunScene";
import type { SectionBreakdown } from "./score";
import { Effects } from "./view/effects";

export interface StageResultSceneData {
  race: Race;
}

/** 行が順に出てくる間隔（ミリ秒） */
const ROW_DELAY_MS = 90;

/** 往路ゴール（5区の後）と総合ゴール（10区の後）の結果画面 */
export class StageResultScene extends Phaser.Scene {
  private race!: Race;
  private rowIndex = 0;

  constructor() {
    super("StageResultScene");
  }

  init(data: StageResultSceneData): void {
    this.race = data.race;
    this.rowIndex = 0;
  }

  create(): void {
    createTextures(this);
    const final = this.race.isFinished;
    const stage = this.race.stage;
    const breakdown = this.race.breakdown();
    this.registry.set("race", this.race);

    // 背景：空と富士山、結果を載せる紙
    this.add.image(0, 0, "sky").setOrigin(0, 0).setDisplaySize(GAME_WIDTH, GAME_HEIGHT);
    this.add.image(GAME_WIDTH - 150, GAME_HEIGHT - 20, "fuji").setOrigin(0.5, 1).setAlpha(0.6);
    const paper = this.add.graphics();
    paper.fillStyle(0x10243e, 0.18).fillRoundedRect(34, 30, GAME_WIDTH - 60, GAME_HEIGHT - 52, 18);
    paper.fillStyle(0xf8f3e6, 0.97).fillRoundedRect(28, 24, GAME_WIDTH - 60, GAME_HEIGHT - 52, 18);

    // 手を振るランナー
    const runner = this.add.sprite(96, GAME_HEIGHT - 40, "runner", "wave").setOrigin(0.5, 1).setScale(1.5);
    this.time.addEvent({
      delay: 300,
      loop: true,
      callback: () => runner.setFrame(runner.frame.name === "wave" ? "stand" : "wave"),
    });

    const title = final ? "総合ゴール  大手町" : "往路ゴール  芦ノ湖";
    const titleText = this.add
      .text(GAME_WIDTH / 2, 70, title, { fontFamily: FONT, fontSize: "40px", color: "#c0392b", fontStyle: "bold" })
      .setOrigin(0.5)
      .setScale(0.3);
    this.tweens.add({ targets: titleText, scale: 1, duration: 350, ease: "Back.Out" });

    // 合計ポイント（数え上げる）
    const pointsText = this.add
      .text(GAME_WIDTH - 48, 42, "0 pt", { fontFamily: FONT, fontSize: "28px", color: TEXT_COLOR, fontStyle: "bold" })
      .setOrigin(1, 0);

    // 区間タイムとポイントの一覧
    const stages: Stage[] = final ? [1, 2] : [stage];
    stages.forEach((s, col) => {
      const x = stages.length === 1 ? GAME_WIDTH / 2 - 210 : 50 + col * 450;
      this.drawStageTable(s, x, 112, breakdown.sections);
    });

    const summary = final
      ? `往路 ${formatTime(this.race.totalMs(1))}   復路 ${formatTime(this.race.totalMs(2))}   総合 ${formatTime(this.race.totalMs())}`
      : `往路 合計 ${formatTime(this.race.totalMs(1))}`;
    this.reveal(
      this.add
        .text(GAME_WIDTH / 2, 362, summary, { fontFamily: FONT, fontSize: "26px", color: TEXT_COLOR, fontStyle: "bold" })
        .setOrigin(0.5, 0),
    );
    const pointLine = this.add
      .text(GAME_WIDTH / 2, 404, "", { fontFamily: FONT, fontSize: "26px", color: "#b8860b", fontStyle: "bold" })
      .setOrigin(0.5, 0);
    this.reveal(pointLine);

    const counter = { value: 0 };
    const linePrefix = final
      ? `全区間ボーナス ${breakdown.fullRelayBonus > 0 ? `+${breakdown.fullRelayBonus.toLocaleString()}` : "なし"}   最終ポイント `
      : "ここまでのポイント ";
    const showCount = () => {
      const v = Math.round(counter.value).toLocaleString();
      pointsText.setText(`${v} pt`);
      pointLine.setText(`${linePrefix}${v} pt`);
    };
    showCount();
    this.tweens.add({
      targets: counter,
      value: breakdown.total,
      delay: ROW_DELAY_MS * this.rowIndex,
      duration: 1200,
      ease: "Cubic.Out",
      onUpdate: showCount,
      onComplete: () => {
        showCount();
        this.tweens.add({ targets: [pointLine, pointsText], scale: 1.12, duration: 160, yoyo: true });
      },
    });

    const hint = final ? "Enterで1区からもう一度" : "Enterで復路（6区 芦ノ湖）スタート";
    const hintText = this.add
      .text(GAME_WIDTH / 2, 466, hint, { fontFamily: FONT, fontSize: "22px", color: "#c0392b", fontStyle: "bold" })
      .setOrigin(0.5, 0);
    this.tweens.add({ targets: hintText, alpha: 0.35, duration: 700, yoyo: true, repeat: -1, ease: "Sine.InOut" });

    // 紙吹雪（総合ゴールは盛大に）
    const effects = new Effects(this);
    const bursts = final ? 6 : 2;
    for (let i = 0; i < bursts; i++) {
      this.time.delayedCall(200 + i * 450, () => effects.confetti(120 + ((i * 260) % (GAME_WIDTH - 240)), 40, final ? 60 : 40));
    }

    bindGameKeys(this, {
      onEnter: () => {
        if (final) {
          this.scene.start("RunScene", { race: new Race() } satisfies RunSceneData);
        } else {
          this.race.advance();
          this.scene.start("RunScene", { race: this.race, autoStart: true } satisfies RunSceneData);
        }
      },
    });
  }

  /** 文字を、順番に横から滑り込ませて表示する */
  private reveal(text: Phaser.GameObjects.Text): void {
    const x = text.x;
    text.setAlpha(0).setX(x + 24);
    this.tweens.add({ targets: text, alpha: 1, x, delay: ROW_DELAY_MS * this.rowIndex++, duration: 260, ease: "Quad.Out" });
  }

  private drawStageTable(stage: Stage, x: number, y: number, sections: SectionBreakdown[]): void {
    const style = { fontFamily: FONT, fontSize: "20px", color: TEXT_COLOR };
    this.reveal(this.add.text(x, y, STAGE_NAMES[stage], { ...style, fontStyle: "bold" }));
    sectionsOfStage(stage).forEach((s, i) => {
      const time = this.race.sectionTimesMs[s.no - 1];
      const score = sections.find((b) => b.no === s.no);
      const row = `${String(s.no).padStart(2, " ")}区  ${s.from} → ${s.to}`;
      const rowY = y + 36 + i * 40;
      this.reveal(this.add.text(x, rowY, row, style));
      this.reveal(this.add.text(x + 300, rowY, time === null ? "-" : formatTime(time), style).setOrigin(1, 0));
      this.reveal(this.add.text(x + 420, rowY, score ? `${score.total.toLocaleString()} pt` : "-", style).setOrigin(1, 0));
    });
  }
}
