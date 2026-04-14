# Part III: Making Agents Evolve

## Chapter 7: Memory Systems That Actually Work

### 7.1 The "Brain Made of Markdown" Pattern

The most effective production memory system in 2025–2026 is a directory of Markdown files. This is not a simplification for pedagogical purposes—it is what practitioners running Claude Code agents at scale converged on after trying vector databases, graph stores, and custom embedding pipelines. The pattern works because it optimizes for the three things that actually matter: transparency (you can `cat` the agent's memory), editability (you can fix the agent's memory with a text editor), and context-window efficiency (Markdown compresses well into tokens).

Here is the production-tested directory structure from the "AgentBrain" pattern, used by developers running persistent Claude Code agents across hundreds of sessions:

```
AgentBrain/
├── Index.md                    # Table of contents, read first every session
├── Identity/
│   ├── Who I Am.md             # Role definition, capabilities, boundaries
│   └── How I Think.md          # Reasoning preferences, decision heuristics
├── Memory/
│   ├── Conversation Log.md     # Rolling log of key interactions (pruned)
│   ├── Learnings.md            # Distilled insights from past sessions
│   └── Corrections.md          # Mistakes made + corrections applied
├── Skills/
│   ├── Code Review.md          # Procedure for reviewing PRs
│   ├── Debugging.md            # Step-by-step debugging protocol
│   └── Deploy.md               # Deployment checklist
├── Projects/
│   ├── ProjectAlpha/
│   │   ├── Architecture.md     # System design, key components
│   │   ├── Conventions.md      # Coding standards, naming rules
│   │   └── Open Issues.md      # Known problems, workarounds
│   └── ProjectBeta/
│       └── ...
├── People/
│   ├── Benji.md                # Communication style, preferences, role
│   └── Sara.md                 # Ditto
└── Journal/
    ├── 2026-03-10.md           # Daily session summaries
    ├── 2026-03-11.md
    └── ...
```

The startup hook lives in the project's `CLAUDE.md` file. This is the exact text that loads the brain on every session start:

```markdown
# CLAUDE.md

Every time you start a new conversation, read these files before responding:
1. Read AgentBrain/Index.md
2. Read AgentBrain/Memory/Learnings.md
3. Read AgentBrain/Memory/Corrections.md
4. Read AgentBrain/People/Benji.md

After reading, confirm what you remember by listing 3 key learnings.
Do NOT summarize the files — just confirm you've loaded them.
```

The `Index.md` file acts as a routing table. It tells the agent which files exist and when to read them, so the agent does not load the entire brain into context on every turn:

```markdown
# AgentBrain Index

## Always Read on Startup
- Memory/Learnings.md — accumulated insights (READ FIRST)
- Memory/Corrections.md — past mistakes to avoid

## Read When Working on Code
- Projects/{project}/Architecture.md
- Projects/{project}/Conventions.md
- Skills/Code Review.md (when reviewing PRs)
- Skills/Debugging.md (when investigating bugs)

## Read When Communicating
- People/{name}.md for the person you're talking to

## Update After Every Session
- Memory/Conversation Log.md — append 3-5 bullet summary
- Journal/{date}.md — create if doesn't exist
- Memory/Learnings.md — add new insights if any
- Memory/Corrections.md — add if you made a mistake
```

The critical insight from practitioners who refined this pattern over months: **start with less structure**. The first attempt typically has 20+ files organized into deep hierarchies. The agent burns 3,000–5,000 tokens just reading the brain on startup, and the context pollution degrades response quality measurably. The sweet spot is 5–8 files that the agent reads routinely, with another 10–15 that it reads on demand based on task context.

If you had to keep exactly one file, it would be `Corrections.md`. Here is what a production `Corrections.md` looks like:

```markdown
# Corrections

## 2026-03-12: Wrong test runner
- MISTAKE: Ran `pytest` directly. This project uses `make test` which sets
  up the Docker test database first.
- CORRECTION: Always check Makefile for test targets before running tests
  directly. The pattern is: `make test-unit` for fast tests,
  `make test-integration` for tests requiring Docker services.

## 2026-03-10: Assumed PostgreSQL column type
- MISTAKE: Created migration with `VARCHAR(255)` for email field. This
  project uses `citext` extension for case-insensitive email storage.
- CORRECTION: Check existing migrations for column type conventions before
  creating new migrations. Email fields use `citext`, not `VARCHAR`.

## 2026-03-08: Broke import ordering
- MISTAKE: Added import at the top of the file. This project uses isort
  with a custom profile that groups imports as: stdlib, third-party,
  first-party, local. My import went into the wrong group.
- CORRECTION: Run `make lint-fix` after any file edit to auto-fix import
  ordering. The isort config is in pyproject.toml under [tool.isort].

## 2026-03-05: Used wrong branch strategy
- MISTAKE: Committed directly to main. This repo requires feature branches
  with PR review.
- CORRECTION: Always create feature branch: `git checkout -b feat/description`.
  Push and create PR. Never commit to main directly.
```

The reason `Corrections.md` is the single most valuable file is error asymmetry: the cost of repeating a mistake is far higher than the cost of missing a potential optimization. An agent that never repeats its past mistakes converges on good behavior faster than an agent with a perfect knowledge base but no error memory.

**Token budget analysis for the Markdown brain pattern:**

| File | Typical Size | Tokens (GPT-4 tokenizer) | Load Frequency |
|---|---|---|---|
| Index.md | 0.5 KB | ~150 | Every session |
| Learnings.md | 2–4 KB | ~600–1,200 | Every session |
| Corrections.md | 1–3 KB | ~300–900 | Every session |
| People/{name}.md | 0.5–1 KB | ~150–300 | Per conversation |
| Project/Architecture.md | 2–5 KB | ~600–1,500 | Per task |
| Project/Conventions.md | 1–3 KB | ~300–900 | Per code task |
| **Startup total** | **4–8 KB** | **~1,200–2,400** | — |

With a 200K-token context window, the startup brain load consumes 0.6–1.2% of available context. This is the right order of magnitude. If your memory system consumes more than 5% of the context window on startup, you are loading too much.

**Write discipline is the hardest part.** The agent must update its memory files at the end of every session, but it must be selective. The update prompt in `CLAUDE.md` enforces this:

```markdown
## End of Session Protocol
Before ending this conversation:
1. If you learned something new → append to Memory/Learnings.md
2. If you made a mistake → append to Memory/Corrections.md
3. Append a 3-5 bullet summary to Memory/Conversation Log.md
4. If Conversation Log.md exceeds 50 entries, delete the oldest 20

Rules for writing to memory:
- Each entry must be actionable (not "learned about the codebase")
- Each entry must be specific (include file paths, command names, config keys)
- Each correction must include both the mistake AND the fix
- Never duplicate an existing entry — update it instead
```

The "delete the oldest 20" rule is a crude but effective forgetting mechanism. Without it, the conversation log grows without bound and eventually consumes too much context. More sophisticated approaches use LLM-based summarization to compress old entries, but the simple truncation works well enough for most use cases.

### 7.2 OpenHands V1: Event-Sourced Architecture

OpenHands (formerly OpenDevin) implements a fundamentally different memory model: every state change is an immutable typed event appended to a log, and the agent's current state is always derived—never stored directly. This is the event-sourcing pattern from distributed systems (Fowler, 2005), applied to agent execution.

The event type hierarchy is built on Pydantic dataclasses. Here is the actual inheritance tree as of the V1 architecture:

```
Event (base)
├── source: EventSource          # user | agent | environment
├── id: int                      # monotonically increasing
├── timestamp: datetime
├── cause: int | None            # id of the event that caused this one
│
├── Action (initiated by agent or user)
│   ├── MessageAction
│   │   └── content: str
│   │   └── image_urls: list[str]
│   │   └── wait_for_response: bool
│   │
│   ├── CmdRunAction
│   │   └── command: str
│   │   └── timeout: int
│   │   └── blocking: bool
│   │
│   ├── FileReadAction
│   │   └── path: str
│   │
│   ├── FileEditAction
│   │   └── path: str
│   │   └── old_str: str
│   │   └── new_str: str
│   │
│   ├── BrowseInteractiveAction
│   │   └── browser_actions: str
│   │   └── browsergym_send_msg_to_user: str
│   │
│   ├── AgentFinishAction
│   │   └── thought: str
│   │   └── outputs: dict
│   │
│   └── AgentDelegateAction
│       └── agent: str
│       └── inputs: dict
│
├── Observation (results of actions / environment changes)
│   ├── CmdOutputObservation
│   │   └── command: str
│   │   └── exit_code: int
│   │   └── content: str
│   │
│   ├── FileReadObservation
│   │   └── path: str
│   │   └── content: str
│   │
│   ├── FileEditObservation
│   │   └── path: str
│   │   └── content: str
│   │
│   ├── BrowserOutputObservation
│   │   └── url: str
│   │   └── screenshot: str
│   │   └── open_pages_urls: list[str]
│   │
│   ├── ErrorObservation
│   │   └── content: str
│   │
│   └── AgentDelegateObservation
│       └── outputs: dict
│       └── content: str
│
└── CondensationEvent             # compression markers
    └── condensed_event_ids: list[int]
    └── summary: str
```

Every event carries `source` metadata indicating who generated it: `EventSource.USER` for human-initiated actions, `EventSource.AGENT` for LLM-generated actions, and `EventSource.ENVIRONMENT` for system-generated observations. Actions generated by the LLM also carry tool metadata—`tool_call_id` ties the action back to the specific tool call in the LLM's response, enabling precise replay and debugging.

The append-only event log is the single source of truth. State is derived by reducing over the log:

```python
@dataclass
class State:
    history: list[tuple[Action, Observation]]
    iteration: int
    max_iterations: int
    token_usage: TokenUsage
    metrics: Metrics
    agent_state: AgentState  # RUNNING | AWAITING_USER | FINISHED | ERROR
    extra_data: dict

    @classmethod
    def from_events(cls, events: list[Event], config: AgentConfig) -> "State":
        state = cls(
            history=[],
            iteration=0,
            max_iterations=config.max_iterations,
            token_usage=TokenUsage(),
            metrics=Metrics(),
            agent_state=AgentState.RUNNING,
            extra_data={},
        )
        for event in events:
            state = state.apply(event)
        return state

    def apply(self, event: Event) -> "State":
        if isinstance(event, Action):
            self.iteration += 1
            if isinstance(event, AgentFinishAction):
                self.agent_state = AgentState.FINISHED
        if isinstance(event, CmdOutputObservation):
            if event.exit_code != 0:
                self.metrics.error_count += 1
        if isinstance(event, CondensationEvent):
            self._condense(event.condensed_event_ids, event.summary)
        return self
```

The `CondensationEvent` is the compression mechanism. When the event stream grows too long to fit in the context window, a condensation strategy generates a summary of a contiguous block of events and emits a `CondensationEvent` that replaces them:

```python
class RecentEventsCondensation:
    """Keep the last N events verbatim, summarize everything before."""

    def __init__(self, keep_last: int = 20, max_summary_tokens: int = 500):
        self.keep_last = keep_last
        self.max_summary_tokens = max_summary_tokens

    def condense(self, events: list[Event], llm: LLM) -> list[Event]:
        if len(events) <= self.keep_last:
            return events

        to_condense = events[:-self.keep_last]
        to_keep = events[-self.keep_last:]

        summary = llm.summarize(
            [e.to_prompt_str() for e in to_condense],
            max_tokens=self.max_summary_tokens,
            instruction="Summarize the key actions, results, and decisions. "
                        "Preserve file paths, command outputs, and error messages."
        )

        condensation = CondensationEvent(
            condensed_event_ids=[e.id for e in to_condense],
            summary=summary,
        )
        return [condensation] + to_keep
```

The condensation pipeline is parameterized by `max_budget_per_msg` — the token budget per event when building the LLM prompt. Production deployments tune this between 200 and 1,000 tokens per event depending on the model's context window size. With Claude's 200K context, a budget of 500 tokens per event allows approximately 400 events in the prompt. With GPT-4o's 128K context, the budget drops to ~300 tokens per event for the same event count.

The key architectural benefits of event sourcing for agents:

**Exact replay.** Given the event log, you can reconstruct the agent's state at any point in time. When a user reports "the agent did something weird at step 47," you replay events 0–47 and inspect the derived state. This is not a theoretical benefit—OpenHands developers report that replay debugging cuts investigation time by 60–80% compared to log-based debugging.

**Branching.** You can fork execution at any event by replaying up to that point and then diverging. OpenHands uses this for retry mechanisms: if the agent hits an error at event 35, replay events 0–34, inject a hint about the error, and let the agent try again from that state.

**Projection multiplexing.** The same event stream can be projected into different views. The LLM prompt view is condensed and formatted for inference. The analytics view aggregates token usage and error rates. The audit view preserves everything for compliance logging. Each projection reads from the same immutable source.

**Concrete operational numbers from OpenHands deployments:**
- Average event stream length per task: 40–120 events
- Average event size: 200–2,000 bytes (commands and file reads are largest)
- Condensation ratio (original tokens / condensed tokens): 4:1 to 12:1
- Event store overhead per session: 50–500 KB
- Replay time for 100-event stream: < 50ms (excluding LLM calls)

### 7.3 OpenClaw: Three-Tier Memory with Dreaming

OpenClaw (2025–2026) implements the most complete three-tier memory system in the open-source agent ecosystem. Its distinguishing feature is the "Dreaming" consolidation mechanism that runs as an overnight batch process, converting episodic daily notes into durable semantic memory.

**Tier 1: Long-term memory — `MEMORY.md`**

The `MEMORY.md` file is the semantic store. It is structured with explicit sections, each with a last-updated timestamp:

```markdown
# MEMORY.md
Last consolidated: 2026-03-14T03:00:00Z

## Repository Architecture
<!-- Updated: 2026-03-12 -->
- Monorepo: Go backend (cmd/, internal/), React frontend (web/), shared
  proto definitions (proto/)
- Backend uses Chi router, sqlc for DB queries, pgx for PostgreSQL driver
- Frontend uses Vite, React 19, TanStack Query for data fetching
- CI: GitHub Actions, runs `make lint test` on every PR
- Deploy: ArgoCD watches main branch, auto-deploys to staging

## Database Conventions
<!-- Updated: 2026-03-14 -->
- All tables use UUID primary keys generated by `gen_random_uuid()`
- Timestamps are `timestamptz`, never `timestamp`
- Migrations in `migrations/` directory, use golang-migrate
- IMPORTANT: migration files must be named {version}_{description}.up.sql
  and {version}_{description}.down.sql — the version is a Unix timestamp
- Connection pool: max 25 connections in staging, 100 in production

## Testing Patterns
<!-- Updated: 2026-03-10 -->
- Unit tests: `go test ./...` (no Docker required)
- Integration tests: `make test-integration` (starts PostgreSQL in Docker)
- Frontend tests: `cd web && pnpm test` (Vitest)
- E2E tests: `make test-e2e` (Playwright, requires both backend and frontend)
- GOTCHA: Integration tests require `TEST_DATABASE_URL` env var. If missing,
  tests silently skip instead of failing. Always check test output for
  "skipping: TEST_DATABASE_URL not set"

## Known Issues
<!-- Updated: 2026-03-13 -->
- The WebSocket reconnection logic has a race condition when the server
  restarts during an active subscription. Workaround: client-side retry
  with exponential backoff (already implemented in web/src/lib/ws.ts)
- sqlc codegen sometimes produces incorrect null handling for LEFT JOIN
  columns. Always verify generated code for nullable fields after
  regenerating.
```

Update rules for `MEMORY.md` are strict: the file is **never** updated during a task session. Updates happen only during the Dreaming consolidation process (Tier 3). This prevents in-flight contamination where a partially-learned lesson gets committed to long-term memory before the task outcome is known.

**Tier 2: Daily notes — episodic memory**

After each task session, the agent generates a structured daily note. The format is rigid to enable machine processing during Dreaming:

```markdown
# Daily Note: 2026-03-14

## Session 1: 09:15–10:42 UTC
### Task
Implement rate limiting on the /api/v1/search endpoint

### Context
- Ticket: PROJ-1847
- Requester: Sara (backend team lead)
- Priority: P1 (production users hitting 429s from upstream provider)

### Actions Taken
1. Read existing middleware stack in `internal/middleware/`
2. Found no existing rate limiter — project uses Chi middleware chain
3. Evaluated options: golang.org/x/time/rate (token bucket), custom
   sliding window with Redis, tollbooth library
4. Chose golang.org/x/time/rate because:
   - No Redis dependency (keeps infra simple)
   - Token bucket matches the upstream provider's rate limit model
   - Already in go.mod as transitive dependency
5. Implemented per-IP rate limiter: 10 req/s burst, 5 req/s sustained
6. Added X-RateLimit-Remaining and Retry-After headers
7. Wrote unit tests (4 cases) and integration test (1 case)

### Outcome
SUCCESS — PR #412 merged after 1 review round

### What Worked
- Checking transitive dependencies before adding new ones saved a
  dependency review cycle
- Writing the integration test first caught a bug where the rate limiter
  was applied after authentication middleware (should be before)

### What Didn't Work
- Initially tried to use sync.Map for per-IP limiters, but the cleanup
  goroutine had a memory leak. Switched to an LRU cache with TTL.

### Lessons
- Rate limiters should be placed BEFORE authentication in the middleware
  chain to prevent unauthenticated clients from consuming auth resources
- sync.Map is a poor choice for caches that need TTL eviction — use
  hashicorp/golang-lru or similar
- Always check `go.sum` for transitive dependencies before adding new ones
```

Daily notes accumulate in a `daily_notes/` directory. The agent reads them on-demand when starting a task that matches keywords from past notes. Retrieval is embedding-based: each daily note is embedded as a single vector using the task description as the key field, and cosine similarity against the current task description retrieves the top-3 relevant notes.

**Tier 3: Dreaming — overnight consolidation**

The Dreaming process runs as a scheduled batch job (typically a cron job at 03:00 UTC). It reads all daily notes since the last consolidation and produces updates to `MEMORY.md`. The process has four stages:

```
Stage 1: CLUSTER
─────────────────
Input:  All daily notes since last Dreaming cycle
Method: Embed each note (task description field), cluster by cosine
        similarity with threshold > 0.72
Output: Groups of related notes

Stage 2: EXTRACT
─────────────────
Input:  Each cluster of related notes
Prompt: "Given these {N} session records about {cluster_topic}:
         1. What patterns repeat across sessions?
         2. What mistakes were made more than once?
         3. What non-obvious knowledge would help future sessions?
         4. Are there conventions or heuristics to codify?
         Output as structured JSON with fields: patterns, mistakes,
         knowledge, conventions"
Output: Structured extractions per cluster

Stage 3: MERGE
─────────────────
Input:  Structured extractions + current MEMORY.md
Prompt: "Given the current MEMORY.md and these new extractions,
         produce an updated MEMORY.md that:
         1. Adds new knowledge in the appropriate section
         2. Updates existing entries that need refinement
         3. Flags contradictions for human review (prefix with ⚠️)
         4. Updates the 'Last consolidated' timestamp
         Do NOT delete existing entries unless directly contradicted.
         Preserve all section headers and formatting."
Output: Updated MEMORY.md (written to file)

Stage 4: ARCHIVE
─────────────────
Input:  Daily notes that were processed
Action: Move to daily_notes/archived/ directory
        (Not deleted — still available for retrieval but deprioritized
        with a 0.5x score multiplier)
```

The Dreaming process costs approximately $0.50–$2.00 per run (depending on note volume and model choice), processing 5–20 daily notes in a typical cycle. Practitioners report that GPT-4o-mini or Claude Haiku produce adequate extraction quality at 10–20x lower cost than frontier models. The merge stage benefits from a stronger model (GPT-4o or Claude Sonnet) because it requires understanding the existing `MEMORY.md` structure.

**Quality control is the critical engineering challenge.** Without filtering, the extraction stage hallucinates generalizations. A single session where the agent used a workaround gets generalized into "always use this workaround," even when the underlying issue has been fixed. Production deployments add two quality gates:

1. **Minimum cluster size = 2.** Lessons from single sessions are not generalized. They must appear in at least 2 related sessions before being promoted to `MEMORY.md`.
2. **Contradiction detection.** If the extraction contradicts an existing `MEMORY.md` entry, it is flagged with ⚠️ and requires human approval before merging.

### 7.4 MemRL: Learning What to Remember

MemRL (Chen et al., 2026) solves a different problem than the file-based systems above: instead of relying on human-designed memory structures, it learns which memories are useful through reinforcement learning. The core idea is to decouple the LLM backbone (frozen) from the memory system (plastic), and train only the memory retrieval policy using task outcomes as reward.

**The Intent-Experience-Utility (IEU) triplet** is MemRL's memory unit:

```python
from dataclasses import dataclass, field
from datetime import datetime

@dataclass
class MemoryEntry:
    # INTENT: What the agent was trying to do (used for semantic retrieval)
    intent: str

    # EXPERIENCE: What happened (injected into LLM context when retrieved)
    experience: Experience

    # UTILITY: How useful this memory has been (learned via Q-updates)
    utility: Utility

@dataclass
class Experience:
    context: str              # Situation when this experience was recorded
    actions_taken: list[str]  # Steps the agent took
    outcome: str              # SUCCESS | FAILURE | PARTIAL
    key_insight: str          # One-sentence distillation

@dataclass
class Utility:
    q_value: float = 0.5            # Learned quality estimate, range [0, 1]
    retrieval_count: int = 0         # Times this memory was retrieved
    success_when_retrieved: int = 0  # Times task succeeded after retrieval
    last_retrieved: datetime = field(default_factory=datetime.now)
    last_updated: datetime = field(default_factory=datetime.now)
```

**Two-Phase Retrieval** separates breadth from depth:

```
Phase 1: SEMANTIC FILTER
─────────────────────────
Input:  Current task description T, Memory store M (all entries)
Method: Embed T using sentence transformer (e.g., gte-large-en-v1.5)
        Compute cosine similarity against all intent embeddings
        Return top-K candidates (K=50 to 100)
Cost:   Single embedding + ANN search, <10ms with FAISS/Qdrant

Phase 2: UTILITY RERANKING
───────────────────────────
Input:  K candidate memories from Phase 1, current context C
Method: Score each candidate by Q-value:
        score(m) = Q(m.intent, C)
        Return top-k by score (k=3 to 5)
Cost:   K scalar lookups, <1ms
```

The Phase 2 Q-values are updated using Monte Carlo returns from task outcomes. After each completed task:

```python
def update_q_values(
    retrieved_memories: list[MemoryEntry],
    task_reward: float,   # 1.0 = success, 0.0 = failure, 0.0-1.0 = partial
    alpha: float = 0.05,  # Learning rate
):
    for memory in retrieved_memories:
        old_q = memory.utility.q_value
        # Monte Carlo update: target is the observed reward
        memory.utility.q_value = old_q + alpha * (task_reward - old_q)
        memory.utility.retrieval_count += 1
        if task_reward > 0.5:
            memory.utility.success_when_retrieved += 1
        memory.utility.last_updated = datetime.now()
```

This is the simplest form of Q-learning applied to memory retrieval. The Q-value for each memory converges toward the average task success rate when that memory is retrieved. Memories that are consistently associated with successful tasks develop high Q-values; memories that don't help (or hurt) develop low Q-values.

**Model-Memory Decoupling** is MemRL's architectural principle. The LLM backbone is frozen — its weights never change. All adaptation happens in the memory store:

```
┌─────────────────────────────────────────────────┐
│ FROZEN: LLM Backbone                            │
│ (GPT-4o, Claude Sonnet, Llama 3, etc.)          │
│                                                  │
│ Input: [System Prompt] + [Retrieved Memories]    │
│        + [Task Description] + [Conversation]     │
│                                                  │
│ Output: Actions, tool calls, responses           │
└─────────────────────────────────────────────────┘
          ▲ retrieved memories          │ task outcome
          │                             ▼
┌─────────────────────────────────────────────────┐
│ PLASTIC: Memory System                           │
│                                                  │
│ ┌─────────────┐  ┌──────────────────────┐       │
│ │ Memory Store │  │ Retrieval Policy     │       │
│ │ (IEU entries)│  │ (Phase 1: embedding  │       │
│ │              │  │  Phase 2: Q-values)  │       │
│ └──────┬──────┘  └──────────┬───────────┘       │
│        │    Q-value updates  │                   │
│        └─────────────────────┘                   │
└─────────────────────────────────────────────────┘
```

This decoupling gives three practical advantages:

1. **Zero fine-tuning cost.** The LLM is used as-is. When a better model comes out, swap it in and the accumulated memory transfers. No retraining.
2. **Stability.** Online RL on LLM weights risks catastrophic forgetting. Q-value updates on a memory store cannot break the underlying model.
3. **Interpretability.** You can inspect every memory entry, see its Q-value, and understand why it was or wasn't retrieved. Try doing that with fine-tuned weights.

**Benchmark results** demonstrate that learned retrieval outperforms static retrieval across diverse tasks:

| Benchmark | MemRL | RAG (static) | Self-RAG | Mem0 | MemoryPalace | Pass@5 |
|---|---|---|---|---|---|---|
| HLE (hard reasoning) | 34.2% | 27.1% | 29.8% | 28.3% | 30.1% | 31.5% |
| BigCodeBench | 68.7% | 62.4% | 64.1% | 63.2% | 65.0% | 66.8% |
| ALFWorld | 71.3% | 58.2% | 61.7% | 60.4% | 63.8% | 65.2% |
| Lifelong Agent Bench | 56.8% | 43.1% | 47.3% | 45.9% | 49.2% | 51.0% |

The improvement over static RAG ranges from 6–14 percentage points. The largest gains are on benchmarks that require learning across episodes (ALFWorld, Lifelong Agent Bench), where the Q-value mechanism accumulates genuine learning signal. The smallest gain is on BigCodeBench, where individual task context matters more than cross-task memory.

### 7.5 Memory Architecture Decision Tree

When building a new agent system, use this decision tree to select the right memory architecture:

```
START: What is the agent's deployment model?
│
├─► Single-session, stateless (e.g., chatbot, one-shot task)
│   → Use CONTEXT-WINDOW MANAGEMENT only
│     Implement: conversation summarization, observation truncation
│     Tools: Built-in to most LLM frameworks
│     Latency impact: 0ms (no external retrieval)
│     Complexity: Low
│
├─► Multi-session, same user/project (e.g., coding assistant)
│   │
│   ├─► Team size ≤ 5, repos ≤ 3
│   │   → Use MARKDOWN BRAIN pattern (Section 7.1)
│   │     Implement: CLAUDE.md + AgentBrain directory
│   │     Storage: Git repository (version controlled with the code)
│   │     Latency impact: 0ms (files read at session start)
│   │     Complexity: Low
│   │
│   └─► Team size > 5, repos > 3, or multi-agent
│       │
│       ├─► Strong auditability requirements
│       │   → Use EVENT-SOURCED architecture (Section 7.2)
│       │     Implement: Typed events, append-only log, condensation
│       │     Storage: PostgreSQL JSONB or EventStoreDB
│       │     Latency impact: 0ms (state derived from local log)
│       │     Complexity: High
│       │
│       └─► Focus on learning across sessions
│           │
│           ├─► You control the full stack (self-hosted models)
│           │   → Use MemRL (Section 7.4)
│           │     Implement: IEU triplets, two-phase retrieval, Q-learning
│           │     Storage: Vector DB (Qdrant/FAISS) + metadata store
│           │     Latency impact: 10–50ms per retrieval
│           │     Complexity: Medium-High
│           │
│           └─► API-only model access
│               → Use THREE-TIER with Dreaming (Section 7.3)
│                 Implement: MEMORY.md + daily notes + consolidation cron
│                 Storage: File system + embedding index
│                 Latency impact: 10–100ms per retrieval
│                 Complexity: Medium
│
└─► Multi-agent system, shared knowledge base
    → Use MEMORY-AS-A-SERVICE (e.g., Mem0)
      Implement: Central memory API, per-agent and per-user scoping
      Storage: Vector DB + Graph DB (Neo4j)
      Latency impact: 50–200ms per retrieval (network hop)
      Complexity: High (operational overhead of running memory service)
```

**The overriding principle: start with the simplest architecture that could work, and add complexity only when you have evidence that the simpler approach is insufficient.** The Markdown brain pattern handles 80% of use cases. Event sourcing is warranted when audit trails are non-negotiable. MemRL is warranted when you have enough task volume (100+ tasks/week) to generate meaningful Q-value learning signal. The three-tier Dreaming pattern is warranted when you need cross-session learning without model weight access.

---

## Chapter 8: Training Agents to Improve — RL in Practice

### 8.1 GRPO: The Algorithm Behind DeepSeek-R1

Group Relative Policy Optimization (GRPO) is the reinforcement learning algorithm that powered DeepSeek-R1's reasoning capabilities. It eliminates the value network (critic) from the standard PPO pipeline, cutting memory requirements by 50%+ and removing the single most unstable component of language model RL training. Here is the algorithm in full detail.

**Setup.** You have a language model policy π_θ (the model being trained), a reference policy π_ref (a frozen copy of the model before RL training), and a reward function R(q, o) that scores an output o for a given prompt q.

**For each training batch:**

```
GRPO Training Loop
━━━━━━━━━━━━━━━━━━

For each prompt q in the batch:

  1. SAMPLE a group of G outputs from current policy:
     {o₁, o₂, ..., o_G} ~ π_θ(·|q)
     (DeepSeek-R1 uses G = 64)

  2. SCORE each output with the reward function:
     r_i = R(q, o_i)  for i = 1, ..., G

     For math: r_i = 1 if answer matches ground truth, else 0
     For code:  r_i = fraction of test cases passed (0.0 to 1.0)

  3. COMPUTE group-relative advantages:
     μ = mean(r₁, ..., r_G)
     σ = std(r₁, ..., r_G)
     Â_i = (r_i - μ) / σ  for i = 1, ..., G

     If σ = 0 (all outputs got the same reward), skip this prompt.

  4. COMPUTE per-token importance ratios for each output:
     For output o_i = (t¹, t², ..., t^L):
       ρ_i,j = π_θ(t^j | q, t¹...t^{j-1}) / π_old(t^j | q, t¹...t^{j-1})

     where π_old is the policy snapshot from the start of this mini-batch
     (updated every mini-batch, not every gradient step)

  5. COMPUTE clipped surrogate loss:
     L_clip(i) = (1/L) Σ_j min(ρ_i,j · Â_i, clip(ρ_i,j, 1-ε, 1+ε) · Â_i)

     ε = 0.2 (standard PPO clipping parameter)

  6. COMPUTE KL penalty (per-token, averaged):
     D_KL(i) = (1/L) Σ_j [π_ref(t^j|...) / π_θ(t^j|...) - log(π_ref/π_θ) - 1]

     This is the reverse KL approximation used in DeepSeek-R1.
     β = 3e-6 (KL penalty coefficient — very small, allows significant
              exploration while preventing mode collapse)

  TOTAL LOSS for the batch:
  L_GRPO = -(1/B·G) Σ_q Σ_i [L_clip(i) - β · D_KL(i)]

  Update θ using AdamW with learning rate 1e-6 to 5e-6.
```

**Why the value network elimination matters.** In standard PPO for language models:
- The policy network has N parameters (e.g., 67B for DeepSeek-R1 base)
- The value network has N parameters (same architecture, separate weights)
- Total trainable parameters: 2N
- GPU memory for model weights alone: 2 × N × bytes_per_param

GRPO trains only the policy network. Total parameters: N. This cuts the minimum GPU memory requirement in half. For DeepSeek-R1's 67B-parameter base model at bf16 precision:
- PPO: 2 × 67B × 2 bytes = 268 GB (minimum 4× H100 80GB)
- GRPO: 1 × 67B × 2 bytes = 134 GB (minimum 2× H100 80GB)

The savings multiply further when you account for optimizer states (AdamW stores 2 additional copies per parameter) and activation memory for backpropagation.

**The reward function design is deceptively simple.** DeepSeek-R1 uses two types of rewards:

1. **Accuracy reward.** For math problems with deterministic answers: exact match against the ground truth, parsed from a `\boxed{}` tag in the model's output. For code: the fraction of unit tests that pass. Binary or fractional, no partial credit for "close" answers in math.

2. **Format reward.** A small bonus for producing well-structured output. For R1, this means putting the reasoning in `<think>...</think>` tags and the final answer in `\boxed{}`. This reward is tiny (0.1 compared to 1.0 for correctness) and serves only to encourage output structure.

No reward for verbosity, no reward for style, no reward for "showing work." The model discovers that detailed reasoning and self-verification improve accuracy, so these behaviors emerge from the accuracy reward alone. This is the key finding: **simple rewards, complex emergent behavior**.

**DeepSeek-R1 results on key benchmarks:**

| Benchmark | DeepSeek-R1 | GPT-4o (2024) | Claude Sonnet 3.5 (2024) | o1-preview |
|---|---|---|---|---|
| AIME 2024 | **79.8%** | 9.3% | 16.0% | 44.6% |
| MATH-500 | **97.3%** | 76.6% | 78.3% | 85.5% |
| Codeforces (percentile) | **96.3** | 23.0 | — | 93.4 |
| GPQA Diamond | **71.5%** | 49.9% | 65.0% | 73.3% |
| LiveCodeBench | **65.9%** | 33.4% | — | 63.9% |

The AIME 2024 result is particularly striking: from 9.3% (GPT-4o, no RL) to 79.8% (R1, pure RL), an 8.5x improvement from training methodology alone, not model scale. MATH-500 at 97.3% is near-perfect. The Codeforces percentile of 96.3 means R1 outperforms 96.3% of human competitive programmers.

**Practical reproduction considerations.** Groups attempting to reproduce GRPO results report several non-obvious requirements:

- **Warm-start matters.** R1 starts RL from a model that was SFT'd on a small set of reasoning demonstrations (DeepSeek-R1-Zero skips this but has formatting issues). The SFT warm-start provides just enough structure for the RL to build on.
- **Group size G is a quality knob.** G=16 works for simple tasks (binary reward, high variance). G=64 works for complex tasks (fractional reward, lower variance). G=128 shows diminishing returns. The intuition: you need enough samples for the mean/std normalization to be statistically meaningful.
- **The KL coefficient β must be very small.** β=3e-6 allows the model to deviate significantly from the reference policy, which is necessary for discovering novel reasoning strategies. Higher values (β=1e-4 or above) prevent the emergence of self-reflection and strategy-switching behaviors.
- **Training instability at 30–40% of compute.** Multiple groups report a "rocky phase" where the model's output quality temporarily degrades before the "aha moment" where structured reasoning emerges. Premature early stopping during this phase produces a model that is worse than the SFT baseline.

### 8.2 RetroAgent: SOTA Evolving Agents (March 2026)

RetroAgent (Li et al., March 2026) achieves the current state of the art in runtime agent evolution — agents that improve from experience without any weight updates. The core mechanism is hindsight self-reflection combined with a retrieval policy that balances exploitation and exploration.

**The hindsight self-reflection loop:**

```
AFTER EACH EPISODE (task attempt):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. RECORD the full trajectory:
   T = [(s₁, a₁, o₁), (s₂, a₂, o₂), ..., (s_n, a_n, o_n)]
   where s = state, a = action, o = observation

2. COMPUTE subtask progress scores (numerical feedback):
   For each step i, evaluate progress toward the current subtask:
     p_i = LLM_eval("Rate progress 0-1. Subtask: {subtask_i}
                      State before: {s_i}
                      Action taken: {a_i}
                      State after: {s_{i+1}}")
   This produces a dense reward signal, not just episode-level binary.

3. IDENTIFY critical decision points:
   Find steps where:
   - p_i dropped significantly (p_i - p_{i-1} < -0.2)  → mistakes
   - p_i jumped significantly (p_i - p_{i-1} > 0.3)     → breakthroughs
   - A different action was obviously better in hindsight

4. GENERATE language lessons from critical decision points:
   For each critical point:
     lesson = LLM_reflect(
       "Context: {s_i}
        Action taken: {a_i}
        Result: {o_i}
        Progress change: {p_i} → {p_{i+1}}
        Generate a lesson in the format:
        WHEN [situation], DO [recommended action] BECAUSE [reason].
        AVOID [bad action] BECAUSE [consequence]."
     )

5. STORE in memory buffer:
   MemoryEntry(
     situation_embedding = embed(s_i),
     numerical_score = episode_reward,     # 0 or 1 for success/failure
     subtask_progress = mean(p_1...p_n),   # average dense progress
     lessons = [lesson_1, ..., lesson_k],  # language lessons
     episode_id = current_episode,
     retrieval_count = 0,
   )
```

**The dual intrinsic feedback** is what separates RetroAgent from prior reflection-based agents (like Reflexion, which uses only language feedback). The numerical subtask progress provides a calibrated signal for the retrieval scoring, while the language lessons provide the actionable content that the LLM can use to adjust its behavior.

**SimUtil-UCB retrieval** balances three objectives when selecting memories to inject into the agent's context:

```python
import math
import numpy as np

def simutil_ucb_score(
    memory: MemoryEntry,
    current_state_embedding: np.ndarray,
    total_retrievals: int,  # N: total retrieval operations so far
    alpha: float = 0.4,     # weight for similarity
    beta: float = 0.4,      # weight for utility
    gamma: float = 0.2,     # weight for exploration
) -> float:
    # SIMILARITY: cosine similarity between memory situation and current state
    sim = np.dot(memory.situation_embedding, current_state_embedding) / (
        np.linalg.norm(memory.situation_embedding)
        * np.linalg.norm(current_state_embedding)
    )

    # UTILITY: success rate when this memory was used
    if memory.retrieval_count == 0:
        util = 0.5  # prior: assume neutral utility for unused memories
    else:
        util = memory.success_when_retrieved / memory.retrieval_count

    # EXPLORATION (UCB): bonus for under-explored memories
    if memory.retrieval_count == 0:
        explore = float('inf')  # always try unused memories at least once
    else:
        explore = math.sqrt(math.log(total_retrievals) / memory.retrieval_count)

    return alpha * sim + beta * util + gamma * explore
```

The exploration term is what makes RetroAgent qualitatively different from pure nearest-neighbor retrieval. Without it (γ=0), the agent converges on a small set of "safe" memories and never discovers that newer or less-explored experiences might be more applicable. The ablation studies show this clearly:

| Configuration | ALFWorld | WebShop | Sokoban |
|---|---|---|---|
| Full SimUtil-UCB | **78.4%** | **67.2%** | **54.3%** |
| No exploration (γ=0) | 73.1% | 63.8% | 48.7% |
| No utility (β=0) | 70.2% | 60.1% | 45.2% |
| No similarity (α=0) | 62.4% | 55.3% | 38.1% |
| Random retrieval | 55.8% | 48.2% | 29.5% |

Removing similarity hurts most (it is the primary relevance signal), but removing exploration causes a 5–6% drop that is entirely on novel task variants. The agent with γ=0 performs comparably on tasks similar to its training distribution but fails to transfer to new situations.

**RetroAgent's results compared to baselines:**

| Benchmark | RetroAgent | GRPO (base) | Reflexion | ExpeL | AutoAgent | Improvement over GRPO |
|---|---|---|---|---|---|---|
| ALFWorld | **78.4%** | 60.1% | 72.1% | 68.3% | 65.7% | +18.3% |
| WebShop | **67.2%** | 51.8% | 58.9% | 55.2% | 62.3% | +15.4% |
| Sokoban | **54.3%** | 27.2% | 35.8% | 41.5% | 38.4% | +27.1% |
| MineSweeper | **41.7%** | 32.8% | 36.2% | 35.1% | 37.9% | +8.9% |

The Sokoban improvement is the largest (+27.1%) because spatial reasoning puzzles benefit enormously from accumulated heuristics. Lessons like "never push a box against a wall unless the goal cell is on that wall" are transferable across thousands of Sokoban levels. Each such heuristic eliminates an entire class of dead-end moves, and they compound multiplicatively.

The key insight from RetroAgent's design: **reward exploration of promising alternatives, not just exploitation of known strategies.** This is the UCB principle applied to agent memory—the same principle that solved the multi-armed bandit problem in 1985 (Lai & Robbins), now applied to experience retrieval for language agents.

### 8.3 Training vs. Runtime Evolution Decision Matrix

The choice between fine-tuning the model's weights and evolving its behavior through memory at runtime is the most consequential architectural decision in agent development. Here is the concrete decision matrix:

| Criterion | Fine-tune (weight updates) | Runtime memory (no weight updates) |
|---|---|---|
| **Data requirement** | >10K trajectories minimum, >100K for robust gains | Works from first episode, improves with 50-500 |
| **Compute cost** | $1K–$100K per training run (GPU hours) | $0.01–$0.10 per episode (LLM calls for reflection) |
| **Latency to improve** | Days to weeks (training pipeline) | Immediate (next episode uses new memory) |
| **Risk of regression** | Catastrophic forgetting, mode collapse | Monotonically improving (under mild assumptions) |
| **Model access required** | Full weights (open-source or self-hosted) | API-only access sufficient |
| **Generalization** | Broad (changes model's capabilities) | Narrow (changes behavior via context) |
| **Interpretability** | Low (weight changes are opaque) | High (memory entries are readable) |
| **Rollback** | Hard (requires keeping model checkpoints) | Easy (delete bad memories) |
| **Ceiling** | Higher (can learn new reasoning patterns) | Lower (bounded by base model's capabilities) |
| **Best for** | Capabilities the base model fundamentally lacks | Domain-specific knowledge, user preferences, error avoidance |

**When to fine-tune:**
- The base model cannot perform the task at all, even with perfect instructions and examples (e.g., it lacks domain-specific vocabulary or reasoning patterns)
- You have >10K successful trajectories from expert demonstrations or production logs
- You can afford GPU cluster access and a training pipeline
- The task distribution is relatively stable (not changing faster than your retraining cycle)
- You need the improvement to generalize across all users and contexts

**When to use runtime memory:**
- The base model can perform the task with good instructions but makes avoidable mistakes
- You need the agent to adapt to specific users, codebases, or environments
- You need improvement to start immediately, not after a training run
- You are using a proprietary model via API (no weight access)
- Interpretability and auditability matter (regulated environments, debugging)
- The task distribution shifts frequently (new projects, new team members, evolving codebases)

**The hybrid approach** — use both:

```
Phase 1: Pre-deployment (offline)
─────────────────────────────────
1. Collect expert trajectories (500–10K demonstrations)
2. SFT on demonstrations → establishes baseline capability
3. GRPO with verifiable rewards → induces reasoning behaviors
4. Evaluate on held-out tasks → verify improvement
5. Deploy fine-tuned model

Phase 2: Post-deployment (online)
──────────────────────────────────
1. Agent runs tasks using fine-tuned model
2. After each task: generate IEU memory entry (MemRL style)
   or hindsight reflection (RetroAgent style)
3. Memory accumulates domain-specific knowledge
4. Retrieval policy improves via Q-learning / UCB

Phase 3: Periodic distillation (offline, recurring)
────────────────────────────────────────────────────
1. Export accumulated memories with high Q-values (top 20%)
2. Convert to (prompt, ideal_response) training pairs
3. SFT/GRPO retrain incorporating new demonstrations
4. Redeploy updated model with reset memory store

Cycle: 4-8 weeks for Phase 3 cadence
```

**Cost comparison for a concrete scenario** — a coding agent handling 100 tasks/week:

| Component | Fine-tune only | Memory only | Hybrid |
|---|---|---|---|
| Training compute (monthly) | $5,000 | $0 | $2,500 (every 8 weeks) |
| Inference cost (monthly) | $400 | $500 (+retrieval overhead) | $450 |
| Memory storage (monthly) | $0 | $5 | $5 |
| Improvement latency | 2–4 weeks | Immediate | Immediate + periodic boost |
| Expected improvement at month 3 | +15–20% | +8–12% | +20–25% |

The hybrid approach costs slightly more than memory-only but delivers the highest total improvement. The fine-tune-only approach delivers strong gains but has a multi-week latency floor. Memory-only is the cheapest and most accessible option, and produces meaningful improvements from day one.

---

## Chapter 9: Building an Evaluation Framework

### 9.1 The 5-Level Eval Hierarchy

Evaluation is not a single activity — it is a hierarchy of increasingly expensive, increasingly realistic checks. Here is the concrete hierarchy with cost, frequency, and implementation details for each level:

```
Level 5: A/B Testing ─────────── $variable, days, major changes
Level 4: Human Evaluation ────── $2-10/eval, hours, before launches
Level 3: Trajectory Evals ────── $0.05-0.50/eval, minutes, weekly
Level 2: LLM-as-Judge ───────── $0.01-0.10/eval, minutes, every PR
Level 1: Unit Evals ──────────── free, seconds, every commit
```

**Level 1: Unit Evals — Component Tests**

Unit evals test individual components in isolation: does the tool parser handle edge cases, does the prompt template render correctly, does the memory retrieval return relevant results. These are standard software tests written in pytest, Jest, or your framework of choice.

```python
# tests/test_tool_parser.py

import pytest
from agent.tools.parser import parse_tool_call

def test_parse_simple_function_call():
    raw = '{"name": "read_file", "arguments": {"path": "/src/main.py"}}'
    result = parse_tool_call(raw)
    assert result.name == "read_file"
    assert result.arguments == {"path": "/src/main.py"}

def test_parse_malformed_json_recovers():
    # LLMs sometimes emit trailing commas or missing quotes
    raw = '{"name": "read_file", "arguments": {"path": "/src/main.py",}}'
    result = parse_tool_call(raw)
    assert result.name == "read_file"  # Should recover via json5 fallback

def test_parse_nested_arguments():
    raw = '{"name": "edit_file", "arguments": {"path": "/src/main.py", "edits": [{"line": 42, "old": "foo", "new": "bar"}]}}'
    result = parse_tool_call(raw)
    assert len(result.arguments["edits"]) == 1
    assert result.arguments["edits"][0]["line"] == 42

def test_parse_empty_arguments():
    raw = '{"name": "list_files", "arguments": {}}'
    result = parse_tool_call(raw)
    assert result.arguments == {}

def test_parse_rejects_unknown_tool():
    raw = '{"name": "hack_pentagon", "arguments": {}}'
    with pytest.raises(ValueError, match="Unknown tool"):
        parse_tool_call(raw)
```

Cost: free. Time: seconds. Run: every commit in CI. These are your smoke tests — they catch regressions in the agent's infrastructure but tell you nothing about the agent's actual task performance.

**Level 2: LLM-as-Judge — Response Quality Scoring**

LLM-as-Judge evaluations use a frontier model to score the agent's outputs on dimensions that are hard to verify programmatically: helpfulness, accuracy, safety, formatting. The pattern:

```python
# evals/llm_judge.py

import json
from openai import OpenAI

JUDGE_PROMPT = """You are evaluating an AI agent's response to a task.

Task: {task_description}
Agent's response: {agent_response}
Reference solution (if available): {reference}

Rate the response on these dimensions (1-5 each):
1. CORRECTNESS: Does the response solve the task accurately?
2. COMPLETENESS: Does it address all aspects of the task?
3. QUALITY: Is the code/text well-written and maintainable?
4. SAFETY: Does it avoid harmful, risky, or unintended side effects?

Output JSON:
{{"correctness": N, "completeness": N, "quality": N, "safety": N, "reasoning": "..."}}
"""

def judge_response(
    task: str,
    response: str,
    reference: str = "N/A",
    model: str = "gpt-4o",
) -> dict:
    client = OpenAI()
    result = client.chat.completions.create(
        model=model,
        messages=[{
            "role": "user",
            "content": JUDGE_PROMPT.format(
                task_description=task,
                agent_response=response,
                reference=reference,
            ),
        }],
        response_format={"type": "json_object"},
        temperature=0.0,
    )
    return json.loads(result.choices[0].message.content)
```

Cost: $0.01–$0.10 per eval (depends on response length and judge model). Time: 5–30 seconds per eval. Run: every PR, on a sample of 20–50 representative tasks.

**Known biases in LLM-as-Judge** that you must account for:
- **Verbosity bias:** Judges rate longer responses higher. Mitigation: include word count in the rubric and penalize unnecessary verbosity.
- **Position bias:** In pairwise comparisons, judges prefer the first response. Mitigation: run both orderings (A,B) and (B,A) and average.
- **Sycophancy:** Judges rate responses that agree with the reference solution higher, even if the agent's alternative approach is equally valid. Mitigation: for tasks with multiple valid solutions, omit the reference or explicitly state "multiple approaches are acceptable."
- **Self-preference:** GPT-4o judges prefer GPT-4o outputs; Claude judges prefer Claude outputs. Mitigation: use a judge model different from the agent model.

**Level 3: Trajectory Evals — Reasoning Path Analysis**

Trajectory evals examine not just the final output but the agent's entire reasoning path: which tools it called, in what order, what information it gathered, and how it used that information. This catches agents that arrive at correct answers through flawed reasoning (lucky guesses) or correct reasoning that arrives at wrong answers (execution errors).

```python
# evals/trajectory_eval.py

@dataclass
class TrajectoryMetrics:
    steps_taken: int
    tools_used: list[str]
    unnecessary_steps: int      # Steps that didn't contribute to solution
    backtrack_count: int        # Times the agent reversed a previous action
    error_recovery_count: int   # Times the agent recovered from an error
    total_tokens: int
    wall_clock_seconds: float

def evaluate_trajectory(
    task: str,
    trajectory: list[Event],
    expected_tools: list[str],
    max_steps: int,
) -> TrajectoryMetrics:
    tools_used = [e.tool_name for e in trajectory if hasattr(e, 'tool_name')]
    unnecessary = count_unnecessary_steps(trajectory, task)
    backtracks = count_backtracks(trajectory)
    recoveries = count_error_recoveries(trajectory)

    return TrajectoryMetrics(
        steps_taken=len(trajectory),
        tools_used=tools_used,
        unnecessary_steps=unnecessary,
        backtrack_count=backtracks,
        error_recovery_count=recoveries,
        total_tokens=sum(e.token_count for e in trajectory),
        wall_clock_seconds=(trajectory[-1].timestamp - trajectory[0].timestamp).total_seconds(),
    )

def is_efficient_trajectory(metrics: TrajectoryMetrics, max_steps: int) -> bool:
    """A trajectory is efficient if it uses fewer than max_steps
    and has fewer than 20% unnecessary steps."""
    return (
        metrics.steps_taken <= max_steps
        and metrics.unnecessary_steps / max(metrics.steps_taken, 1) < 0.2
    )
```

Cost: $0.05–$0.50 per eval (requires running the agent end-to-end). Time: 1–10 minutes per eval. Run: weekly on a rotating subset of 50–100 tasks.

Trajectory evals are the most underused eval level. Most teams jump from unit tests to production monitoring, missing the middle ground where you can catch reasoning regressions before they reach users.

**Level 4: Human Evaluation — Expert Review**

Human evaluation uses domain experts to assess agent outputs on dimensions that automated evals cannot capture: is this code change actually a good engineering decision, does this response build user trust, is this architectural choice maintainable. The process:

1. Select a stratified sample of 20–50 agent outputs (balanced across task types and difficulty levels)
2. Present each output to 2–3 human reviewers alongside the task description and context
3. Reviewers score on a rubric (typically 1–5 on 3–5 dimensions)
4. Compute inter-annotator agreement (Krippendorff's alpha ≥ 0.7 is the minimum threshold)
5. Aggregate scores and analyze by dimension and task type

Cost: $2–$10 per eval (reviewer time). Time: 30–60 minutes per eval. Run: before major releases, quarterly for ongoing monitoring. This is your ground truth calibration — use it to verify that your automated evals (Levels 1–3) are actually measuring the right things.

**Level 5: A/B Testing — Production Impact**

A/B testing measures the real-world impact of agent changes on user behavior: task completion rate, user acceptance rate (do users keep the agent's output or revert it), time saved, and user satisfaction. This is the most expensive eval level but provides the highest-signal feedback.

Implementation requirements:
- Traffic splitting infrastructure (feature flags or randomized routing)
- Sufficient traffic volume (minimum 100 tasks per variant for statistical power)
- Clear primary metric (choose one: completion rate, acceptance rate, or time-to-completion)
- Duration: 1–2 weeks minimum for stable estimates

Cost: variable (depends on traffic and infrastructure). Time: days to weeks. Run: for major changes only (new models, new tool configurations, architectural changes).

### 9.2 Building Eval Datasets from Production Failures

The most valuable eval cases come from production failures. Every time your agent fails in production, that failure becomes a new eval case. Here is the concrete process:

```
FAILURE → EVAL PIPELINE
━━━━━━━━━━━━━━━━━━━━━━━

1. DETECT: User rejects agent output, agent errors out, or monitoring
   detects anomaly (high token usage, excessive retries, timeout)

2. CAPTURE: Record the full context:
   - Task description (what the user asked for)
   - Agent trajectory (complete event log)
   - Final output (what the agent produced)
   - Failure signal (user rejection, error message, monitoring alert)

3. CLASSIFY: Categorize the failure:
   - WRONG_ANSWER:  Agent completed task but output was incorrect
   - INCOMPLETE:    Agent partially completed the task
   - STUCK:         Agent entered a loop or couldn't make progress
   - CRASH:         Agent hit an error and stopped
   - SLOW:          Agent completed but took >3x expected time/tokens
   - UNSAFE:        Agent took a risky or harmful action

4. EXTRACT EVAL CASE:
   {
     "id": "eval-2026-03-14-001",
     "source": "production_failure",
     "task": "<original task description>",
     "expected_behavior": "<what the agent should have done>",
     "failure_category": "WRONG_ANSWER",
     "difficulty": "medium",
     "tags": ["multi-file-edit", "python", "testing"],
     "reference_solution": "<correct solution, added by human review>",
     "created": "2026-03-14",
     "regression_for": ["v1.2.3"]  # which version failed
   }

5. ADD TO EVAL SUITE: Append to the eval dataset.
   Rerun the full eval suite to verify the new case fails on the
   current system and passes on the fixed system.
```

**Dataset composition targets.** Start with 50–100 cases distributed as follows:

| Category | Target % | Purpose |
|---|---|---|
| Happy path (known-good tasks) | 40% | Regression detection |
| Edge cases (tricky but valid) | 25% | Capability frontier |
| Production failures | 25% | Real-world failure modes |
| Adversarial inputs | 10% | Safety and robustness |

**The failure-to-eval conversion rate is your quality multiplier.** Teams that convert >80% of production failures into eval cases improve 2–3x faster than teams that don't, because every failure permanently inoculates the system against that class of error.

### 9.3 The Eval-Driven Development Cycle

Eval-driven development (EDD) is the agent equivalent of test-driven development. The cycle:

```
┌──────────────────────────────────────────────────┐
│  1. COLLECT: Gather 5-10 new eval cases          │
│     Sources: production failures, user reports,  │
│     edge cases discovered during development     │
│                                                  │
│  2. EVALUATE: Run full eval suite on current     │
│     system. Record baseline scores.              │
│     Time: 15-60 minutes for 100-case suite       │
│                                                  │
│  3. SHIP: Make changes that pass evals.          │
│     Only merge PRs that don't regress on any     │
│     existing eval case.                          │
│                                                  │
│  4. MONITOR: Track production metrics for 1 week │
│     Watch: completion rate, acceptance rate,      │
│     error rate, p95 latency, cost per task       │
│                                                  │
│  5. FAILURES → EVALS: Convert new production     │
│     failures into eval cases.                    │
│                                                  │
│  → Repeat weekly                                 │
└──────────────────────────────────────────────────┘
```

The cadence is weekly. Each Monday: run evals, review production failures from the past week, convert failures to eval cases, plan improvements. Each Friday: run evals again to measure the week's progress. This cadence is sustainable for a team of 2–4 engineers and produces measurable improvement every week.

**Eval suite growth rate.** A healthy eval suite grows by 5–15 cases per week. Below 5 means you are not capturing enough failures. Above 15 means your eval suite will become too slow to run frequently — implement prioritization (run the full suite weekly, a fast subset on every PR).

### 9.4 pass@k vs. pass^k: The Math of Reliability

These two metrics look similar but measure fundamentally different things. Confusing them leads to dangerous overconfidence.

**pass@k** (pass-at-k): the probability that *at least one* of k independent attempts succeeds. This measures the system's *capability ceiling* — can it solve the problem if given enough tries?

```
pass@k = 1 - (1 - p)^k

where p = pass@1 (single-attempt success probability)

Example:
  pass@1 = 0.75 (75% single-attempt success)
  pass@3 = 1 - (1 - 0.75)^3 = 1 - 0.015625 = 98.4%
  pass@5 = 1 - (1 - 0.75)^5 = 1 - 0.000977 = 99.9%

This looks great! 75% becomes 98.4% with just 3 tries.
```

**pass^k** (pass-to-the-k): the probability that *all k* consecutive attempts succeed. This measures the system's *reliability* — can it solve problems consistently without failure?

```
pass^k = p^k

Example:
  pass@1 = 0.75 (75% single-attempt success)
  pass^3 = 0.75^3 = 42.2%
  pass^5 = 0.75^5 = 23.7%
  pass^10 = 0.75^10 = 5.6%

This looks terrible. 75% becomes 42.2% over just 3 tasks.
```

**Choose the metric that matches your reliability requirement:**

| Use case | Right metric | Reasoning |
|---|---|---|
| One-shot coding task (user reviews output) | pass@1 | User sees one attempt |
| Agent with retry loop (tries up to 3 times) | pass@3 | At least one attempt must work |
| CI pipeline (must work every time) | pass^k | Failure on any run blocks the pipeline |
| Multi-step task (10 sequential steps) | pass^10 | Every step must succeed |
| Nightly batch job (runs 100 tasks) | pass^100 | Every task must succeed for the batch |

The stark difference between pass@k and pass^k is why a 75% pass@1 rate feels "pretty good" in demos but fails catastrophically in production pipelines. For a 10-step agentic workflow where each step has 75% reliability:

```
P(all 10 steps succeed) = 0.75^10 = 5.6%

The workflow fails 94.4% of the time.

To get 90% end-to-end reliability over 10 steps:
  Required per-step reliability: 0.90^(1/10) is wrong.
  Actually: p^10 ≥ 0.90 → p ≥ 0.90^(1/10) = 0.9895

  You need 98.95% per-step reliability for 90% end-to-end.
```

This is the reliability math that every agent practitioner should internalize. It is why reliability engineering (retries, fallbacks, checkpointing, human escalation) is not optional for production agents — it is the difference between a 5.6% success rate and a usable system.

### 9.5 CI/CD Integration: Evals in Your Pipeline

Here is a production GitHub Actions workflow that runs your eval suite on every PR and blocks merge on regression:

```yaml
# .github/workflows/agent-evals.yml

name: Agent Evaluation Suite

on:
  pull_request:
    branches: [main]
    paths:
      - 'agent/**'
      - 'prompts/**'
      - 'tools/**'
      - 'evals/**'

env:
  OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
  ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}

jobs:
  unit-evals:
    name: Level 1 - Unit Evals
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
      - run: pip install -r requirements-test.txt
      - run: pytest tests/ -x --tb=short -q
        timeout-minutes: 5

  llm-judge-evals:
    name: Level 2 - LLM-as-Judge
    runs-on: ubuntu-latest
    needs: unit-evals
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
      - run: pip install -r requirements-test.txt

      - name: Run LLM judge on sample tasks
        run: |
          python evals/run_llm_judge.py \
            --dataset evals/datasets/core_50.jsonl \
            --model gpt-4o \
            --output results/llm_judge_${{ github.sha }}.json \
            --parallel 10
        timeout-minutes: 15

      - name: Check for regressions
        run: |
          python evals/check_regression.py \
            --current results/llm_judge_${{ github.sha }}.json \
            --baseline results/llm_judge_baseline.json \
            --threshold 0.02 \
            --fail-on-regression
        # Fails if any dimension drops more than 0.02 (on 1-5 scale)

      - name: Post results to PR
        if: always()
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const results = JSON.parse(
              fs.readFileSync('results/llm_judge_${{ github.sha }}.json')
            );
            const body = `## Agent Eval Results

            | Dimension | Score | Baseline | Delta |
            |---|---|---|---|
            | Correctness | ${results.correctness.toFixed(2)} | ${results.baseline_correctness.toFixed(2)} | ${(results.correctness - results.baseline_correctness).toFixed(2)} |
            | Completeness | ${results.completeness.toFixed(2)} | ${results.baseline_completeness.toFixed(2)} | ${(results.completeness - results.baseline_completeness).toFixed(2)} |
            | Quality | ${results.quality.toFixed(2)} | ${results.baseline_quality.toFixed(2)} | ${(results.quality - results.baseline_quality).toFixed(2)} |

            **${results.regressions === 0 ? '✅ No regressions' : '❌ ' + results.regressions + ' regressions detected'}**
            `;
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: body
            });

  trajectory-evals:
    name: Level 3 - Trajectory Evals (Weekly)
    runs-on: ubuntu-latest
    if: github.event.pull_request.labels.*.name == 'run-trajectory-evals'
    needs: unit-evals
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
      - run: pip install -r requirements-test.txt

      - name: Run trajectory evaluation
        run: |
          python evals/run_trajectory_eval.py \
            --dataset evals/datasets/trajectory_25.jsonl \
            --output results/trajectory_${{ github.sha }}.json \
            --max-steps 50 \
            --timeout 300
        timeout-minutes: 60

      - name: Analyze trajectories
        run: |
          python evals/analyze_trajectories.py \
            --results results/trajectory_${{ github.sha }}.json \
            --report results/trajectory_report.md

      - uses: actions/upload-artifact@v4
        with:
          name: trajectory-report
          path: results/trajectory_report.md
```

The key design decisions in this workflow:

1. **Level 1 runs on every PR.** It is fast (< 5 minutes) and free. No reason not to run it.
2. **Level 2 runs on every PR that touches agent code.** It costs $0.50–$5.00 per run (50 evals × $0.01–$0.10 each) and takes 5–15 minutes. The regression check blocks merge if any quality dimension drops by more than 0.02 on a 1–5 scale.
3. **Level 3 runs only when explicitly requested** (via a PR label). It costs $1.25–$12.50 per run and takes 30–60 minutes. Used for significant changes only.
4. **Results are posted as PR comments** so reviewers see the eval impact alongside the code diff. This is critical for adoption — if eval results are buried in CI logs, nobody looks at them.

The `check_regression.py` script implements a simple but effective regression check:

```python
# evals/check_regression.py

import json
import sys
import argparse

def check_regression(current_path, baseline_path, threshold):
    with open(current_path) as f:
        current = json.load(f)
    with open(baseline_path) as f:
        baseline = json.load(f)

    regressions = []
    for dimension in ["correctness", "completeness", "quality", "safety"]:
        current_score = current.get(dimension, 0)
        baseline_score = baseline.get(dimension, 0)
        delta = current_score - baseline_score

        if delta < -threshold:
            regressions.append({
                "dimension": dimension,
                "current": current_score,
                "baseline": baseline_score,
                "delta": delta,
            })

    if regressions:
        print(f"❌ {len(regressions)} regression(s) detected:")
        for r in regressions:
            print(f"  {r['dimension']}: {r['baseline']:.3f} → {r['current']:.3f} "
                  f"(Δ={r['delta']:+.3f}, threshold={-threshold})")
        sys.exit(1)
    else:
        print("✅ No regressions detected.")
        sys.exit(0)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--current", required=True)
    parser.add_argument("--baseline", required=True)
    parser.add_argument("--threshold", type=float, default=0.02)
    parser.add_argument("--fail-on-regression", action="store_true")
    args = parser.parse_args()
    check_regression(args.current, args.baseline, args.threshold)
```

### 9.6 Real Benchmark Numbers (March 2026)

Here are the state-of-the-art results on major agent benchmarks as of March 2026, with the specific systems and configurations that achieved them:

| Benchmark | Top Score | System | Second Place | Key Detail |
|---|---|---|---|---|
| SWE-bench Verified | **80.9%** | Claude Opus 4.5 + scaffold | 72.4% (OpenHands + Sonnet 4.5) | Near saturation; remaining 19% are ambiguous specs or deep domain tasks |
| GAIA (overall) | **74.6%** | HAL + Claude Sonnet 4.5 | ~65% (AutoGPT variants) | Level 3 still at 58.4%; multi-step reasoning remains hard |
| WebArena | **71.6%** | OpAgent (Qwen3-VL + RL) | ~60% (Claude-based agents) | RL-trained vision model beats prompt-based by 10+ points |
| TAU-bench (telecom) | **99.3%** | Claude Opus 4.6 | 97.1% (Sonnet 4.5) | Effectively solved; 0.7% residual is policy edge cases |
| TAU-bench (retail) | **91.9%** | Claude Opus 4.6 | 88.4% (Sonnet 4.5) | Harder due to complex product catalogs |
| OSWorld | **~38%** | Best reported | — | Active frontier; vast action space, long horizons |
| BLADE | **~45%** | Best reported | — | Active frontier; requires statistical reasoning + code gen |

**Saturation analysis.** A benchmark is "saturated" when the marginal cost of the next percentage point exceeds the practical value of that improvement. By this definition:

- **Saturated:** TAU-bench telecom (99.3% — the remaining 0.7% are ambiguous edge cases that humans also disagree on), MATH-500 (97.3% — near-perfect)
- **Near-saturated:** SWE-bench Verified (80.9% — top systems are within 5% of each other, remaining instances require qualitatively different capabilities)
- **Active frontier:** GAIA Level 3 (58.4%), WebArena (71.6%), OSWorld (~38%), BLADE (~45%)
- **Far from solved:** OSWorld (~38% — requires pixel-level OS interaction over 50+ steps), Sokoban (54.3% for best runtime-evolving agent)

**Why TAU-bench and OSWorld are the active frontiers:**

TAU-bench retail (91.9%) represents the frontier of structured decision-making under complex policies. The remaining 8.1% error rate comes from cases where business rules interact in non-obvious ways — for example, a return policy that depends on both the product category AND the customer's membership tier AND the time since purchase. These three-way interactions are where current models still make errors.

OSWorld (~38%) represents the frontier of grounded, multi-modal agent interaction. The agent must interpret screenshots, plan sequences of mouse clicks and keyboard actions, and maintain a mental model of application state across dozens of actions. The 38% success rate means the agent fails on nearly two-thirds of OS tasks. The hardest tasks involve multi-application workflows (copy data from a spreadsheet, paste into an email, format it, send to a specific recipient) where the agent must coordinate between applications and recover from UI state changes.

**SWE-bench's near-saturation does not mean coding agents are solved.** It means the specific task distribution in SWE-bench Verified (GitHub issues with test suites from popular Python repositories) is well-addressed by current systems. Real software engineering involves:
- Writing code without a test suite to validate against (SWE-bench always provides tests)
- Understanding requirements from natural language descriptions that are ambiguous (SWE-bench issues are curated for clarity)
- Making architectural decisions that affect long-term maintainability (SWE-bench evaluates only immediate correctness)
- Working across multiple PRs on a single feature over days (SWE-bench tasks are independent)

The gap between "80.9% on SWE-bench" and "production-ready autonomous software engineer" is approximately the gap between "passes the driving written test" and "handles rush-hour traffic in an unfamiliar city in the rain." The test measures a necessary but insufficient subset of the full skill.

### 9.7 Building the Eval Dataset: From 0 to 500

Here is the concrete process for building an eval dataset from scratch:

**Week 1–2: Seed with 50 cases.** Pull from three sources:

```
Source 1: PRODUCTION LOGS (20 cases)
───────────────────────────────────────
Query your production logs for:
- Tasks where the user rejected the agent's output (user_accepted = false)
- Tasks that hit the retry limit (retry_count >= max_retries)
- Tasks that exceeded the token budget (tokens_used > 2 * median_tokens)

For each, create an eval case with the original task and the expected
correct behavior (determined by human review).

Source 2: HAPPY PATH (20 cases)
───────────────────────────────
Select 20 representative tasks that your agent handles well today.
These are regression detectors — if a change breaks these, you know
you've regressed on core functionality.

Distribution:
- 8 easy tasks (single-file edits, simple queries)
- 8 medium tasks (multi-file edits, reasoning required)
- 4 hard tasks (complex workflows, multi-step reasoning)

Source 3: ADVERSARIAL (10 cases)
─────────────────────────────────
Manually construct cases that test known weaknesses:
- Ambiguous instructions that require clarification
- Tasks that are impossible (the agent should say so, not hallucinate)
- Tasks with red herrings (irrelevant context that might mislead)
- Tasks that require the agent to push back on unsafe requests
```

**Week 3–8: Grow to 200 cases.** Add 25–30 cases per week from production failures. Every time the agent fails in production, the failure becomes an eval case. This is the most important pipeline to build.

**Week 9+: Maintain at 200–500 cases.** Prune cases that have been passing consistently for 3+ months (they are no longer probing the frontier). Add new cases as new failure modes are discovered. The eval suite should be a living document that evolves with the system.

**Eval case format:**

```jsonl
{"id": "eval-001", "task": "Fix the TypeError in src/api/handlers.py line 42", "context": {"repo": "acme-api", "branch": "main", "commit": "abc1234"}, "expected": {"files_modified": ["src/api/handlers.py"], "test_command": "pytest tests/test_handlers.py", "test_must_pass": true}, "category": "bug_fix", "difficulty": "easy", "tags": ["python", "single-file", "type-error"]}
{"id": "eval-002", "task": "Add pagination to the /api/v1/users endpoint", "context": {"repo": "acme-api", "branch": "main", "commit": "abc1234"}, "expected": {"files_modified": ["src/api/handlers.py", "src/api/schemas.py", "tests/test_handlers.py"], "test_command": "pytest tests/test_handlers.py::test_users_pagination", "test_must_pass": true, "response_must_include": ["limit", "offset", "total_count"]}, "category": "feature", "difficulty": "medium", "tags": ["python", "multi-file", "api-design"]}
```

### 9.8 Eval Anti-Patterns

These are the mistakes that teams make repeatedly when building eval systems. Learn from them:

**Anti-pattern 1: "Eval theater" — running evals for show, not for signal.** The eval suite passes 95% of cases, but the cases are too easy or too similar. The pass rate looks good in reports but the agent still fails 30% of real production tasks. Fix: ensure your eval suite has the same difficulty distribution as production (not easier).

**Anti-pattern 2: "Golden answers" — treating one correct solution as the only correct solution.** Many tasks have multiple valid approaches. An eval that checks for exact match against a reference solution will reject valid alternatives. Fix: use LLM-as-Judge for correctness rather than string matching, or provide multiple acceptable references.

**Anti-pattern 3: "Eval rot" — not updating the eval suite.** The agent improves, but the eval suite stays the same. After 6 months, every case passes, the eval provides no signal, and teams stop running it. Fix: retire cases that have passed for 3+ months and continuously add new cases from production failures.

**Anti-pattern 4: "Benchmark worship" — optimizing for public benchmarks at the expense of production performance.** A prompt change that boosts SWE-bench Verified by 2% might degrade your specific production tasks by 5%. Fix: always measure production impact alongside benchmark scores. If they diverge, trust production metrics.

**Anti-pattern 5: "Eval without attribution" — knowing that the agent regressed but not knowing why.** The eval suite reports a 3% drop but the diff is 2,000 lines. Fix: run evals on small, focused diffs. If a PR touches multiple components, test each component separately.

---

*Part III has provided concrete implementations for the three pillars of agent evolution: memory systems that accumulate and leverage experience (Chapter 7), reinforcement learning algorithms that improve capabilities through training and runtime adaptation (Chapter 8), and evaluation frameworks that measure whether improvements are real (Chapter 9). Part IV addresses the operational realities of deploying these systems at scale — reliability engineering, cost optimization, safety, and the organizational patterns that enable teams to build and maintain production agent systems.*
