// ゲームの調整用パラメータ。後で管理画面（lil-gui）から書き換える前提で1か所にまとめる。

export interface SectionConfig {
  /** 区間番号（1〜10） */
  no: number;
  from: string;
  to: string;
  /** 実際の距離（km） */
  distanceKm: number;
  /** 理想的な連打を続けたときに走り切るまでの秒数 */
  targetSeconds: number;
}

export interface RunConfig {
  /** 連打回数/秒（転倒判定・上限判定用）の集計時間（ミリ秒） */
  windowMs: number;
  /** 1回の連打で走り続ける時間（ミリ秒）。勢いはこの時間をかけて 0 まで減る */
  momentumMs: number;
  /** この連打回数/秒を続けると最高速度になる */
  optimalRate: number;
  /** 前回の連打からこの時間（ミリ秒）より早く押すと「押しすぎ」になる */
  fallIntervalMs: number;
  /** 「押しすぎ」がこの回数続くと転ぶ */
  fallStreak: number;
  /** 転んでから起き上がるまでの時間（ミリ秒） */
  fallDurationMs: number;
  /** 自動連打ツール対策：1秒あたりの連打回数の上限。超えた分は無視する */
  maxRate: number;
  /** 速度が目標値に追いつく速さ（ミリ秒、小さいほど機敏） */
  speedSmoothingMs: number;
}

export const SECTION_1: SectionConfig = {
  no: 1,
  from: "大手町",
  to: "鶴見",
  distanceKm: 21.3,
  targetSeconds: 10,
};

export const RUN_CONFIG: RunConfig = {
  windowMs: 1000,
  momentumMs: 5000,
  optimalRate: 2,
  fallIntervalMs: 500,
  fallStreak: 4,
  fallDurationMs: 1500,
  maxRate: 10,
  speedSmoothingMs: 200,
};
