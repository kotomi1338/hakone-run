import { useEffect, useRef } from "react";
import "./style.css";

export default function HomePage() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let game: { destroy(removeCanvas: boolean): void } | undefined;
    let destroyAdmin: (() => void) | undefined;

    import("../src/game").then(({ createGame }) => {
      if (cancelled || !rootRef.current) return;
      game = createGame(rootRef.current);
    });

    // 管理画面は開発時だけ読み込む（公開版のビルドには含まれない）
    if (import.meta.env.DEV) {
      import("../src/game/admin").then(({ setupAdmin }) => {
        if (!cancelled) destroyAdmin = setupAdmin();
      });
    }

    return () => {
      cancelled = true;
      game?.destroy(true);
      destroyAdmin?.();
    };
  }, []);

  return (
    <main className="game-page">
      <div ref={rootRef} className="game-root" />
      <p className="game-help">スペース：連打で走る ／ エンター：もう一度</p>
    </main>
  );
}
