import { getDb } from "./db.js";
import { MemoryAgent } from "./memory-agent.js";

export function startConsolidationLoop(agent: MemoryAgent, intervalMinutes = 30): NodeJS.Timeout {
  console.log(`🔄 Consolidation: every ${intervalMinutes} minutes`);

  return setInterval(async () => {
    try {
      const database = getDb();
      const row = database
        .prepare("SELECT COUNT(*) AS c FROM memories WHERE consolidated = 0")
        .get() as { c: number };

      if (row.c >= 2) {
        console.log(`🔄 Running consolidation (${row.c} unconsolidated memories)...`);
        const result = await agent.consolidate();
        console.log(`🔄 ${result.slice(0, 100)}`);
      } else {
        console.log(`🔄 Skipping consolidation (${row.c} unconsolidated memories)`);
      }
    } catch (error) {
      console.error("Consolidation error:", error);
    }
  }, intervalMinutes * 60 * 1000);
}
