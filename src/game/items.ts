// 給水・応援・黒たまご。画面（Phaser）に依存しない。
//
// コース上の決まった場所（全員同じ）に置いてあり、目印に重なった瞬間にエンターを押すと受け取れる。
// 判定は襷と同じ：ずれが小さければ PERFECT（満点）、少しずれたら GOOD（半分など）、大きくずれたら取り損ね。
// 押さずに通り過ぎても取り損ね。罰はない。

import type { ScoreConfig } from "./config";
import { judgeRelay, type RelayGrade } from "./score";

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

const w = (km: number): CourseItem => ({ km, kind: "water" });
const c = (km: number): CourseItem => ({ km, kind: "cheer" });
const e = (km: number): CourseItem => ({ km, kind: "egg" });

/** 区間ごとの配置。給水は実際の箱根駅伝と同じく 10km・15km 付近。黒たまごは 5区・6区が中心 */
const ITEMS: Record<number, CourseItem[]> = {
  1: [c(4), w(10), w(15), c(18)],
  2: [c(5), w(10), w(15), c(19)],
  3: [c(6), w(10), w(15), c(18)],
  4: [c(3), w(10), e(13), w(15)],
  5: [c(2), e(6), w(10), e(13), w(15), e(18)],
  6: [e(3), e(7), w(10), e(13), w(15), c(18)],
  7: [e(2), c(5), w(10), w(15), c(18)],
  8: [c(4), w(10), w(15), c(19)],
  9: [c(5), w(10), w(15), c(19)],
  10: [c(4), w(10), w(15), c(18)],
};

export function itemsOf(sectionNo: number): readonly CourseItem[] {
  return ITEMS[sectionNo] ?? [];
}

/** 取ったときのポイント（倍率をかける前）。GOOD は満点 × itemGoodRatio */
export function itemPoints(kind: ItemKind, grade: RelayGrade, score: ScoreConfig): number {
  const full = { water: score.waterPoints, cheer: score.cheerPoints, egg: score.eggPoints }[kind];
  if (grade === "PERFECT") return full;
  if (grade === "GOOD") return Math.round(full * score.itemGoodRatio);
  return 0;
}

/** ずれ（最高速のときのミリ秒 = 画面のピクセル）から判定する */
export function judgeItem(offset: number, score: ScoreConfig): RelayGrade {
  return judgeRelay(offset, { ...score, relayPerfectMs: score.itemPerfectMs, relayGoodMs: score.itemGoodMs });
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
}

/** 1区間ぶんのアイテムの取った・取り損ねたを管理する */
export class ItemTracker {
  readonly items: readonly CourseItem[];
  /** 判定済みのアイテム（添字 → 判定） */
  readonly results = new Map<number, RelayGrade>();
  private readonly score: ScoreConfig;

  constructor(sectionNo: number, score: ScoreConfig) {
    this.items = itemsOf(sectionNo);
    this.score = score;
  }

  /**
   * エンターで狙えるアイテム。目印の手前 gaugePx 以内から、越えて GOOD の範囲を過ぎるまで。
   * 複数あれば一番手前（まだ判定していないもの）
   */
  target(km: number, pxPerKm: number, gaugePx: number): ItemTarget | null {
    for (let i = 0; i < this.items.length; i++) {
      if (this.results.has(i)) continue;
      const offsetPx = (this.items[i].km - km) * pxPerKm;
      if (offsetPx < -this.score.itemGoodMs) continue;
      if (offsetPx > gaugePx) return null;
      return { index: i, item: this.items[i], offsetPx };
    }
    return null;
  }

  /** エンターを押した：判定して結果を返す */
  press(target: ItemTarget): ItemResult {
    return this.record(target.index, judgeItem(target.offsetPx, this.score));
  }

  /** 押さないまま GOOD の範囲を過ぎたアイテムを取り損ねにする */
  missPassed(km: number, pxPerKm: number): ItemResult[] {
    const missed: ItemResult[] = [];
    this.items.forEach((item, i) => {
      if (this.results.has(i)) return;
      if ((item.km - km) * pxPerKm < -this.score.itemGoodMs) missed.push(this.record(i, "MISS"));
    });
    return missed;
  }

  private record(index: number, grade: RelayGrade): ItemResult {
    this.results.set(index, grade);
    const item = this.items[index];
    return { index, item, grade, points: itemPoints(item.kind, grade, this.score) };
  }
}
