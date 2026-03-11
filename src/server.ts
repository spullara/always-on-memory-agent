import express, { type Express, type Request, type Response } from "express";

import { clearAllMemories, deleteMemory, getMemoryStats, readAllMemories } from "./db.js";
import { MemoryAgent } from "./memory-agent.js";

export function buildHttp(agent: MemoryAgent, watchPath = "./inbox"): Express {
  const app = express();
  app.use(express.json());

  app.get("/query", async (request: Request, response: Response) => {
    const q = String(request.query.q ?? "").trim();
    if (!q) {
      response.status(400).json({ error: "missing ?q= parameter" });
      return;
    }

    const answer = await agent.query(q);
    response.json({ question: q, answer });
  });

  app.post("/ingest", async (request: Request, response: Response) => {
    if (!request.body || typeof request.body !== "object") {
      response.status(400).json({ error: "invalid JSON" });
      return;
    }

    const text = typeof request.body.text === "string" ? request.body.text.trim() : "";
    if (!text) {
      response.status(400).json({ error: "missing 'text' field" });
      return;
    }

    const source = typeof request.body.source === "string" ? request.body.source : "api";
    const result = await agent.ingest(text, source);
    response.json({ status: "ingested", response: result });
  });

  app.post("/consolidate", async (_request: Request, response: Response) => {
    const result = await agent.consolidate();
    response.json({ status: "done", response: result });
  });

  app.get("/status", (_request: Request, response: Response) => {
    response.json(getMemoryStats());
  });

  app.get("/memories", (_request: Request, response: Response) => {
    response.json(readAllMemories());
  });

  app.post("/delete", (request: Request, response: Response) => {
    if (!request.body || typeof request.body !== "object") {
      response.status(400).json({ error: "invalid JSON" });
      return;
    }

    const memoryId = request.body.memory_id;
    if (!memoryId) {
      response.status(400).json({ error: "missing 'memory_id' field" });
      return;
    }

    response.json(deleteMemory(Number(memoryId)));
  });

  app.post("/clear", (_request: Request, response: Response) => {
    response.json(clearAllMemories(watchPath));
  });

  return app;
}
