import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  buildDependencyGraph,
  calculateCascade,
  getGraphStats,
  clearGraphCache,
  type DependencyGraph,
} from '@/services/infrastructure-cascade';
import type { CascadeResult, CascadeImpactLevel, InfrastructureNode } from '@/types';

type NodeFilter = 'all' | 'cable' | 'pipeline' | 'port' | 'chokepoint';

export class CascadePanel extends Panel {
  private graph: DependencyGraph | null = null;
  private selectedNode: string | null = null;
  private cascadeResult: CascadeResult | null = null;
  private filter: NodeFilter = 'cable';
  private onSelectCallback: ((nodeId: string | null) => void) | null = null;

  constructor() {
    super({
      id: 'impact',
      title: 'Impact Analysis',
      showCount: true,
      trackActivity: true,
      infoTooltip: `<strong>Cascade Analysis</strong>
        Models DeFi protocol dependencies:
        <ul>
          <li>Cross-chain bridges, yield aggregators, oracles</li>
          <li>Select a protocol to simulate failure</li>
          <li>Shows affected chains and TVL impact</li>
          <li>Identifies redundant liquidity routes</li>
        </ul>
        Data from on-chain analytics and DeFiLlama.`,
    });
    this.init();
  }

  private async init(): Promise<void> {
    this.showLoading();
    try {
      this.graph = buildDependencyGraph();
      const stats = getGraphStats();
      this.setCount(stats.nodes);
      this.render();
    } catch (error) {
      console.error('[CascadePanel] Init error:', error);
      this.showError('Failed to build dependency graph');
    }
  }

  private getImpactColor(level: CascadeImpactLevel): string {
    switch (level) {
      case 'critical': return '#ff4444';
      case 'high': return '#ff8800';
      case 'medium': return '#ffaa00';
      case 'low': return '#88aa44';
    }
  }

  private getImpactEmoji(level: CascadeImpactLevel): string {
    switch (level) {
      case 'critical': return '🔴';
      case 'high': return '🟠';
      case 'medium': return '🟡';
      case 'low': return '🟢';
    }
  }

  private getNodeTypeEmoji(type: string): string {
    switch (type) {
      case 'cable': return '🔌';
      case 'pipeline': return '�';
      case 'port': return '🔗';
      case 'chokepoint': return '🔀';
      case 'country': return '🏳️';
      default: return '📍';
    }
  }

  private getFilteredNodes(): InfrastructureNode[] {
    if (!this.graph) return [];
    const nodes: InfrastructureNode[] = [];
    for (const node of this.graph.nodes.values()) {
      if (this.filter === 'all' || node.type === this.filter) {
        if (node.type !== 'country') {
          nodes.push(node);
        }
      }
    }
    return nodes.sort((a, b) => a.name.localeCompare(b.name));
  }

  private renderSelector(): string {
    const nodes = this.getFilteredNodes();
    const filterButtons = ['cable', 'pipeline', 'port', 'chokepoint'].map(f => {
      const labelMap: Record<string, string> = { cable: 'Bridge', pipeline: 'Yield', port: 'DEX', chokepoint: 'Pool' };
      return `<button class="impact-filter-btn ${this.filter === f ? 'active' : ''}" data-filter="${f}">
        ${this.getNodeTypeEmoji(f)} ${labelMap[f] || f}s
      </button>`;
    }).join('');

    const nodeOptions = nodes.map(n =>
      `<option value="${escapeHtml(n.id)}" ${this.selectedNode === n.id ? 'selected' : ''}>
        ${escapeHtml(n.name)}
      </option>`
    ).join('');

    return `
      <div class="impact-selector">
        <div class="impact-filters">${filterButtons}</div>
        <select class="impact-select" ${nodes.length === 0 ? 'disabled' : ''}>
          <option value="">Select ${this.filter}...</option>
          ${nodeOptions}
        </select>
        <button class="impact-analyze-btn" ${!this.selectedNode ? 'disabled' : ''}>
          Analyze Impact
        </button>
      </div>
    `;
  }

  private renderCascadeResult(): string {
    if (!this.cascadeResult) return '';

    const { source, countriesAffected, redundancies } = this.cascadeResult;

    const countriesHtml = countriesAffected.length > 0
      ? countriesAffected.map(c => `
          <div class="impact-country" style="border-left: 3px solid ${this.getImpactColor(c.impactLevel)}">
            <span class="impact-emoji">${this.getImpactEmoji(c.impactLevel)}</span>
            <span class="impact-country-name">${escapeHtml(c.countryName)}</span>
            <span class="impact-level">${c.impactLevel}</span>
            ${c.affectedCapacity > 0 ? `<span class="impact-capacity">${Math.round(c.affectedCapacity * 100)}% capacity</span>` : ''}
          </div>
        `).join('')
      : '<div class="empty-state">No country impacts detected</div>';

    const redundanciesHtml = redundancies && redundancies.length > 0
      ? `
        <div class="impact-section">
          <div class="impact-section-title">Alternative Routes</div>
          ${redundancies.map(r => `
            <div class="impact-redundancy">
              <span class="impact-redundancy-name">${escapeHtml(r.name)}</span>
              <span class="impact-redundancy-capacity">${Math.round(r.capacityShare * 100)}%</span>
            </div>
          `).join('')}
        </div>
      `
      : '';

    return `
      <div class="impact-result">
        <div class="impact-source">
          <span class="impact-emoji">${this.getNodeTypeEmoji(source.type)}</span>
          <span class="impact-source-name">${escapeHtml(source.name)}</span>
          <span class="impact-source-type">${source.type}</span>
        </div>
        <div class="impact-section">
          <div class="impact-section-title">Countries Affected (${countriesAffected.length})</div>
          <div class="impact-countries">${countriesHtml}</div>
        </div>
        ${redundanciesHtml}
      </div>
    `;
  }

  private render(): void {
    if (!this.graph) {
      this.showLoading();
      return;
    }

    const stats = getGraphStats();
    const statsHtml = `
      <div class="impact-stats">
        <span>🔌 ${stats.cables}</span>
        <span>� ${stats.pipelines}</span>
        <span>🔗 ${stats.ports}</span>
        <span>🌊 ${stats.chokepoints}</span>
        <span>🏳️ ${stats.countries}</span>
        <span>📊 ${stats.edges} links</span>
      </div>
    `;

    this.content.innerHTML = `
      <div class="impact-panel">
        ${statsHtml}
        ${this.renderSelector()}
        ${this.cascadeResult ? this.renderCascadeResult() : '<div class="impact-hint">Select infrastructure to analyze cascade impact</div>'}
      </div>
    `;

    this.attachEventListeners();
  }

  private attachEventListeners(): void {
    const filterBtns = this.content.querySelectorAll('.impact-filter-btn');
    filterBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        this.filter = btn.getAttribute('data-filter') as NodeFilter;
        this.selectedNode = null;
        this.cascadeResult = null;
        this.render();
      });
    });

    const select = this.content.querySelector('.impact-select') as HTMLSelectElement;
    if (select) {
      select.addEventListener('change', () => {
        this.selectedNode = select.value || null;
        this.cascadeResult = null;
        if (this.onSelectCallback) {
          this.onSelectCallback(this.selectedNode);
        }
        this.render();
      });
    }

    const analyzeBtn = this.content.querySelector('.impact-analyze-btn');
    if (analyzeBtn) {
      analyzeBtn.addEventListener('click', () => this.runAnalysis());
    }
  }

  private runAnalysis(): void {
    if (!this.selectedNode) return;

    this.cascadeResult = calculateCascade(this.selectedNode);
    this.render();

    if (this.onSelectCallback) {
      this.onSelectCallback(this.selectedNode);
    }
  }

  public selectNode(nodeId: string): void {
    this.selectedNode = nodeId;
    const nodeType = nodeId.split(':')[0] as NodeFilter;
    if (['cable', 'pipeline', 'port', 'chokepoint'].includes(nodeType)) {
      this.filter = nodeType;
    }
    this.runAnalysis();
  }

  public onSelect(callback: (nodeId: string | null) => void): void {
    this.onSelectCallback = callback;
  }

  public getSelectedNode(): string | null {
    return this.selectedNode;
  }

  public getCascadeResult(): CascadeResult | null {
    return this.cascadeResult;
  }

  public refresh(): void {
    clearGraphCache();
    this.graph = null;
    this.cascadeResult = null;
    this.init();
  }

  public destroy(): void {
    super.destroy();
  }
}
