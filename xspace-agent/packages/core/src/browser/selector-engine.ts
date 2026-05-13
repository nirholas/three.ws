// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§82]

// =============================================================================
// Self-healing selector engine
// Tries multiple strategies per UI element, caches successes, logs failures
// =============================================================================

import type { Page, ElementHandle } from 'puppeteer';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SelectorStrategy {
  name: string;
  selector: string;
  priority: number; // Lower = tried first
}

export interface SelectorDefinition {
  name: string;
  description: string;
  strategies: SelectorStrategy[];
  textMatch?: string;
  ariaMatch?: string;
}

export interface SelectorHealthEntry {
  name: string;
  strategy?: string;
  strategies?: string[];
}

export interface SelectorHealthReport {
  healthy: SelectorHealthEntry[];
  broken: SelectorHealthEntry[];
  timestamp: number;
}

export interface SelectorFailureEntry {
  name: string;
  selector: string;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export class SelectorEngine {
  private definitions: Map<string, SelectorDefinition> = new Map();
  private successCache: Map<string, string> = new Map();
  private failureLog: SelectorFailureEntry[] = [];

  constructor(definitions: SelectorDefinition[]) {
    for (const def of definitions) {
      this.definitions.set(def.name, def);
    }
  }

  /** Return the best selector string to try first (cached or highest priority). */
  get(name: string): string {
    const cached = this.successCache.get(name);
    if (cached) return cached;

    const def = this.definitions.get(name);
    if (!def) throw new Error(`Unknown selector: ${name}`);

    const sorted = [...def.strategies].sort((a, b) => a.priority - b.priority);
    return sorted[0].selector;
  }

  /** Try all strategies to locate an element, with text / aria / a11y fallbacks. */
  async find(page: Page, name: string): Promise<ElementHandle | null> {
    const def = this.definitions.get(name);
    if (!def) throw new Error(`Unknown selector: ${name}`);

    // 1. Cached selector
    const cached = this.successCache.get(name);
    if (cached) {
      const el = await this.safeQuery(page, cached);
      if (el) return el;
      this.successCache.delete(name); // stale
    }

    // 2. Strategy chain
    const sorted = [...def.strategies].sort((a, b) => a.priority - b.priority);
    for (const strategy of sorted) {
      try {
        const el = await this.safeQuery(page, strategy.selector);
        if (el) {
          this.successCache.set(name, strategy.selector);
          return el;
        }
      } catch {
        this.failureLog.push({ name, selector: strategy.selector, timestamp: Date.now() });
      }
    }

    // 3. Text content fallback
    if (def.textMatch) {
      const el = await this.findByText(page, def.textMatch);
      if (el) return el;
    }

    // 4. Aria-label fallback
    if (def.ariaMatch) {
      const el = await this.safeQuery(page, `[aria-label*="${def.ariaMatch}" i]`);
      if (el) return el;
    }

    // 5. Accessibility tree fallback
    const el = await this.findByAccessibilityTree(page, def);
    if (el) return el;

    // All strategies exhausted
    this.failureLog.push({ name, selector: 'ALL_STRATEGIES', timestamp: Date.now() });
    return null;
  }

  /** Manually override the cached selector for a given name. */
  override(name: string, selector: string): void {
    this.successCache.set(name, selector);
  }

  /** Return a copy of the failure log for diagnostics. */
  getFailureReport(): SelectorFailureEntry[] {
    return [...this.failureLog];
  }

  /** Get all registered definition names. */
  getDefinitionNames(): string[] {
    return [...this.definitions.keys()];
  }

  /** Get a specific definition. */
  getDefinition(name: string): SelectorDefinition | undefined {
    return this.definitions.get(name);
  }

  /** Get the current success cache (name → working selector). */
  getSuccessCache(): Map<string, string> {
    return new Map(this.successCache);
  }

  // ── Private helpers ────────────────────────────────────────

  private async safeQuery(page: Page, selector: string): Promise<ElementHandle | null> {
    try {
      return await page.$(selector);
    } catch {
      return null; // invalid or unsupported selector syntax
    }
  }

  private async findByText(page: Page, text: string): Promise<ElementHandle | null> {
    try {
      const handle = await page.evaluateHandle((t: string) => {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          if (walker.currentNode.textContent?.trim().toLowerCase().includes(t.toLowerCase())) {
            return walker.currentNode.parentElement;
          }
        }
        return null;
      }, text);

      const el = handle.asElement();
      if (el) return el as ElementHandle;
      await handle.dispose();
      return null;
    } catch {
      return null;
    }
  }

  private async findByAccessibilityTree(page: Page, def: SelectorDefinition): Promise<ElementHandle | null> {
    let cdp;
    try {
      cdp = await page.createCDPSession();
      await cdp.send('Accessibility.enable');
      const { nodes } = await cdp.send('Accessibility.getFullAXTree') as { nodes: any[] };

      const searchTerms = [
        def.ariaMatch?.toLowerCase(),
        def.textMatch?.toLowerCase(),
      ].filter(Boolean) as string[];

      if (searchTerms.length === 0) return null;

      const target = nodes.find((node: any) => {
        const nodeName = (node.name?.value || '').toLowerCase();
        return searchTerms.some((term) => nodeName.includes(term));
      });

      if (target?.backendDOMNodeId) {
        try {
          const { object } = await cdp.send('DOM.resolveNode', {
            backendNodeId: target.backendDOMNodeId,
          }) as { object: { objectId?: string } };

          if (object?.objectId) {
            // Use CDP createElementHandle to convert the remote object to an ElementHandle
            const jsHandle = await page.evaluateHandle(
              `(() => {
                return document.querySelector('[data-backend-id]');
              })()`,
            );
            // Best-effort: query by aria role/name as fallback since CDP node → ElementHandle
            // conversion requires internal Puppeteer APIs not publicly exposed
            const ariaLabel = def.ariaMatch || def.textMatch;
            if (ariaLabel) {
              const fallback = await page.$(`[aria-label*="${ariaLabel.replace(/"/g, '\\"')}" i]`);
              await jsHandle.dispose();
              if (fallback) return fallback;
            }
            await jsHandle.dispose();
          }
        } catch {
          // DOM.resolveNode can fail if the node is no longer in the DOM
        }
      }
    } catch {
      // Accessibility tree not available or query failed — acceptable
    } finally {
      try {
        await cdp?.detach();
      } catch { /* ignore */ }
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Health check utility
// ---------------------------------------------------------------------------

export async function validateSelectors(
  page: Page,
  engine: SelectorEngine,
): Promise<SelectorHealthReport> {
  const report: SelectorHealthReport = { healthy: [], broken: [], timestamp: Date.now() };

  for (const name of engine.getDefinitionNames()) {
    const el = await engine.find(page, name);
    if (el) {
      report.healthy.push({
        name,
        strategy: engine.getSuccessCache().get(name),
      });
      await el.dispose();
    } else {
      const def = engine.getDefinition(name);
      report.broken.push({
        name,
        strategies: def?.strategies.map((s) => s.selector) ?? [],
      });
    }
  }

  return report;
}


