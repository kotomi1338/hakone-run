// レース全体の進み具合（どの区間を走っているか、区間タイム）。画面（Phaser）に依存しない。

import { SECTIONS, type SectionConfig } from "./config";

export type Stage = 1 | 2;

export const STAGE_NAMES: Record<Stage, string> = {
  1: "第1ステージ（往路）",
  2: "第2ステージ（復路）",
};

/** 各ステージの最後の区間番号 */
const STAGE_LAST_SECTION: Record<Stage, number> = { 1: 5, 2: 10 };

export function stageOf(section: SectionConfig): Stage {
  return section.no <= STAGE_LAST_SECTION[1] ? 1 : 2;
}

export function sectionsOfStage(stage: Stage): SectionConfig[] {
  return SECTIONS.filter((s) => stageOf(s) === stage);
}

export class Race {
  /** 今走っている区間（SECTIONS の添字） */
  sectionIndex: number;
  /** 区間ごとのタイム（ミリ秒）。まだ走っていない・飛ばした区間は null */
  readonly sectionTimesMs: (number | null)[] = SECTIONS.map(() => null);

  constructor(startIndex = 0) {
    this.sectionIndex = Math.min(Math.max(0, startIndex), SECTIONS.length - 1);
  }

  get section(): SectionConfig {
    return SECTIONS[this.sectionIndex];
  }

  get stage(): Stage {
    return stageOf(this.section);
  }

  get nextSection(): SectionConfig | undefined {
    return SECTIONS[this.sectionIndex + 1];
  }

  /** ステージのスタートから今の区間のスタート（中継所）までの距離（km） */
  get sectionStartKm(): number {
    return sectionsOfStage(this.stage)
      .filter((s) => s.no < this.section.no)
      .reduce((sum, s) => sum + s.distanceKm, 0);
  }

  /** 今の区間がステージの最後（5区・10区）か */
  get isStageLastSection(): boolean {
    return this.section.no === STAGE_LAST_SECTION[this.stage];
  }

  /** 10区まで走り終えたか */
  get isFinished(): boolean {
    return this.sectionIndex === SECTIONS.length - 1 && this.sectionTimesMs[this.sectionIndex] !== null;
  }

  /** 今の区間のタイムを記録する */
  recordSection(timeMs: number): void {
    this.sectionTimesMs[this.sectionIndex] = timeMs;
  }

  /** 次の区間へ進む。最後の区間なら何もしない */
  advance(): void {
    if (this.sectionIndex < SECTIONS.length - 1) this.sectionIndex++;
  }

  /** 記録済みの区間タイムの合計（ステージ指定なしなら全区間） */
  totalMs(stage?: Stage): number {
    return SECTIONS.reduce((sum, s, i) => {
      if (stage !== undefined && stageOf(s) !== stage) return sum;
      return sum + (this.sectionTimesMs[i] ?? 0);
    }, 0);
  }
}
