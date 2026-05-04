import React from "react"

import styles from "./Studio.module.css"

const Studio = () => {
  return (
    <div className={styles.container}>
      <div className={styles.leftPanel}>
        {/* Agent Brain Configuration */}
        <h2>Agent Brain</h2>
        {/* Form elements for personality, skills, etc. */}
      </div>
      <div className={styles.centerPanel}>
        {/* This is where the 3D viewport will be rendered */}
      </div>
      <div className={styles.rightPanel}>
        {/* Appearance Customization */}
        <h2>Appearance</h2>
        {/* Color pickers, texture selectors, etc. */}
      </div>
    </div>
  )
}

export default Studio
