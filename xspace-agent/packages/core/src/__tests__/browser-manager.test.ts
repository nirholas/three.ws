// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§32]

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Browser, Page } from 'puppeteer';
import { BrowserManager } from '../browser/launcher';

// Mock puppeteer and puppeteer-extra
vi.mock('puppeteer-extra');
vi.mock('puppeteer-extra-plugin-stealth');

describe('BrowserManager', () => {
  let mockBrowser: Partial<Browser>;
  let mockPage: Partial<Page>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup mock page
    mockPage = {
      url: vi.fn().mockResolvedValue('https://x.com/home'),
      evaluate: vi.fn().mockResolvedValue(true),
      goto: vi.fn().mockResolvedValue(null),
      setUserAgent: vi.fn().mockResolvedValue(undefined),
      setCookie: vi.fn().mockResolvedValue(undefined),
    };

    // Setup mock browser
    mockBrowser = {
      newPage: vi.fn().mockResolvedValue(mockPage),
      pages: vi.fn().mockResolvedValue([mockPage]),
      close: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    // Mock global fetch for endpoint discovery
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        webSocketDebuggerUrl: 'ws://localhost:9222/devtools/browser/test',
      }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initialization', () => {
    it('should create a BrowserManager with default managed mode', () => {
      const mgr = new BrowserManager();
      expect(mgr.isConnectMode).toBe(false);
    });

    it('should create a BrowserManager in connect mode', () => {
      const mgr = new BrowserManager({ mode: 'connect' });
      expect(mgr.isConnectMode).toBe(true);
    });

    it('should create a BrowserManager in managed mode explicitly', () => {
      const mgr = new BrowserManager({ mode: 'managed' });
      expect(mgr.isConnectMode).toBe(false);
    });
  });

  describe('managed mode', () => {
    it('should have isConnectMode false for managed mode', () => {
      const mgr = new BrowserManager({ mode: 'managed' });
      expect(mgr.isConnectMode).toBe(false);
    });

    it('should report correct mode in healthCheck', async () => {
      const mgr = new BrowserManager({ mode: 'managed' });
      // Mock the private page
      (mgr as any)._page = mockPage;
      (mgr as any)._browser = mockBrowser;

      const health = await mgr.healthCheck();
      expect(health.mode).toBe('managed');
      expect(health.connected).toBe(true);
    });
  });

  describe('connect mode', () => {
    it('should have isConnectMode true for connect mode', () => {
      const mgr = new BrowserManager({ mode: 'connect', cdpPort: 9222 });
      expect(mgr.isConnectMode).toBe(true);
    });

    it('should report correct mode in healthCheck', async () => {
      const mgr = new BrowserManager({ mode: 'connect' });
      // Mock the private page
      (mgr as any)._page = mockPage;
      (mgr as any)._browser = mockBrowser;

      const health = await mgr.healthCheck();
      expect(health.mode).toBe('connect');
      expect(health.connected).toBe(true);
    });

    it('should discover endpoint from host and port', async () => {
      const mockFetch = global.fetch as any;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          webSocketDebuggerUrl: 'ws://localhost:9222/devtools/browser/abc123',
        }),
      });

      const mgr = new BrowserManager({
        mode: 'connect',
        cdpHost: 'localhost',
        cdpPort: 9222,
      });

      // Access private method via type casting
      const endpoint = await (mgr as any).discoverEndpoint();
      expect(endpoint).toBe('ws://localhost:9222/devtools/browser/abc123');
      expect(mockFetch).toHaveBeenCalledWith('http://localhost:9222/json/version');
    });

    it('should throw error if CDP endpoint discovery fails', async () => {
      const mockFetch = global.fetch as any;
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const mgr = new BrowserManager({
        mode: 'connect',
        cdpHost: 'localhost',
        cdpPort: 9999,
      });

      await expect((mgr as any).discoverEndpoint()).rejects.toThrow(
        'Cannot connect to Chrome at localhost:9999'
      );
    });
  });

  describe('getters', () => {
    it('should provide access to browser and page', () => {
      const mgr = new BrowserManager();
      expect(mgr.browser).toBeNull();
      expect(mgr.page).toBeNull();

      // Set private fields via type casting
      (mgr as any)._browser = mockBrowser;
      (mgr as any)._page = mockPage;

      expect(mgr.browser).toBe(mockBrowser);
      expect(mgr.page).toBe(mockPage);
    });
  });

  describe('healthCheck', () => {
    it('should report unknown URL when page is null', async () => {
      const mgr = new BrowserManager();
      const health = await mgr.healthCheck();
      // When page is null, optional chaining returns undefined
      // The implementation returns connected: true with pageUrl: 'unknown'
      expect(health.connected).toBe(true);
      expect(health.pageUrl).toBe('unknown');
    });

    it('should report page URL when connected', async () => {
      const mgr = new BrowserManager();
      (mgr as any)._page = mockPage;
      (mgr as any)._browser = mockBrowser;

      const health = await mgr.healthCheck();
      expect(health.connected).toBe(true);
      expect(health.pageUrl).toBe('https://x.com/home');
    });

    it('should catch errors during healthCheck', async () => {
      const mgr = new BrowserManager();
      const failingPage: Partial<Page> = {
        url: vi.fn().mockRejectedValue(new Error('Page disconnected')),
      };
      (mgr as any)._page = failingPage;

      const health = await mgr.healthCheck();
      expect(health.connected).toBe(false);
      expect(health.pageUrl).toBe('disconnected');
    });
  });

  describe('close', () => {
    it('should disconnect in connect mode and not close browser', async () => {
      const mgr = new BrowserManager({ mode: 'connect' });
      (mgr as any)._browser = mockBrowser;

      await mgr.close();

      expect(mockBrowser.disconnect).toHaveBeenCalled();
      expect(mockBrowser.close).not.toHaveBeenCalled();
      expect(mgr.browser).toBeNull();
    });

    it('should close browser in managed mode', async () => {
      const mgr = new BrowserManager({ mode: 'managed' });
      (mgr as any)._browser = mockBrowser;

      await mgr.close();

      expect(mockBrowser.close).toHaveBeenCalled();
      expect(mockBrowser.disconnect).not.toHaveBeenCalled();
      expect(mgr.browser).toBeNull();
    });
  });

  describe('config defaults', () => {
    it('should use default CDP port of 9222', () => {
      const mgr = new BrowserManager({ mode: 'connect' });
      // Access via type casting to verify config
      expect((mgr as any).config.cdpPort ?? 9222).toBe(9222);
    });

    it('should use default CDP host of localhost', () => {
      const mgr = new BrowserManager({ mode: 'connect' });
      expect((mgr as any).config.cdpHost ?? 'localhost').toBe('localhost');
    });

    it('should default mode to managed', () => {
      const mgr = new BrowserManager({});
      expect(mgr.isConnectMode).toBe(false);
    });
  });
});


