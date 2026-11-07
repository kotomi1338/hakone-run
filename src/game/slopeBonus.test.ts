import { describe, expect, it } from "vite-plus/test";
import type { ScoreConfig } from "./config";
import { climbCheckpoints, SlopeBonus, zoneOf, CLIMB_NAME, DESCENT_NAME, type SlopeBonusEvent } from "./slopeBonus";

const score = {
  hillTargetEffort: 0.8,
  hillCheckpointPoints: 100,
  summitBonus: 500,
  downhillTargetEffort: 0.7,
  downhillPointsPerKm: 40,
} as ScoreConfig;

/** fromKm から toKm まで、勢い effort で 0.01km ずつ（1歩 10ms）走らせる */
function runSteps(bonus: SlopeBonus, fromKm: number, toKm: number, effort: (km: number) => number): SlopeBonusEvent[] {
  const events: SlopeBonusEvent[] = [];
  const steps = Math.round((toKm - fromKm) / 0.01);
  for (let i = 1; i <= steps; i++) {
    const km = fromKm + i * 0.01;
    events.push(...bonus.update(km, effort(km), 10));
  }
  return events;
}

describe("坂ボーナスの範囲", () => {
  it("5区は山登り（3km〜最高地点16.2km）、6区は山下り", () => {
    expect(zoneOf(5, CLIMB_NAME)).toEqual({ fromKm: 3, toKm: 16.2 });
    expect(zoneOf(5, DESCENT_NAME)).toBeNull();
    expect(zoneOf(6, DESCENT_NAME)).toMatchObject({ fromKm: 4.6, toKm: 20.8 });
    expect(zoneOf(1, CLIMB_NAME)).toBeNull();
  });

  it("区切りは約1kmごとで、最後は最高地点。短すぎる最後の区切りは前とまとめる", () => {
    expect(climbCheckpoints({ fromKm: 3, toKm: 16.2 })).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16.2]);
    expect(climbCheckpoints({ fromKm: 0, toKm: 2.8 })).toEqual([1, 2, 2.8]);
  });

  it("坂ボーナスのない区間では何も起きない", () => {
    const bonus = new SlopeBonus(10, score);
    expect(bonus.active).toBe(false);
    expect(runSteps(bonus, 0, 23, () => 1)).toEqual([]);
    expect(bonus.points).toBe(0);
  });
});

describe("5区 山登り", () => {
  it("ずっと目安以上なら、全部の区切りと最高地点のボーナス", () => {
    const bonus = new SlopeBonus(5, score);
    const events = runSteps(bonus, 0, 20.8, () => 0.9);
    const checkpoints = events.filter((e) => e.kind === "checkpoint");
    expect(checkpoints).toHaveLength(13);
    expect(checkpoints.every((e) => e.cleared)).toBe(true);
    expect(events.at(-1)).toMatchObject({ kind: "summit", cleared: true, points: 500 });
    expect(bonus.points).toBe(13 * 100 + 500);
  });

  it("目安より遅い区切りはポイントなし。上り全体の平均が目安未満なら最高地点のボーナスもなし", () => {
    const bonus = new SlopeBonus(5, score);
    // 3〜8km は勢い 0.9、それ以降は 0.5
    runSteps(bonus, 0, 20.8, (km) => (km <= 8 ? 0.9 : 0.5));
    expect(bonus.cleared).toBe(5); // 4,5,6,7,8km の区切り
    expect(bonus.passed).toBe(13);
    expect(bonus.points).toBe(500); // 区切り5つ分。最高地点のボーナスはなし
  });

  it("区切りの平均は時間で測るので、転んで止まっている時間（勢い 0）も平均を下げる", () => {
    const bonus = new SlopeBonus(5, score, 3);
    bonus.update(3.5, 1, 100); // 勢い 1 で 100ms
    bonus.update(3.5, 0, 100); // 転倒中：進まず 100ms
    const [e] = bonus.update(4, 1, 100);
    expect(e).toMatchObject({ kind: "checkpoint", index: 1, cleared: false });
    expect((e as { average: number }).average).toBeCloseTo(2 / 3);
  });

  it("1フレームで区切りを2つ越えても両方判定する", () => {
    const bonus = new SlopeBonus(5, score, 3);
    const events = bonus.update(5.1, 1, 100);
    expect(events.map((e) => e.kind === "checkpoint" && e.index)).toEqual([1, 2]);
  });
});

describe("6区 山下り", () => {
  it("目安以上の勢いで下った距離だけポイント（1km 40pt）", () => {
    const bonus = new SlopeBonus(6, score);
    // 下りは 4.6km から。10km までは勢い 0.8、それ以降は 0.5
    const events = runSteps(bonus, 0, 20.8, (km) => (km <= 10 ? 0.8 : 0.5));
    expect(events).toEqual([]);
    expect(bonus.keptKm).toBeCloseTo(5.4, 1);
    expect(bonus.points).toBe(Math.floor(bonus.keptKm * 40));
  });

  it("上り（下りが始まる前）で頑張ってもポイントにならない", () => {
    const bonus = new SlopeBonus(6, score);
    runSteps(bonus, 0, 4.6, () => 1);
    expect(bonus.points).toBe(0);
  });
});
