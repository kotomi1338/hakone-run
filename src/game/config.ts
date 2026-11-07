// ゲームの調整用パラメータ。後で管理画面（lil-gui）から書き換える前提で1か所にまとめる。

export interface SectionConfig {
  /** 区間番号（1〜10） */
  no: number;
  from: string;
  to: string;
  /** 実際の箱根駅伝の距離（km）。ゲーム内の長さはこの距離 × 縮尺で決まる */
  distanceKm: number;
}

export interface CourseConfig {
  /** 縮尺：最高速度で 1km を走り切る秒数。全区間共通で、区間の長さの比率は実際の距離どおりになる */
  secondsPerKm: number;
}

/** 1区（21.3km）を最高速で約5秒 */
export const COURSE_CONFIG: CourseConfig = {
  secondsPerKm: 0.235,
};

/** 最高速度で走ったときに区間を走り切る秒数 */
export function sectionSeconds(section: SectionConfig, course: CourseConfig = COURSE_CONFIG): number {
  return section.distanceKm * course.secondsPerKm;
}

export interface RunConfig {
  /** 連打回数/秒（転倒判定・上限判定用）の集計時間（ミリ秒） */
  windowMs: number;
  /** 1回の連打で走り続ける時間（ミリ秒）。勢いはこの時間をかけて 0 まで減る */
  momentumMs: number;
  /** この連打回数/秒を続けると最高速度になる */
  optimalRate: number;
  /** 連打のジャストタイミング：リズムボーナスの基準になる押す間隔（ミリ秒） */
  justIntervalMs: number;
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

/** 全10区間。距離は実際の箱根駅伝に準拠 */
export const SECTIONS: SectionConfig[] = [
  { no: 1, from: "大手町", to: "鶴見", distanceKm: 21.3 },
  { no: 2, from: "鶴見", to: "戸塚", distanceKm: 23.1 },
  { no: 3, from: "戸塚", to: "平塚", distanceKm: 21.4 },
  { no: 4, from: "平塚", to: "小田原", distanceKm: 20.9 },
  { no: 5, from: "小田原", to: "芦ノ湖", distanceKm: 20.8 },
  { no: 6, from: "芦ノ湖", to: "小田原", distanceKm: 20.8 },
  { no: 7, from: "小田原", to: "平塚", distanceKm: 21.3 },
  { no: 8, from: "平塚", to: "戸塚", distanceKm: 21.4 },
  { no: 9, from: "戸塚", to: "鶴見", distanceKm: 23.1 },
  { no: 10, from: "鶴見", to: "大手町", distanceKm: 23.0 },
];


export const RUN_CONFIG: RunConfig = {
  windowMs: 1000,
  momentumMs: 5000,
  optimalRate: 2,
  justIntervalMs: 500,
  fallIntervalMs: 500,
  fallStreak: 4,
  fallDurationMs: 1500,
  maxRate: 10,
  speedSmoothingMs: 200,
};
