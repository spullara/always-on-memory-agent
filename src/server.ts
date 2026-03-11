import fs from "node:fs";
import path from "node:path";

import express, { type Express, type Request, type Response } from "express";
import multer from "multer";

import { clearAllMemories, deleteMemory, getMemoryStats, readAllMemories } from "./db.js";
import { MemoryAgent } from "./memory-agent.js";

export function buildHttp(agent: MemoryAgent, watchPath = "./inbox"): Express {
  const app = express();
  const resolvedWatchPath = path.resolve(watchPath);
  const upload = multer({
    storage: multer.diskStorage({
      destination: (_request, _file, callback) => {
        fs.mkdirSync(resolvedWatchPath, { recursive: true });
        callback(null, resolvedWatchPath);
      },
      filename: (_request, file, callback) => {
        callback(null, nextUploadName(resolvedWatchPath, file.originalname));
      },
    }),
  });

  app.use((request, response, next) => {
    response.header("Access-Control-Allow-Origin", "http://localhost:5173");
    response.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    response.header("Access-Control-Allow-Headers", "Content-Type");
    if (request.method === "OPTIONS") {
      response.sendStatus(204);
      return;
    }
    next();
  });
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

  app.post("/upload", upload.array("files"), (request: Request, response: Response) => {
    const files = request.files;
    if (!Array.isArray(files) || files.length === 0) {
      response.status(400).json({ error: "missing 'files' uploads" });
      return;
    }

    response.json({
      status: "uploaded",
      files: files.map((file) => ({
        name: file.originalname,
        size: file.size,
      })),
    });
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

function nextUploadName(directory: string, originalName: string): string {
  const parsed = path.parse(path.basename(originalName));
  const baseName = parsed.name || "upload";
  const extension = parsed.ext;

  let candidate = `${baseName}${extension}`;
  let suffix = 1;
  while (fs.existsSync(path.join(directory, candidate))) {
    candidate = `${baseName}-${suffix}${extension}`;
    suffix += 1;
  }

  return candidate;
}
