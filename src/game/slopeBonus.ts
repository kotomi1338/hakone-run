// 坂ボーナス（5区・6区）。画面（Phaser）に依存しない。
//
// 5区（山登り）：上り坂を約1kmごとに区切り、区切りごとの平均の勢いが目安以上ならポイント。
//               最高地点に着いたとき、上り全体の平均の勢いが目安以上なら大きめのボーナス。
// 6区（山下り）：下り坂で、転ばずに目安以上の勢いを保てた距離に比例してポイント。
//
// 「勢い」は連打の勢い（Runner.speedRatio、最高で 1）。坂で遅くなる分は含まないので、
// 急な坂でもゆるい坂でも、同じだけ頑張れば同じ評価になる。転んでいる間は 0。

import type { ScoreConfig } from "./config";
import { terrainOf } from "./terrain";

export const CLIMB_NAME = "山登り";
export const DESCENT_NAME = "山下り";

export type SlopeBonusEvent =
  | { kind: "checkpoint"; index: number; total: number; average: number; cleared: boolean; points: number }
  | { kind: "summit"; average: number; cleared: boolean; points: number };

export interface Zone {
  fromKm: number;
  toKm: number;
}

/** 名前のついた坂の範囲（つながった坂をまとめて1つにする） */
export function zoneOf(sectionNo: number, name: string): Zone | null {
  const segs = terrainOf(sectionNo).filter((s) => s.name === name);
  if (segs.length === 0) return null;
  return { fromKm: Math.min(...segs.map((s) => s.fromKm)), toKm: Math.max(...segs.map((s) => s.toKm)) };
}

/** 山登りの区切り（km）。約1kmごとで、最後は最高地点。半端に短い最後の区切りは前とまとめる */
export function climbCheckpoints(zone: Zone): number[] {
  const points: number[] = [];
  for (let km = Math.floor(zone.fromKm) + 1; km < zone.toKm - 0.5; km++) points.push(km);
  points.push(zone.toKm);
  return points;
}

export class SlopeBonus {
  /** この区間でもらった坂ボーナスの合計 */
  points = 0;
  /** 山登り：通過した区切りの数・クリアした区切りの数 */
  passed = 0;
  cleared = 0;
  /** 山下り：目安以上の勢いを保てた距離（km） */
  keptKm = 0;

  readonly climb: Zone | null;
  readonly descent: Zone | null;
  readonly checkpoints: number[];

  private readonly score: ScoreConfig;
  private lastKm: number;
  /** 今の区切りの「勢い × 時間」と時間 */
  private segEffortMs = 0;
  private segMs = 0;
  /** 上り全体の「勢い × 時間」と時間 */
  private climbEffortMs = 0;
  private climbMs = 0;

  constructor(sectionNo: number, score: ScoreConfig, startKm = 0) {
    this.score = score;
    this.climb = zoneOf(sectionNo, CLIMB_NAME);
    this.descent = zoneOf(sectionNo, DESCENT_NAME);
    this.checkpoints = this.climb ? climbCheckpoints(this.climb) : [];
    this.lastKm = startKm;
  }

  /** 坂ボーナスのある区間か */
  get active(): boolean {
    return this.climb !== null || this.descent !== null;
  }

  /** 山登りの、今の区切りでの平均の勢い（まだ測っていなければ null） */
  get segmentAverage(): number | null {
    return this.segMs > 0 ? this.segEffortMs / this.segMs : null;
  }

  /** 今山登りの中にいるか（最高地点の手前） */
  inClimb(km: number): boolean {
    return this.climb !== null && km >= this.climb.fromKm && this.passed < this.checkpoints.length;
  }

  /** 今山下りの中にいるか */
  inDescent(km: number): boolean {
    return this.descent !== null && km >= this.descent.fromKm && km < this.descent.toKm;
  }

  /**
   * 毎フレーム呼ぶ。km は区間のスタートからの距離、effort は今の勢い（転倒中は 0）。
   * 区切りを通過したらイベントを返す。
   */
  update(km: number, effort: number, dtMs: number): SlopeBonusEvent[] {
    const events: SlopeBonusEvent[] = [];
    const prevKm = this.lastKm;
    this.lastKm = km;

    if (this.inClimb(prevKm) || (this.climb && prevKm < this.climb.fromKm && km >= this.climb.fromKm)) {
      this.segEffortMs += effort * dtMs;
      this.segMs += dtMs;
      this.climbEffortMs += effort * dtMs;
      this.climbMs += dtMs;
      // 1フレームで区切りを2つ越えることもあるので while
      while (this.passed < this.checkpoints.length && km >= this.checkpoints[this.passed]) {
        events.push(...this.passCheckpoint());
      }
    }

    if (this.descent && effort >= this.score.downhillTargetEffort) {
      const from = Math.max(prevKm, this.descent.fromKm);
      const to = Math.min(km, this.descent.toKm);
      if (to > from) {
        const before = this.descentPoints;
        this.keptKm += to - from;
        this.points += this.descentPoints - before;
      }
    }
    return events;
  }

  private get descentPoints(): number {
    return Math.floor(this.keptKm * this.score.downhillPointsPerKm);
  }

  private passCheckpoint(): SlopeBonusEvent[] {
    const events: SlopeBonusEvent[] = [];
    const average = this.segMs > 0 ? this.segEffortMs / this.segMs : 0;
    const cleared = average >= this.score.hillTargetEffort;
    const points = cleared ? this.score.hillCheckpointPoints : 0;
    this.passed++;
    if (cleared) this.cleared++;
    this.points += points;
    events.push({ kind: "checkpoint", index: this.passed, total: this.checkpoints.length, average, cleared, points });
    this.segEffortMs = 0;
    this.segMs = 0;

    if (this.passed === this.checkpoints.length) {
      const climbAverage = this.climbMs > 0 ? this.climbEffortMs / this.climbMs : 0;
      const summitCleared = climbAverage >= this.score.hillTargetEffort;
      const summitPoints = summitCleared ? this.score.summitBonus : 0;
      this.points += summitPoints;
      events.push({ kind: "summit", average: climbAverage, cleared: summitCleared, points: summitPoints });
    }
    return events;
  }
}
