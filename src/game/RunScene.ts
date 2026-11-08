import Phaser from "phaser";
import { createTextures, FAN_COLORS } from "./art/textures";
import { playSe, preloadSounds, startBgm, stopBgm } from "./audio";
import { COURSE_CONFIG, RUN_CONFIG, SCORE_CONFIG, type SectionConfig } from "./config";
import { bindGameKeys, formatTime } from "./input";
import { isSunny, ITEM_ACTIONS, ITEM_NAMES, ItemTracker, itemWindows, sunnyZoneOf, type ItemKind, type ItemResult } from "./items";
import { FONT, GAME_HEIGHT, GAME_WIDTH, TEXT_COLOR } from "./layout";
import { Race, sectionsOfStage, STAGE_NAMES } from "./race";
import type { RankingSceneData } from "./RankingScene";
import { Runner } from "./runner";
import { judgeRelay, RhythmCombo, sectionMultiplier, type RelayGrade } from "./score";
import { SlopeBonus, type SlopeBonusEvent } from "./slopeBonus";
import { inSpurt, LastSpurt, spurtZoneOf } from "./spurt";
import { elevationAt, segmentAt } from "./terrain";
import { Background, preloadBackground, sceneryOf, type Scenery } from "./view/Background";
import { Effects } from "./view/effects";

/** 平地のとき、道路のいちばん奥（草地の上端）の高さ */
const BASE_ROAD_Y = 372;
/** 道路の奥の端からランナーの足元まで */
const LANE_Y = 44;
/** ランナーの絵の拡大率 */
const RUNNER_SCALE = 1.25;
/** 進む方向の反対側の端からランナーまでの距離（ピクセル） */
const RUNNER_MARGIN_X = 240;
/** 最高速度のとき画面が1秒に流れるピクセル数（縮尺を変えても見た目の速さは一定） */
const MAX_SCROLL_PX_PER_SEC = 1000;
/** 坂を画面でどれだけ大げさに傾けるか（実際の勾配 × この倍率で描く） */
const SLOPE_EXAGGERATION = 4;
/** 距離表示どうしの最小間隔（ピクセル） */
const MIN_LABEL_GAP_PX = 160;
/** 観客を置く間隔（ピクセル） */
const FAN_SLOT_PX = 30;
/** 表示用の速度（最高速度のときの km/h） */
const DISPLAY_TOP_KMH = 21;
/** ゴール（5区・10区）に着いてから結果画面に移るまで（ミリ秒） */
const GOAL_PAUSE_MS = 2200;
/** 襷リレーの表示を出しておく時間（ミリ秒）。走りは止まらない */
const RELAY_MESSAGE_MS = 1500;
/** スタート前のカウントダウンの1つの数字を出している時間（ミリ秒） */
const COUNTDOWN_STEP_MS = 800;
/** 中継線までこのピクセル以内に近づいたら襷ゲージを出し、エンターを受け付ける */
const RELAY_GAUGE_PX = 400;
/** タイミングゲージの画面上の長さ：出ている範囲 1px あたり何 px で描くか */
const GAUGE_PX_SCALE = 150 / RELAY_GAUGE_PX;
/** タイミングゲージの長さの半分の最小・最大（px） */
const GAUGE_MIN_HALF = 40;
const GAUGE_MAX_HALF = 230;
const HUD_DEPTH = 100;
const RELAY_GRADE_COLORS: Record<RelayGrade, string> = { PERFECT: "#f2a900", GOOD: "#2e9e4f", MISS: "#7a7a7a" };
const ITEM_LABEL_COLORS: Record<ItemKind, string> = { water: "#2e86de", cheer: "#e67e22", egg: "#222222" };

/** ready：スペース待ち → countdown：3・2・1 → running：走っている → arrived：ゴールした */
type State = "ready" | "countdown" | "running" | "arrived";

/** エンターで狙うもの（襷 or アイテム）と、そのずれ */
interface TimingTarget {
  /** 目印とのずれ（ピクセル。手前ならプラス、越えた後はマイナス） */
  px: number;
  label: string;
  perfectPx: number;
  goodPx: number;
  /** 目印のこれだけ手前からゲージを出す（ゲージの長さもこれに比例する） */
  gaugePx: number;
}

export interface RunSceneData {
  race?: Race;
  /** true ならスペース待ちをせず、すぐに区間をスタートする（復路のスタートなど） */
  autoStart?: boolean;
}

/** 整数から 0〜1 の決まった値（観客の並びなどを毎回同じにする） */
function hash(n: number): number {
  const x = Math.sin(n * 91.7 + 17.3) * 43758.5453;
  return x - Math.floor(x);
}

export class RunScene extends Phaser.Scene {
  private race!: Race;
  private section!: SectionConfig;
  private autoStart = false;
  private runner!: Runner;
  private state: State = "ready";
  private startedAt = 0;
  private arrivedAt = 0;
  /** 進む向き。往路は左から右（右向き）なので +1、復路は右から左なので -1 */
  private dir: 1 | -1 = 1;
  /** このシーンで前の区間から走ってきたか（区間ジャンプ直後は前の中継線の判定をしない） */
  private ranPrev = false;

  private combo!: RhythmCombo;
  private slopeBonus!: SlopeBonus;
  private lastSpurt!: LastSpurt;
  /** 区間（SECTIONS の添字）ごとのアイテムの取った・取り損ね */
  private itemTrackers = new Map<number, ItemTracker>();

  // 見た目
  private background!: Background;
  private effects!: Effects;
  private zoneGfx!: Phaser.GameObjects.Graphics;
  private road!: Phaser.GameObjects.Graphics;
  private worldGfx!: Phaser.GameObjects.Graphics;
  private fans: Phaser.GameObjects.Image[] = [];
  private kmLabels: Phaser.GameObjects.Text[] = [];
  /** 中継所・ゴールの看板（画面に同時に映るのはせいぜい2つ） */
  private postLabels: Phaser.GameObjects.Text[] = [];
  /** 給水・応援・黒たまごの看板 */
  private itemLabels: Phaser.GameObjects.Text[] = [];
  private eggImages: Phaser.GameObjects.Image[] = [];
  /** 7区「日差しが強い」・10区「ここからラストスパート」の看板 */
  private zoneLabel!: Phaser.GameObjects.Text;
  private landmarkLabel!: Phaser.GameObjects.Text;
  private runnerSprite!: Phaser.GameObjects.Sprite;
  /** 中継所で待っている次の走者 */
  private nextRunner!: Phaser.GameObjects.Sprite;
  /** 襷を渡し終えた前の走者（中継所に残って後ろへ流れていく） */
  private prevRunner!: Phaser.GameObjects.Sprite;
  private prevRunnerKm: number | null = null;
  private prevRunnerAt = 0;
  /** 画面での道路の高さの基準（坂で少し上下させて、前方が見えるようにする） */
  private anchorRoadY = BASE_ROAD_Y;
  private goalTapeBroken = false;
  private wasInSpurt = false;
  private lastPoints = 0;

  // 画面の表示（HUD）
  private hudPanel!: Phaser.GameObjects.Graphics;
  private sectionTitle!: Phaser.GameObjects.Text;
  private hud!: Phaser.GameObjects.Text;
  private progressBar!: Phaser.GameObjects.Graphics;
  private pointsText!: Phaser.GameObjects.Text;
  private plusText!: Phaser.GameObjects.Text;
  private comboText!: Phaser.GameObjects.Text;
  private smallPopText!: Phaser.GameObjects.Text;
  private relayGauge!: Phaser.GameObjects.Graphics;
  private relayGaugeText!: Phaser.GameObjects.Text;
  private messagePanel!: Phaser.GameObjects.Graphics;
  private titleText!: Phaser.GameObjects.Text;
  /** スタート前に出す操作説明 */
  private controlsText!: Phaser.GameObjects.Text;
  private countdownText!: Phaser.GameObjects.Text;
  private centerText!: Phaser.GameObjects.Text;
  private subText!: Phaser.GameObjects.Text;
  private relayMessageTimer?: Phaser.Time.TimerEvent;
  private rankingButton?: Phaser.GameObjects.Text;

  constructor() {
    super("RunScene");
  }

  init(data: RunSceneData): void {
    this.race = data.race ?? new Race();
    this.section = this.race.section;
    this.autoStart = data.autoStart ?? false;
  }

  preload(): void {
    preloadSounds(this);
    preloadBackground(this);
  }

  create(): void {
    createTextures(this);
    // 区間ジャンプや結果画面への切り替えでシーンが終わったら BGM も止める
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.sound.get("bgm")?.stop());
    this.runner = new Runner(RUN_CONFIG, this.section);
    this.combo = new RhythmCombo(RUN_CONFIG, SCORE_CONFIG);
    this.slopeBonus = new SlopeBonus(this.section.no, SCORE_CONFIG);
    this.lastSpurt = new LastSpurt(this.section.no);
    this.itemTrackers = new Map();
    // 管理画面のポイント内訳が今のレースを読めるようにする
    this.registry.set("race", this.race);
    this.state = "ready";
    this.ranPrev = false;
    this.dir = this.race.stage === 1 ? 1 : -1;
    this.prevRunnerKm = null;
    this.anchorRoadY = BASE_ROAD_Y;
    this.goalTapeBroken = false;
    this.wasInSpurt = false;
    this.lastPoints = this.race.breakdown().total;
    this.rankingButton = undefined;

    // 奥から順に作る（後から作ったものが手前に描かれる）
    this.background = new Background(this, this.dir, BASE_ROAD_Y);
    this.zoneGfx = this.add.graphics();
    this.road = this.add.graphics();
    this.kmLabels = Array.from({ length: 8 }, () =>
      this.add.text(0, 0, "", { fontFamily: FONT, fontSize: "18px", color: "#ffffff" }).setOrigin(0.5, 0),
    );
    this.fans = Array.from({ length: 40 }, () =>
      this.add.image(0, 0, "fans", "fan0_0").setOrigin(0.5, 1).setVisible(false),
    );
    this.worldGfx = this.add.graphics();
    this.eggImages = Array.from({ length: 3 }, () => this.add.image(0, 0, "egg").setOrigin(0.5, 1).setVisible(false));
    this.postLabels = Array.from({ length: 3 }, () =>
      this.add
        .text(0, 0, "", {
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
    this.zoneLabel = this.add
      .text(0, 0, "", {
        fontFamily: FONT,
        fontSize: "18px",
        color: "#b35c00",
        fontStyle: "bold",
        backgroundColor: "#fff3c4",
        padding: { x: 8, y: 3 },
      })
      .setOrigin(0.5, 1)
      .setVisible(false);
    this.landmarkLabel = this.add
      .text(0, 0, "", {
        fontFamily: FONT,
        fontSize: "20px",
        color: "#ffffff",
        fontStyle: "bold",
        backgroundColor: "#8e44ad",
        padding: { x: 8, y: 3 },
      })
      .setOrigin(0.5, 1)
      .setVisible(false);

    this.prevRunner = this.add.sprite(0, 0, "runner", "stand").setOrigin(0.5, 1).setScale(RUNNER_SCALE).setVisible(false);
    this.nextRunner = this.add.sprite(0, 0, "runner", "stand").setOrigin(0.5, 1).setScale(RUNNER_SCALE).setVisible(false);
    this.runnerSprite = this.add
      .sprite(this.runnerX, BASE_ROAD_Y + LANE_Y, "runner", "stand")
      .setOrigin(0.5, 1)
      .setScale(RUNNER_SCALE)
      .setFlipX(this.dir === -1);

    this.effects = new Effects(this);
    this.createHud();

    bindGameKeys(this, {
      onSpace: (now) => {
        if (this.state === "ready") this.beginCountdown();
        else if (this.state === "running") this.onTap(now);
      },
      onEnter: () => {
        if (this.state === "running") this.onEnterKey();
      },
    });

    if (this.autoStart) this.start(performance.now());

    this.drawWorld(performance.now());
    this.drawHud(performance.now());
  }

  private createHud(): void {
    const hudText = (x: number, y: number, size: number, bold = false) =>
      this.add
        .text(x, y, "", { fontFamily: FONT, fontSize: `${size}px`, color: TEXT_COLOR, fontStyle: bold ? "bold" : "normal" })
        .setDepth(HUD_DEPTH);

    this.hudPanel = this.add.graphics().setDepth(HUD_DEPTH - 1);
    this.progressBar = this.add.graphics().setDepth(HUD_DEPTH);
    hudText(24, 12, 15).setText(STAGE_NAMES[this.race.stage]);
    this.sectionTitle = hudText(24, 32, 22, true);
    this.updateSectionTitle();
    this.hud = hudText(24, 70, 18).setLineSpacing(6);

    // ポイント（常に表示）
    this.pointsText = hudText(GAME_WIDTH - 24, 78, 28, true).setOrigin(1, 0);
    this.plusText = hudText(0, 84, 20, true).setOrigin(1, 0).setColor("#e67e22").setVisible(false);
    this.comboText = hudText(GAME_WIDTH - 24, 116, 18).setOrigin(1, 0).setLineSpacing(4).setAlign("right");

    this.smallPopText = this.add
      .text(0, 0, "", {
        fontFamily: FONT,
        fontSize: "20px",
        color: "#2e9e4f",
        fontStyle: "bold",
        stroke: "#ffffff",
        strokeThickness: 4,
      })
      .setOrigin(0.5, 1)
      .setDepth(HUD_DEPTH)
      .setVisible(false);

    this.relayGauge = this.add.graphics().setDepth(HUD_DEPTH);
    this.relayGaugeText = this.add
      .text(GAME_WIDTH / 2, 116, "", {
        fontFamily: FONT,
        fontSize: "20px",
        color: "#c0392b",
        fontStyle: "bold",
        stroke: "#ffffff",
        strokeThickness: 4,
      })
      .setOrigin(0.5, 0)
      .setDepth(HUD_DEPTH)
      .setVisible(false);

    this.messagePanel = this.add.graphics().setDepth(HUD_DEPTH - 1);
    this.titleText = this.add
      .text(GAME_WIDTH / 2, 150, "箱根駅伝 連打ラン", {
        fontFamily: FONT,
        fontSize: "46px",
        color: "#c0392b",
        fontStyle: "bold",
        stroke: "#ffffff",
        strokeThickness: 8,
      })
      .setOrigin(0.5)
      .setDepth(HUD_DEPTH)
      .setVisible(false);
    this.centerText = this.add
      .text(GAME_WIDTH / 2, 204, "スペースキーを押してスタート！", {
        fontFamily: FONT,
        fontSize: "34px",
        color: TEXT_COLOR,
        fontStyle: "bold",
        stroke: "#ffffff",
        strokeThickness: 6,
      })
      .setOrigin(0.5)
      .setDepth(HUD_DEPTH);
    this.subText = this.add
      .text(GAME_WIDTH / 2, 282, "", {
        fontFamily: FONT,
        fontSize: "20px",
        color: TEXT_COLOR,
        stroke: "#ffffff",
        strokeThickness: 4,
      })
      .setOrigin(0.5)
      .setDepth(HUD_DEPTH)
      .setVisible(false);
    this.controlsText = this.add
      .text(
        GAME_WIDTH / 2,
        242,
        [
          "［スペースキー］連打で走る。速く押すほど速いけど、押しすぎると転ぶ",
          "［エンターキー］ゲージに合わせて押す：襷リレー・給水・応援・黒たまご",
        ].join("\n"),
        { fontFamily: FONT, fontSize: "18px", color: TEXT_COLOR, lineSpacing: 8, align: "left" },
      )
      .setOrigin(0.5, 0)
      .setDepth(HUD_DEPTH)
      .setVisible(!this.autoStart);
    this.countdownText = this.add
      .text(GAME_WIDTH / 2, 236, "", {
        fontFamily: FONT,
        fontSize: "96px",
        color: "#c0392b",
        fontStyle: "bold",
        stroke: "#ffffff",
        strokeThickness: 10,
      })
      .setOrigin(0.5)
      .setDepth(HUD_DEPTH + 10)
      .setVisible(false);

    // 最初の区間のスタート前だけタイトルと「ランキングを見る」を出す
    if (!this.autoStart) {
      this.titleText.setVisible(this.race.sectionIndex === 0);
      if (this.race.sectionIndex === 0) {
        this.rankingButton = this.add
          .text(GAME_WIDTH / 2, 336, "ランキングを見る ▶", {
            fontFamily: FONT,
            fontSize: "20px",
            color: "#ffffff",
            fontStyle: "bold",
            backgroundColor: "#c0392b",
            padding: { x: 14, y: 6 },
          })
          .setOrigin(0.5)
          .setDepth(HUD_DEPTH)
          .setInteractive({ useHandCursor: true })
          .on("pointerdown", () => {
            playSe(this, "click");
            this.scene.start("RankingScene", {} satisfies RankingSceneData);
          });
      }
      this.tweens.add({ targets: this.centerText, scale: 1.06, duration: 600, yoyo: true, repeat: -1, ease: "Sine.InOut" });
    }
  }

  // ---------------------------------------------------------------------------
  // 位置の計算

  /** ランナーの画面上の位置。進む方向の反対側に寄せて、前方が見えるようにする */
  private get runnerX(): number {
    return this.dir === 1 ? RUNNER_MARGIN_X : GAME_WIDTH - RUNNER_MARGIN_X;
  }

  /** 右向き（往路）で計算した x を、復路なら左右反転する */
  private mx(x: number): number {
    return this.dir === 1 ? x : GAME_WIDTH - x;
  }

  /** 画面上で 1km を何ピクセルで描くか（管理画面で縮尺を変えるとその場で変わる） */
  private get pxPerKm(): number {
    return MAX_SCROLL_PX_PER_SEC * COURSE_CONFIG.secondsPerKm;
  }

  /** ステージのスタートからランナーまでの距離（km） */
  private get runnerWorldKm(): number {
    return this.race.sectionStartKm + this.runner.distanceKm;
  }

  /** ステージのスタートから worldKm の地点の画面上の x */
  private toScreenX(worldKm: number): number {
    return this.mx((worldKm - this.runnerWorldKm) * this.pxPerKm + RUNNER_MARGIN_X);
  }

  /** 画面上の x の地点の、ステージのスタートからの距離（km） */
  private worldKmAt(screenX: number): number {
    const right = this.dir === 1 ? screenX : GAME_WIDTH - screenX;
    return this.runnerWorldKm + (right - RUNNER_MARGIN_X) / this.pxPerKm;
  }

  /** ステージのスタートからの標高差（m） */
  private stageElevation(worldKm: number): number {
    let start = 0;
    let base = 0;
    for (const s of sectionsOfStage(this.race.stage)) {
      if (worldKm <= start + s.distanceKm) return base + elevationAt(s.no, Math.max(0, worldKm - start));
      base += elevationAt(s.no, s.distanceKm);
      start += s.distanceKm;
    }
    return base;
  }

  /** その地点の道路の奥の端（草地の上端）の画面上の y。坂で上下する */
  private roadTop(worldKm: number): number {
    const meters = this.stageElevation(worldKm) - this.stageElevation(this.runnerWorldKm);
    return this.anchorRoadY - meters * (this.pxPerKm / 1000) * SLOPE_EXAGGERATION;
  }

  /** その地点の画面上のランナーの足元の y */
  private laneY(worldKm: number): number {
    return this.roadTop(worldKm) + LANE_Y;
  }

  /** ステージのスタートから見た、その区間のスタート位置（km） */
  private sectionStartWorldKm(sectionNo: number): number {
    let start = 0;
    for (const s of sectionsOfStage(this.race.stage)) {
      if (s.no === sectionNo) return start;
      start += s.distanceKm;
    }
    return start;
  }

  // ---------------------------------------------------------------------------
  // 入力

  private onTap(now: number): void {
    const result = this.runner.tap(now);
    // ラストスパート中は、受け付けた連打1回ごとにポイント
    if (result === "accepted" && this.runner.inSpurt) this.race.addSpurt(SCORE_CONFIG.spurtPointsPerTap);
    if (result === "accepted") {
      const points = this.combo.tap(now);
      if (points > 0) {
        this.race.addRhythm(points, this.combo.combo);
        // コンボの倍率が上がった瞬間に演出
        if (this.combo.combo % Math.max(1, SCORE_CONFIG.comboStep) === 0) {
          const y = this.laneY(this.runnerWorldKm) - 165;
          this.effects.bigText(`${this.combo.combo} COMBO  ×${this.combo.multiplier.toFixed(1)}`, this.runnerX, y, "#e67e22", 24);
          this.effects.sparkle(this.runnerX, y + 30, 10, 0xffb347);
        }
      }
    } else if (result === "fell") {
      this.combo.break();
      this.race.addFall();
      const y = this.laneY(this.runnerWorldKm);
      this.effects.dust(this.runnerX, y, 18);
      this.effects.bigText("転倒！", this.runnerX, y - 110, "#d84b1e", 30);
      this.cameras.main.shake(180, 0.006);
    }
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

  /** その区間のアイテム管理（なければ作る） */
  private trackerOf(sectionIndex: number): ItemTracker {
    let t = this.itemTrackers.get(sectionIndex);
    if (!t) {
      t = new ItemTracker(sectionIndex + 1, this.race.itemsOf(sectionIndex + 1), SCORE_CONFIG);
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
      return {
        px: relay.px,
        label: "Enterで襷を渡す！",
        perfectPx: SCORE_CONFIG.relayPerfectMs,
        goodPx: SCORE_CONFIG.relayGoodMs,
        gaugePx: RELAY_GAUGE_PX,
      };
    }
    const item = this.itemTracker.target(this.runner.distanceKm, this.pxPerKm);
    if (item) {
      const windows = itemWindows(item.item.kind, SCORE_CONFIG);
      return {
        px: item.offsetPx,
        label: ITEM_ACTIONS[item.item.kind],
        perfectPx: windows.perfect,
        goodPx: windows.good,
        gaugePx: windows.gauge,
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
    const item = this.itemTracker.target(this.runner.distanceKm, this.pxPerKm);
    if (item) this.applyItem(this.itemTracker.press(item));
    // 中継所やアイテムの近く以外でのエンターは何もしない
  }

  // ---------------------------------------------------------------------------
  // 判定の結果と演出

  private applyItem(result: ItemResult): void {
    const got = result.grade !== "MISS";
    this.race.addItem(result.points, got);
    const name = ITEM_NAMES[result.item.kind];
    if (!got) {
      this.showSmallPop(`${name} 取り損ね`, "#7a7a7a");
      return;
    }
    const mult = sectionMultiplier(this.section.no, SCORE_CONFIG);
    const label = result.sunny ? `日差し${name}×${SCORE_CONFIG.sunnyWaterMultiplier}` : name;
    this.effects.bigText(`${label} ${result.grade}!  +${Math.round(result.points * mult)}`, GAME_WIDTH / 2, 186, RELAY_GRADE_COLORS[result.grade], 30);

    // アイテムごとの動き
    const worldKm = this.race.sectionStartKm + result.item.km;
    const x = this.toScreenX(worldKm);
    const y = this.laneY(worldKm) - 20;
    const runnerY = this.laneY(this.runnerWorldKm);
    if (result.item.kind === "egg") {
      // 黒たまごはポンと跳ねてポイントの表示へ飛んでいく
      this.effects.fly("egg", x, y - 10, GAME_WIDTH - 90, 94, 650, () => {
        this.effects.sparkle(GAME_WIDTH - 90, 94, 18, 0xffe066);
      });
    } else if (result.item.kind === "water") {
      this.effects.fly("cup", x, y - 30, this.runnerX, runnerY - 55, 380, () => {
        this.effects.splash(this.runnerX, runnerY - 55, 18);
      });
    } else {
      this.effects.confetti(x, y - 70, 36);
    }
  }

  private judge(index: number, grade: RelayGrade): void {
    this.race.setRelay(index, grade);
    const points = this.race.sectionScores[index]?.relay ?? 0;
    const mult = sectionMultiplier(index + 1, SCORE_CONFIG);
    if (grade === "MISS") {
      this.effects.bigText("MISS…", GAME_WIDTH / 2, 186, RELAY_GRADE_COLORS.MISS, 34);
      return;
    }
    this.effects.bigText(`${grade}!  +${Math.round(points * mult)}`, GAME_WIDTH / 2, 186, RELAY_GRADE_COLORS[grade], grade === "PERFECT" ? 46 : 38);
    this.effects.sparkle(GAME_WIDTH / 2, 186, grade === "PERFECT" ? 28 : 14, grade === "PERFECT" ? 0xffd34d : 0x7fd67f);
    if (grade === "PERFECT") this.cameras.main.flash(120, 255, 250, 210);
  }

  /** ランナーの頭の上に小さく出して消える表示 */
  private showSmallPop(text: string, color: string): void {
    const y = this.laneY(this.runnerWorldKm) - 108;
    this.tweens.killTweensOf(this.smallPopText);
    this.smallPopText.setText(text).setColor(color).setPosition(this.runnerX, y).setAlpha(1).setVisible(true);
    this.tweens.add({ targets: this.smallPopText, y: y - 30, alpha: 0, duration: 700, delay: 200 });
  }

  /** スペースキーを押したら 3・2・1 のカウントダウンをしてからスタート */
  private beginCountdown(): void {
    this.state = "countdown";
    this.hideStartScreen();
    const steps = ["3", "2", "1"];
    steps.forEach((label, i) => {
      this.time.delayedCall(i * COUNTDOWN_STEP_MS, () => {
        playSe(this, "click");
        this.tweens.killTweensOf(this.countdownText);
        this.countdownText.setText(label).setVisible(true).setScale(1.6).setAlpha(1);
        this.tweens.add({ targets: this.countdownText, scale: 1, duration: 250, ease: "Back.Out" });
        // 次の数字の直前まで出しておき、すっと消す
        this.tweens.add({ targets: this.countdownText, alpha: 0, delay: COUNTDOWN_STEP_MS - 160, duration: 140 });
      });
    });
    this.time.delayedCall(steps.length * COUNTDOWN_STEP_MS, () => {
      this.countdownText.setVisible(false);
      this.start(performance.now());
    });
  }

  /** タイトル・操作説明・「ランキングを見る」を消す */
  private hideStartScreen(): void {
    this.tweens.killTweensOf(this.centerText);
    this.centerText.setScale(1).setVisible(false);
    this.subText.setVisible(false);
    this.titleText.setVisible(false);
    this.controlsText.setVisible(false);
    this.rankingButton?.destroy();
    this.rankingButton = undefined;
  }

  private start(now: number): void {
    this.state = "running";
    this.startedAt = now;
    this.hideStartScreen();
    this.effects.bigText("スタート！", GAME_WIDTH / 2, 236, "#c0392b", 50);
    playSe(this, "start");
    startBgm(this, () => this.state === "running");
  }

  update(time: number, delta: number): void {
    const now = performance.now();

    if (this.state === "running") {
      this.runner.update(now, delta);
      this.updateSlopeBonus(now, delta);
      this.lastSpurt.update(this.runner.distanceKm, this.runner.isFallen(now) ? 0 : this.runner.speedRatio, delta);
      this.checkSpurtStart();
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

    // 坂では道路の基準の高さを少し動かして、上りは前方の坂が、下りは下った先が見えるようにする
    const targetAnchor = BASE_ROAD_Y + Phaser.Math.Clamp(this.runner.grade * 7, -48, 48);
    this.anchorRoadY += (targetAnchor - this.anchorRoadY) * Math.min(1, delta / 500);

    this.updateRunnerSprite(now);
    this.drawWorld(time);
    this.drawHud(now);
    this.effects.updateStreaks(this.state === "running" ? this.runner.actualSpeed : 0, this.dir, time);
  }

  /** 10区でラストスパートの区間に入った瞬間 */
  private checkSpurtStart(): void {
    const spurt = inSpurt(this.section.no, this.runner.distanceKm);
    if (spurt && !this.wasInSpurt) {
      this.effects.bigText("ラストスパート！連打しろ！", GAME_WIDTH / 2, 236, "#8e44ad", 44);
      this.effects.sparkle(GAME_WIDTH / 2, 236, 24, 0xd291ff);
    }
    this.wasInSpurt = spurt;
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
    const relayWorldKm = this.runnerWorldKm;
    this.race.recordSection(time);
    this.race.advance();
    this.section = this.race.section;
    this.runner.handOver(this.section);
    this.slopeBonus = new SlopeBonus(this.section.no, SCORE_CONFIG);
    this.lastSpurt = new LastSpurt(this.section.no);
    this.startedAt = now;
    this.ranPrev = true;
    this.updateSectionTitle();

    // 走り終えた走者は中継所に残り、襷が次の走者（プレイヤー）へ飛んでいく
    this.prevRunnerKm = relayWorldKm;
    this.prevRunnerAt = now;
    const y = this.laneY(relayWorldKm);
    this.effects.fly("sash", this.runnerX - 40 * this.dir, y - 50, this.runnerX, y - 45, 420, () => {
      this.effects.sparkle(this.runnerX, y - 45, 12, 0xff9a3c);
    });

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
    if (this.lastSpurt.zone) {
      const bonus = this.lastSpurt.bonus(RUN_CONFIG, SCORE_CONFIG);
      // 連打1回ごとのポイントに、平均の勢いに応じたボーナスを足す
      this.race.addSpurt(bonus);
      const mult = sectionMultiplier(this.section.no, SCORE_CONFIG);
      this.effects.bigText(`ラストスパート  +${Math.round(bonus * mult)}`, GAME_WIDTH / 2, 186, "#8e44ad", 34);
    }

    stopBgm(this);

    // ゴールテープを切って紙吹雪
    this.goalTapeBroken = true;
    const y = this.laneY(this.runnerWorldKm);
    this.effects.confetti(this.runnerX, y - 120, 60);
    this.time.delayedCall(250, () => this.effects.confetti(GAME_WIDTH / 2, 120, 70));
    this.time.delayedCall(550, () => this.effects.confetti(this.runnerX + 200 * this.dir, 140, 60));

    const label = this.race.stage === 1 ? "往路ゴール！" : "総合ゴール！";
    this.centerText.setText(`${this.section.to} ${label}`).setVisible(true).setScale(0.4);
    this.tweens.add({ targets: this.centerText, scale: 1.15, duration: 300, ease: "Back.Out" });
    this.subText
      .setText(`区間タイム ${formatTime(time)}   連打 ${this.runner.tapCount}回 / 転倒 ${this.runner.fallCount}回`)
      .setVisible(true);

    this.time.delayedCall(GOAL_PAUSE_MS, () => {
      this.scene.start("StageResultScene", { race: this.race });
    });
  }

  // ---------------------------------------------------------------------------
  // 描画

  /** ランナーのアニメ：連打の速さに合わせて走るモーションの速さを変える。坂では体を傾ける */
  private updateRunnerSprite(now: number): void {
    const sprite = this.runnerSprite;
    const km = this.runnerWorldKm;
    const y = this.laneY(km);
    sprite.setPosition(this.runnerX, y);

    if (this.runner.isFallen(now)) {
      sprite.anims.stop();
      sprite.setFrame("run2").setAngle(80 * this.dir).setY(y - 4);
      return;
    }
    const speed = this.state === "arrived" ? 0.3 : this.runner.actualSpeed;
    if (speed < 0.03 && this.state !== "arrived") {
      sprite.anims.stop();
      sprite.setFrame("stand");
    } else {
      if (!sprite.anims.isPlaying) sprite.play("run");
      sprite.anims.timeScale = 0.35 + speed * 1.3;
    }
    // 道路の傾きに合わせて体を傾け、速いほど少し前傾する
    const dx = this.toScreenX(km + 0.05) - this.toScreenX(km - 0.05);
    const dy = this.laneY(km + 0.05) - this.laneY(km - 0.05);
    const slopeDeg = dx === 0 ? 0 : Phaser.Math.RadToDeg(Math.atan(dy / dx));
    sprite.setAngle(slopeDeg + this.runner.speedRatio * 6 * this.dir);
  }

  private drawWorld(timeMs: number): void {
    const pxPerKm = this.pxPerKm;
    const offsetPx = this.runnerWorldKm * pxPerKm;
    const stageSections = sectionsOfStage(this.race.stage);
    const sceneryAt = (px: number): Scenery => {
      let start = 0;
      for (const s of stageSections) {
        start += s.distanceKm * pxPerKm;
        if (px < start) return sceneryOf(s.no);
      }
      return sceneryOf(stageSections[stageSections.length - 1].no);
    };
    // 小田原中継所（往路は4区のゴール、復路は6区のゴール）の位置
    let odawaraPx: number | null = null;
    let km = 0;
    for (const s of stageSections) {
      km += s.distanceKm;
      if (s.to === "小田原") odawaraPx = km * pxPerKm;
    }
    this.background.update(offsetPx, sceneryAt, timeMs, odawaraPx);

    this.drawZones();
    this.drawRoad(timeMs);
    this.drawFans(timeMs);
    this.drawCourseObjects(timeMs);
    this.drawOtherRunners(timeMs);
  }

  /** 坂に合わせて傾いた道路（草地・車道・路肩）と中央線 */
  private drawRoad(_timeMs: number): void {
    const r = this.road;
    r.clear();
    const step = 16;
    const xs: number[] = [];
    for (let x = -step; x <= GAME_WIDTH + step; x += step) xs.push(x);
    const tops = xs.map((x) => this.roadTop(this.worldKmAt(x)));
    const band = (fromOff: number, toOff: number | null, color: number) => {
      const pts = xs.map((x, i) => new Phaser.Math.Vector2(x, tops[i] + fromOff));
      for (let i = xs.length - 1; i >= 0; i--) {
        pts.push(new Phaser.Math.Vector2(xs[i], toOff === null ? GAME_HEIGHT : tops[i] + toOff));
      }
      r.fillStyle(color, 1).fillPoints(pts, true);
    };
    band(0, null, 0x2d3036);
    band(0, 18, 0x6b8e4e);
    band(18, 22, 0xd9d4c3);
    band(22, 128, 0x4a4f57);
    band(128, 134, 0xd9d4c3);

    // 中央線（世界に固定された破線）
    const dashKm = 80 / this.pxPerKm;
    const leftKm = Math.min(this.worldKmAt(0), this.worldKmAt(GAME_WIDTH));
    const rightKm = Math.max(this.worldKmAt(0), this.worldKmAt(GAME_WIDTH));
    r.lineStyle(6, 0xf5f5f5, 1);
    for (let k = Math.floor(leftKm / dashKm) - 1; k * dashKm < rightKm + dashKm; k++) {
      const a = k * dashKm;
      const b = a + dashKm / 2;
      r.lineBetween(this.toScreenX(a), this.roadTop(a) + 78, this.toScreenX(b), this.roadTop(b) + 78);
    }
  }

  /** 沿道の観客。中継所・ゴールの近くや応援ポイントほど多く、街の区間は山の区間より多い */
  private drawFans(timeMs: number): void {
    const stageSections = sectionsOfStage(this.race.stage);
    const hot: number[] = [];
    let start = 0;
    for (const s of stageSections) {
      hot.push(start + s.distanceKm);
      for (const item of this.trackerOf(s.no - 1).items) if (item.kind === "cheer") hot.push(start + item.km);
      start += s.distanceKm;
    }
    const density = (km: number): number => {
      const near = hot.some((h) => km > h - 1.2 && km < h + 0.4);
      if (near) return 0.95;
      if (km < 0.8) return 0.8;
      let s0 = 0;
      for (const s of stageSections) {
        if (km < s0 + s.distanceKm) {
          const scenery = sceneryOf(s.no);
          return scenery === "city" ? 0.45 : scenery === "coast" ? 0.25 : 0.12;
        }
        s0 += s.distanceKm;
      }
      return 0.3;
    };

    const slotKm = FAN_SLOT_PX / this.pxPerKm;
    const leftKm = Math.min(this.worldKmAt(-20), this.worldKmAt(GAME_WIDTH + 20));
    const rightKm = Math.max(this.worldKmAt(-20), this.worldKmAt(GAME_WIDTH + 20));
    let idx = 0;
    for (let n = Math.floor(leftKm / slotKm); n * slotKm <= rightKm && idx < this.fans.length; n++) {
      const km = n * slotKm;
      if (km < 0 || hash(n) > density(km)) continue;
      const color = Math.floor(hash(n + 7) * FAN_COLORS.length);
      // 腕を振るタイミングを人ごとにずらす
      const up = Math.floor(timeMs / 260 + hash(n + 3) * 4) % 2;
      const bob = up ? 2 : 0;
      this.fans[idx++]
        .setFrame(`fan${color}_${up}`)
        .setPosition(this.toScreenX(km) + (hash(n + 11) - 0.5) * 10, this.roadTop(km) + 15 - bob)
        .setScale(0.9 + hash(n + 5) * 0.25)
        .setVisible(true);
    }
    for (let i = idx; i < this.fans.length; i++) this.fans[i].setVisible(false);
  }

  /** 距離表示、中継所・ゴール、給水・応援・黒たまご、ラストスパートのスタートライン */
  private drawCourseObjects(timeMs: number): void {
    const g = this.worldGfx;
    g.clear();
    const stageSections = sectionsOfStage(this.race.stage);
    const stepKm = Math.max(1, Math.ceil(MIN_LABEL_GAP_PX / this.pxPerKm));
    const inView = (x: number, margin: number) => x > -margin && x < GAME_WIDTH + margin;
    let labelIdx = 0;
    let postIdx = 0;
    let itemIdx = 0;
    let eggIdx = 0;
    let startKm = 0;
    for (const s of stageSections) {
      const endKm = startKm + s.distanceKm;
      // 距離表示（各区間のスタートからの km）
      for (let km = stepKm; km < s.distanceKm && labelIdx < this.kmLabels.length; km += stepKm) {
        const x = this.toScreenX(startKm + km);
        if (!inView(x, 50)) continue;
        const top = this.roadTop(startKm + km);
        this.kmLabels[labelIdx++].setText(`${km}km`).setPosition(x, top + 96).setVisible(true);
        g.fillStyle(0xffffff, 0.9).fillRect(x - 2, top + 22, 4, 70);
      }

      // 給水・応援・黒たまご
      const tracker = this.trackerOf(s.no - 1);
      tracker.items.forEach((item, i) => {
        const km = startKm + item.km;
        const x = this.toScreenX(km);
        const grade = tracker.results.get(i);
        // 取ったものは消える。取り損ねたものは薄く残す
        if (!inView(x, 60) || itemIdx >= this.itemLabels.length || (grade && grade !== "MISS")) return;
        const alpha = grade === "MISS" ? 0.35 : 1;
        const base = this.roadTop(km) + 26;
        let labelY: number;
        if (item.kind === "egg" && eggIdx < this.eggImages.length) {
          // 黒たまごはふわふわ浮いている
          const float = Math.sin(timeMs / 200 + i) * 4;
          this.eggImages[eggIdx++].setPosition(x, base - 6 + float).setAlpha(alpha).setVisible(true);
          labelY = base - 44;
        } else {
          labelY = this.drawItem(g, item.kind, x, base, alpha);
        }
        this.itemLabels[itemIdx++]
          .setText(ITEM_NAMES[item.kind])
          .setBackgroundColor(ITEM_LABEL_COLORS[item.kind])
          .setPosition(x, labelY)
          .setAlpha(alpha)
          .setVisible(true);
      });

      // 中継所・ゴール
      const postX = this.toScreenX(endKm);
      if (inView(postX, 100) && postIdx < this.postLabels.length) {
        const isGoal = s === stageSections[stageSections.length - 1];
        const top = this.roadTop(endKm);
        this.postLabels[postIdx++].setText(isGoal ? `${s.to} ゴール` : `${s.to}中継所`).setPosition(postX, top - 104).setVisible(true);
        // 中継線（ゴールは市松模様）
        if (isGoal) {
          for (let yy = top + 22; yy < top + 128; yy += 10) {
            g.fillStyle(((yy - top) / 10) % 2 < 1 ? 0xffffff : 0x222222, 1).fillRect(postX - 6, yy, 6, 10);
            g.fillStyle(((yy - top) / 10) % 2 < 1 ? 0x222222 : 0xffffff, 1).fillRect(postX, yy, 6, 10);
          }
        } else {
          g.fillStyle(0xffffff, 1).fillRect(postX - 3, top + 22, 6, 106);
        }
        // 看板の柱
        g.fillStyle(0x7a3b2e, 1).fillRect(postX - 70, top - 104, 6, 126).fillRect(postX + 64, top - 104, 6, 126);
        // ゴールテープ
        if (isGoal) {
          const tapeY = top + 6;
          if (!this.goalTapeBroken) {
            g.fillStyle(0xffffff, 1).fillRect(postX - 64, tapeY, 128, 4);
            g.fillStyle(0xe74c3c, 1).fillRect(postX - 64, tapeY + 4, 128, 3);
          } else {
            // 切れて垂れ下がったテープ
            g.lineStyle(4, 0xe74c3c, 1);
            g.lineBetween(postX - 64, tapeY, postX - 40, tapeY + 34);
            g.lineBetween(postX + 64, tapeY, postX + 40, tapeY + 34);
          }
        }
      }

      // ラストスパートのスタートライン（紫のラインと旗）
      const spurt = spurtZoneOf(s.no);
      if (spurt) {
        const km = startKm + spurt.fromKm;
        const x = this.toScreenX(km);
        if (inView(x, 120)) {
          const top = this.roadTop(km);
          g.fillStyle(0x8e44ad, 1).fillRect(x - 4, top + 22, 8, 106);
          g.fillStyle(0x7a3b2e, 1).fillRect(x - 3, top - 70, 4, 92);
          g.fillStyle(0xd291ff, 1).fillTriangle(x + 1 * this.dir, top - 70, x + 1 * this.dir, top - 44, x + 36 * this.dir, top - 57);
          this.landmarkLabel.setText("ここからラストスパート！").setPosition(x, top - 76).setVisible(true);
        } else {
          this.landmarkLabel.setVisible(false);
        }
      }
      startKm = endKm;
    }
    if (!stageSections.some((s) => spurtZoneOf(s.no))) this.landmarkLabel.setVisible(false);
    for (let i = labelIdx; i < this.kmLabels.length; i++) this.kmLabels[i].setVisible(false);
    for (let i = postIdx; i < this.postLabels.length; i++) this.postLabels[i].setVisible(false);
    for (let i = itemIdx; i < this.itemLabels.length; i++) this.itemLabels[i].setVisible(false);
    for (let i = eggIdx; i < this.eggImages.length; i++) this.eggImages[i].setVisible(false);
  }

  /** 給水所と応援の旗を描く。看板を置く y を返す */
  private drawItem(g: Phaser.GameObjects.Graphics, kind: ItemKind, x: number, base: number, alpha: number): number {
    if (kind === "water") {
      // 給水所の机（白いテーブルクロス）とコップ
      g.fillStyle(0x2e86de, alpha).fillRect(x - 24, base - 30, 48, 30);
      g.fillStyle(0xffffff, alpha).fillRect(x - 26, base - 34, 52, 8);
      g.fillStyle(0xffffff, alpha).fillRect(x - 16, base - 46, 9, 12).fillRect(x + 7, base - 46, 9, 12);
      g.fillStyle(0x4aa3ff, alpha).fillRect(x - 14, base - 44, 5, 4).fillRect(x + 9, base - 44, 5, 4);
      return base - 50;
    }
    // 応援の旗（風になびく）
    g.fillStyle(0x7a3b2e, alpha).fillRect(x - 2, base - 96, 4, 96);
    g.fillStyle(0xe67e22, alpha).fillTriangle(x + 2 * this.dir, base - 96, x + 2 * this.dir, base - 64, x + 44 * this.dir, base - 80);
    return base - 102;
  }

  /** 中継所で待つ次の走者と、渡し終えて残る前の走者 */
  private drawOtherRunners(timeMs: number): void {
    // 次の走者：中継線の少し先で、手を振って待っている
    const next = this.nextRunner;
    if (!this.race.isStageLastSection) {
      const km = this.sectionStartWorldKm(this.section.no) + this.section.distanceKm + 30 / this.pxPerKm;
      const x = this.toScreenX(km);
      const visible = x > -60 && x < GAME_WIDTH + 60;
      next.setVisible(visible);
      if (visible) {
        // 走ってくる仲間のほうを向き、手を振る
        next
          .setPosition(x, this.laneY(km))
          .setFlipX(this.dir === 1)
          .setFrame(Math.floor(timeMs / 280) % 2 === 0 ? "wave" : "stand");
      }
    } else {
      next.setVisible(false);
    }

    // 前の走者：中継所でゆっくり歩き、だんだん消える
    const prev = this.prevRunner;
    if (this.prevRunnerKm === null) {
      prev.setVisible(false);
      return;
    }
    const elapsed = performance.now() - this.prevRunnerAt;
    if (elapsed > 3000) {
      this.prevRunnerKm = null;
      prev.setVisible(false);
      return;
    }
    const km = this.prevRunnerKm + (Math.min(elapsed, 1200) / 1000) * (60 / this.pxPerKm);
    prev
      .setVisible(true)
      .setPosition(this.toScreenX(km), this.laneY(km))
      .setFlipX(this.dir === -1)
      .setAlpha(1 - elapsed / 3000);
    if (elapsed > 600) {
      prev.anims.stop();
      prev.setFrame(Math.floor(timeMs / 300) % 2 === 0 ? "wave" : "stand");
    } else if (!prev.anims.isPlaying) {
      prev.play("run");
      prev.anims.timeScale = 0.6;
    }
  }

  /** 7区の日差しが強い区間（空を黄色く、太陽を出す） */
  private drawZones(): void {
    const g = this.zoneGfx;
    g.clear();
    let startKm = 0;
    let zoneLabelX: number | null = null;
    let sunAlpha = 0;
    for (const s of sectionsOfStage(this.race.stage)) {
      const sunny = sunnyZoneOf(s.no);
      if (sunny) {
        const a = this.toScreenX(startKm + sunny.fromKm);
        const b = this.toScreenX(startKm + sunny.toKm);
        const left = Math.max(0, Math.min(a, b));
        const right = Math.min(GAME_WIDTH, Math.max(a, b));
        if (right > left) {
          g.fillStyle(0xffd75e, 0.32).fillRect(left, 0, right - left, GAME_HEIGHT);
          // 看板は、画面に見えている日差しの区間の真ん中に出す
          zoneLabelX = (left + right) / 2;
          sunAlpha = (right - left) / GAME_WIDTH;
        }
      }
      startKm += s.distanceKm;
    }
    this.background.sun.setAlpha(sunAlpha);
    this.zoneLabel.setVisible(zoneLabelX !== null);
    if (zoneLabelX !== null) {
      this.zoneLabel
        .setText(`日差しが強い  給水×${SCORE_CONFIG.sunnyWaterMultiplier}`)
        .setPosition(zoneLabelX, this.roadTop(this.worldKmAt(zoneLabelX)) - 120);
    }
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
    // ゲージの長さは出ている範囲に比例（応援は長く、黒たまごは短い）。短すぎると見えないので最低限の長さはとる
    const cx = GAME_WIDTH / 2;
    const y = 94;
    const half = Phaser.Math.Clamp(target.gaugePx * GAUGE_PX_SCALE, GAUGE_MIN_HALF, GAUGE_MAX_HALF);
    const scale = half / target.gaugePx;
    g.fillStyle(0x10243e, 0.35).fillRoundedRect(cx - half - 6, y - 10, half * 2 + 12, 36, 8);
    g.fillStyle(0xffffff, 0.95).fillRect(cx - half, y, half * 2, 16);
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
    const notStarted = this.state === "ready" || this.state === "countdown";
    const elapsed = notStarted ? 0 : (this.state === "arrived" ? this.arrivedAt : now) - this.startedAt;
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

    // ポイント。増えたら弾ませて「+N」を出す
    const points = this.race.breakdown().total;
    this.pointsText.setText(`${points.toLocaleString()} pt`);
    if (points > this.lastPoints) {
      const gained = points - this.lastPoints;
      this.tweens.killTweensOf([this.pointsText, this.plusText]);
      this.pointsText.setScale(1.18);
      this.tweens.add({ targets: this.pointsText, scale: 1, duration: 220, ease: "Quad.Out" });
      // 「+N」はポイントの左に出す
      this.plusText
        .setText(`+${gained.toLocaleString()}`)
        // 弾んで大きくなったポイントの表示に重ならないよう、拡大後の幅ぶん離す
        .setPosition(GAME_WIDTH - 24 - this.pointsText.width * 1.2 - 14, 86)
        .setAlpha(1)
        .setVisible(true);
      this.tweens.add({ targets: this.plusText, y: 74, alpha: 0, delay: 300, duration: 500 });
    }
    this.lastPoints = points;

    const mult = sectionMultiplier(this.section.no, SCORE_CONFIG);
    const comboLines = [
      `コンボ ${this.combo.combo}  リズム×${this.combo.multiplier.toFixed(1)}`,
      mult !== 1 ? `${this.section.no}区はポイント×${mult}` : "",
      this.slopeBonusLabel() || this.specialLabel(),
    ].filter((l) => l !== "");
    this.comboText.setText(comboLines.join("\n"));
    this.drawRelayGauge();

    // HUD の下地（背景の上でも文字が読めるように）
    const panel = this.hudPanel;
    panel.clear();
    panel.fillStyle(0xffffff, 0.72);
    panel.fillRoundedRect(12, 6, Math.max(this.sectionTitle.width, this.hud.width) + 26, this.hud.y + this.hud.height - 2, 10);
    const rightW = Math.max(336, this.comboText.width + 26);
    panel.fillRoundedRect(GAME_WIDTH - rightW - 10, 4, rightW, this.comboText.y + this.comboText.height + 6, 10);

    // 中央のメッセージの下地
    const mp = this.messagePanel;
    mp.clear();
    if (this.centerText.visible) {
      const below = this.controlsText.visible ? this.controlsText : this.subText.visible ? this.subText : null;
      const w = Math.max(this.centerText.width * this.centerText.scaleX, below ? below.width : 0) + 60;
      const top = this.titleText.visible ? this.titleText.y - 40 : this.centerText.y - 34;
      const bottom = !below ? this.centerText.y + 30 : below === this.controlsText ? below.y + below.height + 14 : below.y + 22;
      mp.fillStyle(0xffffff, 0.6).fillRoundedRect(GAME_WIDTH / 2 - w / 2, top, w, bottom - top, 14);
    }

    // 高低図（進捗バーを兼ねる）
    const p = this.progressBar;
    const x = GAME_WIDTH - 324;
    const w = 300;
    p.clear();
    this.drawProfile(p, x, 8, w, 34);

    // 押す間隔ゲージ：前回の連打からの経過時間。赤（早すぎ）を抜けて緑になってから押す
    // 下り坂では赤（押しすぎ）の範囲が広がる。ラストスパート中は全部緑
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
      this.effects.bigText(
        e.cleared ? `最高地点 到達！  +${e.points}` : "最高地点 到達（勢い不足）",
        GAME_WIDTH / 2,
        186,
        e.cleared ? "#2e9e4f" : "#7a7a7a",
        34,
      );
      if (e.cleared) this.effects.confetti(this.runnerX, this.laneY(this.runnerWorldKm) - 100, 50);
      return;
    }
    // 区切りごとの結果はランナーの頭の上に小さく出す
    const text = e.cleared ? `${e.index}/${e.total} クリア +${e.points}` : `${e.index}/${e.total} 勢い不足`;
    this.showSmallPop(text, e.cleared ? "#2e9e4f" : "#7a7a7a");
    if (e.cleared) this.effects.sparkle(this.runnerX, this.laneY(this.runnerWorldKm) - 60, 8, 0x7fd67f);
  }

  /** 7区の日差し・10区のラストスパートの表示（その区間以外では空） */
  private specialLabel(): string {
    const km = this.runner.distanceKm;
    const sunny = sunnyZoneOf(this.section.no);
    if (sunny) {
      if (km < sunny.fromKm) return `この先 日差しが強い区間：給水ポイント×${SCORE_CONFIG.sunnyWaterMultiplier}`;
      if (isSunny(this.section.no, km)) return `日差しが強い！ 給水ポイント×${SCORE_CONFIG.sunnyWaterMultiplier}`;
      return "";
    }
    const spurt = this.lastSpurt.zone;
    if (spurt) {
      if (km < spurt.fromKm) return `${spurt.fromKm}kmからラストスパート`;
      const avg = this.lastSpurt.average ?? 0;
      const est = this.lastSpurt.bonus(RUN_CONFIG, SCORE_CONFIG);
      const tapPoints = this.race.currentScore.spurt;
      return `ラストスパート！連打しろ！ 連打 +${tapPoints}  勢いボーナス +${est}見込み`;
    }
    return "";
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

    g.fillStyle(0xffffff, 0.9).fillRoundedRect(x - 4, y - 2, w + 8, h + 4, 6);
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
