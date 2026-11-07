// 給水・応援・黒たまご。画面（Phaser）に依存しない。
//
// 目印に重なった瞬間にエンターを押すと受け取れる。押さずに通り過ぎると取り損ね（罰はない）。
// 3種類で難しさに差をつけている：
//   応援     かんたん  各区間に1回・場所は固定。判定の幅が広い
//   給水     ふつう    各区間に1〜2回（全10区間で合計15回）。毎回ランダム。判定の幅は中くらい
//                      ただし7区は日差しが強い区間に必ず2回（固定）
//   黒たまご むずかしい 4・5・7・8・9区に1つずつ。毎回ランダム。PERFECT のみ（GOOD なし）
// ランダムな配置は、区間ごとに用意した3パターンの中から毎回選ぶ。

import type { ScoreConfig } from "./config";
import type { RelayGrade } from "./score";

export type ItemKind = "water" | "cheer" | "egg";

export interface CourseItem {
  /** 区間のスタートからの距離（km） */
  km: number;
  kind: ItemKind;
}

export const ITEM_NAMES: Record<ItemKind, string> = { water: "給水", cheer: "応援", egg: "黒たまご" };
export const ITEM_ACTIONS: Record<ItemKind, string> = {
  water: "Enterで給水！",
  cheer: "Enterで応援を受け取る！",
  egg: "Enterで黒たまごを拾う！",
};

/** 中継所（ゲージ）と重ならないよう、区間の最後のこの距離（km）には置かない */
export const ITEM_END_MARGIN_KM = 2;
/** アイテムどうしの最小間隔（km） */
export const ITEM_MIN_GAP_KM = 2;
/** 給水の合計回数（全10区間） */
export const TOTAL_WATER = 15;
export const SECTION_COUNT = 10;
/** 黒たまごが出る区間 */
export const EGG_SECTIONS = [4, 5, 7, 8, 9];

/** 給水の場所を固定する区間。7区は日差しが強い区間（8〜16km）に必ず2回 */
const FIXED_WATER: Record<number, number[]> = { 7: [10, 14] };

/** 応援の場所（固定・各区間1回） */
const CHEER_KM: Record<number, number> = { 1: 4, 2: 5, 3: 6, 4: 3, 5: 2, 6: 2, 7: 5, 8: 4, 9: 5, 10: 4 };

interface Pattern {
  /** 給水の場所。給水が1回の区間では最初の1つだけ使う */
  water: [number, number];
  /** 黒たまごの場所（黒たまごの出る区間だけ使う） */
  egg: number;
}

/**
 * 区間ごとの3パターン。給水の1つ目は 8〜12km なので、7区の日差しが強い区間（8〜16km）に必ず入る。
 * どのパターンでも、応援・給水・黒たまごどうしは2km以上離れ、区間の最後の2kmには置かない。
 */
const BASE_PATTERNS: Pattern[] = [
  { water: [10, 15], egg: 6 },
  { water: [8, 13], egg: 16 },
  { water: [12, 17], egg: 8 },
];
/** 応援と近すぎる区間は黒たまごの場所を変える */
const EGG_OVERRIDES: Record<number, Partial<Record<number, number>>> = {
  7: { 0: 18 }, // 応援 5km と近いので
  9: { 0: 19 },
};

function patternsOf(sectionNo: number): Pattern[] {
  return BASE_PATTERNS.map((p, i) => ({ ...p, egg: EGG_OVERRIDES[sectionNo]?.[i] ?? p.egg }));
}

/** 0 以上 1 未満の乱数を返す関数（テストでは決まった値を返すものに差し替える） */
export type Random = () => number;

/** 1レースぶんのアイテムの配置（区間番号 → その区間のアイテム。距離の順） */
export type ItemLayout = Record<number, CourseItem[]>;

/**
 * 1レースぶんの配置をランダムに作る。給水は合計15回（5区間が2回、残りが1回）。
 * 7区は給水が固定で2回なので、残りの4区間をほかの区間からランダムに選ぶ
 */
export function generateItemLayout(random: Random = Math.random): ItemLayout {
  const sections = Array.from({ length: SECTION_COUNT }, (_, i) => i + 1);
  const fixedExtra = Object.values(FIXED_WATER).reduce((sum, kms) => sum + kms.length - 1, 0);
  // 給水が2回になる区間を、固定の区間以外から選ぶ（シャッフルして先頭から）
  const shuffled = sections.filter((no) => !(no in FIXED_WATER));
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const doubleWater = new Set(shuffled.slice(0, TOTAL_WATER - SECTION_COUNT - fixedExtra));

  const layout: ItemLayout = {};
  for (const no of sections) {
    const patterns = patternsOf(no);
    const p = patterns[Math.min(patterns.length - 1, Math.floor(random() * patterns.length))];
    const items: CourseItem[] = [{ km: CHEER_KM[no], kind: "cheer" }];
    const waters = FIXED_WATER[no] ?? (doubleWater.has(no) ? p.water : [p.water[0]]);
    for (const km of waters) items.push({ km, kind: "water" });
    if (EGG_SECTIONS.includes(no)) items.push({ km: p.egg, kind: "egg" });
    layout[no] = items.sort((a, b) => a.km - b.km);
  }
  return layout;
}

/** 7区：日差しが強い区間（ここの給水はポイントが sunnyWaterMultiplier 倍）。気温の変化がいちばん大きい区間 */
const SUNNY_ZONES: Record<number, { fromKm: number; toKm: number }> = {
  7: { fromKm: 8, toKm: 16 },
};

export function sunnyZoneOf(sectionNo: number): { fromKm: number; toKm: number } | null {
  return SUNNY_ZONES[sectionNo] ?? null;
}

export function isSunny(sectionNo: number, km: number): boolean {
  const zone = sunnyZoneOf(sectionNo);
  return zone !== null && km >= zone.fromKm && km <= zone.toKm;
}

/** 日差し給水（日差しが強い区間の給水）か */
export function isSunnyWater(sectionNo: number, item: CourseItem): boolean {
  return item.kind === "water" && isSunny(sectionNo, item.km);
}

/** 取ったときのポイント（6区以降の倍率をかける前）。GOOD は満点 × itemGoodRatio、日差し給水はさらに倍 */
export function itemPoints(kind: ItemKind, grade: RelayGrade, score: ScoreConfig, sunny = false): number {
  const full = { water: score.waterPoints, cheer: score.cheerPoints, egg: score.eggPoints }[kind];
  const base = grade === "PERFECT" ? full : grade === "GOOD" ? Math.round(full * score.itemGoodRatio) : 0;
  return sunny && kind === "water" ? Math.round(base * score.sunnyWaterMultiplier) : base;
}

/**
 * 種類ごとの判定の幅とゲージを出す範囲（最高速のときのミリ秒 = 画面のピクセル）。
 *   gauge   目印のこれだけ手前からゲージを出し、エンターを受け付ける
 *   perfect / good  判定の幅
 * 応援はゲージが長く出て幅も広い。黒たまごは GOOD がなく、ゲージも PERFECT の幅の中だけ（一瞬）出る
 */
export function itemWindows(kind: ItemKind, score: ScoreConfig): { gauge: number; perfect: number; good: number } {
  if (kind === "cheer") {
    const good = Math.max(score.cheerPerfectMs, score.cheerGoodMs);
    return { gauge: Math.max(good, score.cheerGaugeMs), perfect: score.cheerPerfectMs, good };
  }
  if (kind === "water") {
    const good = Math.max(score.waterPerfectMs, score.waterGoodMs);
    return { gauge: Math.max(good, score.waterGaugeMs), perfect: score.waterPerfectMs, good };
  }
  return { gauge: score.eggPerfectMs, perfect: score.eggPerfectMs, good: score.eggPerfectMs };
}

/** ずれ（最高速のときのミリ秒 = 画面のピクセル）から判定する */
export function judgeItem(kind: ItemKind, offset: number, score: ScoreConfig): RelayGrade {
  const { perfect, good } = itemWindows(kind, score);
  const d = Math.abs(offset);
  if (d <= perfect) return "PERFECT";
  if (d <= good) return "GOOD";
  return "MISS";
}

export interface ItemTarget {
  index: number;
  item: CourseItem;
  /** 目印とのずれ（ピクセル。手前ならプラス、越えた後はマイナス） */
  offsetPx: number;
}

export interface ItemResult {
  index: number;
  item: CourseItem;
  grade: RelayGrade;
  points: number;
  /** 日差し給水だったか */
  sunny: boolean;
}

/** 1区間ぶんのアイテムの取った・取り損ねたを管理する */
export class ItemTracker {
  readonly items: readonly CourseItem[];
  /** 判定済みのアイテム（添字 → 判定） */
  readonly results = new Map<number, RelayGrade>();
  private readonly score: ScoreConfig;
  private readonly sectionNo: number;

  constructor(sectionNo: number, items: readonly CourseItem[], score: ScoreConfig) {
    this.items = items;
    this.score = score;
    this.sectionNo = sectionNo;
  }

  /**
   * エンターで狙えるアイテム。目印の手前のゲージの範囲（種類ごと）に入ってから、越えて GOOD の範囲を過ぎるまで。
   * 複数あれば一番手前（まだ判定していないもの）
   */
  target(km: number, pxPerKm: number): ItemTarget | null {
    for (let i = 0; i < this.items.length; i++) {
      if (this.results.has(i)) continue;
      const offsetPx = (this.items[i].km - km) * pxPerKm;
      const w = itemWindows(this.items[i].kind, this.score);
      if (offsetPx < -w.good) continue;
      if (offsetPx > w.gauge) return null;
      return { index: i, item: this.items[i], offsetPx };
    }
    return null;
  }

  /** エンターを押した：判定して結果を返す */
  press(target: ItemTarget): ItemResult {
    return this.record(target.index, judgeItem(target.item.kind, target.offsetPx, this.score));
  }

  /** 押さないまま GOOD の範囲を過ぎたアイテムを取り損ねにする */
  missPassed(km: number, pxPerKm: number): ItemResult[] {
    const missed: ItemResult[] = [];
    this.items.forEach((item, i) => {
      if (this.results.has(i)) return;
      if ((item.km - km) * pxPerKm < -itemWindows(item.kind, this.score).good) missed.push(this.record(i, "MISS"));
    });
    return missed;
  }

  private record(index: number, grade: RelayGrade): ItemResult {
    this.results.set(index, grade);
    const item = this.items[index];
    const sunny = isSunnyWater(this.sectionNo, item);
    return { index, item, grade, sunny, points: itemPoints(item.kind, grade, this.score, sunny) };
  }
}
