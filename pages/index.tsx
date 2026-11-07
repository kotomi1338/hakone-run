import { useEffect, useRef, useState } from "react";
import "./style.css";

export default function HomePage() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let game: import("phaser").Game | undefined;
    let destroyAdmin: (() => void) | undefined;

    // import.meta.env.SSR はサーバー用ビルドで true に置き換わり、この分岐ごと消える。
    // これでサーバー側のバンドルに Phaser やゲームのコードが入らない。
    if (!import.meta.env.SSR) {
      const load = async () => {
        const { createGame } = await import("../src/game");
        if (cancelled || !rootRef.current) return;
        game = createGame(rootRef.current);
        setLoading(false);

        // 管理画面は開発時だけ読み込む（公開版のビルドには含まれない）
        if (import.meta.env.DEV) {
          const { setupAdmin } = await import("../src/game/admin");
          if (cancelled || !game) return;
          destroyAdmin = setupAdmin(game);
        }
      };
      void load();
    }

    return () => {
      cancelled = true;
      game?.destroy(true);
      destroyAdmin?.();
    };
  }, []);

  return (
    <main className="game-page">
      <div className="game-frame">
        <div ref={rootRef} className="game-root" />
        {loading && <p className="game-loading">読み込み中…</p>}
      </div>
      <p className="game-help">スペース：連打で走る ／ エンター：襷・給水・応援・黒たまごを受け取る、次の画面へ</p>
    </main>
  );
}
