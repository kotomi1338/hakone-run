import Phaser from "phaser";
import { COURSE_CONFIG, RUN_CONFIG, type SectionConfig } from "./config";
import { bindGameKeys, formatTime } from "./input";
import { FONT, GAME_HEIGHT, GAME_WIDTH, TEXT_COLOR } from "./layout";
import { Race, STAGE_NAMES } from "./race";
import { Runner } from "./runner";

const GROUND_Y = 400;
/** 進む方向の反対側の端からランナーまでの距離（ピクセル） */
const RUNNER_MARGIN_X = 240;
const RUNNER_SIZE = 48;
/** 最高速度のとき画面が1秒に流れるピクセル数（縮尺を変えても見た目の速さは一定） */
const MAX_SCROLL_PX_PER_SEC = 1000;
/** 距離表示どうしの最小間隔（ピクセル） */
const MIN_LABEL_GAP_PX = 160;
/** 表示用の速度（最高速度のときの km/h） */
const DISPLAY_TOP_KMH = 21;
/** 中継所に着いてから次の区間が始まるまで（ミリ秒） */
const RELAY_PAUSE_MS = 1500;

type State = "ready" | "running" | "arrived";

export interface RunSceneData {
  race?: Race;
  /** true ならスペース待ちをせず、すぐに区間をスタートする（襷リレー後など） */
  autoStart?: boolean;
}

export class RunScene extends Phaser.Scene {
  private race!: Race;
  private section!: SectionConfig;
  private autoStart = false;
  private runner!: Runner;
  private state: State = "ready";
  private startedAt = 0;
  private arrivedAt = 0;
  private runPhase = 0;
  /** 進む向き。往路は左から右（右向き）なので +1、復路は右から左なので -1 */
  private dir: 1 | -1 = 1;

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

  init(data: RunSceneData): void {
    this.race = data.race ?? new Race();
    this.section = this.race.section;
    this.autoStart = data.autoStart ?? false;
  }

  create(): void {
    this.runner = new Runner(RUN_CONFIG, this.section);
    this.state = "ready";
    this.runPhase = 0;
    this.dir = this.race.stage === 1 ? 1 : -1;

    this.cameras.main.setBackgroundColor("#bfe3ff");
    this.bg = this.add.graphics();
    this.road = this.add.graphics();
    this.kmLabels = Array.from({ length: 8 }, () =>
      this.add
        .text(0, GROUND_Y + 92, "", { fontFamily: FONT, fontSize: "18px", color: "#ffffff" })
        .setOrigin(0.5, 0),
    );
    const goalName = this.race.isStageLastSection ? `${this.section.to} ゴール` : `${this.section.to}中継所`;
    this.goalLabel = this.add
      .text(0, GROUND_Y - 150, goalName, {
        fontFamily: FONT,
        fontSize: "22px",
        color: "#ffffff",
        backgroundColor: "#c0392b",
        padding: { x: 10, y: 4 },
      })
      .setOrigin(0.5, 1);

    this.runnerRect = this.add
      .rectangle(this.runnerX, GROUND_Y, RUNNER_SIZE, RUNNER_SIZE, 0x1e5bd8)
      .setOrigin(0.5, 1)
      .setStrokeStyle(3, 0x0b2a6b);

    this.progressBar = this.add.graphics();
    this.add.text(24, 12, STAGE_NAMES[this.race.stage], {
      fontFamily: FONT,
      fontSize: "15px",
      color: TEXT_COLOR,
    });
    this.add.text(24, 32, `${this.section.no}区  ${this.section.from} → ${this.section.to}（${this.section.distanceKm}km）`, {
      fontFamily: FONT,
      fontSize: "22px",
      color: TEXT_COLOR,
      fontStyle: "bold",
    });
    this.hud = this.add.text(24, 70, "", {
      fontFamily: FONT,
      fontSize: "18px",
      color: TEXT_COLOR,
      lineSpacing: 6,
    });

    this.centerText = this.add
      .text(GAME_WIDTH / 2, 200, "スペースキーを連打してスタート！", {
        fontFamily: FONT,
        fontSize: "36px",
        color: TEXT_COLOR,
        fontStyle: "bold",
        stroke: "#ffffff",
        strokeThickness: 6,
      })
      .setOrigin(0.5);
    this.subText = this.add
      .text(GAME_WIDTH / 2, 250, "速く連打するほど速く走る。でも連打しすぎると転ぶ", {
        fontFamily: FONT,
        fontSize: "20px",
        color: TEXT_COLOR,
        stroke: "#ffffff",
        strokeThickness: 4,
      })
      .setOrigin(0.5);

    bindGameKeys(this, {
      onSpace: (now) => {
        if (this.state === "ready") this.start(now);
        if (this.state === "running") this.runner.tap(now);
      },
    });

    if (this.autoStart) this.start(performance.now());

    this.drawWorld();
    this.drawHud(performance.now());
  }

  /** ランナーの画面上の位置。進む方向の反対側に寄せて、前方が見えるようにする */
  private get runnerX(): number {
    return this.dir === 1 ? RUNNER_MARGIN_X : GAME_WIDTH - RUNNER_MARGIN_X;
  }

  /** 右向き（往路）で計算した x を、復路なら左右反転する。w は矩形の幅 */
  private mx(x: number, w = 0): number {
    return this.dir === 1 ? x : GAME_WIDTH - x - w;
  }

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
      if (this.runner.finished) this.arrive(now);
    }

    const fallen = this.runner.isFallen(now);
    this.runPhase += this.runner.speedRatio * delta * 0.03;
    const bob = fallen ? 0 : Math.abs(Math.sin(this.runPhase)) * 10 * this.runner.speedRatio;
    this.runnerRect.y = GROUND_Y - bob;
    this.runnerRect.angle = (fallen ? 90 : this.runner.speedRatio * 12) * this.dir;
    this.runnerRect.fillColor = fallen ? 0xd84b1e : 0x1e5bd8;

    this.drawWorld();
    this.drawHud(now);
  }

  /** 中継所（またはゴール）に着いた。タイムを記録して、少し待ってから次へ */
  private arrive(now: number): void {
    this.state = "arrived";
    this.arrivedAt = now;
    const time = this.arrivedAt - this.startedAt;
    this.race.recordSection(time);

    const next = this.race.nextSection;
    if (this.race.isStageLastSection) {
      const label = this.race.stage === 1 ? "往路ゴール！" : "総合ゴール！";
      this.centerText.setText(`${this.section.to} ${label}`).setVisible(true);
    } else if (next) {
      this.centerText.setText(`襷リレー！  ${this.section.no}区 → ${next.no}区`).setVisible(true);
    }
    this.subText
      .setText(`区間タイム ${formatTime(time)}   連打 ${this.runner.tapCount}回 / 転倒 ${this.runner.fallCount}回`)
      .setVisible(true);

    this.time.delayedCall(RELAY_PAUSE_MS, () => {
      if (this.race.isStageLastSection) {
        this.scene.start("StageResultScene", { race: this.race });
      } else {
        this.race.advance();
        this.scene.restart({ race: this.race, autoStart: true } satisfies RunSceneData);
      }
    });
  }

  private drawWorld(): void {
    // 画面上で 1km を何ピクセルで描くか（管理画面で縮尺を変えるとその場で変わる）
    const pxPerKm = MAX_SCROLL_PX_PER_SEC * COURSE_CONFIG.secondsPerKm;
    const offsetPx = this.runner.distanceKm * pxPerKm;

    // 以下は右向き（往路）として位置を計算し、mx() で復路のときは左右反転する
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
      g.fillRect(this.mx(x, bw - 8), GROUND_Y - h, bw - 8, h);
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
      r.fillRect(this.mx(i * dash - offsetPx, dash / 2), GROUND_Y + 66, dash / 2, 6);
    }

    // 距離表示（スタートからの km）
    const stepKm = Math.max(1, Math.ceil(MIN_LABEL_GAP_PX / pxPerKm));
    const firstKm = Math.floor((offsetPx - RUNNER_MARGIN_X) / pxPerKm / stepKm) * stepKm;
    this.kmLabels.forEach((label, idx) => {
      const km = firstKm + idx * stepKm;
      const x = this.mx(km * pxPerKm - offsetPx + RUNNER_MARGIN_X);
      const visible = km > 0 && km < this.section.distanceKm && x > -50 && x < GAME_WIDTH + 50;
      label.setVisible(visible);
      if (!visible) return;
      label.setText(`${km}km`).setX(x);
      r.fillStyle(0xffffff).fillRect(x - 2, GROUND_Y + 20, 4, 70);
    });

    // ゴール（中継所）
    const goalX = this.mx(this.section.distanceKm * pxPerKm - offsetPx + RUNNER_MARGIN_X);
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
      this.state === "ready" ? 0 : (this.state === "arrived" ? this.arrivedAt : now) - this.startedAt;
    // 総合タイム：記録済みの区間 + 今の区間（着いた後は記録済みに含まれる）
    const total = this.race.totalMs() + (this.state === "running" ? elapsed : 0);
    const remain = Math.max(0, this.section.distanceKm - this.runner.distanceKm);
    const kmh = this.runner.speedRatio * DISPLAY_TOP_KMH;
    const lastTapAt = this.runner.lastTapAt;
    const sinceLast = this.state === "running" && lastTapAt !== null ? now - lastTapAt : null;
    const fallen = this.runner.isFallen(now);

    this.hud.setText([
      `区間タイム  ${formatTime(elapsed)}    総合  ${formatTime(total)}`,
      `残り  ${remain.toFixed(2)} km`,
      `速度  ${kmh.toFixed(1)} km/h${fallen ? "   転倒！" : ""}`,
      `前回から  ${sinceLast === null ? "-" : `${(sinceLast / 1000).toFixed(2)} 秒`}${
        this.runner.fastStreak > 0 && !fallen ? "   押しすぎ注意！" : ""
      }`,
    ]);

    // 進捗バー（進む向きに合わせて伸ばす）
    const p = this.progressBar;
    const x = GAME_WIDTH - 324;
    const y = 24;
    const w = 300;
    const filled = Math.max(14, (w * this.runner.distanceKm) / this.section.distanceKm);
    p.clear();
    p.fillStyle(0xffffff, 0.8).fillRoundedRect(x, y, w, 14, 7);
    p.fillStyle(0x1e5bd8).fillRoundedRect(this.dir === 1 ? x : x + w - filled, y, filled, 14, 7);

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
