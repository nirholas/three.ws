import * as d3 from 'd3';

export interface TimeSeriesDataPoint {
  date: string | Date;
  value: number;
}

export interface TimeSeriesSeries {
  name: string;
  data: TimeSeriesDataPoint[];
  color: string;
}

export interface TimeSeriesOptions {
  container: HTMLElement;
  width?: number;
  height?: number;
  series: TimeSeriesSeries[];
  yAxisFormat?: 'currency' | 'number' | 'percent';
  showLegend?: boolean;
  showTooltip?: boolean;
  showGrid?: boolean;
  animate?: boolean;
  margin?: { top: number; right: number; bottom: number; left: number };
}

export class TimeSeriesChart {
  private svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  private options: Required<Omit<TimeSeriesOptions, 'container'>> & { container: HTMLElement };
  private tooltip: HTMLElement | null = null;

  constructor(options: TimeSeriesOptions) {
    this.options = {
      width: options.container.clientWidth || 300,
      height: 180,
      yAxisFormat: 'currency',
      showLegend: true,
      showTooltip: true,
      showGrid: true,
      animate: true,
      margin: { top: 10, right: 10, bottom: 25, left: 50 },
      ...options,
    };

    this.svg = d3.select(options.container)
      .append('svg')
      .attr('class', 'ts-chart')
      .attr('width', this.options.width)
      .attr('height', this.options.height);

    if (this.options.series.length && this.options.series.some(s => s.data.length > 0)) {
      this.render();
    }
  }

  private render(): void {
    const { width, height, margin, series } = this.options;
    const w = width - margin.left - margin.right;
    const h = height - margin.top - margin.bottom;

    if (w <= 0 || h <= 0) return;

    const g = this.svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // Combine all dates for x scale
    const allDates = series.flatMap(s => s.data.map(d => new Date(d.date)));
    const allValues = series.flatMap(s => s.data.map(d => d.value));

    if (!allDates.length || !allValues.length) return;

    const dateExtent = d3.extent(allDates) as [Date, Date];
    const minVal = d3.min(allValues) ?? 0;
    const maxVal = d3.max(allValues) ?? 1;

    const x = d3.scaleTime()
      .domain(dateExtent)
      .range([0, w]);

    const y = d3.scaleLinear()
      .domain([minVal * 0.95, maxVal * 1.05])
      .range([h, 0]);

    // Grid lines
    if (this.options.showGrid) {
      g.append('g').attr('class', 'ts-grid')
        .selectAll('line')
        .data(y.ticks(5))
        .join('line')
        .attr('x1', 0).attr('x2', w)
        .attr('y1', d => y(d)).attr('y2', d => y(d))
        .attr('stroke', 'rgba(255,255,255,0.06)');
    }

    // X axis
    g.append('g').attr('class', 'ts-x-axis')
      .attr('transform', `translate(0,${h})`)
      .call(
        d3.axisBottom(x)
          .ticks(5)
          .tickFormat(d3.timeFormat('%b %d') as unknown as (domainValue: Date | d3.NumberValue, index: number) => string)
      )
      .selectAll('text')
      .style('fill', 'rgba(255,255,255,0.5)')
      .style('font-size', '10px');

    // Y axis
    const yFormat = this.getYFormatter();

    g.append('g').attr('class', 'ts-y-axis')
      .call(
        d3.axisLeft(y)
          .ticks(5)
          .tickFormat(yFormat as unknown as (domainValue: d3.NumberValue, index: number) => string)
      )
      .selectAll('text')
      .style('fill', 'rgba(255,255,255,0.5)')
      .style('font-size', '10px');

    // Lines for each series
    const line = d3.line<TimeSeriesDataPoint>()
      .x(d => x(new Date(d.date)))
      .y(d => y(d.value))
      .curve(d3.curveMonotoneX);

    series.forEach(s => {
      if (!s.data.length) return;

      const path = g.append('path')
        .datum(s.data)
        .attr('class', 'ts-line')
        .attr('fill', 'none')
        .attr('stroke', s.color)
        .attr('stroke-width', 1.5)
        .attr('d', line);

      if (this.options.animate) {
        const node = path.node();
        if (node) {
          const totalLength = node.getTotalLength();
          path.attr('stroke-dasharray', `${totalLength} ${totalLength}`)
            .attr('stroke-dashoffset', totalLength)
            .transition().duration(800).ease(d3.easeCubicOut)
            .attr('stroke-dashoffset', 0);
        }
      }

      // Area fill (subtle)
      const area = d3.area<TimeSeriesDataPoint>()
        .x(d => x(new Date(d.date)))
        .y0(h)
        .y1(d => y(d.value))
        .curve(d3.curveMonotoneX);

      g.append('path')
        .datum(s.data)
        .attr('class', 'ts-area')
        .attr('fill', s.color)
        .attr('fill-opacity', 0.08)
        .attr('d', area);
    });

    // Legend
    if (this.options.showLegend && series.length > 1) {
      const legend = g.append('g').attr('class', 'ts-legend')
        .attr('transform', `translate(${w - 10}, 5)`);

      series.forEach((s, i) => {
        const item = legend.append('g').attr('transform', `translate(0, ${i * 16})`);
        item.append('line')
          .attr('x1', -20).attr('x2', -8)
          .attr('y1', 0).attr('y2', 0)
          .attr('stroke', s.color).attr('stroke-width', 2);
        item.append('text')
          .attr('x', -24).attr('y', 4)
          .text(s.name)
          .style('fill', 'rgba(255,255,255,0.6)')
          .style('font-size', '10px')
          .attr('text-anchor', 'end');
      });
    }

    // Tooltip: crosshair on hover
    if (this.options.showTooltip) {
      this.addTooltip(g, x, y, series, w, h);
    }
  }

  private getYFormatter(): (d: number) => string {
    if (this.options.yAxisFormat === 'currency') {
      return (d: number) => {
        if (d >= 1e12) return `$${(d / 1e12).toFixed(1)}T`;
        if (d >= 1e9) return `$${(d / 1e9).toFixed(1)}B`;
        if (d >= 1e6) return `$${(d / 1e6).toFixed(0)}M`;
        return `$${d.toFixed(0)}`;
      };
    }
    if (this.options.yAxisFormat === 'percent') {
      return (d: number) => `${d.toFixed(1)}%`;
    }
    return (d: number) => {
      if (d >= 1e12) return `${(d / 1e12).toFixed(1)}T`;
      if (d >= 1e9) return `${(d / 1e9).toFixed(1)}B`;
      if (d >= 1e6) return `${(d / 1e6).toFixed(0)}M`;
      return `${d}`;
    };
  }

  private addTooltip(
    g: d3.Selection<SVGGElement, unknown, null, undefined>,
    x: d3.ScaleTime<number, number>,
    y: d3.ScaleLinear<number, number>,
    series: TimeSeriesSeries[],
    w: number,
    h: number,
  ): void {
    // Create overlay rect for mouse events
    const crosshair = g.append('line')
      .attr('class', 'ts-crosshair')
      .attr('y1', 0).attr('y2', h)
      .attr('stroke', 'rgba(255,255,255,0.3)')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '3,3')
      .style('display', 'none');

    // Dots for each series
    const dots = series.map(s =>
      g.append('circle')
        .attr('class', 'ts-dot')
        .attr('r', 3)
        .attr('fill', s.color)
        .attr('stroke', '#111')
        .attr('stroke-width', 1)
        .style('display', 'none')
    );

    // Tooltip div
    const tooltip = document.createElement('div');
    tooltip.className = 'ts-tooltip';
    tooltip.style.display = 'none';
    this.options.container.appendChild(tooltip);
    this.tooltip = tooltip;

    const yFormat = this.getYFormatter();
    const bisector = d3.bisector<TimeSeriesDataPoint, Date>(d => new Date(d.date)).left;

    g.append('rect')
      .attr('class', 'ts-overlay')
      .attr('width', w).attr('height', h)
      .attr('fill', 'none')
      .attr('pointer-events', 'all')
      .on('mousemove', (event: MouseEvent) => {
        const [mx] = d3.pointer(event);
        const hoverDate = x.invert(mx);

        crosshair
          .attr('x1', mx).attr('x2', mx)
          .style('display', null);

        let tooltipHtml = `<div class="ts-tooltip-date">${d3.timeFormat('%b %d, %Y')(hoverDate)}</div>`;

        series.forEach((s, i) => {
          if (!s.data.length) return;
          const idx = bisector(s.data, hoverDate, 1);
          const d0 = s.data[idx - 1];
          const d1 = s.data[idx];
          if (!d0) return;
          const closest = d1 && (hoverDate.getTime() - new Date(d0.date).getTime()) > (new Date(d1.date).getTime() - hoverDate.getTime()) ? d1 : d0;

          const dot = dots[i];
          if (!dot) return;
          dot
            .attr('cx', x(new Date(closest.date)))
            .attr('cy', y(closest.value))
            .style('display', null);

          tooltipHtml += `<div class="ts-tooltip-row"><span class="ts-tooltip-color" style="background:${s.color}"></span>${s.name}: ${yFormat(closest.value)}</div>`;
        });

        tooltip.innerHTML = tooltipHtml;
        tooltip.style.display = 'block';

        // Position tooltip
        const containerRect = this.options.container.getBoundingClientRect();
        const svgRect = (this.svg.node() as SVGSVGElement).getBoundingClientRect();
        const tooltipX = svgRect.left - containerRect.left + this.options.margin.left + mx + 12;
        const tooltipW = tooltip.offsetWidth;
        if (tooltipX + tooltipW > containerRect.width) {
          tooltip.style.left = `${tooltipX - tooltipW - 24}px`;
        } else {
          tooltip.style.left = `${tooltipX}px`;
        }
        tooltip.style.top = `${svgRect.top - containerRect.top + this.options.margin.top + 10}px`;
      })
      .on('mouseleave', () => {
        crosshair.style('display', 'none');
        dots.forEach(d => d.style('display', 'none'));
        tooltip.style.display = 'none';
      });
  }

  public update(newSeries: TimeSeriesSeries[]): void {
    this.svg.selectAll('*').remove();
    this.tooltip?.remove();
    this.tooltip = null;
    this.options.series = newSeries;
    if (newSeries.length && newSeries.some(s => s.data.length > 0)) {
      this.render();
    }
  }

  public destroy(): void {
    this.svg.remove();
    this.tooltip?.remove();
    this.tooltip = null;
  }

  public resize(): void {
    const newWidth = this.options.container.clientWidth;
    if (newWidth && newWidth > 0 && newWidth !== this.options.width) {
      this.options.width = newWidth;
      this.svg.attr('width', newWidth);
      this.svg.selectAll('*').remove();
      this.tooltip?.remove();
      this.tooltip = null;
      if (this.options.series.length && this.options.series.some(s => s.data.length > 0)) {
        this.render();
      }
    }
  }
}

/**
 * Creates the period toggle buttons (7d / 30d / 90d / 1y) above a chart.
 * Returns the wrapper element and a callback to set the active period.
 */
export function createPeriodToggle(
  container: HTMLElement,
  periods: string[],
  activePeriod: string,
  onSelect: (period: string) => void,
): { wrapper: HTMLElement; setActive: (p: string) => void } {
  const wrapper = document.createElement('div');
  wrapper.className = 'ts-period-toggle';

  const buttons: HTMLButtonElement[] = [];

  periods.forEach(p => {
    const btn = document.createElement('button');
    btn.className = `ts-period-btn${p === activePeriod ? ' active' : ''}`;
    btn.textContent = p;
    btn.addEventListener('click', () => onSelect(p));
    wrapper.appendChild(btn);
    buttons.push(btn);
  });

  container.appendChild(wrapper);

  return {
    wrapper,
    setActive(p: string) {
      buttons.forEach(b => b.classList.toggle('active', b.textContent === p));
    },
  };
}
