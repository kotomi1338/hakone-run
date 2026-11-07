import Phaser from "phaser";

export interface KeyHandlers {
  onSpace?: (now: number) => void;
  onEnter?: (now: number) => void;
}

/**
 * スペース・エンターを window で直接受ける（e.repeat と preventDefault を確実に扱うため）。
 * シーンが終わると自動で解除する。
 */
export function bindGameKeys(scene: Phaser.Scene, handlers: KeyHandlers): void {
  const onKeyDown = (e: KeyboardEvent): void => {
    // 管理画面などの入力欄に文字を打っているときはゲーム操作として扱わない
    if (isEditableTarget(e.target)) return;

    const isSpace = e.code === "Space";
    const isEnter = e.code === "Enter" || e.code === "NumpadEnter";
    if (!isSpace && !isEnter) return;

    // ページのスクロール防止（押しっぱなしのリピートでもスクロールさせない）
    e.preventDefault();
    // 押しっぱなし対策：キーリピートは連打として数えない
    if (e.repeat) return;

    const now = performance.now();
    if (isSpace) handlers.onSpace?.(now);
    else handlers.onEnter?.(now);
  };

  window.addEventListener("keydown", onKeyDown);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    window.removeEventListener("keydown", onKeyDown);
  });
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export function formatTime(ms: number): string {
  const total = Math.max(0, ms) / 1000;
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}
