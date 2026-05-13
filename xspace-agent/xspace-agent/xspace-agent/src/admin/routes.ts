// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§32]

import type { Request, Response, Router } from "express";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import type { SpaceState, LLMProvider } from "../types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createAdminRoutes(
  spaceState: SpaceState,
  provider: LLMProvider,
  prompts: Record<number, string>,
  voices: Record<number, string>,
): Router {
  const router = express.Router();

  // Admin API key middleware
  router.use("/api/*", (req: Request, res: Response, next) => {
    if (config.adminApiKey) {
      const key =
        req.headers["x-api-key"] ?? req.query["api_key"];
      if (key !== config.adminApiKey) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
    }
    next();
  });

  // Serve admin panel
  router.get("/", (_req: Request, res: Response) => {
    res.sendFile(path.join(__dirname, "../../public/admin.html"));
  });

  // Config endpoint
  router.get("/api/config", (_req: Request, res: Response) => {
    res.json({
      aiProvider: config.aiProvider,
      providerType: provider.type,
      ttsProvider: config.ttsProvider,
      sttProvider: config.sttProvider,
      xSpacesEnabled: config.xSpacesEnabled,
    });
  });

  // State endpoint
  router.get("/api/state", (_req: Request, res: Response) => {
    res.json({
      agents: spaceState.agents,
      currentTurn: spaceState.currentTurn,
      messages: spaceState.messages.slice(-50),
    });
  });

  // Session endpoint (for WebRTC mode)
  router.get("/api/session/:agentId", async (req: Request, res: Response) => {
    const agentId = parseInt(req.params["agentId"] ?? "", 10);
    if (agentId !== 0 && agentId !== 1) {
      res.status(400).json({ error: "Invalid agent ID" });
      return;
    }
    if (provider.type !== "webrtc") {
      res.json({ type: "socket", provider: config.aiProvider });
      return;
    }
    try {
      const data = await provider.createSession!(agentId, prompts, voices);
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: "Failed to create session" });
    }
  });

  // Update agent prompts
  router.put("/api/prompts/:agentId", express.json(), (req: Request, res: Response) => {
    const agentId = parseInt(req.params["agentId"] ?? "", 10);
    if (agentId !== 0 && agentId !== 1) {
      res.status(400).json({ error: "Invalid agent ID" });
      return;
    }
    const { prompt } = req.body as { prompt?: string };
    if (!prompt || typeof prompt !== "string") {
      res.status(400).json({ error: "prompt is required" });
      return;
    }
    prompts[agentId] = prompt;
    res.json({ ok: true, agentId, prompt });
  });

  // Health check
  router.get("/api/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      uptime: process.uptime(),
      timestamp: Date.now(),
    });
  });

  return router;
}


