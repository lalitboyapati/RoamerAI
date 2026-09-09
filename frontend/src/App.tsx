import { useEffect } from "react";
import { Scene } from "./scene/Scene";
import { Hud } from "./ui/Hud";
import { Landing } from "./ui/Landing";
import { Profile } from "./ui/Profile";
import { go, useRoute } from "./route";
import { useStore } from "./store";

export default function App() {
  const route = useRoute();
  const loadCatalog = useStore((s) => s.loadCatalog);
  const catalog = useStore((s) => s.catalog);
  const selected = useStore((s) => s.selected);
  const begin = useStore((s) => s.begin);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  // A deep link past the picker still has to pick something; a remembered
  // choice covers the common case, and an empty one goes back to the door.
  useEffect(() => {
    if (route === "landing" || !catalog) return;
    if (!selected.length) go("landing");
    else begin(selected);
    // begin() is idempotent: it only ever adds models to the worker
  }, [route, catalog, selected, begin]);

  if (route === "landing") return <Landing />;
  if (route === "profile") return <Profile />;
  return (
    <>
      <Scene />
      <Hud />
    </>
  );
}
