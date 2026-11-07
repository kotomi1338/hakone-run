import { describe, expect, it } from "vite-plus/test";
import { SCORE_CONFIG, SECTIONS, sectionSeconds } from "./config";
import { Race } from "./race";
import { buildSubmission, compareEntries, normalizeName, validateSubmission } from "./ranking";

/** 1区から10区まで、最高速の 1.5 倍の時間で走り、襷はすべて PERFECT だったレース */
function finishedRace(): Race {
  const race = new Race();
  for (let i = 0; i < SECTIONS.length; i++) {
    race.addRhythm(120, 6);
    if (race.section.no !== 5 && race.section.no !== 10) race.setRelay(i, "PERFECT");
    race.addItem(150, true);
    race.recordSection(sectionSeconds(race.section) * 1000 * 1.5 + 0.4);
    race.advance();
  }
  return race;
}

describe("並び順", () => {
  const e = (id: number, points: number, timeMs: number) => ({ id, points, timeMs });

  it("ポイントの多い順 → 同点ならタイムの速い順 → それでも同点なら先に登録した順", () => {
    const list = [e(1, 100, 5000), e(2, 300, 9000), e(3, 100, 4000), e(4, 100, 4000)];
    expect(list.sort(compareEntries).map((x) => x.id)).toEqual([2, 3, 4, 1]);
  });
});

describe("名前", () => {
  it("前後の空白を除き、連続する空白は1つにする", () => {
    expect(normalizeName("  はこね   太郎 ")).toEqual({ ok: true, name: "はこね 太郎" });
  });

  it("空・長すぎる・制御文字は使えない", () => {
    expect(normalizeName("   ").ok).toBe(false);
    expect(normalizeName("あ".repeat(21)).ok).toBe(false);
    expect(normalizeName("あ".repeat(20)).ok).toBe(true);
    expect(normalizeName("a\u0000b").ok).toBe(false);
  });
});

describe("buildSubmission", () => {
  it("10区間すべて走ったレースから、名前・最終ポイント・合計タイムだけの記録を作る", () => {
    const race = finishedRace();
    const s = buildSubmission(race, "はこね太郎");
    expect(s).toEqual({ name: "はこね太郎", points: race.breakdown().total, timeMs: Math.round(race.totalMs()) });
    expect(s!.points).toBeGreaterThan(SCORE_CONFIG.fullRelayBonus); // 全区間ボーナスつき
  });

  it("途中から走ったレース（全区間ボーナスなし）は登録できない", () => {
    const race = new Race(5);
    for (let i = 5; i < 10; i++) {
      race.recordSection(sectionSeconds(race.section) * 2000);
      race.advance();
    }
    expect(buildSubmission(race, "x")).toBeNull();
  });
});

describe("validateSubmission", () => {
  it("実際に走ったレースの記録は通る（名前は整える）", () => {
    const s = buildSubmission(finishedRace(), "  はこね太郎 ")!;
    expect(validateSubmission(s)).toEqual({ ok: true, name: "はこね太郎", points: s.points, timeMs: s.timeMs });
  });

  it("整数でない・マイナスの値や、使えない名前は弾く", () => {
    const timeMs = 70000;
    expect(validateSubmission({ name: "x", points: 1.5, timeMs }).ok).toBe(false);
    expect(validateSubmission({ name: "x", points: -1, timeMs }).ok).toBe(false);
    expect(validateSubmission({ name: "   ", points: 100, timeMs }).ok).toBe(false);
  });
});
