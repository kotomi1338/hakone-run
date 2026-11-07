// レース全体の進み具合（どの区間を走っているか、区間タイム、ポイント）。画面（Phaser）に依存しない。

import {
  COURSE_CONFIG,
  SCORE_CONFIG,
  SECTIONS,
  sectionSeconds,
  SLOPE_CONFIG,
  type CourseConfig,
  type ScoreConfig,
  type SectionConfig,
  type SlopeConfig,
} from "./config";
import { generateItemLayout, type CourseItem, type ItemLayout, type Random } from "./items";
import {
  emptySectionScore,
  relayPoints,
  scoreBreakdown,
  timePoints,
  type RelayGrade,
  type ScoreBreakdown,
  type SectionScore,
} from "./score";

export type Stage = 1 | 2;

export const STAGE_NAMES: Record<Stage, string> = {
  1: "第1ステージ（往路）",
  2: "第2ステージ（復路）",
};

/** 各ステージの最後の区間番号 */
const STAGE_LAST_SECTION: Record<Stage, number> = { 1: 5, 2: 10 };

export function stageOf(section: SectionConfig): Stage {
  return section.no <= STAGE_LAST_SECTION[1] ? 1 : 2;
}

export function sectionsOfStage(stage: Stage): SectionConfig[] {
  return SECTIONS.filter((s) => stageOf(s) === stage);
}

export class Race {
  /** 今走っている区間（SECTIONS の添字） */
  sectionIndex: number;
  /** 区間ごとのタイム（ミリ秒）。まだ走っていない・飛ばした区間は null */
  readonly sectionTimesMs: (number | null)[] = SECTIONS.map(() => null);
  /** 区間ごとのポイント（倍率をかける前）。まだ走っていない・飛ばした区間は null */
  readonly sectionScores: (SectionScore | null)[] = SECTIONS.map(() => null);

  private readonly course: CourseConfig;
  private readonly score: ScoreConfig;
  private readonly slope: SlopeConfig;
  /** このレースの給水・応援・黒たまごの配置（給水と黒たまごはレースごとにランダム） */
  readonly itemLayout: ItemLayout;

  constructor(
    startIndex = 0,
    course: CourseConfig = COURSE_CONFIG,
    score: ScoreConfig = SCORE_CONFIG,
    slope: SlopeConfig = SLOPE_CONFIG,
    random: Random = Math.random,
  ) {
    this.sectionIndex = Math.min(Math.max(0, startIndex), SECTIONS.length - 1);
    this.course = course;
    this.score = score;
    this.slope = slope;
    this.itemLayout = generateItemLayout(random);
  }

  /** その区間の給水・応援・黒たまご（距離の順） */
  itemsOf(sectionNo: number): readonly CourseItem[] {
    return this.itemLayout[sectionNo] ?? [];
  }

  /** 今走っている区間のポイント（走り始めたら作られる） */
  get currentScore(): SectionScore {
    return (this.sectionScores[this.sectionIndex] ??= emptySectionScore());
  }

  get section(): SectionConfig {
    return SECTIONS[this.sectionIndex];
  }

  get stage(): Stage {
    return stageOf(this.section);
  }

  get nextSection(): SectionConfig | undefined {
    return SECTIONS[this.sectionIndex + 1];
  }

  /** ステージのスタートから今の区間のスタート（中継所）までの距離（km） */
  get sectionStartKm(): number {
    return sectionsOfStage(this.stage)
      .filter((s) => s.no < this.section.no)
      .reduce((sum, s) => sum + s.distanceKm, 0);
  }

  /** 今の区間がステージの最後（5区・10区）か */
  get isStageLastSection(): boolean {
    return this.section.no === STAGE_LAST_SECTION[this.stage];
  }

  /** 10区まで走り終えたか */
  get isFinished(): boolean {
    return this.sectionIndex === SECTIONS.length - 1 && this.sectionTimesMs[this.sectionIndex] !== null;
  }

  /** 今の区間のタイムを記録し、タイムポイントをつける */
  recordSection(timeMs: number): void {
    this.sectionTimesMs[this.sectionIndex] = timeMs;
    const idealMs = sectionSeconds(this.section, this.course, this.slope) * 1000;
    this.currentScore.time = timePoints(this.section, timeMs, idealMs, this.score);
  }

  /** 今の区間にリズムポイントを足す */
  addRhythm(points: number, combo: number): void {
    const s = this.currentScore;
    s.rhythm += points;
    s.maxCombo = Math.max(s.maxCombo, combo);
  }

  /** 今の区間の坂ボーナスの合計を記録する */
  setSlope(points: number): void {
    this.currentScore.slope = points;
  }

  /** 今の区間のラストスパートボーナスを記録する */
  setSpurt(points: number): void {
    this.currentScore.spurt = points;
  }

  /** 今の区間のラストスパートのポイントに足す（連打1回ごとのポイントや、ゴール時のボーナス） */
  addSpurt(points: number): void {
    this.currentScore.spurt += points;
  }

  /** 今の区間に給水・応援・黒たまごの結果を足す */
  addItem(points: number, got: boolean): void {
    const s = this.currentScore;
    s.items += points;
    s.itemsJudged++;
    if (got) s.itemsGot++;
  }

  /** index 番目の区間の襷の判定を記録する（判定済みなら何もしない） */
  setRelay(index: number, grade: RelayGrade): void {
    const s = (this.sectionScores[index] ??= emptySectionScore());
    if (s.relayGrade !== null) return;
    s.relayGrade = grade;
    s.relay = relayPoints(grade, this.score);
  }

  /** 10区間すべて走り、襷をつないだか（今は繰り上げがないので、全区間を走れば true） */
  get allConnected(): boolean {
    return this.isFinished && this.sectionTimesMs.every((t) => t !== null);
  }

  /** 今までのポイントの内訳（走っている途中の区間のリズムポイントも含む） */
  breakdown(): ScoreBreakdown {
    return scoreBreakdown(this.sectionScores, this.allConnected, this.score);
  }

  /** 次の区間へ進む。最後の区間なら何もしない */
  advance(): void {
    if (this.sectionIndex < SECTIONS.length - 1) this.sectionIndex++;
  }

  /** 記録済みの区間タイムの合計（ステージ指定なしなら全区間） */
  totalMs(stage?: Stage): number {
    return SECTIONS.reduce((sum, s, i) => {
      if (stage !== undefined && stageOf(s) !== stage) return sum;
      return sum + (this.sectionTimesMs[i] ?? 0);
    }, 0);
  }
}
