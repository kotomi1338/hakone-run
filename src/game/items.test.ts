import { describe, expect, it } from "vite-plus/test";
import { SECTIONS, type ScoreConfig } from "./config";
import { ITEM_END_MARGIN_KM, ITEM_MIN_GAP_KM, itemPoints, itemsOf, ItemTracker, judgeItem } from "./items";

const score = {
  itemPerfectMs: 80,
  itemGoodMs: 200,
  itemGoodRatio: 0.5,
  waterPoints: 150,
  cheerPoints: 100,
  eggPoints: 500,
} as ScoreConfig;

describe("アイテムの配置", () => {
  it.each(SECTIONS.map((s) => [s.no, s] as const))(
    "%i区：スタート直後・中継所の手前には置かず、間隔をあけて順に並ぶ",
    (_, section) => {
      const items = itemsOf(section.no);
      expect(items.length).toBeGreaterThan(0);
      items.forEach((item, i) => {
        expect(item.km).toBeGreaterThanOrEqual(1);
        expect(item.km).toBeLessThanOrEqual(section.distanceKm - ITEM_END_MARGIN_KM);
        if (i > 0) expect(item.km - items[i - 1].km).toBeGreaterThanOrEqual(ITEM_MIN_GAP_KM);
      });
    },
  );

  it("給水はどの区間にもあり、黒たまごは 5区・6区が一番多い", () => {
    for (const s of SECTIONS) expect(itemsOf(s.no).some((i) => i.kind === "water")).toBe(true);
    const eggs = (no: number) => itemsOf(no).filter((i) => i.kind === "egg").length;
    const maxOthers = Math.max(...SECTIONS.filter((s) => s.no !== 5 && s.no !== 6).map((s) => eggs(s.no)));
    expect(eggs(5)).toBeGreaterThan(maxOthers);
    expect(eggs(6)).toBeGreaterThan(maxOthers);
  });
});

describe("アイテムの判定とポイント", () => {
  it("ずれで PERFECT / GOOD / 取り損ね", () => {
    expect(judgeItem(0, score)).toBe("PERFECT");
    expect(judgeItem(-80, score)).toBe("PERFECT");
    expect(judgeItem(150, score)).toBe("GOOD");
    expect(judgeItem(201, score)).toBe("MISS");
  });

  it("PERFECT は満点、GOOD は割合ぶん、取り損ねは 0", () => {
    expect(itemPoints("water", "PERFECT", score)).toBe(150);
    expect(itemPoints("egg", "PERFECT", score)).toBe(500);
    expect(itemPoints("cheer", "GOOD", score)).toBe(50);
    expect(itemPoints("egg", "MISS", score)).toBe(0);
  });
});

describe("ItemTracker", () => {
  const pxPerKm = 1000; // 1km = 1000px
  const gaugePx = 400;
  // 1区：応援 4km、給水 10km、給水 15km、応援 18km

  it("目印の手前 gaugePx 以内に入ると狙える。遠ければ何もない", () => {
    const t = new ItemTracker(1, score);
    expect(t.target(3.5, pxPerKm, gaugePx)).toBeNull(); // 500px 手前
    const target = t.target(3.7, pxPerKm, gaugePx);
    expect(target).toMatchObject({ index: 0, item: { kind: "cheer", km: 4 } });
    expect(target!.offsetPx).toBeCloseTo(300);
  });

  it("ぴったりで押すと PERFECT。判定済みのアイテムは次から狙えない", () => {
    const t = new ItemTracker(1, score);
    const result = t.press(t.target(3.95, pxPerKm, gaugePx)!); // 50px 手前
    expect(result).toMatchObject({ grade: "PERFECT", points: 100 });
    expect(t.target(4.0, pxPerKm, gaugePx)).toBeNull();
  });

  it("早すぎるエンターは取り損ね", () => {
    const t = new ItemTracker(1, score);
    expect(t.press(t.target(3.7, pxPerKm, gaugePx)!).grade).toBe("MISS");
  });

  it("越えた後でも GOOD の範囲なら押せる。過ぎたら自動で取り損ね", () => {
    const t = new ItemTracker(1, score);
    expect(t.target(4.15, pxPerKm, gaugePx)).toMatchObject({ index: 0 }); // 150px 過ぎ
    expect(t.missPassed(4.15, pxPerKm)).toEqual([]);
    const missed = t.missPassed(4.25, pxPerKm); // 250px 過ぎ
    expect(missed).toMatchObject([{ index: 0, grade: "MISS", points: 0 }]);
    expect(t.missPassed(4.3, pxPerKm)).toEqual([]); // 2回は数えない
  });
});
