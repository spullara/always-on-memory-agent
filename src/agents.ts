import { FunctionTool, LlmAgent } from "@google/adk";
import { z } from "zod";

import {
  clearAllMemories,
  deleteMemory,
  getMemoryStats,
  readAllMemories,
  readConsolidationHistory,
  readUnconsolidatedMemories,
  storeConsolidation,
  storeMemory,
} from "./db.js";

const MODEL = process.env.MODEL ?? "gemini-3.1-flash-lite-preview";

export function buildAgents(): LlmAgent {
  const storeMemoryTool = new FunctionTool({
    name: "store_memory",
    description: "Store a processed memory in the database.",
    parameters: z.object({
      raw_text: z.string().describe("The original input text."),
      summary: z.string().describe("A concise 1-2 sentence summary."),
      entities: z
        .array(z.string())
        .describe("Key people, companies, products, concepts, objects, or locations."),
      topics: z.array(z.string()).describe("2-4 topic tags."),
      importance: z.number().describe("Float 0.0 to 1.0 indicating importance."),
      source: z.string().optional().describe("Where this memory came from."),
    }),
    execute: ({ raw_text, summary, entities, topics, importance, source }) =>
      storeMemory(raw_text, summary, entities, topics, importance, source ?? ""),
  });

  const readUnconsolidatedMemoriesTool = new FunctionTool({
    name: "read_unconsolidated_memories",
    description: "Read memories that have not been consolidated yet.",
    parameters: z.object({}),
    execute: () => readUnconsolidatedMemories(),
  });

  const storeConsolidationTool = new FunctionTool({
    name: "store_consolidation",
    description: "Store a consolidation result and mark source memories as consolidated.",
    parameters: z.object({
      source_ids: z.array(z.number()).describe("Memory IDs that were consolidated."),
      summary: z.string().describe("A synthesized summary across all source memories."),
      insight: z.string().describe("One key pattern or insight discovered."),
      connections: z
        .array(
          z.object({
            from_id: z.number().optional(),
            to_id: z.number().optional(),
            relationship: z.string().optional(),
          }),
        )
        .describe("Connections using from_id, to_id, and relationship keys."),
    }),
    execute: ({ source_ids, summary, insight, connections }) =>
      storeConsolidation(source_ids, summary, insight, connections),
  });

  const readAllMemoriesTool = new FunctionTool({
    name: "read_all_memories",
    description: "Read all stored memories from the database, most recent first.",
    parameters: z.object({}),
    execute: () => readAllMemories(),
  });

  const readConsolidationHistoryTool = new FunctionTool({
    name: "read_consolidation_history",
    description: "Read past consolidation insights.",
    parameters: z.object({}),
    execute: () => readConsolidationHistory(),
  });

  const getMemoryStatsTool = new FunctionTool({
    name: "get_memory_stats",
    description: "Get current memory statistics.",
    parameters: z.object({}),
    execute: () => getMemoryStats(),
  });

  const ingestAgent = new LlmAgent({
    name: "ingest_agent",
    model: MODEL,
    description:
      "Processes raw text or media into structured memory. Call this when new information arrives.",
    instruction: [
      "You are a Memory Ingest Agent. You handle ALL types of input — text, images,",
      "audio, video, and PDFs. For any input you receive:",
      "1. Thoroughly describe what the content contains",
      "2. Create a concise 1-2 sentence summary",
      "3. Extract key entities (people, companies, products, concepts, objects, locations)",
      "4. Assign 2-4 topic tags",
      "5. Rate importance from 0.0 to 1.0",
      "6. Call store_memory with all extracted information",
      "",
      "For images: describe the scene, objects, text, people, and any visual details.",
      "For audio/video: describe the spoken content, sounds, scenes, and key moments.",
      "For PDFs: extract and summarize the document content.",
      "",
      "Use the full description as raw_text in store_memory so the context is preserved.",
      "Always call store_memory. Be concise and accurate.",
      "After storing, confirm what was stored in one sentence.",
    ].join("\n"),
    tools: [storeMemoryTool],
  });

  const consolidateAgent = new LlmAgent({
    name: "consolidate_agent",
    model: MODEL,
    description: "Merges related memories and finds patterns. Call this periodically.",
    instruction: [
      "You are a Memory Consolidation Agent. You:",
      "1. Call read_unconsolidated_memories to see what needs processing",
      "2. If fewer than 2 memories, say nothing to consolidate",
      "3. Find connections and patterns across the memories",
      "4. Create a synthesized summary and one key insight",
      "5. Call store_consolidation with source_ids, summary, insight, and connections",
      "",
      "Connections: list of dicts with 'from_id', 'to_id', 'relationship' keys.",
      "Think deeply about cross-cutting patterns.",
    ].join("\n"),
    tools: [readUnconsolidatedMemoriesTool, storeConsolidationTool],
  });

  const queryAgent = new LlmAgent({
    name: "query_agent",
    model: MODEL,
    description: "Answers questions using stored memories.",
    instruction: [
      "You are a Memory Query Agent. When asked a question:",
      "1. Call read_all_memories to access the memory store",
      "2. Call read_consolidation_history for higher-level insights",
      "3. Synthesize an answer based ONLY on stored memories",
      "4. Reference memory IDs: [Memory 1], [Memory 2], etc.",
      "5. If no relevant memories exist, say so honestly",
      "",
      "Be thorough but concise. Always cite sources.",
    ].join("\n"),
    tools: [readAllMemoriesTool, readConsolidationHistoryTool],
  });

  return new LlmAgent({
    name: "memory_orchestrator",
    model: MODEL,
    description: "Routes memory operations to specialist agents.",
    instruction: [
      "You are the Memory Orchestrator for an always-on memory system.",
      "Route requests to the right sub-agent:",
      "- New information -> ingest_agent",
      "- Consolidation request -> consolidate_agent",
      "- Questions -> query_agent",
      "- Status check -> call get_memory_stats and report",
      "",
      "After the sub-agent completes, give a brief summary.",
    ].join("\n"),
    subAgents: [ingestAgent, consolidateAgent, queryAgent],
    tools: [getMemoryStatsTool],
  });
}

export {
  clearAllMemories,
  deleteMemory,
  getMemoryStats,
  readAllMemories,
  readConsolidationHistory,
  readUnconsolidatedMemories,
};
