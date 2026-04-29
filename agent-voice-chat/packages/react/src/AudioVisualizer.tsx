// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/agent-voice-chat)

import React, { useMemo } from 'react';
import type { AudioVisualizerProps } from './types';

/**
 * Renders a bar-style audio level visualizer.
 *
 * @example
 * ```tsx
 * <AudioVisualizer level={audioLevel} bars={20} height={40} color="#3b82f6" />
 * ```
 */
export const AudioVisualizer: React.FC<AudioVisualizerProps> = ({
  level,
  bars = 20,
  barWidth = 3,
  barGap = 2,
  height = 40,
  color = '#3b82f6',
  inactiveColor = '#e5e7eb',
  className,
  style,
}) => {
  const activeBars = Math.round(level * bars);
  const totalWidth = bars * barWidth + (bars - 1) * barGap;

  const barElements = useMemo(() => {
    return Array.from({ length: bars }, (_, i) => {
      const isActive = i < activeBars;
      // Create a natural waveform shape: taller in center, shorter at edges
      const centerDistance = Math.abs(i - bars / 2) / (bars / 2);
      const barHeight = isActive
        ? height * (0.3 + 0.7 * (1 - centerDistance) * Math.min(level * 3, 1))
        : height * 0.15;

      return (
        <div
          key={i}
          style={{
            width: barWidth,
            height: barHeight,
            backgroundColor: isActive ? color : inactiveColor,
            borderRadius: barWidth / 2,
            transition: 'height 0.05s ease, background-color 0.1s ease',
          }}
        />
      );
    });
  }, [activeBars, bars, barWidth, height, color, inactiveColor, level]);

  return (
    <div
      className={className}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: barGap,
        width: totalWidth,
        height,
        ...style,
      }}
    >
      {barElements}
    </div>
  );
};

AudioVisualizer.displayName = 'AudioVisualizer';
