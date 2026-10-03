import { useState, useEffect } from "react";
import { isAuthenticated, clearAuth } from "./authStore.ts";
import Auth from "./components/Auth.tsx";
import CanvasList from "./components/CanvasList.tsx";
import CanvasPage from "./components/CanvasPage.tsx";

type Page =
  | { kind: "login" }
  | { kind: "signup" }
  | { kind: "canvases" }
  | { kind: "canvas"; canvasId: string };

export default function App() {
  const [page, setPage] = useState<Page>(() =>
    isAuthenticated() ? { kind: "canvases" } : { kind: "login" }
  );

  // Reset body margin/padding for full-viewport layout
  useEffect(() => {
    document.body.style.margin = "0";
    document.body.style.padding = "0";
    document.body.style.overflow = "hidden";
  }, []);

  const handleAuth = () => {
    setPage({ kind: "canvases" });
  };

  const handleLogout = () => {
    clearAuth();
    setPage({ kind: "login" });
  };

  switch (page.kind) {
    case "login":
      return <Auth initialMode="login" onAuth={handleAuth} />;

    case "signup":
      return <Auth initialMode="signup" onAuth={handleAuth} />;

    case "canvases":
      return (
        <CanvasList
          onSelectCanvas={(canvasId) => setPage({ kind: "canvas", canvasId })}
          onLogout={handleLogout}
        />
      );

    case "canvas":
      return (
        <CanvasPage
          key={page.canvasId}
          canvasId={page.canvasId}
          onBack={() => setPage({ kind: "canvases" })}
          onLogout={handleLogout}
        />
      );
  }
}
