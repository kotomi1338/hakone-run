// 開発用の管理画面。import.meta.env.DEV のときだけ読み込み、公開版には含めない。
// 設定オブジェクトを直接書き換えるので、プレイ中でもその場で反映される。

import GUI from "lil-gui";
import { COURSE_CONFIG, RUN_CONFIG, SECTIONS, sectionSeconds } from "./config";

export function setupAdmin(): () => void {
  const gui = new GUI({ title: "管理画面（開発用）" });

  // コースの縮尺：距離は実際の箱根駅伝のまま、全区間まとめて長さを変える
  const course = gui.addFolder("コースの縮尺");
  const preview: Record<string, string> = {};
  const total = (sections: typeof SECTIONS) => {
    const km = sections.reduce((sum, s) => sum + s.distanceKm, 0);
    const sec = sections.reduce((sum, s) => sum + sectionSeconds(s), 0);
    return `${km.toFixed(1)}km → ${sec.toFixed(1)}秒`;
  };
  const updatePreview = () => {
    for (const s of SECTIONS) {
      preview[`${s.no}区`] = `${s.distanceKm}km → ${sectionSeconds(s).toFixed(1)}秒`;
    }
    preview.outbound = total(SECTIONS.filter((s) => s.no <= 5));
    preview.all = total(SECTIONS);
  };
  updatePreview();
  course
    .add(COURSE_CONFIG, "secondsPerKm", 0.05, 3, 0.005)
    .name("1kmを走る秒数")
    .onChange(updatePreview);
  course.add(preview, "outbound").name("往路 1〜5区 合計").listen().disable();
  course.add(preview, "all").name("全10区 合計").listen().disable();
  const perSection = course.addFolder("最高速で走り切る秒数（目安）");
  for (const s of SECTIONS) {
    perSection.add(preview, `${s.no}区`).name(`${s.no}区 ${s.from}→${s.to}`).listen().disable();
  }
  perSection.close();

  const rhythm = gui.addFolder("連打のジャストタイミング");
  rhythm.add(RUN_CONFIG, "justIntervalMs", 200, 1500, 10).name("押す間隔(ms)");

  const run = gui.addFolder("走りの調整");
  run.add(RUN_CONFIG, "optimalRate", 0.5, 10, 0.1).name("最高速の連打(回/秒)");
  run.add(RUN_CONFIG, "momentumMs", 500, 10000, 100).name("1回で走る時間(ms)");
  run.add(RUN_CONFIG, "fallIntervalMs", 100, 2000, 10).name("押しすぎ間隔(ms)");
  run.add(RUN_CONFIG, "fallStreak", 1, 10, 1).name("転ぶ連続回数");
  run.add(RUN_CONFIG, "fallDurationMs", 0, 5000, 100).name("転倒時間(ms)");
  run.add(RUN_CONFIG, "maxRate", 1, 30, 1).name("連打上限(回/秒)");
  run.close();

  return () => gui.destroy();
}
