import { useEffect } from "react";
import { Scene } from "./scene/Scene";
import { Hud } from "./ui/Hud";
import { useStore } from "./store";

export default function App() {
  const loadManifest = useStore((s) => s.loadManifest);
  useEffect(() => {
    void loadManifest();
  }, [loadManifest]);

  return (
    <>
      <Scene />
      <Hud />
    </>
  );
}
