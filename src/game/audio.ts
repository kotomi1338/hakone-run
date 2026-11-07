// BGM と効果音。音声ファイルは public/audio/ に置く（ファイルがなければ鳴らさないだけで、ゲームは動く）。
//
//   public/audio/bgm.wav    レース中の BGM（ループ再生）
//   public/audio/start.mp3  レース開始の音
//   public/audio/click.mp3  クリック音（ボタンや、Enter で次の画面へ進むとき）

import type Phaser from "phaser";
import { AUDIO_CONFIG } from "./config";

export const SOUND_FILES = {
  bgm: "/audio/bgm.wav",
  start: "/audio/start.mp3",
  click: "/audio/click.mp3",
} as const;

type SoundKey = keyof typeof SOUND_FILES;
type SeKey = Exclude<SoundKey, "bgm">;

/** 読み込みに失敗した（ファイルがない）音。何度も読み込みに行かないように覚えておく */
const missing = new Set<SoundKey>();

/**
 * 効果音を読み込む（シーンの preload で呼ぶ）。小さいファイルなので先に読む。
 * BGM は大きいので、ここでは読まずに startBgm の中で裏で読み込む。
 */
export function preloadSounds(scene: Phaser.Scene): void {
  scene.load.on("loaderror", (file: Phaser.Loader.File) => {
    if (file.key in SOUND_FILES) missing.add(file.key as SoundKey);
  });
  for (const key of ["start", "click"] as const) {
    if (!scene.cache.audio.exists(key) && !missing.has(key)) scene.load.audio(key, SOUND_FILES[key]);
  }
}

/** 効果音を鳴らす */
export function playSe(scene: Phaser.Scene, key: SeKey): void {
  if (!scene.cache.audio.exists(key)) return;
  scene.sound.play(key, { volume: AUDIO_CONFIG.seVolume });
}

/** レース中の BGM をループ再生する。まだ読み込んでいなければ裏で読み込み、読み込めたら鳴らす */
export function startBgm(scene: Phaser.Scene, shouldPlay: () => boolean = () => true): void {
  if (missing.has("bgm")) return;
  if (!scene.cache.audio.exists("bgm")) {
    scene.load.once("filecomplete-audio-bgm", () => {
      if (scene.sys.isActive() && shouldPlay()) startBgm(scene, shouldPlay);
    });
    scene.load.once("loaderror", (file: Phaser.Loader.File) => {
      if (file.key === "bgm") missing.add("bgm");
    });
    scene.load.audio("bgm", SOUND_FILES.bgm);
    scene.load.start();
    return;
  }
  const bgm = scene.sound.get("bgm") ?? scene.sound.add("bgm", { loop: true });
  setVolume(bgm, AUDIO_CONFIG.bgmVolume);
  if (!bgm.isPlaying) bgm.play({ loop: true, volume: AUDIO_CONFIG.bgmVolume });
}

/** BGM を止める（少しずつ小さくしてから止める） */
export function stopBgm(scene: Phaser.Scene, fadeMs = 600): void {
  const bgm = scene.sound.get("bgm");
  if (!bgm || !bgm.isPlaying) return;
  scene.tweens.add({
    targets: bgm,
    volume: 0,
    duration: fadeMs,
    onComplete: () => bgm.stop(),
  });
}

/** 管理画面で音量を変えたとき、鳴っている BGM にもすぐ反映する */
export function applyBgmVolume(sound: Phaser.Sound.BaseSoundManager): void {
  const bgm = sound.get("bgm");
  if (bgm) setVolume(bgm, AUDIO_CONFIG.bgmVolume);
}

function setVolume(sound: Phaser.Sound.BaseSound, volume: number): void {
  (sound as Phaser.Sound.BaseSound & { volume: number }).volume = volume;
}
