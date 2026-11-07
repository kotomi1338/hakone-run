import { describe, expect, it } from "vite-plus/test";
import { SECTIONS, sectionSeconds, type RunConfig, type SlopeConfig } from "./config";
import { Runner } from "./runner";
import { elevationAt, fallIntervalExtraMs, gradeAt, segmentAt, slopeFactor, terrainOf } from "./terrain";

const slope: SlopeConfig = {
  uphillSlowdownPerGrade: 0.05,
  downhillBoostPerGrade: 0.05,
  maxDownhillBoost: 0.4,
  downhillFallIntervalMsPerGrade: 25,
};

describe("地形データ", () => {
  it.each(SECTIONS.map((s) => [s.no, s] as const))("%i区：坂は区間の中に収まり、重ならず、順に並ぶ", (_, section) => {
    let prevTo = 0;
    for (const seg of terrainOf(section.no)) {
      expect(seg.fromKm).toBeGreaterThanOrEqual(prevTo);
      expect(seg.toKm).toBeGreaterThan(seg.fromKm);
      expect(seg.toKm).toBeLessThanOrEqual(section.distanceKm);
      prevTo = seg.toKm;
    }
  });

  it("5区は最高地点（約16.2km）が一番高く、標高差は約850m", () => {
    const top = elevationAt(5, 16.2);
    expect(top).toBeGreaterThan(800);
    expect(top).toBeLessThan(900);
    for (let km = 0; km <= 20.8; km += 0.1) expect(elevationAt(5, km)).toBeLessThanOrEqual(top + 1e-9);
  });

  it("6区は5区の逆向き：最初の約4kmを上り、あとは下る", () => {
    expect(gradeAt(6, 1)).toBeGreaterThan(0);
    expect(gradeAt(6, 10)).toBeLessThan(0);
    expect(elevationAt(6, 20.8)).toBeCloseTo(-elevationAt(5, 20.8));
    expect(segmentAt(6, 10)?.name).toBe("山下り");
  });

  it("9区は2区の逆向きで、権太坂を下る", () => {
    const gonta2 = terrainOf(2).find((s) => s.name === "権太坂")!;
    const gonta9 = terrainOf(9).find((s) => s.name === "権太坂")!;
    expect(gonta9.grade).toBe(-gonta2.grade);
    expect(gonta9.fromKm).toBeCloseTo(23.1 - gonta2.toKm);
  });

  it("平坦な所は勾配 0%、標高差は勾配 × 距離（1% で 1km 10m）", () => {
    expect(gradeAt(10, 5)).toBe(0);
    expect(gradeAt(1, 17.7)).toBe(3);
    expect(elevationAt(1, 18.0)).toBeCloseTo(15); // 3% × 0.5km
    expect(elevationAt(1, 21.3)).toBeCloseTo(0); // 上って下りて元の高さ
  });
});

describe("坂の影響", () => {
  it("上りは遅く、下りは速い（上限あり）", () => {
    expect(slopeFactor(0, slope)).toBe(1);
    expect(slopeFactor(6, slope)).toBeCloseTo(0.7);
    expect(slopeFactor(-4, slope)).toBeCloseTo(1.2);
    expect(slopeFactor(-20, slope)).toBeCloseTo(1.4);
    expect(slopeFactor(100, slope)).toBe(0.2); // どんなに急でも止まりはしない
  });

  it("下りでは「押しすぎ」の間隔が長くなる", () => {
    expect(fallIntervalExtraMs(5, slope)).toBe(0);
    expect(fallIntervalExtraMs(-6, slope)).toBe(150);
  });

  it("坂のある区間は、最高速で走り切る秒数が坂の分だけ変わる", () => {
    const course = { secondsPerKm: 1 };
    const s10 = SECTIONS[9]; // 平坦
    const s5 = SECTIONS[4]; // 上りが長い
    expect(sectionSeconds(s10, course, slope)).toBeCloseTo(23.0);
    expect(sectionSeconds(s5, course, slope)).toBeGreaterThan(20.8 * 1.2);
  });
});

describe("Runner と坂", () => {
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
  };
  const course = { secondsPerKm: 1 };

  /** 指定した地点から、最高速の勢いで 1秒走った距離 */
  const runOneSecondFrom = (sectionNo: number, km: number) => {
    const runner = new Runner(run, SECTIONS[sectionNo - 1], course, slope);
    runner.distanceKm = km;
    // 勢いがつくまで連打（間隔 700ms = 下り坂でも押しすぎにならない）
    for (let t = 0; t <= 4900; t += 700) runner.tap(t);
    const before = runner.distanceKm;
    for (let i = 0; i < 100; i++) runner.update(5000 + i * 10, 10);
    return runner.distanceKm - before;
  };

  it("平地より上りは進む距離が短く、下りは長い", () => {
    const flat = runOneSecondFrom(10, 5);
    const up = runOneSecondFrom(5, 5); // 7% の上り
    const down = runOneSecondFrom(6, 10); // 6区の下り
    expect(up).toBeLessThan(flat * 0.7);
    expect(down).toBeGreaterThan(flat * 1.2);
  });

  it("下り坂では、平地なら大丈夫な間隔の連打でも転ぶ", () => {
    const flat = new Runner(run, SECTIONS[9], course, slope);
    flat.distanceKm = 5;
    const down = new Runner(run, SECTIONS[5], course, slope);
    down.distanceKm = 10; // 勾配 -6% 前後 → 押しすぎ間隔が 500 + 約150ms
    for (const t of [0, 550, 1100, 1650]) {
      flat.tap(t);
      down.tap(t);
    }
    expect(flat.fallCount).toBe(0);
    expect(down.fallCount).toBe(1);
  });
});
