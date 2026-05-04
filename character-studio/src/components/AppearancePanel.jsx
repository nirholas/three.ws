import React, { useContext, useState } from "react";
import { SceneContext } from "../context/SceneContext";
import styles from "./AppearancePanel.module.css";
import { ChromePicker } from "react-color";

const AppearancePanel = () => {
  const { characterManager } = useContext(SceneContext);
  const [color, setColor] = useState("#ffffff");

  const handleColorChange = (color) => {
    setColor(color.hex);
    if (characterManager) {
      // This is a simplified example. We'll need to know which trait to color.
      // For now, let's assume we're coloring the 'skin'.
      characterManager.setTraitColor("skin", color.hex);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.controlGroup}>
        <label>Skin Color</label>
        <ChromePicker
          color={color}
          onChangeComplete={handleColorChange}
          disableAlpha={true}
        />
      </div>
    </div>
  );
};

export default AppearancePanel;
