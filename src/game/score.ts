// ポイント計算。画面（Phaser）に依存しない純粋なロジック（score.test.ts でテストする）。
//
// 区間ごとにもらえるポイント：
// - タイム：区間タイムが速いほど多い（最高速で走り切ったときが満点）
// - リズム：ジャストタイミングの間隔で連打し続けるとコンボがつながり、倍率が上がる
// - 襷：中継線を越える瞬間にエンター。ぴったりで PERFECT、少しずれて GOOD
// - 坂：5区の山登り・6区の山下り（slopeBonus.ts）
// - 給水・応援・黒たまご：目印に合わせてエンター（items.ts）。7区の日差しが強い区間の給水は2倍
// - ラストスパート：10区のラスト約60%の連打の速さ（spurt.ts）
// 6区以降の区間はこれらの合計に倍率（1.2倍）をかける。
// 10区間すべて襷をつないでゴールすると、全区間ボーナスを加える（倍率はかけない）。

import type { RunConfig, ScoreConfig, SectionConfig } from "./config";

export type RelayGrade = "PERFECT" | "GOOD" | "MISS";

/** 1区間で獲得したポイント（6区以降の倍率をかける前） */
export interface SectionScore {
  time: number;
  rhythm: number;
  relay: number;
  /** 坂ボーナス（5区・6区） */
  slope: number;
  /** 給水・応援・黒たまご */
  items: number;
  /** 給水・応援・黒たまごを取れた数・判定した数 */
  itemsGot: number;
  itemsJudged: number;
  /** 10区：ラストスパートボーナス */
  spurt: number;
  /** 襷の判定。中継所のない区間（5区・10区）やまだ判定していないときは null */
  relayGrade: RelayGrade | null;
  /** その区間でつながった最大コンボ */
  maxCombo: number;
}

export function emptySectionScore(): SectionScore {
  return { time: 0, rhythm: 0, relay: 0, slope: 0, items: 0, itemsGot: 0, itemsJudged: 0, spurt: 0, relayGrade: null, maxCombo: 0 };
}

/**
 * タイムポイント：最高速で走り切ったタイム（idealMs、坂の影響も含む）を満点として、
 * かかった時間に反比例して減る
 */
export function timePoints(section: SectionConfig, timeMs: number, idealMs: number, score: ScoreConfig): number {
  if (timeMs <= 0) return 0;
  const fullMarks = score.timePointsPerKm * section.distanceKm;
  return Math.round(fullMarks * Math.min(1, idealMs / timeMs));
}

/** コンボ数に応じたリズムポイントの倍率 */
export function comboMultiplier(combo: number, score: ScoreConfig): number {
  const steps = Math.floor(combo / Math.max(1, score.comboStep));
  return Math.min(score.maxComboMultiplier, 1 + steps * score.comboMultiplierStep);
}

/**
 * リズムのコンボ。前回の連打からの間隔がジャストタイミング ± 許容幅に入るとコンボがつながる。
 * 外れたらコンボは 0 に戻る（その連打から数え直し）。
 */
export class RhythmCombo {
  combo = 0;
  maxCombo = 0;
  private lastTapAt: number | null = null;
  private readonly run: RunConfig;
  private readonly score: ScoreConfig;

  constructor(run: RunConfig, score: ScoreConfig) {
    this.run = run;
    this.score = score;
  }

  get multiplier(): number {
    return comboMultiplier(this.combo, this.score);
  }

  /** 受け付けた連打を記録して、もらえたリズムポイントを返す */
  tap(now: number): number {
    const last = this.lastTapAt;
    this.lastTapAt = now;
    if (last === null) return 0;

    const gap = Math.abs(now - last - this.run.justIntervalMs);
    if (gap > this.score.rhythmToleranceMs) {
      this.combo = 0;
      return 0;
    }
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    return Math.round(this.score.rhythmPointsPerTap * this.multiplier);
  }

  /** 転んだときなど、コンボを切る */
  break(): void {
    this.combo = 0;
    this.lastTapAt = null;
  }
}

/**
 * 襷の判定。offset は中継線とのずれ（最高速で走っているときのミリ秒。画面上のピクセルと同じ）。
 * 同じ距離のずれでも、速く飛び込むほど判定の時間は短くなる。
 */
export function judgeRelay(offset: number, score: ScoreConfig): RelayGrade {
  const d = Math.abs(offset);
  if (d <= score.relayPerfectMs) return "PERFECT";
  if (d <= score.relayGoodMs) return "GOOD";
  return "MISS";
}

export function relayPoints(grade: RelayGrade, score: ScoreConfig): number {
  if (grade === "PERFECT") return score.relayPerfectPoints;
  if (grade === "GOOD") return score.relayGoodPoints;
  return 0;
}

/** その区間のポイントにかける倍率（6区以降は secondStageMultiplier） */
export function sectionMultiplier(sectionNo: number, score: ScoreConfig): number {
  return sectionNo >= 6 ? score.secondStageMultiplier : 1;
}

export interface SectionBreakdown extends SectionScore {
  no: number;
  /** 倍率をかける前の合計 */
  subtotal: number;
  multiplier: number;
  /** 倍率をかけた後の合計 */
  total: number;
}

export interface ScoreBreakdown {
  /** 走った区間だけ（区間番号順） */
  sections: SectionBreakdown[];
  fullRelayBonus: number;
  total: number;
}

/**
 * 最終ポイントの内訳。
 * scores は区間 1〜10 の順（まだ走っていない区間は null）。
 * allConnected は 10区間すべて襷をつないでゴールしたか。
 */
export function scoreBreakdown(
  scores: readonly (SectionScore | null)[],
  allConnected: boolean,
  score: ScoreConfig,
): ScoreBreakdown {
  const sections: SectionBreakdown[] = [];
  scores.forEach((s, i) => {
    if (s === null) return;
    const no = i + 1;
    const subtotal = s.time + s.rhythm + s.relay + s.slope + s.items + s.spurt;
    const multiplier = sectionMultiplier(no, score);
    sections.push({ ...s, no, subtotal, multiplier, total: Math.round(subtotal * multiplier) });
  });
  const fullRelayBonus = allConnected ? score.fullRelayBonus : 0;
  const total = sections.reduce((sum, s) => sum + s.total, 0) + fullRelayBonus;
  return { sections, fullRelayBonus, total };
}
