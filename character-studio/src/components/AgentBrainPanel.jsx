import React, { useState } from "react";
import styles from "./AgentBrainPanel.module.css";

const AgentBrainPanel = () => {
  const [systemPrompt, setSystemPrompt] = useState("");

  return (
    <div className={styles.container}>
      <h2>Agent Brain</h2>
      <div className={styles.controlGroup}>
        <label htmlFor="system-prompt">System Prompt</label>
        <textarea
          id="system-prompt"
          className={styles.textarea}
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          placeholder="e.g., You are a helpful assistant."
        />
      </div>
    </div>
  );
};

export default AgentBrainPanel;
