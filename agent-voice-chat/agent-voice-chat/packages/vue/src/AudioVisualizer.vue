<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(defineProps<{
  level: number;
  bars?: number;
  barWidth?: number;
  barGap?: number;
  height?: number;
  color?: string;
  inactiveColor?: string;
}>(), {
  bars: 20,
  barWidth: 3,
  barGap: 2,
  height: 40,
  color: '#3b82f6',
  inactiveColor: '#e5e7eb',
});

const activeBars = computed(() => Math.round(props.level * props.bars));
const totalWidth = computed(() => props.bars * props.barWidth + (props.bars - 1) * props.barGap);

const barElements = computed(() =>
  Array.from({ length: props.bars }, (_, i) => {
    const isActive = i < activeBars.value;
    const centerDistance = Math.abs(i - props.bars / 2) / (props.bars / 2);
    const barHeight = isActive
      ? props.height * (0.3 + 0.7 * (1 - centerDistance) * Math.min(props.level * 3, 1))
      : props.height * 0.15;

    return { isActive, barHeight };
  }),
);
</script>

<template>
  <div
    class="avc-audio-visualizer"
    :style="{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: `${barGap}px`,
      width: `${totalWidth}px`,
      height: `${height}px`,
    }"
  >
    <div
      v-for="(bar, i) in barElements"
      :key="i"
      :style="{
        width: `${barWidth}px`,
        height: `${bar.barHeight}px`,
        backgroundColor: bar.isActive ? color : inactiveColor,
        borderRadius: `${barWidth / 2}px`,
        transition: 'height 0.05s ease, background-color 0.1s ease',
      }"
    />
  </div>
</template>


