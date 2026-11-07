import { describe, expect, it } from "vite-plus/test";
import { SECTIONS, type RunConfig, type ScoreConfig, type SlopeConfig } from "./config";
import { generateItemLayout, isSunny, isSunnyWater, itemPoints, ItemTracker } from "./items";
import { Runner } from "./runner";
import { inSpurt, LastSpurt, spurtZoneOf } from "./spurt";

const run: RunConfig = {
  windowMs: 1000,
  momentumMs: 5000,
  optimalRate: 2,
  justIntervalMs: 500,
  fallIntervalMs: 500,
  fallStreak: 2,
  fallDurationMs: 1500,
  maxRate: 10,
  speedSmoothingMs: 1,
  spurtMaxSpeed: 1.5,
};
const score = {
  cheerGaugeMs: 600,
  cheerPerfectMs: 150,
  cheerGoodMs: 260,
  waterGaugeMs: 400,
  waterPerfectMs: 100,
  waterGoodMs: 230,
  eggPerfectMs: 80,
  itemGoodRatio: 0.5,
  waterPoints: 150,
  cheerPoints: 100,
  eggPoints: 500,
  sunnyWaterMultiplier: 2,
  spurtBonus: 1500,
} as ScoreConfig;
const slope: SlopeConfig = {
  uphillSlowdownPerGrade: 0.05,
  downhillBoostPerGrade: 0.05,
  maxDownhillBoost: 0.4,
  downhillFallIntervalMsPerGrade: 25,
};
const course = { secondsPerKm: 1 };

describe("7区 日差し給水", () => {
  it("日差しが強いのは 7区の途中だけで、その中に給水がある", () => {
    expect(isSunny(7, 12)).toBe(true);
    expect(isSunny(7, 3)).toBe(false);
    expect(isSunny(1, 12)).toBe(false);
    expect(generateItemLayout()[7].filter((i) => isSunnyWater(7, i)).length).toBeGreaterThan(0);
  });

  it("日差し給水は倍、応援・黒たまごや GOOD・取り損ねにも正しく効く", () => {
    expect(itemPoints("water", "PERFECT", score, true)).toBe(300);
    expect(itemPoints("water", "GOOD", score, true)).toBe(150);
    expect(itemPoints("water", "MISS", score, true)).toBe(0);
    expect(itemPoints("egg", "PERFECT", score, true)).toBe(500); // 給水以外は倍にならない
  });

  it("7区の給水を PERFECT で取ると倍、日差しの外の給水は普通", () => {
    const water = [{ km: 10, kind: "water" as const }];
    const t = new ItemTracker(7, water, score);
    const sunny = t.press(t.target(9.98, 1000)!); // 10km の給水（日差しの中）
    expect(sunny).toMatchObject({ sunny: true, points: 300 });
    const t1 = new ItemTracker(1, water, score);
    expect(t1.press(t1.target(9.98, 1000)!)).toMatchObject({ sunny: false, points: 150 });
  });
});

describe("10区 ラストスパート", () => {
  it("10区のラスト約60%（9.2km地点）からゴールまで", () => {
    expect(spurtZoneOf(10)).toEqual({ fromKm: 9.2, toKm: 23 });
    expect(inSpurt(10, 9.1)).toBe(false);
    expect(inSpurt(10, 9.2)).toBe(true);
    expect(inSpurt(10, 21)).toBe(true);
    expect(spurtZoneOf(9)).toBeNull();
  });

  it("平均の勢いがダッシュの上限なら満額、最高速（1）なら 2/3", () => {
    const full = new LastSpurt(10);
    full.update(19, 1.5, 1000); // 区間の外は数えない
    full.update(21, 1.5, 1000);
    expect(full.bonus(run, score)).toBe(1500);

    const normal = new LastSpurt(10);
    normal.update(21, 1, 1000);
    expect(normal.bonus(run, score)).toBe(1000);

    expect(new LastSpurt(10).bonus(run, score)).toBe(0); // 入っていなければ 0
  });

  /** 間隔 intervalMs で連打し続けたあとの Runner */
  const tapRunner = (km: number, intervalMs: number) => {
    const runner = new Runner(run, SECTIONS[9], course, slope);
    runner.distanceKm = km;
    for (let t = 0; t <= 3000; t += intervalMs) {
      runner.tap(t);
      runner.update(t, 1);
    }
    runner.update(3001, 1);
    return runner;
  };

  it("ラストスパート中は速く連打しても転ばず、最高速度を超える", () => {
    const spurt = tapRunner(21, 150);
    expect(spurt.fallCount).toBe(0);
    expect(spurt.speedRatio).toBeGreaterThan(1);
    expect(spurt.speedRatio).toBeLessThanOrEqual(1.5);
    expect(spurt.fallIntervalMs).toBe(0);
  });

  it("ラストスパートの手前では、同じ連打で転ぶ", () => {
    const before = tapRunner(3, 150);
    expect(before.fallCount).toBeGreaterThan(0);
  });
});
