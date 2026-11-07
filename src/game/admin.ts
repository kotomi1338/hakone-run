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
  AUDIO_CONFIG,
  RUN_CONFIG,
  SCORE_CONFIG,
  SECTIONS,
  SLOPE_CONFIG,
  sectionSeconds,
  snapshotSettings,
} from "./config";
import { applyBgmVolume } from "./audio";
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
  run.add(RUN_CONFIG, "spurtMaxSpeed", 1, 3, 0.05).name("10区ダッシュの上限(倍)");
  run.close();

  const slope = gui.addFolder("坂の効き具合");
  slope.add(SLOPE_CONFIG, "uphillSlowdownPerGrade", 0, 0.15, 0.005).name("上り 1%で遅くなる割合").onChange(updatePreview);
  slope.add(SLOPE_CONFIG, "downhillBoostPerGrade", 0, 0.15, 0.005).name("下り 1%で速くなる割合").onChange(updatePreview);
  slope.add(SLOPE_CONFIG, "maxDownhillBoost", 0, 1, 0.05).name("下りで速くなる上限").onChange(updatePreview);
  slope.add(SLOPE_CONFIG, "downhillFallIntervalMsPerGrade", 0, 100, 5).name("下り 1%で押しすぎ間隔+(ms)");
  slope.close();

  const scoring = gui.addFolder("ポイントの調整");
  scoring.add(SCORE_CONFIG, "timePointsPerKm", 0, 200, 1).name("タイム満点(pt/km)");
  scoring.add(SCORE_CONFIG, "rhythmToleranceMs", 0, 500, 10).name("リズム許容幅(±ms)");
  scoring.add(SCORE_CONFIG, "rhythmPointsPerTap", 0, 100, 1).name("リズム1回(pt)");
  scoring.add(SCORE_CONFIG, "comboStep", 1, 30, 1).name("倍率が上がるコンボ数");
  scoring.add(SCORE_CONFIG, "comboMultiplierStep", 0, 2, 0.1).name("倍率の上がり幅");
  scoring.add(SCORE_CONFIG, "maxComboMultiplier", 1, 10, 0.1).name("リズム倍率の上限");
  scoring.add(SCORE_CONFIG, "relayPerfectMs", 0, 400, 5).name("襷PERFECT幅(ms)");
  scoring.add(SCORE_CONFIG, "relayGoodMs", 0, 400, 5).name("襷GOOD幅(ms)");
  scoring.add(SCORE_CONFIG, "relayPerfectPoints", 0, 2000, 10).name("襷PERFECT(pt)");
  scoring.add(SCORE_CONFIG, "relayGoodPoints", 0, 2000, 10).name("襷GOOD(pt)");
  scoring.add(SCORE_CONFIG, "hillTargetEffort", 0, 1, 0.05).name("5区 区切りの目安(勢い)");
  scoring.add(SCORE_CONFIG, "hillCheckpointPoints", 0, 1000, 10).name("5区 区切り1つ(pt)");
  scoring.add(SCORE_CONFIG, "summitBonus", 0, 5000, 50).name("5区 最高地点(pt)");
  scoring.add(SCORE_CONFIG, "downhillTargetEffort", 0, 1, 0.05).name("6区 下りの目安(勢い)");
  scoring.add(SCORE_CONFIG, "downhillPointsPerKm", 0, 500, 5).name("6区 下り1km(pt)");
  scoring.add(SCORE_CONFIG, "cheerGaugeMs", 0, 1000, 10).name("応援ゲージの範囲(ms)");
  scoring.add(SCORE_CONFIG, "cheerPerfectMs", 0, 400, 5).name("応援PERFECT幅(ms)");
  scoring.add(SCORE_CONFIG, "cheerGoodMs", 0, 400, 5).name("応援GOOD幅(ms)");
  scoring.add(SCORE_CONFIG, "waterGaugeMs", 0, 1000, 10).name("給水ゲージの範囲(ms)");
  scoring.add(SCORE_CONFIG, "waterPerfectMs", 0, 400, 5).name("給水PERFECT幅(ms)");
  scoring.add(SCORE_CONFIG, "waterGoodMs", 0, 400, 5).name("給水GOOD幅(ms)");
  scoring.add(SCORE_CONFIG, "eggPerfectMs", 0, 400, 5).name("黒たまごPERFECT幅(ms)");
  scoring.add(SCORE_CONFIG, "itemGoodRatio", 0, 1, 0.05).name("GOODでもらえる割合");
  scoring.add(SCORE_CONFIG, "waterPoints", 0, 2000, 10).name("給水(pt)");
  scoring.add(SCORE_CONFIG, "cheerPoints", 0, 2000, 10).name("応援(pt)");
  scoring.add(SCORE_CONFIG, "eggPoints", 0, 5000, 10).name("黒たまご(pt)");
  scoring.add(SCORE_CONFIG, "sunnyWaterMultiplier", 1, 5, 0.1).name("7区 日差し給水の倍率");
  scoring.add(SCORE_CONFIG, "spurtBonus", 0, 10000, 50).name("10区 ラストスパート勢いボーナス(pt)");
  scoring.add(SCORE_CONFIG, "spurtPointsPerTap", 0, 100, 1).name("10区 ラストスパート連打1回(pt)");
  scoring.add(SCORE_CONFIG, "fullRelayBonus", 0, 20000, 100).name("全区間ボーナス(pt)");
  scoring.add(SCORE_CONFIG, "secondStageMultiplier", 1, 3, 0.05).name("6区以降の倍率");
  scoring.close();

  // ポイント計算の見える化：今のレースの内訳を区間ごと・項目ごとに表で出す
  const audio = gui.addFolder("音量");
  audio.add(AUDIO_CONFIG, "bgmVolume", 0, 1, 0.05).name("BGM").onChange(() => applyBgmVolume(game.sound));
  audio.add(AUDIO_CONFIG, "seVolume", 0, 1, 0.05).name("効果音");
  audio.close();

  const breakdownFolder = gui.addFolder("ポイント内訳");
  const table = document.createElement("div");
  table.style.cssText = "padding:6px 8px;font-size:11px;line-height:1.5;overflow-x:auto";
  breakdownFolder.$children.appendChild(table);
  let lastHtml = "";
  const renderBreakdown = () => {
    const race = game.registry.get("race") as Race | undefined;
    const html = race ? breakdownHtml(race) : "まだレースが始まっていません";
    if (html !== lastHtml) table.innerHTML = lastHtml = html;
  };
  renderBreakdown();
  const breakdownTimer = window.setInterval(renderBreakdown, 250);

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

  return () => {
    window.clearInterval(breakdownTimer);
    gui.destroy();
  };
}

function breakdownHtml(race: Race): string {
  const b = race.breakdown();
  const num = (n: number) => n.toLocaleString();
  const cell = (v: string, bold = false) =>
    `<td style="text-align:right;padding:0 4px;${bold ? "font-weight:bold" : ""}">${v}</td>`;
  const head = ["区", "タイム", "リズム", "襷", "坂", "アイテム", "スパート", "小計", "倍率", "合計"]
    .map((h) => `<th style="text-align:right;padding:0 4px">${h}</th>`)
    .join("");
  const rows = b.sections
    .map((s) => {
      const relay = s.relayGrade ? `${num(s.relay)} <small>${s.relayGrade}</small>` : "-";
      return `<tr>${cell(`${s.no}`)}${cell(num(s.time))}${cell(`${num(s.rhythm)} <small>最大${s.maxCombo}</small>`)}${cell(relay)}${cell(s.slope ? num(s.slope) : "-")}${cell(s.itemsJudged ? `${num(s.items)} <small>${s.itemsGot}/${s.itemsJudged}</small>` : "-")}${cell(s.spurt ? num(s.spurt) : "-")}${cell(num(s.subtotal))}${cell(`×${s.multiplier}`)}${cell(num(s.total), true)}</tr>`;
    })
    .join("");
  const footer =
    `<tr><td colspan="9" style="text-align:right;padding:0 4px">全区間ボーナス${race.allConnected ? "" : "（10区間すべて走ると加算）"}</td>${cell(num(b.fullRelayBonus))}</tr>` +
    `<tr><td colspan="9" style="text-align:right;padding:0 4px;font-weight:bold">最終ポイント</td>${cell(num(b.total), true)}</tr>`;
  return `<table style="border-collapse:collapse;width:100%"><thead><tr>${head}</tr></thead><tbody>${rows}${footer}</tbody></table>`;
}
