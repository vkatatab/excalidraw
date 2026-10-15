import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";

const App = lazy(() =>
  import.meta.env.VITE_APP_KATATA === "true"
    ? import("./katata/KatataApp")
    : import("./App"),
);

if (import.meta.env.VITE_APP_KATATA !== "true") {
  void import("./sentry");
}
window.__EXCALIDRAW_SHA__ = import.meta.env.VITE_APP_GIT_SHA;
const rootElement = document.getElementById("root")!;
const root = createRoot(rootElement);
registerSW();
root.render(
  <StrictMode>
    <Suspense fallback={<p role="status">Carregando…</p>}>
      <App />
    </Suspense>
  </StrictMode>,
);
