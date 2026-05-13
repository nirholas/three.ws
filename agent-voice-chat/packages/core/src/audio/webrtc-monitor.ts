// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§78]

import type { Page } from 'puppeteer';
import type { WebRTCStats, WebRTCMonitorConfig } from './types';
import { getLogger } from '../logger';

/**
 * Monitors WebRTC connection quality by polling RTCPeerConnection.getStats()
 * inside the browser page via CDP.
 *
 * Exposes packet loss, jitter, round-trip time, and bytes received for
 * observability and quality-degradation detection.
 */
export class WebRTCMonitor {
  private page: Page | null = null;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private readonly pollIntervalMs: number;
  private readonly packetLossThreshold: number;
  private readonly jitterThreshold: number;
  private lastStats: WebRTCStats = {
    packetsLost: 0,
    jitter: 0,
    roundTripTime: 0,
    bytesReceived: 0,
  };
  private onStatsCallback: ((stats: WebRTCStats) => void) | null = null;
  private onDegradedCallback: ((reason: string, stats: WebRTCStats) => void) | null = null;

  constructor(config?: WebRTCMonitorConfig) {
    this.pollIntervalMs = config?.pollIntervalMs ?? 5000;
    this.packetLossThreshold = config?.packetLossThreshold ?? 50;
    this.jitterThreshold = config?.jitterThreshold ?? 0.05; // 50ms
  }

  /** Start monitoring WebRTC stats by injecting a poller into the page. */
  async start(page: Page): Promise<void> {
    this.page = page;

    // Inject the stats polling into the browser page
    await page.evaluate(() => {
      (window as any).__webrtcStats = {
        packetsLost: 0,
        jitter: 0,
        roundTripTime: 0,
        bytesReceived: 0,
      };

      // Find the hooked RTCPeerConnection (set by audio bridge)
      const poll = async (): Promise<void> => {
        const pc = (window as any).__rtcPeerConnection as RTCPeerConnection | undefined;
        if (!pc) return;

        try {
          const stats = await pc.getStats();
          const report: any = {};

          stats.forEach((stat: any) => {
            if (stat.type === 'inbound-rtp' && stat.kind === 'audio') {
              report.packetsLost = stat.packetsLost ?? 0;
              report.jitter = stat.jitter ?? 0;
              report.bytesReceived = stat.bytesReceived ?? 0;
            }
            if (stat.type === 'candidate-pair' && stat.state === 'succeeded') {
              report.roundTripTime = stat.currentRoundTripTime ?? 0;
            }
          });

          (window as any).__webrtcStats = report;
        } catch {
          // Stats unavailable — connection may have closed
        }
      };

      (window as any).__webrtcStatsPollId = setInterval(poll, 5000);
      poll(); // Initial poll
    });

    // Node-side polling to read stats from the page
    this.pollInterval = setInterval(() => {
      this.readStats().catch(() => {});
    }, this.pollIntervalMs);

    getLogger().debug('[WebRTCMonitor] Started');
  }

  /** Stop monitoring and clean up intervals. */
  async stop(): Promise<void> {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    if (this.page) {
      try {
        await this.page.evaluate(() => {
          if ((window as any).__webrtcStatsPollId) {
            clearInterval((window as any).__webrtcStatsPollId);
            (window as any).__webrtcStatsPollId = null;
          }
        });
      } catch {
        // Page may already be closed
      }
      this.page = null;
    }

    getLogger().debug('[WebRTCMonitor] Stopped');
  }

  /** Register a callback for stats updates. */
  onStats(callback: (stats: WebRTCStats) => void): void {
    this.onStatsCallback = callback;
  }

  /** Register a callback for quality degradation events. */
  onDegraded(callback: (reason: string, stats: WebRTCStats) => void): void {
    this.onDegradedCallback = callback;
  }

  /** Get the most recent stats snapshot. */
  getStats(): WebRTCStats {
    return { ...this.lastStats };
  }

  /** Read stats from the browser page and check for degradation. */
  private async readStats(): Promise<void> {
    if (!this.page) return;

    try {
      const stats = await this.page.evaluate(
        () => (window as any).__webrtcStats as WebRTCStats | undefined,
      );
      if (!stats) return;

      this.lastStats = stats;
      this.onStatsCallback?.(stats);

      // Check for quality degradation
      if (stats.packetsLost > this.packetLossThreshold) {
        this.onDegradedCallback?.(
          `High packet loss: ${stats.packetsLost}`,
          stats,
        );
      }
      if (stats.jitter > this.jitterThreshold) {
        this.onDegradedCallback?.(
          `High jitter: ${(stats.jitter * 1000).toFixed(1)}ms`,
          stats,
        );
      }
    } catch {
      // Page may be navigating or closed
    }
  }
}


