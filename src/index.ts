import { Command } from "commander";
import type { FSWatcher } from "chokidar";

import { buildHttp } from "./server.js";
import { startConsolidationLoop } from "./consolidation.js";
import { MemoryAgent } from "./memory-agent.js";
import { watchFolder } from "./watcher.js";

type RuntimeHandles = {
  consolidationTimer: NodeJS.Timeout;
  server: ReturnType<ReturnType<typeof buildHttp>["listen"]>;
  watcher: FSWatcher;
};

async function main(): Promise<void> {
  const program = new Command();

  program
    .description("Agent Memory Layer - Always-On ADK Agent")
    .option("--watch <dir>", "Folder to watch for new files (default: ./inbox)", "./inbox")
    .option("--port <number>", "HTTP API port (default: 8888)", "8888")
    .option(
      "--consolidate-every <minutes>",
      "Consolidation interval in minutes (default: 30)",
      "30",
    )
    .parse(process.argv);

  const options = program.opts<{
    watch: string;
    port: string;
    consolidateEvery: string;
  }>();

  const port = Number(options.port);
  const consolidateEvery = Number(options.consolidateEvery);
  const agent = new MemoryAgent();

  console.log("🧠 Agent Memory Layer starting");
  console.log(`   Model: ${process.env.MODEL ?? "gemini-3.1-flash-lite-preview"}`);
  console.log(`   Database: ${process.env.MEMORY_DB ?? "memory.db"}`);
  console.log(`   Watch: ${options.watch}`);
  console.log(`   Consolidate: every ${consolidateEvery}m`);
  console.log(`   API: http://localhost:${port}`);
  console.log("");

  const watcher = await watchFolder(agent, options.watch);
  const consolidationTimer = startConsolidationLoop(agent, consolidateEvery);
  const app = buildHttp(agent, options.watch);
  const server = app.listen(port, "0.0.0.0", () => {
    console.log(`✅ Agent running. Drop files in ${options.watch}/ or POST to http://localhost:${port}/ingest`);
    console.log("   Supported: text, images, audio, video, PDFs");
    console.log("");
  });

  const handles: RuntimeHandles = { consolidationTimer, server, watcher };

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    console.log(`\n👋 Shutting down (signal ${signal})...`);
    clearInterval(handles.consolidationTimer);
    await handles.watcher.close();
    await new Promise<void>((resolve, reject) => {
      handles.server.close((error?: Error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    console.log("🧠 Agent stopped.");
    process.exit(0);
  };

  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
