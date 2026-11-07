// 多重スクロール（パララックス）の背景。遠いものほどゆっくり流れて奥行きが出る。
//   空（動かない）→ 雲・富士山（ごくゆっくり）→ 遠くの山並み → 中景（街・海沿い・山）
// 中景の景色は区間で変わる：大手町〜戸塚・鶴見〜大手町は街、湘南の海沿いは海と松、箱根の山は森。

import Phaser from "phaser";
import { GAME_HEIGHT, GAME_WIDTH } from "../layout";

export type Scenery = "city" | "coast" | "mountain";

/** 区間ごとの中景の景色 */
export function sceneryOf(sectionNo: number): Scenery {
  if (sectionNo === 5 || sectionNo === 6) return "mountain";
  if ([3, 4, 7, 8].includes(sectionNo)) return "coast";
  return "city";
}

const CLOUD_FACTOR = 0.03;
const FUJI_FACTOR = 0.015;
const FAR_FACTOR = 0.08;
const MID_FACTOR = 0.3;
const MID_SLOT_PX = 70;

/** 整数から 0〜1 の決まった値（毎回同じ景色になるように乱数は使わない） */
function hash(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

export class Background {
  private readonly scene: Phaser.Scene;
  private readonly dir: 1 | -1;
  private readonly baseY: number;
  private readonly clouds: Phaser.GameObjects.Image[];
  private readonly fuji: Phaser.GameObjects.Image;
  readonly sun: Phaser.GameObjects.Image;
  private readonly far: Phaser.GameObjects.Graphics;
  private readonly mid: Phaser.GameObjects.Graphics;
  private readonly trees: Phaser.GameObjects.Image[];

  /** baseY は中景の地面の高さ（道路の基準の高さ） */
  constructor(scene: Phaser.Scene, dir: 1 | -1, baseY: number) {
    this.scene = scene;
    this.dir = dir;
    this.baseY = baseY;
    scene.add.image(0, 0, "sky").setOrigin(0, 0).setDisplaySize(GAME_WIDTH, baseY + 40);
    this.sun = scene.add.image(GAME_WIDTH / 2, 70, "sun").setAlpha(0).setScale(1.2);
    this.fuji = scene.add.image(0, baseY - 60, "fuji").setOrigin(0.5, 1).setAlpha(0.9);
    this.clouds = Array.from({ length: 5 }, (_, i) =>
      scene.add.image(0, 40 + hash(i) * 120, "cloud").setScale(0.6 + hash(i + 10) * 0.7).setAlpha(0.9),
    );
    this.far = scene.add.graphics();
    this.mid = scene.add.graphics();
    this.trees = Array.from({ length: 24 }, () => scene.add.image(0, 0, "tree").setOrigin(0.5, 1).setVisible(false));
  }

  /** 右向きで計算した x を、復路なら左右反転する */
  private mx(x: number, w = 0): number {
    return this.dir === 1 ? x : GAME_WIDTH - x - w;
  }

  /**
   * 毎フレーム呼ぶ。offsetPx はステージのスタートからランナーまでの距離（ピクセル）。
   * sceneryAt(offsetPx) は、その位置の景色（中景がどの区間の景色か）
   */
  update(offsetPx: number, sceneryAt: (offsetPx: number) => Scenery, timeMs: number): void {
    // 雲：ごくゆっくり流れ、さらに風で少しずつ動く
    const wrap = GAME_WIDTH + 300;
    this.clouds.forEach((c, i) => {
      const base = i * 260 + timeMs * 0.005 * (1 + hash(i)) + offsetPx * CLOUD_FACTOR;
      const x = ((base % wrap) + wrap) % wrap - 150;
      c.setX(this.mx(GAME_WIDTH - x));
    });

    // 富士山：とても遠いので、ほとんど動かない
    const fujiX = 700 - ((offsetPx * FUJI_FACTOR) % (GAME_WIDTH + 500));
    this.fuji.setX(this.mx(fujiX < -260 ? fujiX + GAME_WIDTH + 500 : fujiX));

    this.drawFar(offsetPx);
    this.drawMid(offsetPx, sceneryAt);
  }

  /** 遠くの山並み（青みがかったシルエット） */
  private drawFar(offsetPx: number): void {
    const g = this.far;
    g.clear();
    const shift = offsetPx * FAR_FACTOR;
    const step = 40;
    const first = Math.floor(shift / step) - 1;
    const pts: Phaser.Math.Vector2[] = [new Phaser.Math.Vector2(this.mx(-step), GAME_HEIGHT)];
    for (let i = first; i <= first + GAME_WIDTH / step + 3; i++) {
      // なだらかな起伏を2つの周期で作る
      const h = 70 + Math.sin(i * 0.35) * 30 + Math.sin(i * 0.11 + 1) * 25 + hash(i) * 10;
      pts.push(new Phaser.Math.Vector2(this.mx(i * step - shift), this.baseY - 40 - h));
    }
    pts.push(new Phaser.Math.Vector2(this.mx(GAME_WIDTH + step * 2), GAME_HEIGHT));
    g.fillStyle(0x9db7d3, 1).fillPoints(pts, true);
  }

  /** 中景：区間の景色に合わせて街・海と松・森を描く */
  private drawMid(offsetPx: number, sceneryAt: (offsetPx: number) => Scenery): void {
    const g = this.mid;
    g.clear();
    const shift = offsetPx * MID_FACTOR;
    const first = Math.floor(shift / MID_SLOT_PX) - 1;
    let treeIdx = 0;
    const ground = this.baseY + 10;
    for (let i = first; i <= first + GAME_WIDTH / MID_SLOT_PX + 2; i++) {
      const x = i * MID_SLOT_PX - shift;
      // この中景の要素がランナーの真後ろ（画面の x=240）に来るときの、ランナーの位置で景色を決める
      const scenery = sceneryAt((x + shift - 240) / MID_FACTOR);
      const sx = this.mx(x, MID_SLOT_PX);
      const r = hash(i);
      if (scenery === "city") {
        const h = 70 + r * 120;
        const w = MID_SLOT_PX - 10;
        g.fillStyle(r > 0.5 ? 0x8aa3be : 0x7d96b3, 1).fillRect(sx + 5, ground - h, w, h);
        // 窓
        g.fillStyle(0xd6e6f5, 0.7);
        for (let wy = ground - h + 10; wy < ground - 14; wy += 16) {
          for (let wx = sx + 12; wx < sx + w - 4; wx += 14) g.fillRect(wx, wy, 6, 8);
        }
      } else if (scenery === "coast") {
        // 海（相模湾）と砂浜
        g.fillStyle(0x3d8fd1, 1).fillRect(sx, ground - 46, MID_SLOT_PX + 1, 30);
        g.fillStyle(0x7fc1ee, 1).fillRect(sx, ground - 46, MID_SLOT_PX + 1, 5);
        g.fillStyle(0xe8d9a8, 1).fillRect(sx, ground - 16, MID_SLOT_PX + 1, 16);
        if (r > 0.45 && treeIdx < this.trees.length) {
          this.trees[treeIdx++].setPosition(sx + MID_SLOT_PX / 2, ground - 4).setScale(0.8 + r * 0.4).setVisible(true);
        }
      } else {
        // 山：緑の斜面と杉の森
        const h = 90 + Math.sin(i * 0.5) * 40 + r * 30;
        g.fillStyle(0x4f8a4a, 1).fillTriangle(sx - 40, ground, sx + MID_SLOT_PX / 2, ground - h, sx + MID_SLOT_PX + 40, ground);
        if (treeIdx < this.trees.length) {
          this.trees[treeIdx++].setPosition(sx + MID_SLOT_PX / 2, ground).setScale(0.9 + r * 0.6).setVisible(true);
        }
      }
    }
    for (let i = treeIdx; i < this.trees.length; i++) this.trees[i].setVisible(false);
    // 中景の地面（道路が下り坂で下がっても隙間が見えないように、画面の下まで塗る）
    g.fillStyle(0x5d7f47, 1).fillRect(0, ground, GAME_WIDTH, GAME_HEIGHT - ground);
  }
}
