import fs from "node:fs/promises";
import path from "node:path";

import chokidar, { type FSWatcher } from "chokidar";

import { getDb } from "./db.js";
import { MemoryAgent } from "./memory-agent.js";

const TEXT_EXTENSIONS = new Set([".txt", ".md", ".json", ".csv", ".log", ".xml", ".yaml", ".yml"]);
const MEDIA_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".svg",
  ".mp3",
  ".wav",
  ".ogg",
  ".flac",
  ".m4a",
  ".aac",
  ".mp4",
  ".webm",
  ".mov",
  ".avi",
  ".mkv",
  ".pdf",
]);
const ALL_SUPPORTED = new Set([...TEXT_EXTENSIONS, ...MEDIA_EXTENSIONS]);

export async function watchFolder(agent: MemoryAgent, folder: string): Promise<FSWatcher> {
  const resolvedFolder = path.resolve(folder);
  await fs.mkdir(resolvedFolder, { recursive: true });

  console.log(`👁️  Watching: ${resolvedFolder}/  (supports: text, images, audio, video, PDFs)`);

  const watcher = chokidar.watch(resolvedFolder, {
    ignoreInitial: false,
    depth: 0,
    awaitWriteFinish: {
      stabilityThreshold: 1000,
      pollInterval: 100,
    },
  });

  watcher.on("add", async (filePath) => {
    const fileName = path.basename(filePath);
    if (fileName.startsWith(".")) {
      return;
    }

    const suffix = path.extname(filePath).toLowerCase();
    if (!ALL_SUPPORTED.has(suffix)) {
      return;
    }

    const database = getDb();
    const row = database
      .prepare("SELECT 1 FROM processed_files WHERE path = ?")
      .get(filePath) as { 1: number } | undefined;
    if (row) {
      return;
    }

    try {
      if (TEXT_EXTENSIONS.has(suffix)) {
        console.log(`📄 New text file: ${fileName}`);
        const text = (await fs.readFile(filePath, "utf8")).slice(0, 10_000);
        if (text.trim()) {
          await agent.ingest(text, fileName);
        }
      } else {
        console.log(`🖼️  New media file: ${fileName}`);
        await agent.ingestFile(filePath);
      }
    } catch (error) {
      console.error(`Error ingesting ${fileName}:`, error);
    }

    database
      .prepare("INSERT INTO processed_files (path, processed_at) VALUES (?, ?)")
      .run(filePath, new Date().toISOString());
  });

  watcher.on("error", (error) => {
    console.error("Watch error:", error);
  });

  return watcher;
}
