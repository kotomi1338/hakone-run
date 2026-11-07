import Phaser from "phaser";
import { COURSE_CONFIG, RUN_CONFIG, SCORE_CONFIG, type SectionConfig } from "./config";
import { bindGameKeys, formatTime } from "./input";
import { FONT, GAME_HEIGHT, GAME_WIDTH, TEXT_COLOR } from "./layout";
import { Race, sectionsOfStage, STAGE_NAMES } from "./race";
import { Runner } from "./runner";
import { elevationAt, segmentAt } from "./terrain";
import { SlopeBonus, type SlopeBonusEvent } from "./slopeBonus";
import { ITEM_ACTIONS, ITEM_NAMES, ItemTracker, type ItemKind, type ItemResult } from "./items";
import { judgeRelay, RhythmCombo, sectionMultiplier, type RelayGrade } from "./score";

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
/** ゴール（5区・10区）に着いてから結果画面に移るまで（ミリ秒） */
const GOAL_PAUSE_MS = 1500;
/** 襷リレーの表示を出しておく時間（ミリ秒）。走りは止まらない */
const RELAY_MESSAGE_MS = 1500;
/** 中継線までこのピクセル以内に近づいたら襷ゲージを出し、エンターを受け付ける */
const RELAY_GAUGE_PX = 400;
const RELAY_GRADE_COLORS: Record<RelayGrade, string> = { PERFECT: "#f2a900", GOOD: "#2e9e4f", MISS: "#7a7a7a" };
const ITEM_LABEL_COLORS: Record<ItemKind, string> = { water: "#2e86de", cheer: "#e67e22", egg: "#222222" };

/** エンターで狙うもの（襷 or アイテム）と、そのずれ */
interface TimingTarget {
  /** 目印とのずれ（ピクセル。手前ならプラス、越えた後はマイナス） */
  px: number;
  label: string;
  perfectPx: number;
  goodPx: number;
}

type State = "ready" | "running" | "arrived";

export interface RunSceneData {
  race?: Race;
  /** true ならスペース待ちをせず、すぐに区間をスタートする（復路のスタートなど） */
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
  /** 中継所・ゴールの看板（画面に同時に映るのはせいぜい2つ） */
  private postLabels: Phaser.GameObjects.Text[] = [];
  /** 給水・応援・黒たまごの看板 */
  private itemLabels: Phaser.GameObjects.Text[] = [];
  /** 区間（SECTIONS の添字）ごとのアイテムの取った・取り損ね */
  private itemTrackers = new Map<number, ItemTracker>();
  private sectionTitle!: Phaser.GameObjects.Text;
  private relayMessageTimer?: Phaser.Time.TimerEvent;
  private combo!: RhythmCombo;
  private slopeBonus!: SlopeBonus;
  private slopeText!: Phaser.GameObjects.Text;
  private pointsText!: Phaser.GameObjects.Text;
  private comboText!: Phaser.GameObjects.Text;
  private relayGauge!: Phaser.GameObjects.Graphics;
  private relayGaugeText!: Phaser.GameObjects.Text;
  private popText!: Phaser.GameObjects.Text;
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
    this.combo = new RhythmCombo(RUN_CONFIG, SCORE_CONFIG);
    this.slopeBonus = new SlopeBonus(this.section.no, SCORE_CONFIG);
    this.itemTrackers = new Map();
    // 管理画面のポイント内訳が今のレースを読めるようにする
    this.registry.set("race", this.race);
    this.state = "ready";
    this.runPhase = 0;
    this.ranPrev = false;
    this.dir = this.race.stage === 1 ? 1 : -1;

    this.cameras.main.setBackgroundColor("#bfe3ff");
    this.bg = this.add.graphics();
    this.road = this.add.graphics();
    this.kmLabels = Array.from({ length: 8 }, () =>
      this.add
        .text(0, GROUND_Y + 92, "", { fontFamily: FONT, fontSize: "18px", color: "#ffffff" })
        .setOrigin(0.5, 0),
    );
    this.postLabels = Array.from({ length: 3 }, () =>
      this.add
        .text(0, GROUND_Y - 150, "", {
          fontFamily: FONT,
          fontSize: "22px",
          color: "#ffffff",
          backgroundColor: "#c0392b",
          padding: { x: 10, y: 4 },
        })
        .setOrigin(0.5, 1),
    );
    this.itemLabels = Array.from({ length: 6 }, () =>
      this.add
        .text(0, 0, "", { fontFamily: FONT, fontSize: "15px", color: "#ffffff", padding: { x: 6, y: 2 } })
        .setOrigin(0.5, 1),
    );

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
    this.sectionTitle = this.add.text(24, 32, "", {
      fontFamily: FONT,
      fontSize: "22px",
      color: TEXT_COLOR,
      fontStyle: "bold",
    });
    this.updateSectionTitle();
    this.hud = this.add.text(24, 70, "", {
      fontFamily: FONT,
      fontSize: "18px",
      color: TEXT_COLOR,
      lineSpacing: 6,
    });

    // ポイント（常に表示）
    this.pointsText = this.add
      .text(GAME_WIDTH - 24, 78, "", { fontFamily: FONT, fontSize: "28px", color: TEXT_COLOR, fontStyle: "bold" })
      .setOrigin(1, 0);
    this.comboText = this.add
      .text(GAME_WIDTH - 24, 116, "", { fontFamily: FONT, fontSize: "18px", color: TEXT_COLOR, lineSpacing: 4, align: "right" })
      .setOrigin(1, 0);

    this.slopeText = this.add
      .text(0, GROUND_Y - 80, "", {
        fontFamily: FONT,
        fontSize: "20px",
        color: "#2e9e4f",
        fontStyle: "bold",
        stroke: "#ffffff",
        strokeThickness: 4,
      })
      .setOrigin(0.5, 1)
      .setVisible(false);

    this.relayGauge = this.add.graphics();
    this.relayGaugeText = this.add
      .text(GAME_WIDTH / 2, 116, "Enterで襷を渡す！", {
        fontFamily: FONT,
        fontSize: "20px",
        color: "#c0392b",
        fontStyle: "bold",
        stroke: "#ffffff",
        strokeThickness: 4,
      })
      .setOrigin(0.5, 0)
      .setVisible(false);
    this.popText = this.add
      .text(GAME_WIDTH / 2, 150, "", {
        fontFamily: FONT,
        fontSize: "34px",
        color: "#f2a900",
        fontStyle: "bold",
        stroke: "#ffffff",
        strokeThickness: 6,
      })
      .setOrigin(0.5)
      .setVisible(false);

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
        if (this.state === "running") this.onTap(now);
      },
      onEnter: () => {
        if (this.state === "running") this.onEnterKey();
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

  private onTap(now: number): void {
    const result = this.runner.tap(now);
    if (result === "accepted") {
      const points = this.combo.tap(now);
      if (points > 0) this.race.addRhythm(points, this.combo.combo);
    } else if (result === "fell") {
      this.combo.break();
    }
  }

  /** 画面上で 1km を何ピクセルで描くか（管理画面で縮尺を変えるとその場で変わる） */
  private get pxPerKm(): number {
    return MAX_SCROLL_PX_PER_SEC * COURSE_CONFIG.secondsPerKm;
  }

  /**
   * 襷の判定を待っている中継線とのずれ（ピクセル。手前ならプラス、越えた後はマイナス）。
   * 判定するものがなければ null
   */
  private relayOffset(): { index: number; px: number } | null {
    const i = this.race.sectionIndex;
    // これから越える中継線（ステージ最後の区間はゴールなので襷なし）
    if (!this.race.isStageLastSection && this.race.sectionScores[i]?.relayGrade == null) {
      const px = (this.section.distanceKm - this.runner.distanceKm) * this.pxPerKm;
      if (px <= RELAY_GAUGE_PX) return { index: i, px };
    }
    // 越えたばかりでまだ押していない中継線（前の区間をこのシーンで走ったときだけ）
    const prev = this.race.sectionScores[i - 1];
    if (i > 0 && this.race.sectionTimesMs[i - 1] !== null && prev && prev.relayGrade === null && this.ranPrev) {
      return { index: i - 1, px: -this.runner.distanceKm * this.pxPerKm };
    }
    return null;
  }

  /** このシーンで前の区間から走ってきたか（区間ジャンプ直後は前の中継線の判定をしない） */
  private ranPrev = false;

  /** 今の区間のアイテム管理（なければ作る） */
  private trackerOf(sectionIndex: number): ItemTracker {
    let t = this.itemTrackers.get(sectionIndex);
    if (!t) {
      t = new ItemTracker(sectionIndex + 1, SCORE_CONFIG);
      this.itemTrackers.set(sectionIndex, t);
    }
    return t;
  }

  private get itemTracker(): ItemTracker {
    return this.trackerOf(this.race.sectionIndex);
  }

  /** エンターで狙うもの。襷を優先し、なければ一番手前のアイテム */
  private timingTarget(): TimingTarget | null {
    const relay = this.relayOffset();
    if (relay) {
      return { px: relay.px, label: "Enterで襷を渡す！", perfectPx: SCORE_CONFIG.relayPerfectMs, goodPx: SCORE_CONFIG.relayGoodMs };
    }
    const item = this.itemTracker.target(this.runner.distanceKm, this.pxPerKm, RELAY_GAUGE_PX);
    if (item) {
      return {
        px: item.offsetPx,
        label: ITEM_ACTIONS[item.item.kind],
        perfectPx: SCORE_CONFIG.itemPerfectMs,
        goodPx: SCORE_CONFIG.itemGoodMs,
      };
    }
    return null;
  }

  private onEnterKey(): void {
    const relay = this.relayOffset();
    if (relay) {
      this.judge(relay.index, judgeRelay(relay.px, SCORE_CONFIG));
      return;
    }
    const item = this.itemTracker.target(this.runner.distanceKm, this.pxPerKm, RELAY_GAUGE_PX);
    if (item) this.applyItem(this.itemTracker.press(item));
    // 中継所やアイテムの近く以外でのエンターは何もしない
  }

  private applyItem(result: ItemResult): void {
    const got = result.grade !== "MISS";
    this.race.addItem(result.points, got);
    const name = ITEM_NAMES[result.item.kind];
    if (!got) {
      this.showSmallPop(`${name} 取り損ね`, "#7a7a7a");
      return;
    }
    const mult = sectionMultiplier(this.section.no, SCORE_CONFIG);
    this.showPop(`${name} ${result.grade}!  +${Math.round(result.points * mult)}`, RELAY_GRADE_COLORS[result.grade]);
  }

  private judge(index: number, grade: RelayGrade): void {
    this.race.setRelay(index, grade);
    const points = this.race.sectionScores[index]?.relay ?? 0;
    const mult = sectionMultiplier(index + 1, SCORE_CONFIG);
    this.showPop(grade === "MISS" ? "MISS…" : `${grade}!  +${Math.round(points * mult)}`, RELAY_GRADE_COLORS[grade]);
  }

  private showPop(text: string, color: string): void {
    this.tweens.killTweensOf(this.popText);
    this.popText.setText(text).setColor(color).setVisible(true).setAlpha(1).setY(150).setScale(1.3);
    this.tweens.add({ targets: this.popText, scale: 1, duration: 150, ease: "Back.Out" });
    this.tweens.add({
      targets: this.popText,
      y: 120,
      alpha: 0,
      delay: 700,
      duration: 500,
      onComplete: () => this.popText.setVisible(false),
    });
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
      this.updateSlopeBonus(now, delta);
      if (this.runner.finished) {
        if (this.race.isStageLastSection) this.arrive(now);
        else this.relay(now);
      }
      // 中継線を越えてから押さないまま GOOD の範囲を過ぎたら MISS
      const target = this.relayOffset();
      if (target && target.px < -SCORE_CONFIG.relayGoodMs) this.judge(target.index, "MISS");
      // アイテムも、押さないまま通り過ぎたら取り損ね
      for (const r of this.itemTracker.missPassed(this.runner.distanceKm, this.pxPerKm)) this.applyItem(r);
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

  private updateSectionTitle(): void {
    const s = this.section;
    this.sectionTitle.setText(`${s.no}区  ${s.from} → ${s.to}（${s.distanceKm}km）`);
  }

  /** 中継所を通過：走りは止めずに襷を渡し、そのまま次の区間を走る */
  private relay(now: number): void {
    const time = now - this.startedAt;
    const from = this.section;
    const taps = this.runner.tapCount;
    const falls = this.runner.fallCount;
    this.race.recordSection(time);
    this.race.advance();
    this.section = this.race.section;
    this.runner.handOver(this.section);
    this.slopeBonus = new SlopeBonus(this.section.no, SCORE_CONFIG);
    this.startedAt = now;
    this.ranPrev = true;
    this.updateSectionTitle();

    this.centerText.setText(`襷リレー！  ${from.no}区 → ${this.section.no}区`).setVisible(true);
    this.subText
      .setText(`${from.no}区 区間タイム ${formatTime(time)}   連打 ${taps}回 / 転倒 ${falls}回`)
      .setVisible(true);
    this.relayMessageTimer?.remove();
    this.relayMessageTimer = this.time.delayedCall(RELAY_MESSAGE_MS, () => {
      if (this.state !== "running") return;
      this.centerText.setVisible(false);
      this.subText.setVisible(false);
    });
  }

  /** ステージのゴール（5区・10区）に着いた。タイムを記録して、少し待ってから結果画面へ */
  private arrive(now: number): void {
    this.state = "arrived";
    this.arrivedAt = now;
    const time = this.arrivedAt - this.startedAt;
    this.race.recordSection(time);
    this.relayMessageTimer?.remove();

    const label = this.race.stage === 1 ? "往路ゴール！" : "総合ゴール！";
    this.centerText.setText(`${this.section.to} ${label}`).setVisible(true);
    this.subText
      .setText(`区間タイム ${formatTime(time)}   連打 ${this.runner.tapCount}回 / 転倒 ${this.runner.fallCount}回`)
      .setVisible(true);

    this.time.delayedCall(GOAL_PAUSE_MS, () => {
      this.scene.start("StageResultScene", { race: this.race });
    });
  }

  private drawWorld(): void {
    // 画面上で 1km を何ピクセルで描くか（管理画面で縮尺を変えるとその場で変わる）
    const pxPerKm = MAX_SCROLL_PX_PER_SEC * COURSE_CONFIG.secondsPerKm;
    // ステージ全体を1本の道として描く（中継所を通過しても景色がつながる）
    const sectionStartKm = this.race.sectionStartKm;
    const offsetPx = (sectionStartKm + this.runner.distanceKm) * pxPerKm;
    /** ステージのスタートから worldKm の地点の画面上の x */
    const toScreenX = (worldKm: number) => this.mx(worldKm * pxPerKm - offsetPx + RUNNER_MARGIN_X);

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

    // 距離表示（各区間のスタートからの km）と、中継所・ゴール
    const stageSections = sectionsOfStage(this.race.stage);
    const stepKm = Math.max(1, Math.ceil(MIN_LABEL_GAP_PX / pxPerKm));
    const inView = (x: number, margin: number) => x > -margin && x < GAME_WIDTH + margin;
    let labelIdx = 0;
    let postIdx = 0;
    let itemIdx = 0;
    let startKm = 0;
    for (const s of stageSections) {
      const endKm = startKm + s.distanceKm;
      for (let km = stepKm; km < s.distanceKm && labelIdx < this.kmLabels.length; km += stepKm) {
        const x = toScreenX(startKm + km);
        if (!inView(x, 50)) continue;
        this.kmLabels[labelIdx++].setText(`${km}km`).setX(x).setVisible(true);
        r.fillStyle(0xffffff).fillRect(x - 2, GROUND_Y + 20, 4, 70);
      }
      const tracker = this.trackerOf(s.no - 1);
      tracker.items.forEach((item, i) => {
        const x = toScreenX(startKm + item.km);
        const grade = tracker.results.get(i);
        // 取ったものは消える。取り損ねたものは薄く残す
        if (!inView(x, 60) || itemIdx >= this.itemLabels.length || (grade && grade !== "MISS")) return;
        const alpha = grade === "MISS" ? 0.35 : 1;
        const labelY = this.drawItem(r, item.kind, x, alpha);
        this.itemLabels[itemIdx++]
          .setText(ITEM_NAMES[item.kind])
          .setBackgroundColor(ITEM_LABEL_COLORS[item.kind])
          .setPosition(x, labelY)
          .setAlpha(alpha)
          .setVisible(true);
      });

      const postX = toScreenX(endKm);
      if (inView(postX, 100) && postIdx < this.postLabels.length) {
        const isGoal = s === stageSections[stageSections.length - 1];
        this.postLabels[postIdx++].setText(isGoal ? `${s.to} ゴール` : `${s.to}中継所`).setX(postX).setVisible(true);
        r.fillStyle(0xffffff).fillRect(postX - 3, GROUND_Y + 20, 6, 120);
        r.fillStyle(0x7a3b2e).fillRect(postX - 70, GROUND_Y - 150, 6, 150);
        r.fillRect(postX + 64, GROUND_Y - 150, 6, 150);
      }
      startKm = endKm;
    }
    for (let i = labelIdx; i < this.kmLabels.length; i++) this.kmLabels[i].setVisible(false);
    for (let i = postIdx; i < this.postLabels.length; i++) this.postLabels[i].setVisible(false);
    for (let i = itemIdx; i < this.itemLabels.length; i++) this.itemLabels[i].setVisible(false);
  }

  /** アイテムの目印を描く（キャラと同じく仮の図形）。看板を置く y を返す */
  private drawItem(g: Phaser.GameObjects.Graphics, kind: ItemKind, x: number, alpha: number): number {
    if (kind === "water") {
      // 給水所の机とコップ
      g.fillStyle(0x2e86de, alpha).fillRect(x - 20, GROUND_Y - 34, 40, 34);
      g.fillStyle(0xffffff, alpha).fillRect(x - 14, GROUND_Y - 46, 8, 12).fillRect(x + 6, GROUND_Y - 46, 8, 12);
      return GROUND_Y - 52;
    }
    if (kind === "cheer") {
      // 応援の旗
      g.fillStyle(0x7a3b2e, alpha).fillRect(x - 2, GROUND_Y - 96, 4, 96);
      g.fillStyle(0xe67e22, alpha).fillTriangle(x + 2, GROUND_Y - 96, x + 2, GROUND_Y - 66, x + 40 * this.dir, GROUND_Y - 81);
      return GROUND_Y - 102;
    }
    // 黒たまご
    g.fillStyle(0x111111, alpha).fillEllipse(x, GROUND_Y - 16, 26, 32);
    g.fillStyle(0xffffff, alpha * 0.5).fillEllipse(x - 5, GROUND_Y - 24, 6, 9);
    return GROUND_Y - 38;
  }

  /** タイミングゲージ（襷・アイテム共通）：中央の線が目印。マーカーが線に重なった瞬間にエンター */
  private drawRelayGauge(): void {
    const g = this.relayGauge;
    g.clear();
    const target = this.state === "running" ? this.timingTarget() : null;
    this.relayGaugeText.setVisible(target !== null);
    if (!target) return;
    this.relayGaugeText.setText(target.label);

    // 画面上部の真ん中（左右の表示の間）。コース上の看板や旗と重ならない高さ
    const cx = GAME_WIDTH / 2;
    const y = 94;
    const half = 150;
    const scale = half / RELAY_GAUGE_PX;
    g.fillStyle(0xffffff, 0.85).fillRect(cx - half, y, half * 2, 16);
    const good = target.goodPx * scale;
    const perfect = target.perfectPx * scale;
    g.fillStyle(0x7fd67f).fillRect(cx - good, y, good * 2, 16);
    g.fillStyle(0xf2c400).fillRect(cx - perfect, y, perfect * 2, 16);
    g.fillStyle(0xc0392b).fillRect(cx - 1, y - 4, 3, 24);
    // マーカーは進む向きの後ろ側から中央へ近づく
    const mx = cx - this.dir * Math.max(-half, Math.min(half, target.px * scale));
    g.fillStyle(0x10243e).fillRect(mx - 3, y - 8, 6, 32);
  }

  private drawHud(now: number): void {
    const elapsed =
      this.state === "ready" ? 0 : (this.state === "arrived" ? this.arrivedAt : now) - this.startedAt;
    // 総合タイム：記録済みの区間 + 今の区間（着いた後は記録済みに含まれる）
    const total = this.race.totalMs() + (this.state === "running" ? elapsed : 0);
    const remain = Math.max(0, this.section.distanceKm - this.runner.distanceKm);
    const kmh = this.runner.actualSpeed * DISPLAY_TOP_KMH;
    const lastTapAt = this.runner.lastTapAt;
    const sinceLast = this.state === "running" && lastTapAt !== null ? now - lastTapAt : null;
    const fallen = this.runner.isFallen(now);

    this.hud.setText([
      `区間タイム  ${formatTime(elapsed)}    総合  ${formatTime(total)}`,
      `残り  ${remain.toFixed(2)} km`,
      `速度  ${kmh.toFixed(1)} km/h${fallen ? "   転倒！" : ""}`,
      this.slopeLabel(),
      `前回から  ${sinceLast === null ? "-" : `${(sinceLast / 1000).toFixed(2)} 秒`}${
        this.runner.fastStreak > 0 && !fallen ? "   押しすぎ注意！" : ""
      }`,
    ]);

    // ポイント
    const points = this.race.breakdown().total;
    this.pointsText.setText(`${points.toLocaleString()} pt`);
    const mult = sectionMultiplier(this.section.no, SCORE_CONFIG);
    this.comboText.setText(
      [
        `コンボ ${this.combo.combo}  リズム×${this.combo.multiplier.toFixed(1)}`,
        mult !== 1 ? `${this.section.no}区はポイント×${mult}` : "",
        this.slopeBonusLabel(),
      ].join("\n"),
    );
    this.drawRelayGauge();

    // 高低図（進捗バーを兼ねる）
    const p = this.progressBar;
    const x = GAME_WIDTH - 324;
    const w = 300;
    p.clear();
    this.drawProfile(p, x, 8, w, 34);

    // 押す間隔ゲージ：前回の連打からの経過時間。赤（早すぎ）を抜けて緑になってから押す
    // 下り坂では赤（押しすぎ）の範囲が広がる
    const gy = 52;
    const fallMs = this.runner.fallIntervalMs;
    const gaugeMaxMs = Math.max(RUN_CONFIG.fallIntervalMs * 2, RUN_CONFIG.justIntervalMs * 1.5, fallMs * 1.3);
    const toX = (ms: number) => x + (w * Math.min(ms, gaugeMaxMs)) / gaugeMaxMs;
    const okX = toX(fallMs);
    p.fillStyle(0xf08a8a).fillRect(x, gy, okX - x, 12);
    p.fillStyle(0x7fd67f).fillRect(okX, gy, x + w - okX, 12);
    // ジャストタイミングの目印
    p.fillStyle(0xf2c400).fillRect(toX(RUN_CONFIG.justIntervalMs) - 1, gy - 2, 3, 16);
    if (sinceLast !== null) {
      p.fillStyle(sinceLast < fallMs ? 0xd84b1e : 0x10243e).fillRect(toX(sinceLast) - 2, gy - 4, 4, 20);
    }
  }

  private updateSlopeBonus(now: number, delta: number): void {
    if (!this.slopeBonus.active) return;
    const effort = this.runner.isFallen(now) ? 0 : this.runner.speedRatio;
    const events = this.slopeBonus.update(this.runner.distanceKm, effort, delta);
    this.race.setSlope(this.slopeBonus.points);
    for (const e of events) this.showSlopeEvent(e);
  }

  private showSlopeEvent(e: SlopeBonusEvent): void {
    if (e.kind === "summit") {
      this.showPop(e.cleared ? `最高地点 到達！  +${e.points}` : "最高地点 到達（勢い不足）", e.cleared ? "#2e9e4f" : "#7a7a7a");
      return;
    }
    // 区切りごとの結果はランナーの頭の上に小さく出す
    const text = e.cleared ? `${e.index}/${e.total} クリア +${e.points}` : `${e.index}/${e.total} 勢い不足`;
    this.showSmallPop(text, e.cleared ? "#2e9e4f" : "#7a7a7a");
  }

  /** ランナーの頭の上に小さく出して消える表示 */
  private showSmallPop(text: string, color: string): void {
    this.tweens.killTweensOf(this.slopeText);
    this.slopeText.setText(text).setColor(color).setPosition(this.runnerX, GROUND_Y - 80).setAlpha(1).setVisible(true);
    this.tweens.add({ targets: this.slopeText, y: GROUND_Y - 110, alpha: 0, duration: 700, delay: 200 });
  }

  /** 坂ボーナスの進み具合（坂ボーナスのない区間では空） */
  private slopeBonusLabel(): string {
    const b = this.slopeBonus;
    const km = this.runner.distanceKm;
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    if (b.climb) {
      if (km < b.climb.fromKm) return `この先 山登り：勢い${pct(SCORE_CONFIG.hillTargetEffort)}以上で坂ボーナス`;
      if (b.inClimb(km)) {
        const avg = b.segmentAverage;
        return `坂ボーナス ${b.cleared}/${b.checkpoints.length}  今の区切り ${avg === null ? "-" : pct(avg)}（目安${pct(SCORE_CONFIG.hillTargetEffort)}）`;
      }
      return `坂ボーナス ${b.cleared}/${b.checkpoints.length}  +${b.points}`;
    }
    if (b.descent) {
      if (km < b.descent.fromKm) return `この先 山下り：転ばず勢い${pct(SCORE_CONFIG.downhillTargetEffort)}以上で坂ボーナス`;
      const low = b.inDescent(km) && this.runner.speedRatio < SCORE_CONFIG.downhillTargetEffort;
      return `下りキープ ${b.keptKm.toFixed(1)}km  +${b.points}${low ? "  勢い不足" : ""}`;
    }
    return "";
  }

  /** 今いる地点の坂の表示（例：「坂  上り 3.0%（権太坂）」） */
  private slopeLabel(): string {
    const seg = segmentAt(this.section.no, this.runner.distanceKm);
    if (!seg) return "坂  平坦";
    const kind = seg.grade > 0 ? "上り" : "下り";
    const name = seg.name ? `（${seg.name}）` : "";
    const warn = seg.grade < 0 ? "  転びやすい！" : "";
    return `坂  ${kind} ${Math.abs(seg.grade).toFixed(1)}%${name}${warn}`;
  }

  /** 区間の高低図。走った所を濃く塗り、今の位置に印をつける。復路は左右反転 */
  private drawProfile(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number): void {
    const no = this.section.no;
    const dist = this.section.distanceKm;
    const steps = 120;
    const elev = Array.from({ length: steps + 1 }, (_, i) => elevationAt(no, (dist * i) / steps));
    const min = Math.min(...elev);
    // 平坦な区間の小さな起伏が大げさに見えないよう、縦の幅は最低 100m ぶんにする
    const span = Math.max(100, Math.max(...elev) - min);
    const toX = (km: number) => (this.dir === 1 ? x + (w * km) / dist : x + w - (w * km) / dist);
    const toY = (m: number) => y + h - 3 - ((m - min) / span) * (h - 6);

    g.fillStyle(0xffffff, 0.8).fillRoundedRect(x - 4, y - 2, w + 8, h + 4, 6);
    const ran = this.runner.distanceKm;
    const area = (fromKm: number, toKm: number, color: number) => {
      const pts = [new Phaser.Math.Vector2(toX(fromKm), y + h)];
      for (let i = 0; i <= steps; i++) {
        const km = (dist * i) / steps;
        if (km < fromKm || km > toKm) continue;
        pts.push(new Phaser.Math.Vector2(toX(km), toY(elev[i])));
      }
      pts.push(new Phaser.Math.Vector2(toX(toKm), toY(elevationAt(no, toKm))), new Phaser.Math.Vector2(toX(toKm), y + h));
      g.fillStyle(color).fillPoints(pts, true);
    };
    area(0, dist, 0x9fb7cf);
    if (ran > 0) area(0, ran, 0x1e5bd8);
    g.fillStyle(0xc0392b).fillCircle(toX(ran), toY(elevationAt(no, ran)), 5);
  }
}
