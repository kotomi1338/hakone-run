// 連打 → 速度 → 距離 の計算。画面（Phaser）に依存しない純粋なロジック。

import type { RunConfig, SectionConfig } from "./config";

/** 直近 windowMs の連打を記録して、1秒あたりの連打回数を出す */
export class TapMeter {
  private taps: number[] = [];
  private readonly config: RunConfig;

  constructor(config: RunConfig) {
    this.config = config;
  }

  /** 連打を記録する。上限を超えた連打は無視して false を返す */
  tap(now: number): boolean {
    this.prune(now);
    const limit = (this.config.maxRate * this.config.windowMs) / 1000;
    if (this.rate(now) * (this.config.windowMs / 1000) >= limit) return false;
    this.taps.push(now);
    return true;
  }

  /** 1秒あたりの連打回数（直近 windowMs で集計） */
  rate(now: number): number {
    this.prune(now);
    const from = now - this.config.windowMs;
    const count = this.taps.filter((t) => t > from).length;
    return (count * 1000) / this.config.windowMs;
  }

  /** 勢い：各連打が 1 から始まり momentumMs かけて 0 まで減ったものの合計 */
  momentum(now: number): number {
    this.prune(now);
    let sum = 0;
    for (const t of this.taps) sum += 1 - (now - t) / this.config.momentumMs;
    return sum;
  }

  reset(): void {
    this.taps = [];
  }

  private prune(now: number): void {
    const from = now - Math.max(this.config.windowMs, this.config.momentumMs);
    while (this.taps.length > 0 && this.taps[0] <= from) this.taps.shift();
  }
}

export class Runner {
  /** 走った距離（km） */
  distanceKm = 0;
  /** 最高速度を 1 とした今の速度 */
  speedRatio = 0;
  /** 受け付けた連打の合計 */
  tapCount = 0;
  /** 上限超えで無視した連打の合計 */
  rejectedTapCount = 0;
  /** 転んだ回数 */
  fallCount = 0;

  private readonly config: RunConfig;
  private readonly section: SectionConfig;
  private readonly meter: TapMeter;
  /** 最後に受け付けた連打の時刻（転んだ後や開始前は null） */
  lastTapAt: number | null = null;
  /** 「押しすぎ」（前回から fallIntervalMs 未満）が続いている回数 */
  fastStreak = 0;

  private fallenUntil = -Infinity;

  constructor(config: RunConfig, section: SectionConfig) {
    this.config = config;
    this.section = section;
    this.meter = new TapMeter(config);
  }

  isFallen(now: number): boolean {
    return now < this.fallenUntil;
  }

  get finished(): boolean {
    return this.distanceKm >= this.section.distanceKm;
  }

  /** 最高速度で走ったときの 1秒あたりの距離（km） */
  get maxKmPerSec(): number {
    return this.section.distanceKm / this.section.targetSeconds;
  }

  tap(now: number): void {
    if (this.isFallen(now) || this.finished) return;
    if (!this.meter.tap(now)) {
      this.rejectedTapCount++;
      return;
    }
    this.tapCount++;

    // 押しすぎ判定：前回から fallIntervalMs 未満で押すのが fallStreak 回続いたら転ぶ
    const tooFast = this.lastTapAt !== null && now - this.lastTapAt < this.config.fallIntervalMs;
    this.fastStreak = tooFast ? this.fastStreak + 1 : 0;
    this.lastTapAt = now;
    if (this.fastStreak >= this.config.fallStreak) this.fall(now);
  }

  rate(now: number): number {
    return this.isFallen(now) ? 0 : this.meter.rate(now);
  }

  update(now: number, dtMs: number): void {
    if (this.finished) return;

    if (this.isFallen(now)) {
      this.speedRatio = 0;
      return;
    }

    // optimalRate で連打し続けたときの勢いを最高速度とする
    const optimalMomentum = (this.config.optimalRate * this.config.momentumMs) / 1000 / 2;
    const target = Math.min(this.meter.momentum(now) / optimalMomentum, 1);
    const t = Math.min(1, dtMs / this.config.speedSmoothingMs);
    this.speedRatio += (target - this.speedRatio) * t;

    this.distanceKm = Math.min(
      this.section.distanceKm,
      this.distanceKm + this.speedRatio * this.maxKmPerSec * (dtMs / 1000),
    );
  }

  private fall(now: number): void {
    this.fallCount++;
    this.fallenUntil = now + this.config.fallDurationMs;
    this.fastStreak = 0;
    this.lastTapAt = null;
    this.speedRatio = 0;
    this.meter.reset();
  }
}
