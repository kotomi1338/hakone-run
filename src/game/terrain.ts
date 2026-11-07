// 区間ごとの坂（地形）。画面（Phaser）に依存しない。
// 実際の箱根駅伝の地形をもとに、ゲームとして遊びやすいよう単純化している。
// 表にない所は平坦（勾配 0%）。

import type { SlopeConfig } from "./config";

export interface TerrainSegment {
  /** 区間のスタートからの距離（km） */
  fromKm: number;
  toKm: number;
  /** 勾配（%）。プラスが上り、マイナスが下り */
  grade: number;
  /** 坂の名前（あれば画面に出す） */
  name?: string;
}

/** 走る向きを逆にした地形（復路は往路の逆向きの区間がある） */
function reversed(segments: TerrainSegment[], distanceKm: number): TerrainSegment[] {
  return segments
    .map((s) => ({ ...s, fromKm: +(distanceKm - s.toKm).toFixed(3), toKm: +(distanceKm - s.fromKm).toFixed(3), grade: -s.grade }))
    .reverse();
}

// 2区（鶴見 → 戸塚 23.1km）：15km過ぎに権太坂、ラスト3kmに戸塚の壁
const SECTION2: TerrainSegment[] = [
  { fromKm: 15.0, toKm: 16.5, grade: 3, name: "権太坂" },
  { fromKm: 16.5, toKm: 17.5, grade: -2 },
  { fromKm: 20.1, toKm: 23.1, grade: 2.5, name: "戸塚の壁" },
];

// 5区（小田原 → 芦ノ湖 20.8km）：箱根湯本から標高874mの最高地点（約16.2km）まで上り、最後は下る
const SECTION5: TerrainSegment[] = [
  { fromKm: 0, toKm: 3, grade: 1 },
  { fromKm: 3, toKm: 8, grade: 7, name: "山登り" },
  { fromKm: 8, toKm: 12, grade: 6, name: "山登り" },
  { fromKm: 12, toKm: 16.2, grade: 5.6, name: "山登り" },
  { fromKm: 16.2, toKm: 20.8, grade: -3.3 },
];

const TERRAIN: Record<number, TerrainSegment[]> = {
  // 1区：ほぼ平坦。終盤に六郷橋の小さな上り下り
  1: [
    { fromKm: 17.5, toKm: 18.0, grade: 3, name: "六郷橋" },
    { fromKm: 18.0, toKm: 18.5, grade: -3, name: "六郷橋" },
  ],
  2: SECTION2,
  // 3区：序盤は遊行寺坂の下り、後半は海沿いの平坦路
  3: [
    { fromKm: 0.5, toKm: 2.0, grade: -3, name: "遊行寺坂" },
    { fromKm: 2.0, toKm: 4.0, grade: -1 },
  ],
  // 4区：小さな起伏と終盤のゆるい上り
  4: [
    { fromKm: 5, toKm: 6, grade: 1.5 },
    { fromKm: 6, toKm: 7, grade: -1.5 },
    { fromKm: 10, toKm: 11, grade: 1.5 },
    { fromKm: 11, toKm: 12, grade: -1.5 },
    { fromKm: 15.9, toKm: 20.9, grade: 2 },
  ],
  5: SECTION5,
  // 6区：5区の逆。最初の約4kmを上ったあと、一気に下る
  6: reversed(SECTION5, 20.8).map((s) => (s.grade < 0 ? { ...s, name: "山下り" } : { ...s, name: undefined })),
  // 7区：大きな坂はない。小さな起伏だけ
  7: [
    { fromKm: 8, toKm: 9, grade: 1 },
    { fromKm: 9, toKm: 10, grade: -1 },
  ],
  // 8区：湘南新道から約9kmの上り。途中に遊行寺坂
  8: [
    { fromKm: 10, toKm: 15.5, grade: 1.5 },
    { fromKm: 15.5, toKm: 16.5, grade: 4, name: "遊行寺坂" },
    { fromKm: 16.5, toKm: 19, grade: 1.5 },
  ],
  // 9区：2区の逆向き。権太坂を下る
  9: reversed(SECTION2, 23.1),
  // 10区：ほぼ平坦
  10: [],
};

export function terrainOf(sectionNo: number): readonly TerrainSegment[] {
  return TERRAIN[sectionNo] ?? [];
}

/** その地点の坂（平坦なら undefined） */
export function segmentAt(sectionNo: number, km: number): TerrainSegment | undefined {
  return terrainOf(sectionNo).find((s) => km >= s.fromKm && km < s.toKm);
}

/** その地点の勾配（%） */
export function gradeAt(sectionNo: number, km: number): number {
  return segmentAt(sectionNo, km)?.grade ?? 0;
}

/** 区間のスタートからの標高差（m）。勾配 1% は 1km で 10m */
export function elevationAt(sectionNo: number, km: number): number {
  let meters = 0;
  for (const s of terrainOf(sectionNo)) {
    if (km <= s.fromKm) break;
    meters += (Math.min(km, s.toKm) - s.fromKm) * s.grade * 10;
  }
  return meters;
}

/** 坂で最高速度が何倍になるか。上りは遅く、下りは速い（上限あり） */
export function slopeFactor(grade: number, slope: SlopeConfig): number {
  if (grade >= 0) return Math.max(0.2, 1 - grade * slope.uphillSlowdownPerGrade);
  return 1 + Math.min(slope.maxDownhillBoost, -grade * slope.downhillBoostPerGrade);
}

/** 坂で「押しすぎ」と判定される間隔が何ミリ秒長くなるか（下りだけ） */
export function fallIntervalExtraMs(grade: number, slope: SlopeConfig): number {
  return grade < 0 ? -grade * slope.downhillFallIntervalMsPerGrade : 0;
}
