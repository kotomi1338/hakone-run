import { describe, expect, it } from "vite-plus/test";
import { SECTIONS, type CourseConfig, type RunConfig, type ScoreConfig } from "./config";
import { Race } from "./race";
import {
  comboMultiplier,
  emptySectionScore,
  judgeRelay,
  relayPoints,
  RhythmCombo,
  scoreBreakdown,
  sectionMultiplier,
  timePoints,
  type SectionScore,
} from "./score";

// settings.json を書き換えてもテストが変わらないよう、テスト用の値を固定で使う
const course: CourseConfig = { secondsPerKm: 1 };
const run: RunConfig = {
  windowMs: 1000,
  momentumMs: 5000,
  optimalRate: 2,
  justIntervalMs: 500,
  fallIntervalMs: 500,
  fallStreak: 4,
  fallDurationMs: 1500,
  maxRate: 10,
  speedSmoothingMs: 200,
  spurtMaxSpeed: 1.5,
};
const score: ScoreConfig = {
  timePointsPerKm: 50,
  rhythmToleranceMs: 100,
  rhythmPointsPerTap: 10,
  comboStep: 5,
  comboMultiplierStep: 0.5,
  maxComboMultiplier: 2,
  relayPerfectMs: 80,
  relayGoodMs: 200,
  relayPerfectPoints: 300,
  relayGoodPoints: 100,
  hillTargetEffort: 0.8,
  hillCheckpointPoints: 100,
  summitBonus: 500,
  downhillTargetEffort: 0.7,
  downhillPointsPerKm: 40,
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
  spurtPointsPerTap: 10,
  fullRelayBonus: 2000,
  secondStageMultiplier: 1.2,
};
const section1 = SECTIONS[0]; // 21.3km

describe("timePoints", () => {
  const ideal = 21.3 * 1000; // 最高速で走り切ったときのタイム

  it("最高速で走り切ったタイムなら満点", () => {
    expect(timePoints(section1, ideal, ideal, score)).toBe(1065); // 50 × 21.3
  });

  it("2倍の時間がかかったら半分", () => {
    expect(timePoints(section1, ideal * 2, ideal, score)).toBe(533); // 532.5 を四捨五入
  });

  it("満点を超えない・タイム 0 以下は 0", () => {
    expect(timePoints(section1, 1000, ideal, score)).toBe(1065);
    expect(timePoints(section1, 0, ideal, score)).toBe(0);
  });
});

describe("comboMultiplier", () => {
  it("comboStep ごとに上がり、上限で止まる", () => {
    expect(comboMultiplier(0, score)).toBe(1);
    expect(comboMultiplier(4, score)).toBe(1);
    expect(comboMultiplier(5, score)).toBe(1.5);
    expect(comboMultiplier(10, score)).toBe(2);
    expect(comboMultiplier(100, score)).toBe(2);
  });
});

describe("RhythmCombo", () => {
  /** 指定した間隔で連打して、もらえたポイントの合計を返す */
  const tapAt = (combo: RhythmCombo, times: number[]) => times.reduce((sum, t) => sum + combo.tap(t), 0);

  it("最初の1回はポイントなし（間隔が測れないため）", () => {
    const combo = new RhythmCombo(run, score);
    expect(combo.tap(0)).toBe(0);
    expect(combo.combo).toBe(0);
  });

  it("ジャストタイミング ± 許容幅ならコンボがつながる", () => {
    const combo = new RhythmCombo(run, score);
    // 間隔 500, 400(-100), 600(+100) はすべて許容幅の内側
    expect(tapAt(combo, [0, 500, 900, 1500])).toBe(30);
    expect(combo.combo).toBe(3);
  });

  it("許容幅を外れるとコンボが切れて、その連打はポイントなし", () => {
    const combo = new RhythmCombo(run, score);
    tapAt(combo, [0, 500, 1000]);
    expect(combo.combo).toBe(2);
    expect(combo.tap(1300)).toBe(0); // 間隔 300
    expect(combo.combo).toBe(0);
    expect(combo.maxCombo).toBe(2);
    // 切れた連打から数え直す
    expect(combo.tap(1800)).toBe(10);
    expect(combo.combo).toBe(1);
  });

  it("コンボが続くと倍率がかかる", () => {
    const combo = new RhythmCombo(run, score);
    const times = Array.from({ length: 11 }, (_, i) => i * 500); // 10回つながる
    // コンボ1〜4 は ×1、5〜9 は ×1.5、10 は ×2
    expect(tapAt(combo, times)).toBe(4 * 10 + 5 * 15 + 1 * 20);
  });

  it("break でコンボが切れ、次の1回は間隔が測れないのでポイントなし", () => {
    const combo = new RhythmCombo(run, score);
    tapAt(combo, [0, 500, 1000]);
    combo.break();
    expect(combo.combo).toBe(0);
    expect(combo.tap(1500)).toBe(0);
    expect(combo.tap(2000)).toBe(10);
  });
});

describe("judgeRelay / relayPoints", () => {
  it("ずれの大きさで PERFECT / GOOD / MISS（手前でも越えた後でも同じ）", () => {
    expect(judgeRelay(0, score)).toBe("PERFECT");
    expect(judgeRelay(80, score)).toBe("PERFECT");
    expect(judgeRelay(-80, score)).toBe("PERFECT");
    expect(judgeRelay(81, score)).toBe("GOOD");
    expect(judgeRelay(-200, score)).toBe("GOOD");
    expect(judgeRelay(201, score)).toBe("MISS");
  });

  it("判定ごとのポイント", () => {
    expect(relayPoints("PERFECT", score)).toBe(300);
    expect(relayPoints("GOOD", score)).toBe(100);
    expect(relayPoints("MISS", score)).toBe(0);
  });
});

describe("sectionMultiplier", () => {
  it("6区以降だけ倍率がかかる", () => {
    expect(sectionMultiplier(1, score)).toBe(1);
    expect(sectionMultiplier(5, score)).toBe(1);
    expect(sectionMultiplier(6, score)).toBe(1.2);
    expect(sectionMultiplier(10, score)).toBe(1.2);
  });
});

describe("scoreBreakdown", () => {
  const s = (time: number, rhythm: number, relay: number): SectionScore => ({
    ...emptySectionScore(),
    time,
    rhythm,
    relay,
  });

  it("走った区間だけを並べ、6区以降は1.2倍して合計する", () => {
    const scores: (SectionScore | null)[] = Array(10).fill(null);
    scores[0] = s(1000, 200, 300); // 1500
    scores[5] = s(1000, 0, 0); // 1000 × 1.2 = 1200
    const b = scoreBreakdown(scores, false, score);
    expect(b.sections.map((x) => x.no)).toEqual([1, 6]);
    expect(b.sections[0]).toMatchObject({ subtotal: 1500, multiplier: 1, total: 1500 });
    expect(b.sections[1]).toMatchObject({ subtotal: 1000, multiplier: 1.2, total: 1200 });
    expect(b.fullRelayBonus).toBe(0);
    expect(b.total).toBe(2700);
  });

  it("全区間つないだら全区間ボーナス（倍率なし）を加える", () => {
    const scores = Array.from({ length: 10 }, () => s(100, 0, 0));
    const b = scoreBreakdown(scores, true, score);
    expect(b.fullRelayBonus).toBe(2000);
    expect(b.total).toBe(5 * 100 + 5 * 120 + 2000);
  });
});

describe("Race のポイント", () => {
  /** 最高速のタイムで 1区間走る */
  const runSection = (race: Race) => race.recordSection(race.section.distanceKm * 1000);

  it("区間を走るとタイムポイント、リズム・襷は加算される", () => {
    const race = new Race(0, course, score);
    race.addRhythm(30, 3);
    race.setRelay(0, "PERFECT");
    runSection(race);
    expect(race.breakdown().sections[0]).toMatchObject({ time: 1065, rhythm: 30, relay: 300, maxCombo: 3 });
  });

  it("ラストスパートは連打1回ごとのポイントとゴール時のボーナスを足していき、6区以降の倍率がかかる", () => {
    const race = new Race(9, course, score);
    for (let i = 0; i < 30; i++) race.addSpurt(10); // 連打30回
    race.addSpurt(1000); // ゴール時のボーナス
    runSection(race);
    expect(race.breakdown().sections[0]).toMatchObject({ no: 10, spurt: 1300, multiplier: 1.2 });
  });

  it("襷の判定は1回だけ（後から上書きされない）", () => {
    const race = new Race(0, course, score);
    race.setRelay(0, "GOOD");
    race.setRelay(0, "PERFECT");
    expect(race.sectionScores[0]).toMatchObject({ relayGrade: "GOOD", relay: 100 });
  });

  it("1区から10区まで走ると全区間ボーナス", () => {
    const race = new Race(0, course, score);
    for (let i = 0; i < 10; i++) {
      runSection(race);
      race.advance();
    }
    expect(race.isFinished).toBe(true);
    expect(race.allConnected).toBe(true);
    expect(race.breakdown().fullRelayBonus).toBe(2000);
  });

  it("区間ジャンプで途中から走った場合は全区間ボーナスなし", () => {
    const race = new Race(5, course, score);
    for (let i = 5; i < 10; i++) {
      runSection(race);
      race.advance();
    }
    expect(race.isFinished).toBe(true);
    expect(race.allConnected).toBe(false);
    expect(race.breakdown().fullRelayBonus).toBe(0);
  });
});
