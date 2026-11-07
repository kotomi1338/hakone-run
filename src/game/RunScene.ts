import Phaser from "phaser";
import { COURSE_CONFIG, RUN_CONFIG, SECTIONS, type SectionConfig } from "./config";
import { Runner } from "./runner";

export const GAME_WIDTH = 960;
export const GAME_HEIGHT = 540;

const FONT = '"Hiragino Sans", "Noto Sans JP", "Yu Gothic", sans-serif';
const GROUND_Y = 400;
const RUNNER_X = 240;
const RUNNER_SIZE = 48;
/** 最高速度のとき画面が1秒に流れるピクセル数（縮尺を変えても見た目の速さは一定） */
const MAX_SCROLL_PX_PER_SEC = 1000;
/** 距離表示どうしの最小間隔（ピクセル） */
const MIN_LABEL_GAP_PX = 160;
/** 表示用の速度（最高速度のときの km/h） */
const DISPLAY_TOP_KMH = 21;

type State = "ready" | "running" | "finished";

export class RunScene extends Phaser.Scene {
  private section: SectionConfig = SECTIONS[0];
  private runner!: Runner;
  private state: State = "ready";
  private startedAt = 0;
  private finishedAt = 0;
  private runPhase = 0;

  private bg!: Phaser.GameObjects.Graphics;
  private road!: Phaser.GameObjects.Graphics;
  private kmLabels: Phaser.GameObjects.Text[] = [];
  private goalLabel!: Phaser.GameObjects.Text;
  private runnerRect!: Phaser.GameObjects.Rectangle;
  private hud!: Phaser.GameObjects.Text;
  private progressBar!: Phaser.GameObjects.Graphics;
  private centerText!: Phaser.GameObjects.Text;
  private subText!: Phaser.GameObjects.Text;

  constructor() {
    super("RunScene");
  }

  create(): void {
    this.runner = new Runner(RUN_CONFIG, this.section);
    this.state = "ready";
    this.runPhase = 0;

    this.cameras.main.setBackgroundColor("#bfe3ff");
    this.bg = this.add.graphics();
    this.road = this.add.graphics();
    this.kmLabels = Array.from({ length: 8 }, () =>
      this.add
        .text(0, GROUND_Y + 92, "", { fontFamily: FONT, fontSize: "18px", color: "#ffffff" })
        .setOrigin(0.5, 0),
    );
    this.goalLabel = this.add
      .text(0, GROUND_Y - 150, `${this.section.to}中継所`, {
        fontFamily: FONT,
        fontSize: "22px",
        color: "#ffffff",
        backgroundColor: "#c0392b",
        padding: { x: 10, y: 4 },
      })
      .setOrigin(0.5, 1);

    this.runnerRect = this.add
      .rectangle(RUNNER_X, GROUND_Y, RUNNER_SIZE, RUNNER_SIZE, 0x1e5bd8)
      .setOrigin(0.5, 1)
      .setStrokeStyle(3, 0x0b2a6b);

    this.progressBar = this.add.graphics();
    this.hud = this.add.text(24, 56, "", {
      fontFamily: FONT,
      fontSize: "18px",
      color: "#10243e",
      lineSpacing: 6,
    });
    this.add.text(24, 16, `${this.section.no}区  ${this.section.from} → ${this.section.to}（${this.section.distanceKm}km）`, {
      fontFamily: FONT,
      fontSize: "22px",
      color: "#10243e",
      fontStyle: "bold",
    });

    this.centerText = this.add
      .text(GAME_WIDTH / 2, 190, "スペースキーを連打してスタート！", {
        fontFamily: FONT,
        fontSize: "36px",
        color: "#10243e",
        fontStyle: "bold",
        stroke: "#ffffff",
        strokeThickness: 6,
      })
      .setOrigin(0.5);
    this.subText = this.add
      .text(GAME_WIDTH / 2, 240, "速く連打するほど速く走る。でも連打しすぎると転ぶ", {
        fontFamily: FONT,
        fontSize: "20px",
        color: "#10243e",
        stroke: "#ffffff",
        strokeThickness: 4,
      })
      .setOrigin(0.5);

    // キー入力は Phaser ではなく window で直接受ける（e.repeat と preventDefault を確実に扱うため）
    window.addEventListener("keydown", this.onKeyDown);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      window.removeEventListener("keydown", this.onKeyDown);
    });

    this.drawWorld();
    this.drawHud(performance.now());
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    // 管理画面などの入力欄に文字を打っているときはゲーム操作として扱わない
    if (isEditableTarget(e.target)) return;

    const isSpace = e.code === "Space";
    const isEnter = e.code === "Enter" || e.code === "NumpadEnter";
    if (!isSpace && !isEnter) return;

    // ページのスクロール防止（押しっぱなしのリピートでもスクロールさせない）
    e.preventDefault();
    // 押しっぱなし対策：キーリピートは連打として数えない
    if (e.repeat) return;

    const now = performance.now();

    if (isSpace) {
      if (this.state === "ready") this.start(now);
      if (this.state === "running") this.runner.tap(now);
    } else if (isEnter && this.state === "finished") {
      this.scene.restart();
    }
  };

  private start(now: number): void {
    this.state = "running";
    this.startedAt = now;
    this.centerText.setVisible(false);
    this.subText.setVisible(false);
  }

  update(_time: number, delta: number): void {
    const now = performance.now();

    if (this.state === "running") {
      this.runner.update(now, delta);
      if (this.runner.finished) this.finish(now);
    }

    const fallen = this.runner.isFallen(now);
    this.runPhase += this.runner.speedRatio * delta * 0.03;
    const bob = fallen ? 0 : Math.abs(Math.sin(this.runPhase)) * 10 * this.runner.speedRatio;
    this.runnerRect.y = GROUND_Y - bob;
    this.runnerRect.angle = fallen ? 90 : this.runner.speedRatio * 12;
    this.runnerRect.fillColor = fallen ? 0xd84b1e : 0x1e5bd8;

    this.drawWorld();
    this.drawHud(now);
  }

  private finish(now: number): void {
    this.state = "finished";
    this.finishedAt = now;
    const time = formatTime(this.finishedAt - this.startedAt);
    this.centerText.setText(`${this.section.to}中継所 到着！  ${time}`).setVisible(true);
    this.subText
      .setText(`連打 ${this.runner.tapCount}回 / 転倒 ${this.runner.fallCount}回    Enterでもう一度`)
      .setVisible(true);
  }

  private drawWorld(): void {
    // 画面上で 1km を何ピクセルで描くか（管理画面で縮尺を変えるとその場で変わる）
    const pxPerKm = MAX_SCROLL_PX_PER_SEC * COURSE_CONFIG.secondsPerKm;
    const offsetPx = this.runner.distanceKm * pxPerKm;

    // 遠景のビル（ゆっくり流れる）
    const g = this.bg;
    g.clear();
    const farOffset = offsetPx * 0.25;
    const bw = 90;
    const first = Math.floor(farOffset / bw);
    for (let i = first; i < first + GAME_WIDTH / bw + 2; i++) {
      const h = 60 + ((i * 7919) % 110);
      const x = i * bw - farOffset;
      g.fillStyle(i % 2 === 0 ? 0x9fbad6 : 0x8aa7c7);
      g.fillRect(x, GROUND_Y - h, bw - 8, h);
    }

    // 道路
    const r = this.road;
    r.clear();
    r.fillStyle(0x6b8e4e).fillRect(0, GROUND_Y, GAME_WIDTH, 20);
    r.fillStyle(0x4a4f57).fillRect(0, GROUND_Y + 20, GAME_WIDTH, 120);
    r.fillStyle(0x3b3f45).fillRect(0, GAME_HEIGHT - 20, GAME_WIDTH, 20);

    // 中央線（手前なので速く流れる）
    const dash = 80;
    const firstDash = Math.floor(offsetPx / dash);
    r.fillStyle(0xf5f5f5);
    for (let i = firstDash; i < firstDash + GAME_WIDTH / dash + 2; i++) {
      r.fillRect(i * dash - offsetPx, GROUND_Y + 66, dash / 2, 6);
    }

    // 1kmごとの距離表示
    const stepKm = Math.max(1, Math.ceil(MIN_LABEL_GAP_PX / pxPerKm));
    const firstKm = Math.floor((offsetPx - RUNNER_X) / pxPerKm / stepKm) * stepKm;
    this.kmLabels.forEach((label, idx) => {
      const km = firstKm + idx * stepKm;
      const x = km * pxPerKm - offsetPx + RUNNER_X;
      const visible = km > 0 && km < this.section.distanceKm && x > -50 && x < GAME_WIDTH + 50;
      label.setVisible(visible);
      if (!visible) return;
      label.setText(`${km}km`).setX(x);
      r.fillStyle(0xffffff).fillRect(x - 2, GROUND_Y + 20, 4, 70);
    });

    // ゴール（中継所）
    const goalX = this.section.distanceKm * pxPerKm - offsetPx + RUNNER_X;
    const goalVisible = goalX > -100 && goalX < GAME_WIDTH + 100;
    this.goalLabel.setVisible(goalVisible).setX(goalX);
    if (goalVisible) {
      r.fillStyle(0xffffff).fillRect(goalX - 3, GROUND_Y + 20, 6, 120);
      r.fillStyle(0x7a3b2e).fillRect(goalX - 70, GROUND_Y - 150, 6, 150);
      r.fillRect(goalX + 64, GROUND_Y - 150, 6, 150);
    }
  }

  private drawHud(now: number): void {
    const elapsed =
      this.state === "ready" ? 0 : (this.state === "finished" ? this.finishedAt : now) - this.startedAt;
    const remain = Math.max(0, this.section.distanceKm - this.runner.distanceKm);
    const kmh = this.runner.speedRatio * DISPLAY_TOP_KMH;
    const lastTapAt = this.runner.lastTapAt;
    const sinceLast = this.state === "running" && lastTapAt !== null ? now - lastTapAt : null;
    const fallen = this.runner.isFallen(now);

    this.hud.setText([
      `タイム  ${formatTime(elapsed)}`,
      `残り  ${remain.toFixed(2)} km`,
      `速度  ${kmh.toFixed(1)} km/h${fallen ? "   転倒！" : ""}`,
      `前回から  ${sinceLast === null ? "-" : `${(sinceLast / 1000).toFixed(2)} 秒`}${
        this.runner.fastStreak > 0 && !fallen ? "   押しすぎ注意！" : ""
      }`,
    ]);

    // 進捗バー
    const p = this.progressBar;
    const x = GAME_WIDTH - 324;
    const y = 24;
    const w = 300;
    p.clear();
    p.fillStyle(0xffffff, 0.8).fillRoundedRect(x, y, w, 14, 7);
    p.fillStyle(0x1e5bd8).fillRoundedRect(x, y, Math.max(14, (w * this.runner.distanceKm) / this.section.distanceKm), 14, 7);

    // 押す間隔ゲージ：前回の連打からの経過時間。赤（早すぎ）を抜けて緑になってから押す
    const gy = 52;
    const gaugeMaxMs = Math.max(RUN_CONFIG.fallIntervalMs * 2, RUN_CONFIG.justIntervalMs * 1.5);
    const toX = (ms: number) => x + (w * Math.min(ms, gaugeMaxMs)) / gaugeMaxMs;
    const okX = toX(RUN_CONFIG.fallIntervalMs);
    p.fillStyle(0xf08a8a).fillRect(x, gy, okX - x, 12);
    p.fillStyle(0x7fd67f).fillRect(okX, gy, x + w - okX, 12);
    // ジャストタイミングの目印
    p.fillStyle(0xf2c400).fillRect(toX(RUN_CONFIG.justIntervalMs) - 1, gy - 2, 3, 16);
    if (sinceLast !== null) {
      p.fillStyle(sinceLast < RUN_CONFIG.fallIntervalMs ? 0xd84b1e : 0x10243e).fillRect(toX(sinceLast) - 2, gy - 4, 4, 20);
    }
  }
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

function formatTime(ms: number): string {
  const total = Math.max(0, ms) / 1000;
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}
