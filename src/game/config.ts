// ゲームの調整用パラメータ。管理画面（lil-gui）から書き換える前提で1か所にまとめる。
// 調整できる値の初期値は settings.json にある。管理画面の「現在の設定で保存」でこのファイルが更新される。

import settings from "./settings.json";
import { slopeFactor, terrainOf } from "./terrain";

/** 管理画面で調整・保存する設定一式（settings.json の形） */
export interface Settings {
  course: CourseConfig;
  run: RunConfig;
  score: ScoreConfig;
  slope: SlopeConfig;
  audio: AudioConfig;
}

export interface AudioConfig {
  /** レース中の BGM の音量（0〜1） */
  bgmVolume: number;
  /** 効果音（スタート音・クリック音）の音量（0〜1） */
  seVolume: number;
}

export const AUDIO_CONFIG: AudioConfig = { ...settings.audio };

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

export const COURSE_CONFIG: CourseConfig = { ...settings.course };

export interface SlopeConfig {
  /** 上り坂：勾配 1% ごとに最高速度がこの割合だけ落ちる（0.05 なら 6% の坂で 0.7 倍） */
  uphillSlowdownPerGrade: number;
  /** 下り坂：勾配 1% ごとに最高速度がこの割合だけ上がる */
  downhillBoostPerGrade: number;
  /** 下り坂で上がる速度の上限（0.4 なら 1.4 倍まで） */
  maxDownhillBoost: number;
  /** 下り坂：勾配 1% ごとに「押しすぎ」の間隔がこのミリ秒だけ長くなる（転びやすくなる） */
  downhillFallIntervalMsPerGrade: number;
}

export const SLOPE_CONFIG: SlopeConfig = { ...settings.slope };

/** 最高速度で走ったときに区間を走り切る秒数（坂の影響も含む） */
export function sectionSeconds(
  section: SectionConfig,
  course: CourseConfig = COURSE_CONFIG,
  slope: SlopeConfig = SLOPE_CONFIG,
): number {
  // 坂のない所は最高速、坂の区間は速度が slopeFactor 倍になる
  let seconds = 0;
  let flatKm = section.distanceKm;
  for (const seg of terrainOf(section.no)) {
    const km = seg.toKm - seg.fromKm;
    flatKm -= km;
    seconds += (km * course.secondsPerKm) / slopeFactor(seg.grade, slope);
  }
  return seconds + flatKm * course.secondsPerKm;
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
  /** 10区ラストスパート：ダッシュの上限（最高速度の何倍まで出せるか） */
  spurtMaxSpeed: number;
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

export const RUN_CONFIG: RunConfig = { ...settings.run };

export interface ScoreConfig {
  /** タイムポイント：最高速で走り切ったときに 1km あたりもらえるポイント。遅いほど比例して減る */
  timePointsPerKm: number;
  /** リズム：ジャストタイミング（justIntervalMs）から何ミリ秒ずれてもコンボが続くか */
  rhythmToleranceMs: number;
  /** リズム：コンボがつながった連打 1回のポイント（倍率をかける前） */
  rhythmPointsPerTap: number;
  /** リズム：コンボがこの回数つながるごとに倍率が上がる */
  comboStep: number;
  /** リズム：倍率が 1段上がるごとに増える量 */
  comboMultiplierStep: number;
  /** リズム：倍率の上限 */
  maxComboMultiplier: number;
  /** 襷：中継線を越える瞬間とエンターのずれがこのミリ秒以内なら PERFECT */
  relayPerfectMs: number;
  /** 襷：このミリ秒以内なら GOOD。これより大きくずれると MISS */
  relayGoodMs: number;
  relayPerfectPoints: number;
  relayGoodPoints: number;
  /** 全区間ボーナス：10区間すべて襷をつないでゴールしたときのポイント */
  fullRelayBonus: number;
  /** 坂ボーナス（5区）：区切りごとの平均の勢いがこれ以上ならクリア（最高速の勢いが 1） */
  hillTargetEffort: number;
  /** 坂ボーナス（5区）：区切りを1つクリアしたときのポイント */
  hillCheckpointPoints: number;
  /** 坂ボーナス（5区）：最高地点に着いたとき、上り全体の平均の勢いが目安以上ならもらえるポイント */
  summitBonus: number;
  /** 坂ボーナス（6区）：下りでこれ以上の勢いを保てた距離にポイント */
  downhillTargetEffort: number;
  /** 坂ボーナス（6区）：目安以上の勢いで下った 1km あたりのポイント */
  downhillPointsPerKm: number;
  /** 応援：目印のこのミリ秒手前からゲージを出し、エンターを受け付ける（最高速のとき。画面のピクセルと同じ） */
  cheerGaugeMs: number;
  /** 応援（かんたん）：目印とのずれがこのミリ秒以内なら PERFECT */
  cheerPerfectMs: number;
  /** 応援：このミリ秒以内なら GOOD。これより大きくずれると取り損ね */
  cheerGoodMs: number;
  /** 給水：ゲージを出し始める距離（ミリ秒） */
  waterGaugeMs: number;
  /** 給水（ふつう）：PERFECT の幅 */
  waterPerfectMs: number;
  /** 給水：GOOD の幅 */
  waterGoodMs: number;
  /** 黒たまご（むずかしい）：PERFECT の幅。GOOD はなく、これより大きくずれると取り損ね。ゲージもこの幅の中だけ出る */
  eggPerfectMs: number;
  /** GOOD のときにもらえる割合（PERFECT の何倍か） */
  itemGoodRatio: number;
  waterPoints: number;
  cheerPoints: number;
  eggPoints: number;
  /** 7区：日差しが強い区間の給水のポイント倍率 */
  sunnyWaterMultiplier: number;
  /** 10区：ラストスパートの平均の勢いがダッシュの上限なら満額もらえるボーナス */
  spurtBonus: number;
  /** 6区以降に獲得したポイントの倍率 */
  secondStageMultiplier: number;
}

export const SCORE_CONFIG: ScoreConfig = { ...settings.score };

/** 今の設定値のコピー */
export function snapshotSettings(): Settings {
  return {
    course: { ...COURSE_CONFIG },
    run: { ...RUN_CONFIG },
    score: { ...SCORE_CONFIG },
    slope: { ...SLOPE_CONFIG },
    audio: { ...AUDIO_CONFIG },
  };
}

/** 設定値を上書きする。知らないキーや数値でない値は無視する */
export function applySettings(input: unknown): void {
  if (typeof input !== "object" || input === null) return;
  const src = input as Record<string, unknown>;
  assignNumbers(COURSE_CONFIG, src.course);
  assignNumbers(RUN_CONFIG, src.run);
  assignNumbers(SCORE_CONFIG, src.score);
  assignNumbers(SLOPE_CONFIG, src.slope);
  assignNumbers(AUDIO_CONFIG, src.audio);
}

function assignNumbers<T extends object>(target: T, source: unknown): void {
  if (typeof source !== "object" || source === null) return;
  for (const key of Object.keys(target) as (keyof T)[]) {
    const value = (source as Record<string, unknown>)[key as string];
    if (typeof value === "number" && Number.isFinite(value)) {
      (target as Record<keyof T, number>)[key] = value;
    }
  }
}
