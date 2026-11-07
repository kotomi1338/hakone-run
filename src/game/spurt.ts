// 10区のラストスパート。画面（Phaser）に依存しない。
//
// 日本橋を越えた後のラスト約3kmは「押しすぎ」で転ばなくなり、速く連打するほど最高速度を超えてダッシュできる。
// ゴールしたとき、この区間の平均の勢い（最高でダッシュの上限）に比例して大きなボーナス。

import type { RunConfig, ScoreConfig } from "./config";

export interface SpurtZone {
  fromKm: number;
  toKm: number;
  /** ラストスパートが始まる目印 */
  landmark: string;
}

const SPURT_ZONES: Record<number, SpurtZone> = {
  10: { fromKm: 20, toKm: 23.0, landmark: "日本橋" },
};

export function spurtZoneOf(sectionNo: number): SpurtZone | null {
  return SPURT_ZONES[sectionNo] ?? null;
}

export function inSpurt(sectionNo: number, km: number): boolean {
  const zone = spurtZoneOf(sectionNo);
  return zone !== null && km >= zone.fromKm && km <= zone.toKm;
}

/** ラストスパートの平均の勢いを測って、ボーナスを出す */
export class LastSpurt {
  readonly zone: SpurtZone | null;
  private effortMs = 0;
  private ms = 0;
  private readonly sectionNo: number;

  constructor(sectionNo: number) {
    this.sectionNo = sectionNo;
    this.zone = spurtZoneOf(sectionNo);
  }

  /** 毎フレーム呼ぶ。ラストスパートの区間の中だけ数える（転倒中は effort 0） */
  update(km: number, effort: number, dtMs: number): void {
    if (!inSpurt(this.sectionNo, km)) return;
    this.effortMs += effort * dtMs;
    this.ms += dtMs;
  }

  /** ラストスパート区間の平均の勢い（まだ入っていなければ null） */
  get average(): number | null {
    return this.ms > 0 ? this.effortMs / this.ms : null;
  }

  /** ボーナス：平均の勢いがダッシュの上限に近いほど多い */
  bonus(run: RunConfig, score: ScoreConfig): number {
    const avg = this.average;
    if (avg === null) return 0;
    return Math.round(score.spurtBonus * Math.min(1, avg / run.spurtMaxSpeed));
  }
}
