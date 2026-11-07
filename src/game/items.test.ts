import { describe, expect, it } from "vite-plus/test";
import { SECTIONS, type ScoreConfig } from "./config";
import {
  EGG_SECTIONS,
  generateItemLayout,
  ITEM_END_MARGIN_KM,
  ITEM_MIN_GAP_KM,
  itemPoints,
  ItemTracker,
  itemWindows,
  judgeItem,
  TOTAL_WATER,
  type CourseItem,
  type ItemLayout,
} from "./items";

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
} as ScoreConfig;

/** 決まった順に値を返す乱数（同じ配置を作り直せる） */
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

const count = (layout: ItemLayout, kind: CourseItem["kind"]) =>
  Object.values(layout).reduce((sum, items) => sum + items.filter((i) => i.kind === kind).length, 0);

// いろいろな乱数で配置を作って、どの配置でもルールを守っているか確かめる
const layouts = Array.from({ length: 200 }, (_, i) => generateItemLayout(seeded(i + 1)));

describe("アイテムの配置", () => {
  it("応援は各区間に1回で、場所は毎回同じ", () => {
    for (const layout of layouts) {
      for (const s of SECTIONS) {
        const cheers = layout[s.no].filter((i) => i.kind === "cheer");
        expect(cheers).toHaveLength(1);
        expect(cheers[0].km).toBe(layouts[0][s.no].find((i) => i.kind === "cheer")!.km);
      }
    }
  });

  it("給水は各区間に1〜2回で、全10区間の合計はいつも15回", () => {
    for (const layout of layouts) {
      expect(count(layout, "water")).toBe(TOTAL_WATER);
      for (const s of SECTIONS) {
        const n = layout[s.no].filter((i) => i.kind === "water").length;
        expect(n).toBeGreaterThanOrEqual(1);
        expect(n).toBeLessThanOrEqual(2);
      }
    }
  });

  it("黒たまごは 4・5・7・8・9区に1つずつ", () => {
    for (const layout of layouts) {
      for (const s of SECTIONS) {
        const eggs = layout[s.no].filter((i) => i.kind === "egg").length;
        expect(eggs).toBe(EGG_SECTIONS.includes(s.no) ? 1 : 0);
      }
    }
  });

  it("給水と黒たまごの場所は毎回変わる（区間ごとに3パターン）", () => {
    for (const s of SECTIONS.filter((s) => s.no !== 7)) {
      const waterSpots = new Set(layouts.map((l) => l[s.no].find((i) => i.kind === "water")!.km));
      expect(waterSpots.size).toBe(3);
    }
    const twoWaterSections = new Set(
      layouts.map((l) =>
        SECTIONS.filter((s) => l[s.no].filter((i) => i.kind === "water").length === 2)
          .map((s) => s.no)
          .join(","),
      ),
    );
    expect(twoWaterSections.size).toBeGreaterThan(10);
  });

  it("どの配置でも、スタート直後・中継所の手前には置かず、アイテムどうしは間隔をあける", () => {
    for (const layout of layouts) {
      for (const s of SECTIONS) {
        const items = layout[s.no];
        items.forEach((item, i) => {
          expect(item.km).toBeGreaterThanOrEqual(1);
          expect(item.km).toBeLessThanOrEqual(s.distanceKm - ITEM_END_MARGIN_KM);
          if (i > 0) expect(item.km - items[i - 1].km).toBeGreaterThanOrEqual(ITEM_MIN_GAP_KM);
        });
      }
    }
  });

  it("7区は、どの配置でも日差しが強い区間（8〜16km）に給水が2回（10km・14km で固定）", () => {
    for (const layout of layouts) {
      const waters = layout[7].filter((i) => i.kind === "water").map((i) => i.km);
      expect(waters).toEqual([10, 14]);
    }
  });
});

describe("アイテムの判定とポイント", () => {
  it("応援は幅が広く、給水は中くらい", () => {
    expect(judgeItem("cheer", 140, score)).toBe("PERFECT");
    expect(judgeItem("water", 140, score)).toBe("GOOD");
    expect(judgeItem("cheer", 250, score)).toBe("GOOD");
    expect(judgeItem("water", 250, score)).toBe("MISS");
  });

  it("黒たまごは PERFECT のみで、GOOD はない", () => {
    expect(judgeItem("egg", 80, score)).toBe("PERFECT");
    expect(judgeItem("egg", 81, score)).toBe("MISS");
    expect(itemWindows("egg", score)).toEqual({ gauge: 80, perfect: 80, good: 80 });
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
  const items: CourseItem[] = [
    { km: 4, kind: "cheer" },
    { km: 10, kind: "water" },
    { km: 13, kind: "egg" },
  ];
  const tracker = () => new ItemTracker(1, items, score);

  it("ゲージが出る範囲は種類ごと：応援は長く（600px 手前から）、給水はふつう（400px）、黒たまごは一瞬（80px）", () => {
    const t = tracker();
    expect(t.target(3.35, pxPerKm)).toBeNull(); // 応援の 650px 手前
    const cheer = t.target(3.45, pxPerKm); // 550px 手前
    expect(cheer).toMatchObject({ index: 0, item: { kind: "cheer", km: 4 } });
    expect(cheer!.offsetPx).toBeCloseTo(550);
    t.missPassed(5, pxPerKm);
    expect(t.target(9.55, pxPerKm)).toBeNull(); // 給水の 450px 手前
    expect(t.target(9.65, pxPerKm)).toMatchObject({ item: { kind: "water" } });
    t.missPassed(11, pxPerKm);
    expect(t.target(12.9, pxPerKm)).toBeNull(); // 黒たまごの 100px 手前ではまだ出ない
    expect(t.target(12.93, pxPerKm)).toMatchObject({ item: { kind: "egg" } });
  });

  it("ぴったりで押すと PERFECT。判定済みのアイテムは次から狙えない", () => {
    const t = tracker();
    expect(t.press(t.target(3.95, pxPerKm)!)).toMatchObject({ grade: "PERFECT", points: 100 });
    expect(t.target(4.0, pxPerKm)).toBeNull();
  });

  it("黒たまごはゲージが出ている間（PERFECT の幅）に押せば PERFECT、過ぎたら取り損ね", () => {
    const t = tracker();
    t.missPassed(12, pxPerKm); // 応援と給水は通り過ぎた
    expect(t.press(t.target(12.95, pxPerKm)!)).toMatchObject({ item: { kind: "egg" }, grade: "PERFECT", points: 500 });
    const late = tracker();
    late.missPassed(12, pxPerKm);
    expect(late.missPassed(13.09, pxPerKm)).toMatchObject([{ item: { kind: "egg" }, grade: "MISS" }]); // 90px 過ぎ
  });

  it("越えた後でも GOOD の範囲なら押せる。過ぎたら自動で取り損ね（範囲は種類ごと）", () => {
    const t = tracker();
    expect(t.target(4.25, pxPerKm)).toMatchObject({ index: 0 }); // 応援：250px 過ぎでもまだ範囲内
    expect(t.missPassed(4.25, pxPerKm)).toEqual([]);
    expect(t.missPassed(4.3, pxPerKm)).toMatchObject([{ index: 0, grade: "MISS", points: 0 }]);
    expect(t.missPassed(13.09, pxPerKm)).toMatchObject([{ index: 1 }, { index: 2 }]); // 給水も黒たまごも過ぎた
    expect(t.missPassed(14, pxPerKm)).toEqual([]); // 2回は数えない
  });
});
