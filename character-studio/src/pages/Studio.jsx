import React, { useContext, useEffect, useRef } from "react";
import styles from "./Studio.module.css";
import AppearancePanel from "../components/AppearancePanel";
import AgentBrainPanel from "../components/AgentBrainPanel";
import { SceneContext } from "../context/SceneContext";

const Studio = () => {
  const { renderer } = useContext(SceneContext);
  const viewportRef = useRef(null);

  useEffect(() => {
    if (renderer && viewportRef.current) {
      viewportRef.current.appendChild(renderer.domElement);
    }
  }, [renderer]);

  return (
    <div className={styles.container}>
      <div className={styles.leftPanel}>
        <AgentBrainPanel />
      </div>
      <div className={styles.centerPanel} ref={viewportRef}>
        {/* This is where the 3D viewport will be rendered */}
      </div>
      <div className={styles.rightPanel}>
        <AppearancePanel />
      </div>
    </div>
  );
};

export default Studio;
