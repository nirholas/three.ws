// Chart helpers. echarts is loaded on first use so the shell paints fast.
import type { EChartsOption } from 'echarts';

const css = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
export const palette = () => ({ fg: css('--fg'), mut: css('--mut'), line: css('--line'), acc: css('--acc'), up: css('--up'), down: css('--down'), warn: css('--warn'), link: css('--link') });

export async function chart(el: HTMLElement, option: (p: ReturnType<typeof palette>) => EChartsOption): Promise<() => void> {
  const echarts = await import('echarts');
  const inst = echarts.init(el, undefined, { renderer: 'canvas' });
  const apply = () => inst.setOption({ backgroundColor: 'transparent', textStyle: { color: palette().mut }, animationDuration: 300, ...option(palette()) }, true);
  apply();
  const ro = new ResizeObserver(() => inst.resize());
  ro.observe(el);
  const mq = matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', apply);
  return () => {
    mq.removeEventListener('change', apply);
    ro.disconnect();
    inst.dispose();
  };
}

export function lineOption(p: ReturnType<typeof palette>, series: { name: string; data: [number, number][]; color?: string; area?: boolean }[], fmt: (v: number) => string): EChartsOption {
  return {
    grid: { left: 52, right: 14, top: 28, bottom: 28 },
    legend: { top: 0, textStyle: { color: p.mut }, icon: 'roundRect' },
    tooltip: { trigger: 'axis', valueFormatter: (v) => fmt(Number(v)) },
    xAxis: { type: 'time', axisLine: { lineStyle: { color: p.line } }, axisLabel: { color: p.mut } },
    yAxis: { type: 'value', splitLine: { lineStyle: { color: p.line } }, axisLabel: { color: p.mut, formatter: (v: number) => fmt(v) } },
    series: series.map((s, i) => ({ name: s.name, type: 'line', showSymbol: false, smooth: true, data: s.data, lineStyle: { width: 2, color: s.color ?? [p.acc, p.link, p.warn][i % 3] }, itemStyle: { color: s.color ?? [p.acc, p.link, p.warn][i % 3] }, areaStyle: s.area ? { opacity: 0.12 } : undefined })),
  };
}
