// ゲームで使う絵を、画像ファイルを使わずに Canvas で描いてテクスチャにする。
// ランナーの走るモーション（スプライトシート）、観客、木、雲、富士山、黒たまご、コップ、パーティクル用の小さな図形など。

import type Phaser from "phaser";

export const RUNNER_W = 64;
export const RUNNER_H = 80;
export const RUN_FRAMES = 8;
export const FAN_W = 26;
export const FAN_H = 44;
export const FAN_COLORS = ["#e74c3c", "#f1c40f", "#2ecc71", "#9b59b6", "#ffffff", "#e67e22"];

const SKIN = "#f1c27d";
const HAIR = "#2b1d14";
const SHIRT = "#1e5bd8";
const SHIRT_DARK = "#163f99";
const SHORTS = "#0b2a6b";
const SHOES = "#e74c3c";
/** 襷の色 */
export const SASH_COLOR = "#ff7a00";

type Ctx = CanvasRenderingContext2D;

interface Pose {
  /** 太ももの角度（ラジアン。0 が真下、プラスが前） */
  thighFront: number;
  thighBack: number;
  /** 膝の曲がり（すねが太ももより後ろに曲がる量） */
  kneeFront: number;
  kneeBack: number;
  /** 上腕の角度（0 が真下、プラスが前） */
  armFront: number;
  armBack: number;
  /** 体の上下（ピクセル） */
  bob: number;
  /** 前傾（ピクセル） */
  lean: number;
  /** 手を振る（待っている次の走者） */
  wave?: boolean;
}

function limb(ctx: Ctx, x: number, y: number, angle: number, length: number): [number, number] {
  const nx = x + Math.sin(angle) * length;
  const ny = y + Math.cos(angle) * length;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(nx, ny);
  ctx.stroke();
  return [nx, ny];
}

/** ランナーを1コマ描く（右向き）。ox, oy はコマの左上 */
function drawRunner(ctx: Ctx, ox: number, oy: number, p: Pose): void {
  ctx.save();
  ctx.translate(ox, oy);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const hipX = 30;
  const hipY = 46 - p.bob;
  const shoulderX = hipX + 4 + p.lean;
  const shoulderY = 25 - p.bob;
  const thigh = 15;
  const shin = 15;

  const leg = (angle: number, knee: number, color: string) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 7;
    const [kx, ky] = limb(ctx, hipX, hipY, angle, thigh);
    ctx.strokeStyle = SKIN;
    ctx.lineWidth = 6;
    const [fx, fy] = limb(ctx, kx, ky, angle - knee, shin);
    // 靴
    ctx.strokeStyle = SHOES;
    ctx.lineWidth = 6;
    limb(ctx, fx, fy, angle - knee + Math.PI / 2 + 0.2, 6);
  };
  const arm = (angle: number, up: boolean) => {
    ctx.strokeStyle = SKIN;
    ctx.lineWidth = 5;
    const [ex, ey] = limb(ctx, shoulderX, shoulderY + 2, angle, 11);
    limb(ctx, ex, ey, up ? Math.PI - 0.3 : angle + 1.4, 10);
  };

  // 奥の手足（少し暗く）
  ctx.globalAlpha = 0.75;
  leg(p.thighBack, p.kneeBack, SHORTS);
  arm(p.armBack, false);
  ctx.globalAlpha = 1;

  // 胴体（シャツ）
  ctx.strokeStyle = SHIRT;
  ctx.lineWidth = 13;
  ctx.beginPath();
  ctx.moveTo(hipX, hipY - 4);
  ctx.lineTo(shoulderX, shoulderY + 3);
  ctx.stroke();
  // パンツ
  ctx.strokeStyle = SHORTS;
  ctx.lineWidth = 12;
  ctx.beginPath();
  ctx.moveTo(hipX, hipY - 3);
  ctx.lineTo(hipX + 0.5, hipY + 2);
  ctx.stroke();
  // 襷（右肩から左腰へ斜めに）
  ctx.strokeStyle = SASH_COLOR;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(shoulderX + 4, shoulderY + 1);
  ctx.lineTo(hipX - 5, hipY - 5);
  ctx.stroke();
  // シャツの縁取り
  ctx.strokeStyle = SHIRT_DARK;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(hipX - 6, hipY - 4);
  ctx.lineTo(hipX + 6, hipY - 4);
  ctx.stroke();

  // 手前の手足
  leg(p.thighFront, p.kneeFront, SHORTS);
  arm(p.armFront, p.wave ?? false);

  // 頭
  const headX = shoulderX + 3;
  const headY = shoulderY - 10;
  ctx.fillStyle = SKIN;
  ctx.beginPath();
  ctx.arc(headX, headY, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = HAIR;
  ctx.beginPath();
  ctx.arc(headX - 1, headY - 2, 7, Math.PI * 0.95, Math.PI * 2.05);
  ctx.fill();
  // はちまき
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(headX - 7, headY - 2);
  ctx.lineTo(headX + 7, headY - 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(headX - 7, headY - 2);
  ctx.lineTo(headX - 12, headY + 1);
  ctx.stroke();
  // 目
  ctx.fillStyle = "#222";
  ctx.beginPath();
  ctx.arc(headX + 3.5, headY + 0.5, 1.1, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function runPose(i: number): Pose {
  const t = (i / RUN_FRAMES) * Math.PI * 2;
  const s = Math.sin(t);
  return {
    thighFront: s * 0.85,
    thighBack: -s * 0.85,
    // 後ろへ蹴り上げているほうの脚の膝を大きく曲げる
    kneeFront: 0.2 + Math.max(0, -Math.cos(t)) * 1.3,
    kneeBack: 0.2 + Math.max(0, Math.cos(t)) * 1.3,
    armFront: -s * 0.9,
    armBack: s * 0.9,
    bob: Math.abs(Math.cos(t)) * 3,
    lean: 3,
  };
}

const STAND: Pose = {
  thighFront: 0.08,
  thighBack: -0.08,
  kneeFront: 0.05,
  kneeBack: 0.05,
  armFront: 0.15,
  armBack: -0.15,
  bob: 0,
  lean: 0,
};

/** 観客（色違い × 腕を下げる/上げる）。旗を持っている人もいる */
function drawFan(ctx: Ctx, ox: number, oy: number, color: string, armsUp: boolean, flag: boolean): void {
  ctx.save();
  ctx.translate(ox, oy);
  ctx.lineCap = "round";
  // 体
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(6, 42);
  ctx.lineTo(8, 20);
  ctx.lineTo(18, 20);
  ctx.lineTo(20, 42);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.25)";
  ctx.lineWidth = 1;
  ctx.stroke();
  // 腕
  ctx.strokeStyle = SKIN;
  ctx.lineWidth = 3;
  ctx.beginPath();
  if (armsUp) {
    ctx.moveTo(8, 22);
    ctx.lineTo(3, 9);
    ctx.moveTo(18, 22);
    ctx.lineTo(23, 9);
  } else {
    ctx.moveTo(8, 22);
    ctx.lineTo(5, 33);
    ctx.moveTo(18, 22);
    ctx.lineTo(21, 33);
  }
  ctx.stroke();
  // 頭
  ctx.fillStyle = SKIN;
  ctx.beginPath();
  ctx.arc(13, 14, 5.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = HAIR;
  ctx.beginPath();
  ctx.arc(13, 12.5, 5.5, Math.PI, Math.PI * 2);
  ctx.fill();
  // チームカラーの小旗
  if (flag) {
    const hx = armsUp ? 23 : 21;
    const hy = armsUp ? 9 : 33;
    ctx.strokeStyle = "#7a5230";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(hx, hy - 12);
    ctx.stroke();
    ctx.fillStyle = SHIRT;
    ctx.fillRect(hx, hy - 12, 9, 6);
  }
  ctx.restore();
}

function canvasTexture(scene: Phaser.Scene, key: string, w: number, h: number, draw: (ctx: Ctx) => void): void {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, w, h);
  if (!tex) return;
  draw(tex.context);
  tex.refresh();
}

/** シーンの最初に1回呼ぶ（2回目以降は何もしない） */
export function createTextures(scene: Phaser.Scene): void {
  // ランナー：走る8コマ + 立ち + 手を振る
  if (!scene.textures.exists("runner")) {
    const frames = RUN_FRAMES + 2;
    const tex = scene.textures.createCanvas("runner", RUNNER_W * frames, RUNNER_H);
    if (tex) {
      for (let i = 0; i < RUN_FRAMES; i++) {
        drawRunner(tex.context, i * RUNNER_W, 0, runPose(i));
        tex.add(`run${i}`, 0, i * RUNNER_W, 0, RUNNER_W, RUNNER_H);
      }
      drawRunner(tex.context, RUN_FRAMES * RUNNER_W, 0, STAND);
      tex.add("stand", 0, RUN_FRAMES * RUNNER_W, 0, RUNNER_W, RUNNER_H);
      drawRunner(tex.context, (RUN_FRAMES + 1) * RUNNER_W, 0, { ...STAND, armFront: 2.6, wave: true });
      tex.add("wave", 0, (RUN_FRAMES + 1) * RUNNER_W, 0, RUNNER_W, RUNNER_H);
      tex.refresh();
    }
  }
  if (!scene.anims.exists("run")) {
    scene.anims.create({
      key: "run",
      frames: Array.from({ length: RUN_FRAMES }, (_, i) => ({ key: "runner", frame: `run${i}` })),
      frameRate: 14,
      repeat: -1,
    });
  }

  // 観客：色 × (腕下げ, 腕上げ)
  if (!scene.textures.exists("fans")) {
    const tex = scene.textures.createCanvas("fans", FAN_W * 2 * FAN_COLORS.length, FAN_H);
    if (tex) {
      FAN_COLORS.forEach((color, c) => {
        [false, true].forEach((up, u) => {
          const x = (c * 2 + u) * FAN_W;
          drawFan(tex.context, x, 0, color, up, c % 2 === 0);
          tex.add(`fan${c}_${u}`, 0, x, 0, FAN_W, FAN_H);
        });
      });
      tex.refresh();
    }
  }

  // 空のグラデーション
  canvasTexture(scene, "sky", 4, 256, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, "#5aa9f0");
    g.addColorStop(1, "#d9f1ff");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 4, 256);
  });

  canvasTexture(scene, "cloud", 128, 56, (ctx) => {
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    for (const [x, y, r] of [
      [30, 36, 18],
      [56, 26, 24],
      [84, 32, 20],
      [104, 40, 14],
      [64, 42, 18],
    ]) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  canvasTexture(scene, "sun", 120, 120, (ctx) => {
    const g = ctx.createRadialGradient(60, 60, 10, 60, 60, 60);
    g.addColorStop(0, "rgba(255,250,200,1)");
    g.addColorStop(0.35, "rgba(255,220,90,0.95)");
    g.addColorStop(1, "rgba(255,200,60,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 120, 120);
  });

  // 富士山（遠景）
  canvasTexture(scene, "fuji", 360, 150, (ctx) => {
    ctx.fillStyle = "#7f9cc0";
    ctx.beginPath();
    ctx.moveTo(0, 150);
    ctx.lineTo(150, 18);
    ctx.lineTo(210, 18);
    ctx.lineTo(360, 150);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#f4f8ff";
    ctx.beginPath();
    ctx.moveTo(150, 18);
    ctx.lineTo(210, 18);
    ctx.lineTo(240, 46);
    ctx.lineTo(222, 40);
    ctx.lineTo(205, 52);
    ctx.lineTo(186, 40);
    ctx.lineTo(168, 54);
    ctx.lineTo(152, 40);
    ctx.lineTo(120, 46);
    ctx.closePath();
    ctx.fill();
  });

  // 松の木（山の区間・海沿い）
  canvasTexture(scene, "tree", 48, 84, (ctx) => {
    ctx.fillStyle = "#6b4226";
    ctx.fillRect(21, 60, 6, 24);
    ctx.fillStyle = "#2f6b3a";
    for (const [y, w] of [
      [8, 14],
      [24, 20],
      [40, 24],
    ]) {
      ctx.beginPath();
      ctx.moveTo(24, y);
      ctx.lineTo(24 - w, y + 26);
      ctx.lineTo(24 + w, y + 26);
      ctx.closePath();
      ctx.fill();
    }
  });

  canvasTexture(scene, "egg", 28, 34, (ctx) => {
    ctx.fillStyle = "#151515";
    ctx.beginPath();
    ctx.ellipse(14, 18, 12, 15, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.beginPath();
    ctx.ellipse(9, 11, 3, 5, -0.3, 0, Math.PI * 2);
    ctx.fill();
  });

  canvasTexture(scene, "cup", 14, 18, (ctx) => {
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.moveTo(1, 1);
    ctx.lineTo(13, 1);
    ctx.lineTo(11, 17);
    ctx.lineTo(3, 17);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#4aa3ff";
    ctx.fillRect(3, 3, 8, 4);
  });

  canvasTexture(scene, "sash", 34, 12, (ctx) => {
    ctx.fillStyle = SASH_COLOR;
    ctx.beginPath();
    ctx.ellipse(17, 6, 16, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  });

  // パーティクル用：星と丸
  canvasTexture(scene, "spark", 16, 16, (ctx) => {
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? 8 : 3;
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      ctx.lineTo(8 + Math.cos(a) * r, 8 + Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
  });
  canvasTexture(scene, "dot", 8, 8, (ctx) => {
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(4, 4, 4, 0, Math.PI * 2);
    ctx.fill();
  });
  canvasTexture(scene, "streak", 64, 4, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 64, 0);
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(1, "rgba(255,255,255,0.9)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 4);
  });
}
