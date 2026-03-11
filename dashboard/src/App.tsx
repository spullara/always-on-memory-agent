import { useEffect, useMemo, useState, type ReactNode } from "react";

type TabKey = "ingest" | "query" | "memories";

type Stats = {
  total_memories: number;
  unconsolidated: number;
  consolidations: number;
};

type MemoryConnection = {
  linked_to: number;
  relationship: string;
};

type Memory = {
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

type MemoriesResponse = {
  memories: Memory[];
  count: number;
};

const SAMPLE_TEXTS = [
  {
    title: "AI Agents in Production",
    text:
      "Anthropic released a report showing that 62% of Claude usage is now " +
      "code-related, with AI agents being the fastest growing category. " +
      "Companies are deploying agents for customer support, code review, " +
      "and data analysis. The key challenge remains reliability: agents " +
      "fail silently and need human oversight loops.",
  },
  {
    title: "Meeting Notes: Q1 Planning",
    text:
      "Discussed Q1 priorities: 1) Ship the new API by March 15, " +
      "2) Hire two backend engineers, 3) Reduce inference costs by 40% " +
      "by switching to smaller models for routing tasks. Sarah will lead " +
      "the API project. Budget approved for $50k in cloud compute.",
  },
  {
    title: "Research: Memory in LLM Systems",
    text:
      "Current approaches to LLM memory: 1) Vector databases with RAG: " +
      "good for retrieval but no active processing. 2) Conversation " +
      "summarization: loses detail over time. 3) Knowledge graphs: " +
      "expensive to maintain. The gap: no system actively consolidates " +
      "and connects information like human memory does.",
  },
  {
    title: "Product Idea: Smart Inbox",
    text:
      "What if email had an AI layer that continuously reads, categorizes, " +
      "and summarizes incoming mail? Not just filtering: actually understanding " +
      "context across conversations. Competitors: Superhuman (fast UI, no AI " +
      "summary), Shortwave (some AI, limited memory).",
  },
] as const;

const SAMPLE_QUESTIONS = [
  "What are the main themes across everything you remember?",
  "What connections do you see between different memories?",
  "What should I focus on based on what you know?",
  "Summarize everything in 3 bullet points.",
] as const;

const tabs: Array<{ key: TabKey; label: string }> = [
  { key: "ingest", label: "Ingest" },
  { key: "query", label: "Query" },
  { key: "memories", label: "Memory Bank" },
];

const geminiLogoUrl = new URL("../../docs/Gemini_logo.png", import.meta.url).href;
const adkLogoUrl = new URL("../../docs/adk_logo.png", import.meta.url).href;

async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(`/api${path}`);
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return (await response.json()) as T;
}

async function apiPost<T>(path: string, payload: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return (await response.json()) as T;
}

async function readError(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { error?: string };
    return data.error ?? `Request failed (${response.status})`;
  } catch {
    return `Request failed (${response.status})`;
  }
}

function formatTimeStamp(value: string): string {
  if (!value) {
    return "";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString();
}

function importanceTone(importance: number): string {
  if (importance >= 0.7) {
    return "high";
  }
  if (importance >= 0.4) {
    return "medium";
  }
  return "low";
}

function App() {
  const [activeTab, setActiveTab] = useState<TabKey>("ingest");
  const [stats, setStats] = useState<Stats | null>(null);
  const [agentOnline, setAgentOnline] = useState(false);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [inputText, setInputText] = useState("");
  const [question, setQuestion] = useState("");
  const [queryAnswer, setQueryAnswer] = useState("");
  const [queryTiming, setQueryTiming] = useState<number | null>(null);
  const [ingestResult, setIngestResult] = useState("");
  const [ingestTiming, setIngestTiming] = useState<number | null>(null);
  const [consolidateResult, setConsolidateResult] = useState("");
  const [consolidateTiming, setConsolidateTiming] = useState<number | null>(null);
  const [globalError, setGlobalError] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const memoryCountLabel = useMemo(() => {
    return memories.length === 1 ? "1 memory" : `${memories.length} memories`;
  }, [memories.length]);

  useEffect(() => {
    void refreshStatus();
    void refreshMemories();

    const timer = window.setInterval(() => {
      void refreshStatus();
    }, 15000);

    return () => window.clearInterval(timer);
  }, []);

  async function refreshStatus() {
    try {
      const nextStats = await apiGet<Stats>("/status");
      setStats(nextStats);
      setAgentOnline(true);
      setGlobalError("");
    } catch (error) {
      setAgentOnline(false);
      setStats(null);
      setGlobalError(error instanceof Error ? error.message : "Unable to reach the agent.");
    }
  }

  async function refreshMemories() {
    try {
      const data = await apiGet<MemoriesResponse>("/memories");
      setMemories(data.memories);
    } catch (error) {
      setGlobalError(error instanceof Error ? error.message : "Unable to load memories.");
    }
  }

  async function handleIngest(text: string, source: string) {
    if (!text.trim()) {
      setGlobalError("Paste some text before ingesting.");
      return;
    }

    setBusyAction(`ingest:${source}`);
    setGlobalError("");
    const startedAt = performance.now();

    try {
      const result = await apiPost<{ status: string; response: string }>("/ingest", {
        text,
        source,
      });
      setIngestResult(result.response);
      setIngestTiming((performance.now() - startedAt) / 1000);
      if (source === "dashboard") {
        setInputText("");
      }
      await Promise.all([refreshStatus(), refreshMemories()]);
      setActiveTab("ingest");
    } catch (error) {
      setGlobalError(error instanceof Error ? error.message : "Ingest failed.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleConsolidate() {
    setBusyAction("consolidate");
    setGlobalError("");
    const startedAt = performance.now();

    try {
      const result = await apiPost<{ status: string; response: string }>("/consolidate", {});
      setConsolidateResult(result.response);
      setConsolidateTiming((performance.now() - startedAt) / 1000);
      await Promise.all([refreshStatus(), refreshMemories()]);
    } catch (error) {
      setGlobalError(error instanceof Error ? error.message : "Consolidation failed.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleQuery(nextQuestion: string) {
    const trimmed = nextQuestion.trim();
    if (!trimmed) {
      setGlobalError("Enter a question first.");
      return;
    }

    setBusyAction("query");
    setGlobalError("");
    const startedAt = performance.now();

    try {
      const result = await apiGet<{ question: string; answer: string }>(
        `/query?q=${encodeURIComponent(trimmed)}`,
      );
      setQuestion(result.question);
      setQueryAnswer(result.answer);
      setQueryTiming((performance.now() - startedAt) / 1000);
      setActiveTab("query");
    } catch (error) {
      setGlobalError(error instanceof Error ? error.message : "Query failed.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleDelete(memoryId: number) {
    setBusyAction(`delete:${memoryId}`);
    setGlobalError("");

    try {
      await apiPost("/delete", { memory_id: memoryId });
      await Promise.all([refreshStatus(), refreshMemories()]);
    } catch (error) {
      setGlobalError(error instanceof Error ? error.message : "Delete failed.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleClearAll() {
    const confirmed = window.confirm(
      "Delete all memories, consolidations, processed file history, and inbox files?",
    );
    if (!confirmed) {
      return;
    }

    setBusyAction("clear");
    setGlobalError("");

    try {
      await apiPost("/clear", {});
      setQueryAnswer("");
      setIngestResult("");
      setConsolidateResult("");
      await Promise.all([refreshStatus(), refreshMemories()]);
    } catch (error) {
      setGlobalError(error instanceof Error ? error.message : "Clear-all failed.");
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-section">
          <p className="section-kicker">Agent Status</p>
          <div className="status-card">
            <div className={`status-dot ${agentOnline ? "online" : "offline"}`} />
            <div>
              <strong>{agentOnline ? "Agent Online" : "Agent Offline"}</strong>
              <p>{agentOnline ? "Connected to localhost:8888" : "Start the API server first."}</p>
            </div>
          </div>
        </div>

        <div className="sidebar-section">
          <p className="section-kicker">Memory Stats</p>
          <div className="stats-grid">
            <StatCard label="Memories" value={stats?.total_memories ?? 0} />
            <StatCard label="Pending" value={stats?.unconsolidated ?? 0} accent="blue" />
            <StatCard label="Consolidations" value={stats?.consolidations ?? 0} />
          </div>
        </div>

        <div className="sidebar-section">
          <p className="section-kicker">Powered By</p>
          <div className="logo-row">
            <img src={geminiLogoUrl} alt="Gemini logo" className="logo-tile" />
            <img src={adkLogoUrl} alt="ADK logo" className="logo-tile logo-adk" />
          </div>
          <p className="endpoint-label">Endpoint: <code>http://localhost:8888</code></p>
        </div>
      </aside>

      <main className="main-panel">
        <header className="hero">
          <div className="hero-brain">🧠</div>
          <div>
            <h1>Always On Agent Memory Layer</h1>
            <p>
              Always-on memory agent that processes, consolidates, and connects information.
              Built with Google ADK and Gemini 3.1 Flash-Lite.
            </p>
          </div>
        </header>

        <nav className="tab-row" aria-label="Dashboard tabs">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={`tab-button ${activeTab === tab.key ? "active" : ""}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        {globalError ? <div className="banner error">{globalError}</div> : null}

        {activeTab === "ingest" ? (
          <section className="panel-stack">
            <Panel
              title="Feed information into memory"
              subtitle="Paste text or use one of the original samples to trigger the IngestAgent."
            >
              <textarea
                className="text-input large"
                placeholder="Paste text here..."
                value={inputText}
                onChange={(event) => setInputText(event.target.value)}
              />
              <div className="action-row">
                <button
                  type="button"
                  className="primary-button"
                  disabled={busyAction !== null}
                  onClick={() => void handleIngest(inputText, "dashboard")}
                >
                  {busyAction === "ingest:dashboard" ? "Processing..." : "Process into Memory"}
                </button>
              </div>
              {ingestTiming !== null || ingestResult ? (
                <ResultCard
                  tone="blue"
                  timing={ingestTiming}
                  content={ingestResult}
                  emptyText="The agent returned no response."
                />
              ) : null}
            </Panel>

            <Panel title="Sample Texts" subtitle="Use the same seed content from the original Streamlit dashboard.">
              <div className="sample-grid">
                {SAMPLE_TEXTS.map((sample) => (
                  <button
                    key={sample.title}
                    type="button"
                    className="sample-button"
                    disabled={busyAction !== null}
                    onClick={() => void handleIngest(sample.text, sample.title)}
                  >
                    <span>{sample.title}</span>
                    <small>{sample.text.slice(0, 88)}...</small>
                  </button>
                ))}
              </div>
            </Panel>

            <Panel title="Upload Files" subtitle="Pending backend support for `/upload`. For now, drop files into `./inbox` to use the watcher.">
              <div className="upload-placeholder">
                <p>The existing TypeScript API does not expose `/upload` yet.</p>
                <p>Supported today: text, images, audio, video, and PDFs via the watched inbox folder.</p>
              </div>
            </Panel>

            <Panel title="Consolidate Memories" subtitle="Trigger the ConsolidateAgent manually.">
              <div className="action-row">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busyAction !== null}
                  onClick={() => void handleConsolidate()}
                >
                  {busyAction === "consolidate" ? "Running..." : "Run Consolidation"}
                </button>
              </div>
              {consolidateTiming !== null || consolidateResult ? (
                <ResultCard
                  tone="purple"
                  timing={consolidateTiming}
                  content={consolidateResult}
                  emptyText="The agent returned no response."
                />
              ) : null}
            </Panel>
          </section>
        ) : null}

        {activeTab === "query" ? (
          <section className="panel-stack">
            <Panel
              title="Ask your memory anything"
              subtitle="The QueryAgent searches memories and synthesizes answers with citations."
            >
              <div className="query-row">
                <input
                  className="text-input"
                  placeholder="What do you know about AI agents?"
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                />
                <button
                  type="button"
                  className="primary-button"
                  disabled={busyAction !== null}
                  onClick={() => void handleQuery(question)}
                >
                  {busyAction === "query" ? "Searching..." : "Ask"}
                </button>
              </div>
              <div className="sample-grid compact">
                {SAMPLE_QUESTIONS.map((sampleQuestion) => (
                  <button
                    key={sampleQuestion}
                    type="button"
                    className="sample-button compact"
                    disabled={busyAction !== null}
                    onClick={() => void handleQuery(sampleQuestion)}
                  >
                    {sampleQuestion}
                  </button>
                ))}
              </div>
              {queryTiming !== null || queryAnswer ? (
                <ResultCard
                  tone="purple"
                  timing={queryTiming}
                  content={queryAnswer}
                  emptyText="No answer yet."
                />
              ) : null}
            </Panel>
          </section>
        ) : null}

        {activeTab === "memories" ? (
          <section className="panel-stack">
            <Panel title="Stored Memories" subtitle={`${memoryCountLabel} loaded from the API.`}>
              {memories.length > 0 ? (
                <div className="memory-list">
                  {memories.map((memory) => (
                    <article
                      key={memory.id}
                      className={`memory-card ${importanceTone(memory.importance)}`}
                    >
                      <div className="memory-header">
                        <div>
                          <strong>Memory #{memory.id}</strong>
                          <p>
                            {formatTimeStamp(memory.created_at)}
                            {memory.source ? ` | ${memory.source}` : ""}
                          </p>
                        </div>
                        <button
                          type="button"
                          className="icon-button"
                          disabled={busyAction !== null}
                          onClick={() => void handleDelete(memory.id)}
                          aria-label={`Delete memory ${memory.id}`}
                        >
                          {busyAction === `delete:${memory.id}` ? "..." : "Delete"}
                        </button>
                      </div>

                      <p className="memory-summary">{memory.summary}</p>

                      <div className="tag-row">
                        {memory.topics.map((topic) => (
                          <span key={`${memory.id}:topic:${topic}`} className="tag topic">
                            {topic}
                          </span>
                        ))}
                        {memory.entities.map((entity) => (
                          <span key={`${memory.id}:entity:${entity}`} className="tag entity">
                            {entity}
                          </span>
                        ))}
                      </div>

                      <div className="memory-footer">
                        <span>Importance: {memory.importance.toFixed(2)}</span>
                        <span>{memory.connections.length} connections</span>
                        <span>{memory.consolidated ? "Consolidated" : "Pending"}</span>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  No memories yet. Ingest some information or drop files in <code>./inbox</code>.
                </div>
              )}
            </Panel>

            <Panel title="Danger Zone" subtitle="This clears memories, consolidations, processed file history, and inbox files.">
              <button
                type="button"
                className="danger-button"
                disabled={busyAction !== null}
                onClick={() => void handleClearAll()}
              >
                {busyAction === "clear" ? "Clearing..." : "Clear All"}
              </button>
            </Panel>
          </section>
        ) : null}
      </main>
    </div>
  );
}

function Panel(props: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <section className="panel">
      <div className="panel-header">
        <h2>{props.title}</h2>
        <p>{props.subtitle}</p>
      </div>
      {props.children}
    </section>
  );
}

function StatCard(props: { label: string; value: number; accent?: "purple" | "blue" }) {
  return (
    <div className={`stat-card ${props.accent === "blue" ? "blue" : ""}`}>
      <strong>{props.value}</strong>
      <span>{props.label}</span>
    </div>
  );
}

function ResultCard(props: {
  tone: "purple" | "blue";
  timing: number | null;
  content: string;
  emptyText: string;
}) {
  return (
    <div className={`result-card ${props.tone}`}>
      {props.timing !== null ? <span className="result-timing">{props.timing.toFixed(1)}s</span> : null}
      <div>{props.content || props.emptyText}</div>
    </div>
  );
}

export default App;
