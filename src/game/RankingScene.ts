import Phaser from "phaser";
import { createTextures } from "./art/textures";
import { playSe, preloadSounds } from "./audio";
import { bindGameKeys, formatTime } from "./input";
import { FONT, GAME_HEIGHT, GAME_WIDTH, TEXT_COLOR } from "./layout";
import { Race } from "./race";
import { fetchRankings, type RankedEntry } from "./rankingApi";
import type { RunSceneData } from "./RunScene";
import { Effects } from "./view/effects";

export interface RankingSceneData {
  /** いま登録した記録（あれば強調して表示する） */
  highlight?: RankedEntry;
}

/** 画面に並べる上位の件数 */
const TOP_COUNT = 10;
const ROW_H = 27;
const COLS = { rank: 150, name: 210, points: 640, time: 800 };

/** ランキング画面：ポイントの多い順 → タイムの速い順 → 先に登録した順 */
export class RankingScene extends Phaser.Scene {
  private highlight?: RankedEntry;

  constructor() {
    super("RankingScene");
  }

  init(data: RankingSceneData): void {
    this.highlight = data.highlight;
  }

  preload(): void {
    preloadSounds(this);
  }

  create(): void {
    createTextures(this);
    this.add.image(0, 0, "sky").setOrigin(0, 0).setDisplaySize(GAME_WIDTH, GAME_HEIGHT);
    const paper = this.add.graphics();
    paper.fillStyle(0x10243e, 0.18).fillRoundedRect(34, 30, GAME_WIDTH - 60, GAME_HEIGHT - 52, 18);
    paper.fillStyle(0xf8f3e6, 0.97).fillRoundedRect(28, 24, GAME_WIDTH - 60, GAME_HEIGHT - 52, 18);

    this.add
      .text(GAME_WIDTH / 2, 58, "ランキング", { fontFamily: FONT, fontSize: "36px", color: "#c0392b", fontStyle: "bold" })
      .setOrigin(0.5);

    const status = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2, "読み込み中…", { fontFamily: FONT, fontSize: "22px", color: TEXT_COLOR })
      .setOrigin(0.5);

    if (this.highlight) {
      this.add
        .text(GAME_WIDTH / 2, 94, `${this.highlight.name} さんは ${this.highlight.rank}位 で登録されました！`, {
          fontFamily: FONT,
          fontSize: "18px",
          color: "#b8860b",
          fontStyle: "bold",
        })
        .setOrigin(0.5);
      new Effects(this).confetti(GAME_WIDTH / 2, 60, 50);
    }

    const hint = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT - 52, "Enterでタイトルへ", { fontFamily: FONT, fontSize: "20px", color: "#c0392b", fontStyle: "bold" })
      .setOrigin(0.5);
    this.tweens.add({ targets: hint, alpha: 0.35, duration: 700, yoyo: true, repeat: -1, ease: "Sine.InOut" });

    bindGameKeys(this, {
      onEnter: () => {
        playSe(this, "click");
        this.scene.start("RunScene", { race: new Race() } satisfies RunSceneData);
      },
    });

    fetchRankings(TOP_COUNT)
      .then(({ entries, total }) => {
        if (!this.scene.isActive()) return;
        status.destroy();
        this.drawTable(entries, total);
      })
      .catch(() => {
        if (!this.scene.isActive()) return;
        status.setText("ランキングを読み込めませんでした");
      });
  }

  private drawTable(entries: RankedEntry[], total: number): void {
    const top = 126;
    const head = { fontFamily: FONT, fontSize: "16px", color: "#6b7a8f", fontStyle: "bold" };
    this.add.text(COLS.rank, top, "順位", head).setOrigin(1, 0);
    this.add.text(COLS.name, top, "名前", head);
    this.add.text(COLS.points, top, "ポイント", head).setOrigin(1, 0);
    this.add.text(COLS.time, top, "タイム", head).setOrigin(1, 0);
    this.add.text(GAME_WIDTH - 60, 50, `全${total}件`, { fontFamily: FONT, fontSize: "16px", color: "#6b7a8f" }).setOrigin(1, 0.5);

    if (entries.length === 0) {
      this.add
        .text(GAME_WIDTH / 2, GAME_HEIGHT / 2, "まだ記録がありません", { fontFamily: FONT, fontSize: "22px", color: TEXT_COLOR })
        .setOrigin(0.5);
      return;
    }

    const rows: (RankedEntry | null)[] = [...entries];
    // いま登録した記録が上位に入っていなければ、「…」のあとに自分の行を出す
    if (this.highlight && !entries.some((e) => e.id === this.highlight?.id)) rows.push(null, this.highlight);

    rows.forEach((entry, i) => {
      const y = top + 28 + i * ROW_H;
      if (entry === null) {
        this.add.text(GAME_WIDTH / 2, y, "…", { fontFamily: FONT, fontSize: "18px", color: TEXT_COLOR }).setOrigin(0.5, 0);
        return;
      }
      const mine = entry.id === this.highlight?.id;
      if (mine) {
        const band = this.add.graphics();
        band.fillStyle(0xffe08a, 0.8).fillRoundedRect(COLS.rank - 70, y - 3, COLS.time - COLS.rank + 100, ROW_H - 2, 6);
        this.tweens.add({ targets: band, alpha: 0.4, duration: 600, yoyo: true, repeat: -1 });
      }
      const medal = ["#d4a017", "#9aa5b1", "#b0703c"][entry.rank - 1];
      const style = {
        fontFamily: FONT,
        fontSize: "19px",
        color: medal ?? TEXT_COLOR,
        fontStyle: mine || medal ? "bold" : "normal",
      };
      const nameStyle = { ...style, color: TEXT_COLOR };
      const cells = [
        this.add.text(COLS.rank, y, `${entry.rank}位`, style).setOrigin(1, 0),
        this.add.text(COLS.name, y, entry.name, nameStyle),
        this.add.text(COLS.points, y, `${entry.points.toLocaleString()} pt`, nameStyle).setOrigin(1, 0),
        this.add.text(COLS.time, y, formatTime(entry.timeMs), nameStyle).setOrigin(1, 0),
      ];
      // 上から順に滑り込ませる
      for (const c of cells) {
        const x = c.x;
        c.setAlpha(0).setX(x + 20);
        this.tweens.add({ targets: c, alpha: 1, x, delay: i * 60, duration: 240, ease: "Quad.Out" });
      }
    });
  }
}
