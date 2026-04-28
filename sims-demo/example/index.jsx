import "./style.css";
import ReactDOM from "react-dom/client";
import { Canvas } from "@react-three/fiber";
import { Suspense, useEffect, useState } from "react";
import { Bvh } from "@react-three/drei";
import { Joystick, VirtualButton } from "../src/index";
import SimsExperience from "./SimsExperience";
import ChatPanel from "./ChatPanel";

const root = ReactDOM.createRoot(document.querySelector("#root"));

const MAPS = [
  { id: "cozy_tavern", label: "Cozy Tavern" },
  { id: "large_floor", label: "Large Floor" },
  { id: "hintze_hall", label: "Hintze Hall" },
  { id: "fantasy_inn", label: "Fantasy Inn" },
  { id: "ibizone", label: "Ibizone" },
];

const App = () => {
  const [isTouchScreen, setIsTouchScreen] = useState(false);
  const [mapName, setMapName] = useState("ibizone");

  useEffect(() => {
    if ("ontouchstart" in window || navigator.maxTouchPoints > 0) {
      setIsTouchScreen(true);
    }
  }, []);

  return (
    <>
      {isTouchScreen && (
        <>
          <Joystick />
          <VirtualButton id="run" label="RUN" buttonWrapperStyle={{ right: "100px", bottom: "40px" }} />
          <VirtualButton id="jump" label="JUMP" buttonWrapperStyle={{ right: "40px", bottom: "100px" }} />
        </>
      )}
      <div style={{
        position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)",
        display: "flex", gap: 8, zIndex: 100,
      }}>
        {MAPS.map((m) => (
          <button
            key={m.id}
            onClick={() => setMapName(m.id)}
            style={{
              padding: "6px 14px",
              borderRadius: 8,
              border: "none",
              cursor: "pointer",
              fontWeight: 600,
              fontSize: 13,
              background: mapName === m.id ? "#fff" : "rgba(255,255,255,0.25)",
              color: mapName === m.id ? "#111" : "#fff",
              backdropFilter: "blur(6px)",
              transition: "background 0.15s",
            }}
          >
            {m.label}
          </button>
        ))}
      </div>
      <ChatPanel />
      <Canvas shadows camera={{ fov: 65, near: 0.1, far: 1000, position: [0, 2, 5] }}>
        <Suspense fallback={null}>
          <Bvh firstHitOnly>
            <SimsExperience key={mapName} mapName={mapName} />
          </Bvh>
        </Suspense>
      </Canvas>
    </>
  );
};

root.render(<App />);
