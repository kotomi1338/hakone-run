import Phaser from "phaser";
import { bindGameKeys, formatTime } from "./input";
import { FONT, GAME_WIDTH, TEXT_COLOR } from "./layout";
import { Race, sectionsOfStage, STAGE_NAMES, type Stage } from "./race";
import type { RunSceneData } from "./RunScene";

export interface StageResultSceneData {
  race: Race;
}

/** 往路ゴール（5区の後）と総合ゴール（10区の後）の結果画面 */
export class StageResultScene extends Phaser.Scene {
  private race!: Race;

  constructor() {
    super("StageResultScene");
  }

  init(data: StageResultSceneData): void {
    this.race = data.race;
  }

  create(): void {
    const final = this.race.isFinished;
    const stage = this.race.stage;
    this.cameras.main.setBackgroundColor("#f4efe2");

    const title = final ? "総合ゴール  大手町" : "往路ゴール  芦ノ湖";
    this.add
      .text(GAME_WIDTH / 2, 48, title, { fontFamily: FONT, fontSize: "40px", color: TEXT_COLOR, fontStyle: "bold" })
      .setOrigin(0.5, 0);

    // 区間タイムの一覧。総合ゴールでは往路・復路を左右に並べる
    const stages: Stage[] = final ? [1, 2] : [stage];
    stages.forEach((s, col) => {
      const x = stages.length === 1 ? GAME_WIDTH / 2 - 170 : 110 + col * 400;
      this.drawStageTable(s, x, 130);
    });

    const summary = final
      ? `往路 ${formatTime(this.race.totalMs(1))}   復路 ${formatTime(this.race.totalMs(2))}   総合 ${formatTime(this.race.totalMs())}`
      : `往路 合計 ${formatTime(this.race.totalMs(1))}`;
    this.add
      .text(GAME_WIDTH / 2, 400, summary, { fontFamily: FONT, fontSize: "28px", color: TEXT_COLOR, fontStyle: "bold" })
      .setOrigin(0.5, 0);

    const hint = final ? "Enterで1区からもう一度" : "Enterで復路（6区 芦ノ湖）スタート";
    this.add
      .text(GAME_WIDTH / 2, 470, hint, { fontFamily: FONT, fontSize: "22px", color: "#c0392b" })
      .setOrigin(0.5, 0);

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

  private drawStageTable(stage: Stage, x: number, y: number): void {
    this.add.text(x, y, STAGE_NAMES[stage], { fontFamily: FONT, fontSize: "20px", color: TEXT_COLOR, fontStyle: "bold" });
    sectionsOfStage(stage).forEach((s, i) => {
      const time = this.race.sectionTimesMs[s.no - 1];
      const row = `${String(s.no).padStart(2, " ")}区  ${s.from} → ${s.to}`;
      const rowY = y + 36 + i * 40;
      this.add.text(x, rowY, row, { fontFamily: FONT, fontSize: "20px", color: TEXT_COLOR });
      this.add
        .text(x + 340, rowY, time === null ? "-" : formatTime(time), { fontFamily: FONT, fontSize: "20px", color: TEXT_COLOR })
        .setOrigin(1, 0);
    });
  }
}
