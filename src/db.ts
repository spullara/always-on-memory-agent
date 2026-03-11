import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

const DB_PATH = process.env.MEMORY_DB ?? "memory.db";

export type MemoryConnection = {
  linked_to: number;
  relationship: string;
};

export type ConsolidationConnection = {
  from_id?: number;
  to_id?: number;
  relationship?: string;
};

export type MemoryRecord = {
  id: number;
  source: string;
  summary: string;
  entities: string[];
  topics: string[];
  importance: number;
  connections: MemoryConnection[];
  created_at: string;
  consolidated: boolean;
};

export type UnconsolidatedMemoryRecord = {
  id: number;
  summary: string;
  entities: string[];
  topics: string[];
  importance: number;
  created_at: string;
};

let db: Database.Database | null = null;

function nowIso(): string {
  return new Date().toISOString();
}

function getDatabasePath(): string {
  return path.resolve(DB_PATH);
}

function parseJsonArray<T>(value: string): T[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export function getDb(): Database.Database {
  if (db) {
    return db;
  }

  db = new Database(getDatabasePath());
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL DEFAULT '',
      raw_text TEXT NOT NULL,
      summary TEXT NOT NULL,
      entities TEXT NOT NULL DEFAULT '[]',
      topics TEXT NOT NULL DEFAULT '[]',
      connections TEXT NOT NULL DEFAULT '[]',
      importance REAL NOT NULL DEFAULT 0.5,
      created_at TEXT NOT NULL,
      consolidated INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS consolidations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_ids TEXT NOT NULL,
      summary TEXT NOT NULL,
      insight TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS processed_files (
      path TEXT PRIMARY KEY,
      processed_at TEXT NOT NULL
    );
  `);

  return db;
}

export function storeMemory(
  raw_text: string,
  summary: string,
  entities: string[],
  topics: string[],
  importance: number,
  source = "",
): { memory_id: number; status: string; summary: string } {
  const database = getDb();
  const stmt = database.prepare(`
    INSERT INTO memories (source, raw_text, summary, entities, topics, importance, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    source,
    raw_text,
    summary,
    JSON.stringify(entities),
    JSON.stringify(topics),
    importance,
    nowIso(),
  );
  const memoryId = Number(result.lastInsertRowid);

  console.log(`📥 Stored memory #${memoryId}: ${summary.slice(0, 60)}...`);

  return { memory_id: memoryId, status: "stored", summary };
}

export function readAllMemories(): { memories: MemoryRecord[]; count: number } {
  const database = getDb();
  const rows = database
    .prepare("SELECT * FROM memories ORDER BY created_at DESC LIMIT 50")
    .all() as Array<Record<string, unknown>>;

  const memories = rows.map((row) => ({
    id: Number(row.id),
    source: String(row.source),
    summary: String(row.summary),
    entities: parseJsonArray<string>(String(row.entities)),
    topics: parseJsonArray<string>(String(row.topics)),
    importance: Number(row.importance),
    connections: parseJsonArray<MemoryConnection>(String(row.connections)),
    created_at: String(row.created_at),
    consolidated: Boolean(row.consolidated),
  }));

  return { memories, count: memories.length };
}

export function readUnconsolidatedMemories(): {
  memories: UnconsolidatedMemoryRecord[];
  count: number;
} {
  const database = getDb();
  const rows = database
    .prepare("SELECT * FROM memories WHERE consolidated = 0 ORDER BY created_at DESC LIMIT 10")
    .all() as Array<Record<string, unknown>>;

  const memories = rows.map((row) => ({
    id: Number(row.id),
    summary: String(row.summary),
    entities: parseJsonArray<string>(String(row.entities)),
    topics: parseJsonArray<string>(String(row.topics)),
    importance: Number(row.importance),
    created_at: String(row.created_at),
  }));

  return { memories, count: memories.length };
}

export function storeConsolidation(
  source_ids: number[],
  summary: string,
  insight: string,
  connections: ConsolidationConnection[],
): { status: string; memories_processed: number; insight: string } {
  const database = getDb();

  database
    .prepare(
      "INSERT INTO consolidations (source_ids, summary, insight, created_at) VALUES (?, ?, ?, ?)",
    )
    .run(JSON.stringify(source_ids), summary, insight, nowIso());

  const selectConnections = database.prepare("SELECT connections FROM memories WHERE id = ?");
  const updateConnections = database.prepare("UPDATE memories SET connections = ? WHERE id = ?");

  for (const connection of connections) {
    const fromId = connection.from_id;
    const toId = connection.to_id;
    const relationship = connection.relationship ?? "";

    if (!fromId || !toId) {
      continue;
    }

    for (const memoryId of [fromId, toId]) {
      const row = selectConnections.get(memoryId) as { connections: string } | undefined;
      if (!row) {
        continue;
      }

      const existing = parseJsonArray<MemoryConnection>(row.connections);
      existing.push({
        linked_to: memoryId === fromId ? toId : fromId,
        relationship,
      });
      updateConnections.run(JSON.stringify(existing), memoryId);
    }
  }

  if (source_ids.length > 0) {
    const placeholders = source_ids.map(() => "?").join(",");
    database
      .prepare(`UPDATE memories SET consolidated = 1 WHERE id IN (${placeholders})`)
      .run(...source_ids);
  }

  console.log(`🔄 Consolidated ${source_ids.length} memories. Insight: ${insight.slice(0, 80)}...`);

  return {
    status: "consolidated",
    memories_processed: source_ids.length,
    insight,
  };
}

export function readConsolidationHistory(): {
  consolidations: Array<{ summary: string; insight: string; source_ids: string }>;
  count: number;
} {
  const database = getDb();
  const rows = database
    .prepare("SELECT * FROM consolidations ORDER BY created_at DESC LIMIT 10")
    .all() as Array<Record<string, unknown>>;

  const consolidations = rows.map((row) => ({
    summary: String(row.summary),
    insight: String(row.insight),
    source_ids: String(row.source_ids),
  }));

  return { consolidations, count: consolidations.length };
}

export function getMemoryStats(): {
  total_memories: number;
  unconsolidated: number;
  consolidations: number;
} {
  const database = getDb();
  const total = database.prepare("SELECT COUNT(*) AS c FROM memories").get() as { c: number };
  const unconsolidated = database
    .prepare("SELECT COUNT(*) AS c FROM memories WHERE consolidated = 0")
    .get() as { c: number };
  const consolidations = database.prepare("SELECT COUNT(*) AS c FROM consolidations").get() as {
    c: number;
  };

  return {
    total_memories: total.c,
    unconsolidated: unconsolidated.c,
    consolidations: consolidations.c,
  };
}

export function deleteMemory(memory_id: number): { status: string; memory_id: number } {
  const database = getDb();
  const row = database.prepare("SELECT 1 FROM memories WHERE id = ?").get(memory_id);

  if (!row) {
    return { status: "not_found", memory_id };
  }

  database.prepare("DELETE FROM memories WHERE id = ?").run(memory_id);
  console.log(`🗑️  Deleted memory #${memory_id}`);

  return { status: "deleted", memory_id };
}

export function clearAllMemories(
  inbox_path?: string,
): { status: string; memories_deleted: number; files_deleted: number } {
  const database = getDb();
  const row = database.prepare("SELECT COUNT(*) AS c FROM memories").get() as { c: number };

  database.prepare("DELETE FROM memories").run();
  database.prepare("DELETE FROM consolidations").run();
  database.prepare("DELETE FROM processed_files").run();

  let filesDeleted = 0;
  if (inbox_path) {
    const inboxPath = path.resolve(inbox_path);
    if (fs.existsSync(inboxPath) && fs.statSync(inboxPath).isDirectory()) {
      for (const entry of fs.readdirSync(inboxPath, { withFileTypes: true })) {
        if (entry.name.startsWith(".")) {
          continue;
        }

        const entryPath = path.join(inboxPath, entry.name);
        try {
          if (entry.isFile()) {
            fs.unlinkSync(entryPath);
          } else {
            fs.rmSync(entryPath, { recursive: true, force: true });
          }
          filesDeleted += 1;
        } catch (error) {
          console.error(`Failed to delete ${entry.name}:`, error);
        }
      }
    }
  }

  console.log(`🗑️  Cleared all ${row.c} memories, deleted ${filesDeleted} inbox files`);

  return {
    status: "cleared",
    memories_deleted: row.c,
    files_deleted: filesDeleted,
  };
}
