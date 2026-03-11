import fs from "node:fs/promises";
import path from "node:path";

import { InMemorySessionService, Runner, isFinalResponse } from "@google/adk";
import {
  createPartFromBase64,
  createPartFromText,
  createUserContent,
  type Content,
} from "@google/genai";
import mime from "mime-types";

import { buildAgents } from "./agents.js";

const APP_NAME = "memory_layer";
const USER_ID = "agent";

const MEDIA_EXTENSIONS: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".avi": "video/x-msvideo",
  ".mkv": "video/x-matroska",
  ".pdf": "application/pdf",
};

function createTextContent(text: string): Content {
  return createUserContent(createPartFromText(text));
}

function createMultimodalContent(text: string, fileBytes: Buffer, mimeType: string): Content {
  return createUserContent([
    createPartFromText(text),
    createPartFromBase64(fileBytes.toString("base64"), mimeType),
  ]);
}

export class MemoryAgent {
  readonly agent = buildAgents();

  readonly sessionService = new InMemorySessionService();

  readonly runner = new Runner({
    agent: this.agent,
    appName: APP_NAME,
    sessionService: this.sessionService,
  });

  async run(message: string): Promise<string> {
    const session = await this.sessionService.createSession({
      appName: APP_NAME,
      userId: USER_ID,
    });
    return this.execute(session.id, createTextContent(message));
  }

  async runMultimodal(text: string, fileBytes: Buffer, mimeType: string): Promise<string> {
    const session = await this.sessionService.createSession({
      appName: APP_NAME,
      userId: USER_ID,
    });
    return this.execute(session.id, createMultimodalContent(text, fileBytes, mimeType));
  }

  async ingest(text: string, source = ""): Promise<string> {
    const message = source
      ? `Remember this information (source: ${source}):\n\n${text}`
      : `Remember this information:\n\n${text}`;
    return this.run(message);
  }

  async ingestFile(filePath: string): Promise<string> {
    const suffix = path.extname(filePath).toLowerCase();
    const mimeType = MEDIA_EXTENSIONS[suffix] ?? mime.lookup(filePath) ?? "application/octet-stream";
    const fileBytes = await fs.readFile(filePath);
    const sizeMb = fileBytes.length / (1024 * 1024);

    if (sizeMb > 20) {
      console.warn(`⚠️  Skipping ${path.basename(filePath)} (${sizeMb.toFixed(1)}MB) — exceeds 20MB limit`);
      return `Skipped: file too large (${sizeMb.toFixed(1)}MB)`;
    }

    const mediaKind = String(mimeType).split("/")[0] ?? "file";
    const prompt = [
      `Remember this file (source: ${path.basename(filePath)}, type: ${mimeType}).`,
      "",
      `Thoroughly analyze the content of this ${mediaKind} file and extract all meaningful information for memory storage.`,
    ].join("\n");

    console.log(`🔮 Ingesting ${mediaKind}: ${path.basename(filePath)} (${sizeMb.toFixed(1)}MB)`);
    return this.runMultimodal(prompt, fileBytes, String(mimeType));
  }

  async consolidate(): Promise<string> {
    return this.run("Consolidate unconsolidated memories. Find connections and patterns.");
  }

  async query(question: string): Promise<string> {
    return this.run(`Based on my memories, answer: ${question}`);
  }

  async status(): Promise<string> {
    return this.run("Give me a status report on my memory system.");
  }

  private async execute(sessionId: string, content: Content): Promise<string> {
    let response = "";
    const events = this.runner.runAsync({
      userId: USER_ID,
      sessionId,
      newMessage: content,
    });

    for await (const event of events) {
      if (!isFinalResponse(event)) {
        continue;
      }

      if (event.content?.parts?.length) {
        response += event.content.parts.map((part) => part.text ?? "").join("");
      }
    }

    return response;
  }
}
