// 開発用の管理画面。import.meta.env.DEV のときだけ読み込み、公開版には含めない。
// 設定オブジェクトを直接書き換えるので、プレイ中でもその場で反映される。
//
// 設定の保存先は2つ：
// - ブラウザ（localStorage）：値を変えるたびに自動で保存。再読み込みしても残る
// - settings.json：「現在の設定で保存」ボタンで書き込む。コミットすれば公開版にも反映される

import GUI from "lil-gui";
import type Phaser from "phaser";
import {
  applySettings,
  COURSE_CONFIG,
  RUN_CONFIG,
  SECTIONS,
  sectionSeconds,
  snapshotSettings,
} from "./config";
import { Race } from "./race";
import type { RunSceneData } from "./RunScene";
import fileSettings from "./settings.json";

const STORAGE_KEY = "hakone-run:admin-settings";
/** devtools/settings-plugin.ts の SETTINGS_ENDPOINT と同じ */
const SAVE_ENDPOINT = "/__dev/settings";

function loadFromBrowser(): void {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) applySettings(JSON.parse(saved));
  } catch {
    // 保存データが壊れている・使えない環境なら settings.json の値のまま
  }
}

function saveToBrowser(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshotSettings()));
  } catch {
    // 保存できない環境（プライベートウィンドウなど）では何もしない
  }
}

function clearBrowser(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 何もしない
  }
}

export function setupAdmin(game: Phaser.Game): () => void {
  // ブラウザに保存した値を、管理画面を作る前に反映する
  loadFromBrowser();

  const gui = new GUI({ title: "管理画面（開発用）" });

  // 区間ジャンプ：好きな区間からすぐ始める（それより前の区間タイムは記録なし）
  const jump = { sectionNo: 1 };
  const sectionOptions = Object.fromEntries(SECTIONS.map((s) => [`${s.no}区 ${s.from}→${s.to}`, s.no]));
  gui
    .add(jump, "sectionNo", sectionOptions)
    .name("区間ジャンプ")
    .onChange((no: number) => {
      for (const scene of game.scene.getScenes(true)) game.scene.stop(scene.scene.key);
      game.scene.start("RunScene", { race: new Race(no - 1) } satisfies RunSceneData);
    });

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

  // 値を変えたら自動でブラウザに保存
  gui.onFinishChange(saveToBrowser);

  const status = { message: "変更はブラウザに自動保存されます" };
  const refresh = () => {
    updatePreview();
    for (const c of gui.controllersRecursive()) c.updateDisplay();
  };
  const actions = {
    saveToFile: async () => {
      status.message = "保存中…";
      try {
        const res = await fetch(SAVE_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(snapshotSettings()),
        });
        const result = (await res.json()) as { ok: boolean; error?: string };
        if (!result.ok) throw new Error(result.error);
        saveToBrowser();
        status.message = "settings.json に保存しました";
      } catch (error) {
        status.message = `保存に失敗しました：${String(error)}`;
      }
    },
    resetToFile: () => {
      clearBrowser();
      applySettings(fileSettings);
      refresh();
      status.message = "settings.json の値に戻しました";
    },
  };
  const save = gui.addFolder("設定の保存");
  save.add(status, "message").name("状態").listen().disable();
  save.add(actions, "saveToFile").name("現在の設定で保存（settings.json）");
  save.add(actions, "resetToFile").name("settings.json の値に戻す");

  return () => gui.destroy();
}
