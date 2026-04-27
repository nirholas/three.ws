import "./style.css";
import ReactDOM from "react-dom/client";
import { Canvas } from "@react-three/fiber";
import { Suspense, useEffect, useState } from "react";
import { Bvh } from "@react-three/drei";
import { Joystick, VirtualButton } from "../src/index";
import SimsExperience from "./SimsExperience";
import ChatPanel from "./ChatPanel";

const root = ReactDOM.createRoot(document.querySelector("#root"));

const JoystickControls = () => {
  const [isTouchScreen, setIsTouchScreen] = useState(false);
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
          <VirtualButton
            id="run"
            label="RUN"
            buttonWrapperStyle={{ right: "100px", bottom: "40px" }}
          />
          <VirtualButton
            id="jump"
            label="JUMP"
            buttonWrapperStyle={{ right: "40px", bottom: "100px" }}
          />
        </>
      )}
    </>
  );
};

root.render(
  <>
    <JoystickControls />
    <ChatPanel />
    <Canvas
      shadows
      camera={{ fov: 65, near: 0.1, far: 1000, position: [0, 2, 5] }}
    >
      <Suspense fallback={null}>
        <Bvh firstHitOnly>
          <SimsExperience />
        </Bvh>
      </Suspense>
    </Canvas>
  </>
);
