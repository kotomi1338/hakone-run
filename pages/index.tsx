import { useEffect, useRef } from "react";
import "./style.css";

export default function HomePage() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let game: { destroy(removeCanvas: boolean): void } | undefined;

    import("../src/game").then(({ createGame }) => {
      if (cancelled || !rootRef.current) return;
      game = createGame(rootRef.current);
    });

    return () => {
      cancelled = true;
      game?.destroy(true);
    };
  }, []);

  return (
    <main className="game-page">
      <div ref={rootRef} className="game-root" />
      <p className="game-help">スペース：連打で走る ／ エンター：もう一度</p>
    </main>
  );
}
