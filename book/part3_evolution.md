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

### 7.7 Hermes Agent: The Closed-Loop Learning System

Hermes Agent (Nous Research, February 2026, MIT license, 99K+ GitHub stars) is the most complete implementation of an agent that autonomously creates, updates, and retrieves its own skill documents. It solves the key problem that all other memory systems handle only passively: Hermes *actively generates reusable knowledge* from successful task completions.

#### Three-Layer Memory Architecture

```
┌─────────────────────────────────────────────────────┐
│                  HERMES MEMORY                       │
├─────────────────────────────────────────────────────┤
│ Layer 1: Working Context (standard context window)   │
│   - Current conversation, tool outputs, reasoning    │
│   - Size: model context limit (128K-200K tokens)     │
│                                                      │
│ Layer 2: Skill Documents (~/.hermes/skills/)         │
│   - SKILL.md files following agentskills.io standard │
│   - Created autonomously after successful tasks      │
│   - Searched via FTS5 full-text search + LLM summary │
│   - Progressive disclosure: metadata → full content  │
│     Level 0: skills_list() → name+desc (~3K tokens)  │
│     Level 1: skill_view(name) → full instructions    │
│     Level 2: skill_view(name, path) → references     │
│                                                      │
│ Layer 3: Persistent Facts (Honcho integration)       │
│   - Dialectical user modeling via 12-identity layers │
│   - User preferences, communication style, habits    │
│   - Two-layer context injection:                     │
│     Base layer: session summary + user representation │
│     Dialectic: LLM-synthesized reasoning about user  │
│   - Config: contextCadence, dialecticCadence,        │
│            dialecticDepth (1-3 passes)               │
└─────────────────────────────────────────────────────┘
```

#### The Autonomous Skill Creation Loop

This is the critical differentiator. Hermes doesn't wait for the user to tell it to create a skill — it does so proactively:

```
┌────────────────────────────────────────────────────────────┐
│           HERMES CLOSED-LOOP LEARNING                      │
│                                                            │
│  1. TASK EXECUTION                                         │
│     Agent runs task using tools, code, browsing            │
│                    │                                       │
│                    ▼                                       │
│  2. SELF-EVALUATION CHECKPOINT (every 15 tool calls)       │
│     "Was this worth capturing?"                            │
│     Triggers on:                                           │
│       - 5+ tool calls in a sequence                        │
│       - Error recovery (agent fixed its own mistake)       │
│       - User corrections ("no, do it this way")            │
│       - Non-obvious workflow (novel approach discovered)   │
│                    │                                       │
│                    ▼                                       │
│  3. SKILL CREATION OR UPDATE                               │
│     Writes/patches SKILL.md following agentskills.io spec  │
│     Captures: procedure, pitfalls, verification steps      │
│     Can patch mid-session via skill_manage tool             │
│                    │                                       │
│                    ▼                                       │
│  4. MEMORY UPDATE                                          │
│     Key facts → MEMORY.md (persistent across sessions)     │
│     User patterns → USER.md (via Honcho dialectic)         │
│     Corrections → skill patches (immediate)                │
└────────────────────────────────────────────────────────────┘
```

**Concrete result**: after 20-30 complex tasks over a month of regular use, tasks that initially required 25 tool calls drop to 8-10 calls. The agent has internalized the user's workflows.

#### SKILL.md Format — The agentskills.io Open Standard

Every auto-generated skill follows this structure:

```yaml
---
name: deploy-staging
description: Deploy the application to staging environment via GitHub Actions
version: 1.0.0
author: hermes-auto
license: MIT
platforms: [linux, macos]
metadata:
  hermes:
    tags: [DevOps, Deployment]
    related_skills: [docker-compose-management]
    requires_toolsets: [shell]
    requires_tools: [shell_exec, read_file]
    config:
      - key: deploy.staging_branch
        description: "Branch to deploy from"
        default: "staging"
        prompt: "Which branch deploys to staging?"
required_environment_variables:
  - name: GITHUB_TOKEN
    prompt: "Enter your GitHub token for Actions API"
---

# Deploy to Staging

## When to Use
User asks to deploy, push to staging, or update staging environment.

## Quick Reference
```bash
gh workflow run deploy-staging.yml --ref staging
gh run list --workflow=deploy-staging.yml --limit=1 --json status
```

## Procedure
1. Verify current branch is clean: `git status --porcelain`
2. If dirty, stash changes: `git stash push -m "pre-deploy stash"`
3. Trigger deployment: `gh workflow run deploy-staging.yml --ref staging`
4. Wait for completion: poll `gh run list` every 30s, max 10 minutes
5. Verify deployment: `curl -s https://staging.example.com/health`
6. If stashed, restore: `git stash pop`

## Pitfalls
- **Dirty working tree**: Always stash before deploy. Forgetting this caused
  failed deploys on 2026-03-15.
- **Rate limiting**: GitHub Actions API rate-limits at 1,000 requests/hour.
  The polling loop must use 30s intervals, not 5s.
- **Health check timing**: Staging takes 45-90s to become healthy after
  workflow completion. First health check should wait 60s.

## Verification
- Health endpoint returns 200 with `{"status": "ok"}`
- `gh run list` shows latest run with status "completed" and conclusion "success"
```

**The key design insight**: if a skill doesn't trigger, the problem is almost never the instructions — it's the `name` and `description` in the frontmatter. That's what the agent uses to decide whether to load the skill. Progressive disclosure means only ~100 tokens per skill are loaded initially (name + description), so discovery is cheap even with hundreds of skills.

#### Hermes Atropos RL Pipeline — Research-Grade Training Infrastructure

Hermes uniquely integrates an RL training pipeline directly into the agent framework:

```
┌──────────────────────────────────────────────────────┐
│              ATROPOS RL PIPELINE                      │
│                                                      │
│  1. TRAJECTORY COLLECTION                            │
│     Every session auto-generates structured data:    │
│     - User message, tool calls, tool results,        │
│       assistant responses, timestamps                │
│     - Stored in SQLite with compression              │
│     - Batch mode: headless parallel workers           │
│       with checkpointing for large-scale collection  │
│                                                      │
│  2. TRAINING MODES                                   │
│     RLHF: trajectories → human rating → reward       │
│           model → PPO policy optimization            │
│     DPO:  preferred/rejected trajectory pairs →       │
│           direct preference optimization (offline)   │
│     GRPO: group sampling → relative advantage →       │
│           no value network needed                    │
│                                                      │
│  3. EXPORT                                           │
│     ShareGPT format for fine-tuning any model        │
│     Works with: local (Ollama/vLLM), cloud APIs      │
│                                                      │
│  4. ENVIRONMENT FRAMEWORK                            │
│     Three-layer: BaseEnv (Atropos) →                 │
│       HermesAgentBaseEnv → Concrete task envs        │
│     Enables: standardized benchmarks, SFT data gen,  │
│       RL training on multi-turn agentic tasks        │
└──────────────────────────────────────────────────────┘
```

This makes Hermes not just an agent, but a **research platform for training tool-calling models**. Teams can collect trajectories from real usage, then use those trajectories to fine-tune smaller models for specific workflows — closing the loop between deployment and training.

#### Deployment Reality

Hermes runs on six terminal backends:

| Backend | Use Case | Cost |
|---------|----------|------|
| Local | Development, personal use | Free (your hardware) |
| Docker | Isolated deployment | Free (your hardware) |
| SSH | Remote server | $5+ VPS |
| Daytona | Serverless with hibernation | Pay-per-use |
| Modal | GPU tasks, batch RL | Pay-per-use |
| Singularity | HPC/academic clusters | Institutional |

A single gateway process connects to Telegram, Discord, Slack, WhatsApp, Signal, Matrix, iMessage, WeChat, and CLI. Model-agnostic: works with 200+ models via Nous Portal, OpenRouter, OpenAI, Anthropic, and custom endpoints.

### 7.8 Self-Evolving Skills: The SkillHub and ClawHub Ecosystem

The most radical experiment in agent self-improvement is happening in the open-source skills ecosystem around OpenClaw, ClawHub, and SkillHub. These platforms implement a pattern where agents don't just use pre-built skills — they **autonomously create, test, and share self-improvement capabilities**.

#### The Self-Improving Agent Skill — The Most Downloaded Evolution Mechanism

The `self-improving-agent` skill (1,100+ stars, 90,000+ downloads on ClawHub within 2 months of release) implements a structured self-evolution cycle:

```
┌────────────────────────────────────────────────────────────┐
│         SELF-EVOLVING AGENT CYCLE                          │
│                                                            │
│  1. PERCEIVE GAP                                           │
│     Detection signals:                                     │
│     - Task failures and incomplete requests                │
│     - Repeated patterns (same request failing 3+ times)    │
│     - User feedback and explicit corrections               │
│     - Efficiency metrics (tasks taking >2x expected time)  │
│                    │                                       │
│                    ▼                                       │
│  2. SEARCH SOLUTIONS                                       │
│     - Scan engineering blogs, GitHub trending               │
│     - Query SkillHub/ClawHub for relevant skills           │
│     - Check AGENTS.md and TOOLS.md for existing knowledge  │
│                    │                                       │
│                    ▼                                       │
│  3. DESIGN EXPERIMENT                                      │
│     - Formulate hypothesis: "If I change X, metric Y       │
│       should improve by Z%"                                │
│     - Create test case from the failure that triggered gap │
│                    │                                       │
│                    ▼                                       │
│  4. RUN EXPERIMENT                                         │
│     - Execute the proposed improvement                     │
│     - Measure before/after on the test case                │
│                    │                                       │
│                    ▼                                       │
│  5. SELECT WINNER                                          │
│     - Compare old vs new approach on metrics               │
│     - If improvement > threshold, proceed to solidify      │
│     - If not, log failure and try alternative              │
│                    │                                       │
│                    ▼                                       │
│  6. SOLIDIFY                                               │
│     - Promote learning to permanent workspace files:       │
│       Workflow improvements → AGENTS.md                    │
│       Tool gotchas → TOOLS.md                              │
│       Behavioral patterns → SOUL.md                        │
│       Broadly applicable → CLAUDE.md /                     │
│         .github/copilot-instructions.md                    │
│     - Changes persist across ALL future sessions           │
│                    │                                       │
│                    ▼                                       │
│  7. NEXT ITERATION (repeat)                                │
└────────────────────────────────────────────────────────────┘
```

#### The Solidification Mechanism — Where Learnings Become Permanent

The four-component promotion system is the key engineering contribution:

```
Component 1: CAPTURE
─────────────────────
.learnings/
├── LEARNINGS.md      # Insights from successful tasks
├── ERRORS.md         # Catalogued failure modes with fixes
└── FEATURE_REQUESTS.md  # Capability gaps identified

Component 2: PROMOTION TARGETS
──────────────────────────────
Workflow improvements    → AGENTS.md    (loaded every session)
Tool-specific gotchas    → TOOLS.md     (loaded when tool is used)
Behavioral patterns      → SOUL.md      (identity-level changes)
Universal learnings      → CLAUDE.md    (system-level context)
                         → .github/copilot-instructions.md

Component 3: PERSISTENCE
─────────────────────────
Once promoted, learnings are injected into every subsequent
session via the standard CLAUDE.md / AGENTS.md loading mechanism.
No model retraining needed. The agent's behavior changes because
its context changes.

Component 4: AUTOMATED REVIEW
──────────────────────────────
Heartbeat-driven promotion: a cron job runs the promotion
process, scanning .learnings/ for items that have accumulated
enough related issues to warrant promotion. This closes the
loop without human intervention.
```

**Practical example**: A research agent runs on cron at 8:30 AM weekdays. It scans engineering blogs and GitHub trending, compares findings against its AGENTS.md, TOOLS.md, and LESSONS.md files, logs results to a structured JSON experiment tracking file, and promotes verified improvements.

#### SkillHub.cn — The Chinese AI Skills Community

SkillHub (skillhub.cn / skillhub.mobi) is Tencent's localized AI skills platform for the Chinese OpenClaw ecosystem:

| Metric | Value |
|--------|-------|
| Total skills available | 13,000+ (mirrored from ClawHub) |
| Curated Top 50 | Safety-audited, professionally selected |
| Language | Full Chinese interface with optimized search |
| Categories | 8 major skill categories |
| Infrastructure | Tencent Cloud acceleration nodes |
| Cost | Free |

**Most downloaded skills (as of Q1 2026):**

| Rank | Skill | Downloads | Category |
|------|-------|-----------|----------|
| 1 | Xiaohongshu Automation | 59K | Social Media |
| 2 | GitHub Collaboration | 48K | Development |
| 3 | Summarize (PDF/video/web) | 44K | Productivity |
| 4 | Tavily Web Search | 39K | Research |
| 5 | HaS Anonymizer | 31K | Privacy |
| 6 | Tencent Docs Skill | 27K | Office |

The installation is one-line:
```bash
# Install from SkillHub (with Tencent Cloud acceleration)
npx skillhub install summarize

# Install from ClawHub directly
npx agent-skills-hub install self-improving-agent
```

#### Security Concerns with Self-Evolving Skills

Both ClawHub and SkillHub flag self-evolution skills as **suspicious** due to their broad permissions:

- Execute arbitrary shell commands
- Modify agent configuration files (CLAUDE.md, AGENTS.md, SOUL.md)
- Access system files and environment variables
- Make network requests to arbitrary endpoints
- Modify their own skill definitions

The `self-evolve-agent` skill on ClawHub carries an explicit security warning. The risk is real: a compromised or malicious self-evolving skill could gradually modify an agent's behavior in ways that are difficult to detect because the changes are "legitimate" — they look like normal learning.

**Mitigation patterns**:
1. Run self-evolving agents in sandboxed containers (NanoClaw's approach)
2. Git-track all config files so changes are auditable via `git diff`
3. Require human approval for promotions to SOUL.md and CLAUDE.md
4. Rate-limit the promotion mechanism (max 3 promotions/day)
5. Maintain a "constitution" file that self-evolution cannot modify

#### The Hermes vs OpenClaw/SkillHub Approach: A Comparison

| Dimension | Hermes Agent | OpenClaw + SkillHub |
|-----------|-------------|-------------------|
| Skill creation | Autonomous (agent writes SKILL.md after tasks) | Community-driven (humans write, agent installs) |
| Self-improvement | Built-in via Atropos RL + skill patches | Via self-improving-agent skill (optional add-on) |
| Skill format | agentskills.io standard (YAML frontmatter + MD) | Same standard (interoperable) |
| Discovery | FTS5 search + LLM summary (progressive disclosure) | ClawHub/SkillHub marketplace search |
| Training | RLHF/DPO/GRPO via Atropos pipeline | No built-in training (relies on skill-level improvements) |
| User modeling | Honcho 12-identity dialectical modeling | Simple MEMORY.md + daily notes |
| Security model | Per-skill permissions, platform-enforced | Community flagging, user responsibility |
| Scale | 99K+ GitHub stars | 350K+ stars (OpenClaw) + 13K+ skills |

The key takeaway: **Hermes represents the "agent creates its own skills" paradigm, while OpenClaw/SkillHub represents the "community creates skills, agent evolves via curated ecosystem" paradigm**. Both are valid. Hermes is better for power users who want deep personalization. OpenClaw/SkillHub is better for breadth of capability via community network effects.

---

## Chapter 8: Training Agents to Improve — RL in Practice

This chapter presents the complete mathematical formulations, algorithms, hyperparameters, and ablation results for the reinforcement learning methods that define the 2025–2026 generation of agent training. Every equation is reproduced from the original papers with full notation. The goal is not to summarize these algorithms but to provide the level of detail needed to reimplement them.

### 8.1 GRPO — The Full Algorithm from DeepSeek-R1

**Reference:** Guo et al., "DeepSeek-R1: Incentivizing Reasoning Capability in LLMs via Reinforcement Learning," arXiv:2501.12948, January 2025.

Group Relative Policy Optimization (GRPO) is the RL algorithm that powered DeepSeek-R1. Its defining contribution is the elimination of the value network (critic) from the PPO pipeline. In standard PPO for language models, the critic is a separate neural network — typically the same size as the policy — that estimates the expected future reward from each token position. Training this critic is expensive (doubles GPU memory), unstable (the critic can diverge, poisoning the policy gradient), and slow (the critic must be warmed up before the policy can train effectively). GRPO replaces the critic entirely with a statistical normalization over a group of sampled outputs. This section presents the complete algorithm as described in the paper, with every equation, every hyperparameter, and every design choice.

#### 8.1.1 Problem Setup

Let π_θ denote the language model policy parameterized by θ (the model being trained). Let π_ref denote the reference policy — a frozen copy of the model's weights at the start of RL training (or after the SFT warm-start phase). Let π_θ_old denote the policy snapshot from the beginning of the current training iteration (updated once per iteration, not once per gradient step — this is the standard PPO convention). Let D denote the training dataset of prompts. Let R(q, o) denote the reward function that scores a complete output o given prompt q.

The goal is to find parameters θ that maximize the expected reward while staying close to the reference policy:

```
maximize  E_{q ~ D} [ E_{o ~ π_θ(·|q)} [ R(q, o) ] ]
  θ
subject to:  D_KL(π_θ || π_ref)  is small
```

The KL constraint prevents the policy from collapsing to a degenerate distribution that exploits spurious reward signals — the well-known reward hacking problem.

#### 8.1.2 Group Sampling

For each prompt q in a training batch, GRPO samples a group of G complete outputs from the current policy snapshot:

```
{o_1, o_2, ..., o_G} ~ π_θ_old(·|q)
```

Each output o_i is a sequence of tokens: o_i = (o_{i,1}, o_{i,2}, ..., o_{i,|o_i|}), where |o_i| is the length of output i. The outputs are generated autoregressively using the standard LLM sampling procedure (typically with temperature T=1.0 during RL training, though DeepSeek-R1 uses T=0.6 for the early cold-start phase).

**Hyperparameter: Group size G.** The DeepSeek-R1 paper reports G=64 for the main training runs. However, subsequent reproduction efforts and the open-source community have established the following empirical guidance:

| Group Size G | Best For | Advantage Quality | GPU Memory | Throughput |
|---|---|---|---|---|
| 8 | Quick prototyping, large models | Noisy; high variance | Minimal | Fastest |
| 16 | Binary reward tasks (pass/fail) | Adequate for coarse signals | Moderate | Good |
| 32 | General-purpose training | Good balance | Significant | Moderate |
| 64 | Complex reward landscapes | High quality; stable gradients | Large | Slow |
| 128 | Diminishing returns in most settings | Marginal improvement over 64 | Very large | Very slow |

The intuition: the group-relative advantage (next section) is a z-score normalization. With G=8, the sample mean and standard deviation are noisy estimates of the true population parameters. With G=64, they are reliable estimates. With G=128, the marginal improvement in estimation quality rarely justifies the 2x compute cost over G=64.

#### 8.1.3 Advantage Computation — The Key Innovation

Each output in the group is scored by the reward function:

```
r_i = R(q, o_i)    for i = 1, 2, ..., G
```

The group-relative advantage is then computed by z-score normalization over the group:

```
         r_i  -  mean({r_1, r_2, ..., r_G})
A_i  =  ────────────────────────────────────
          std({r_1, r_2, ..., r_G})
```

Explicitly:

```
μ_group = (1/G) Σ_{i=1}^{G} r_i

σ_group = sqrt( (1/G) Σ_{i=1}^{G} (r_i - μ_group)² )

A_i = (r_i - μ_group) / σ_group
```

**Critical edge case:** If σ_group = 0 (all G outputs received the same reward), the advantage is undefined (division by zero). In practice, this prompt is skipped — it provides no gradient signal because all outputs are equally good or equally bad. This is common for very easy prompts (all G outputs are correct, all get reward 1) or very hard prompts (all G outputs are wrong, all get reward 0). The skip rate is a useful diagnostic: if more than 30% of prompts are skipped, the task difficulty is poorly matched to the model's current capability.

**Why this replaces the value network.** In standard PPO, the advantage A_t at token position t is:

```
A_t = R_t - V_φ(s_t)
```

where V_φ is a learned value function that estimates the expected future reward from state s_t. Training V_φ requires its own loss function, its own gradient computation, and its own hyperparameters (value loss coefficient, value clipping, etc.). The critic must track a moving target (the policy changes every gradient step, so the value landscape shifts).

GRPO replaces V_φ with a non-parametric estimate: the mean reward of the group. This is computationally free (a simple average over G scalars), requires no additional parameters, and is automatically calibrated to the current policy's performance level. The cost is that the advantage is computed per-output (all tokens in output o_i share the same advantage A_i) rather than per-token. This is a coarser signal, but the paper demonstrates that the group normalization provides sufficient variance reduction for stable training.

#### 8.1.4 The GRPO Objective — Exact from Paper

The GRPO objective function, as stated in Equation (2) of arXiv:2501.12948:

```
J_GRPO(θ) = E_{q ~ D, {o_i}_{i=1}^{G} ~ π_θ_old(·|q)} [

    (1/G) Σ_{i=1}^{G}  (1/|o_i|) Σ_{t=1}^{|o_i|}  min(
        ρ_{i,t} · A_i,
        clip(ρ_{i,t}, 1-ε, 1+ε) · A_i
    )

] - β · D_KL(π_θ || π_ref)
```

where the per-token importance sampling ratio is:

```
         π_θ(o_{i,t} | q, o_{i,<t})
ρ_{i,t} = ─────────────────────────────
         π_θ_old(o_{i,t} | q, o_{i,<t})
```

and o_{i,<t} denotes all tokens of output i before position t: (o_{i,1}, o_{i,2}, ..., o_{i,t-1}).

Breaking this down term by term:

**Term 1: The clipped surrogate objective.** For each output o_i, for each token position t in that output, compute the ratio ρ_{i,t} between the current policy's probability and the old policy's probability for that token in that context. Multiply by the advantage A_i. Then clip the ratio to the range [1-ε, 1+ε] and multiply by A_i again. Take the minimum of the clipped and unclipped versions. This is the standard PPO clipping mechanism that prevents destructively large policy updates.

**Term 2: The length normalization.** The inner sum over tokens is divided by |o_i|, the length of output i. This prevents longer outputs from contributing disproportionately to the gradient. Without this normalization, the model would learn to produce longer outputs to accumulate more gradient signal, regardless of quality.

**Term 3: The group average.** The outer sum over the G outputs is divided by G. Combined with the expectation over prompts, this gives the batch-level objective.

**Term 4: The KL penalty.** β · D_KL(π_θ || π_ref) penalizes the policy for diverging from the reference. This is subtracted (not added) because we are maximizing the objective.

#### 8.1.5 KL Divergence — Per-Token Formulation

The KL divergence in GRPO is computed per-token and then aggregated. The paper uses a specific approximation of the KL divergence that is computed in the reverse direction and approximated for computational efficiency:

```
D_KL(π_θ || π_ref) = E_{q ~ D, {o_i} ~ π_θ_old} [

    (1/G) Σ_{i=1}^{G}  (1/|o_i|) Σ_{t=1}^{|o_i|}  (
        π_ref(o_{i,t} | q, o_{i,<t})
        ─────────────────────────────  -  log( π_ref(o_{i,t} | q, o_{i,<t}) / π_θ(o_{i,t} | q, o_{i,<t}) )  -  1
        π_θ(o_{i,t} | q, o_{i,<t})
    )

]
```

Written more compactly for a single token at position t of output i:

```
KL_t = (π_ref_t / π_θ_t)  -  log(π_ref_t / π_θ_t)  -  1
```

where π_ref_t is shorthand for π_ref(o_{i,t} | q, o_{i,<t}) and similarly for π_θ_t.

This is the "reverse KL" or "exclusive KL" approximation. It has two useful properties: (1) KL_t ≥ 0 always (it equals zero when π_ref_t = π_θ_t), and (2) it penalizes the policy more heavily when it assigns much higher probability than the reference to a token (mode-seeking behavior) than when it assigns much lower probability (mode-covering behavior). This asymmetry is intentional: it allows the model to discover new reasoning strategies (by reducing probability on some tokens) more easily than it can exploit reward hacking (by inflating probability on specific tokens).

**Numerical stability note.** The ratio π_ref_t / π_θ_t can be extremely large if π_θ assigns near-zero probability to a token. In practice, probabilities are clamped to a minimum of 1e-8 before computing the ratio.

#### 8.1.6 Hyperparameters — Complete Table from Paper and Reproduction

| Hyperparameter | Symbol | Value in Paper | Range in Reproductions | Notes |
|---|---|---|---|---|
| Group size | G | 64 | 16–128 | 64 for DeepSeek-R1; 16 commonly used for smaller models |
| Clipping parameter | ε | 0.2 | 0.1–0.3 | Standard PPO value; 0.2 is robust |
| KL penalty coefficient | β | 0.001 | 3e-6 to 0.04 | R1-Zero uses very small β (~3e-6); R1 SFT stages use larger |
| Learning rate | lr | 1e-6 | 1e-6 to 5e-6 | Cosine schedule with warmup; peak at 1e-6 for large models |
| Batch size (prompts) | B | 1024 | 256–2048 | Total samples per iteration = B × G |
| Max output length | — | 32768 | 4096–32768 | R1 allows very long chain-of-thought |
| Training iterations | — | ~10K | 5K–20K | Until convergence on validation set |
| Warmup steps | — | 100 | 50–200 | Linear warmup for learning rate |
| Temperature (sampling) | T | 1.0 | 0.6–1.0 | T=0.6 for cold-start; T=1.0 for RL |
| AdamW weight decay | — | 0.01 | 0.01–0.1 | Standard AdamW |
| AdamW β_1, β_2 | — | 0.9, 0.95 | Standard | — |
| Gradient clipping | — | 1.0 | 0.5–1.0 | Max gradient norm |

#### 8.1.7 Reward Design — Rule-Based, No Reward Model

This is one of the most consequential design choices in the paper. DeepSeek-R1-Zero uses **no learned reward model at all**. The rewards are entirely rule-based:

**Accuracy reward R_accuracy(q, o):**

For math problems:
```
R_accuracy = 1.0   if extracted_answer(o) matches ground_truth(q)
             0.0   otherwise
```

The answer is extracted by parsing the content inside `\boxed{...}` in the model's output. If no `\boxed{}` tag is found, R_accuracy = 0.

For code problems:
```
R_accuracy = (number of test cases passed) / (total test cases)
```

This gives a fractional reward in [0, 1]. The test cases are executed in a sandboxed environment with a timeout of 10 seconds per test case.

**Format reward R_format(q, o):**

```
R_format = 0.1   if output contains <think>...</think> AND \boxed{...}
           0.0   otherwise
```

This is a small bonus (10% of the accuracy reward) that encourages the model to structure its output with explicit reasoning and a final answer. The format reward is applied only during the R1-Zero stage; later stages enforce format via SFT data.

**Total reward:**
```
R(q, o) = R_accuracy(q, o) + R_format(q, o)
```

No reward for length. No reward for "quality of reasoning." No reward for style. No learned reward model. The simplicity is the point: the model discovers that structured reasoning, self-verification, and error correction improve accuracy. These behaviors emerge because they are instrumentally useful for getting the answer right, not because they are directly rewarded.

#### 8.1.8 The Four Training Stages of Full DeepSeek-R1

The full DeepSeek-R1 (as opposed to R1-Zero) uses a four-stage training pipeline:

```
Stage 1: COLD-START SFT
━━━━━━━━━━━━━━━━━━━━━━━
Input:  DeepSeek-V3 base model
Data:   Thousands of long chain-of-thought examples
        Collected from: few-shot prompting with long CoT,
        direct prompting of DeepSeek-R1-Zero,
        human-authored reasoning traces
Method: Standard supervised fine-tuning
Output: Model with basic chain-of-thought format and reasoning style
Why:    R1-Zero produces correct answers but with poor readability —
        language mixing, no paragraphs, chaotic formatting. Cold-start
        SFT teaches the model *how* to present reasoning, not *what*
        to reason about.

Stage 2: REASONING-FOCUSED RL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Input:  Cold-start SFT model
Data:   Math, code, science, and logic prompts with verifiable answers
Method: GRPO with rule-based rewards (as described in Section 8.1.7)
Reward: Accuracy + format (rule-based only)
Output: Model with strong reasoning, but may have degraded
        general capabilities (creative writing, summarization, etc.)
Why:    RL with verifiable rewards is most effective on tasks where
        correctness can be checked automatically. This stage pushes
        reasoning to its peak, accepting temporary regression on
        non-reasoning tasks.

Stage 3: REJECTION SAMPLING + SFT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Input:  Stage 2 RL model + DeepSeek-V3 base for non-reasoning
Data:   Generated via rejection sampling from Stage 2 model:
        - Sample multiple outputs per prompt
        - Keep only those that pass verification
        - Also include general-capability data (writing, QA, etc.)
        from DeepSeek-V3 SFT datasets
Method: Standard SFT on the combined dataset (~800K samples)
Output: Model with strong reasoning AND restored general capabilities
Why:    Stage 2 degraded non-reasoning tasks due to catastrophic
        forgetting. This stage blends reasoning data (from RL model)
        with general data (from base model SFT) to recover breadth.
        Total samples: ~200K reasoning + ~600K general.

Stage 4: ALL-SCENARIO RL
━━━━━━━━━━━━━━━━━━━━━━━
Input:  Stage 3 SFT model
Data:   Diverse prompts covering reasoning AND general tasks
Method: GRPO with mixed reward signals:
        - Rule-based for math/code (same as Stage 2)
        - Learned reward model for general tasks (helpfulness,
          harmlessness, honesty — the standard RLHF dimensions)
Output: Final DeepSeek-R1 model
Why:    This final RL stage aligns the model on all task types
        simultaneously. The learned reward model (used only for
        non-verifiable tasks) is trained on human preference data
        from the standard RLHF pipeline.
```

The four-stage pipeline is the paper's practical contribution beyond the GRPO algorithm itself. Each stage addresses a specific failure mode of the previous stage. Attempting to do all-scenario RL from the start (skipping Stages 1–3) produces a model that is neither a strong reasoner nor a strong generalist — the two objectives interfere destructively when the model has not yet developed separate competencies for each.

#### 8.1.9 Emergent Behaviors

During Stage 2 (reasoning-focused RL), several complex behaviors emerged spontaneously — they were not explicitly trained, prompted, or rewarded:

| Emergent Behavior | Description | When It Appears | Example |
|---|---|---|---|
| **Self-verification** | Model checks its own answer by substituting back or trying alternative methods | After ~1K training iterations | "Let me verify: if x=3, then 3²+2(3)=15. ✓" |
| **Self-reflection** | Model recognizes an error mid-reasoning and backtracks | After ~2K iterations | "Wait, I made an error in step 3. Let me redo..." |
| **Aha moments** | Model expresses sudden insight after extended exploration | After ~3K iterations | "Hmm, wait. I just realized this is actually a modular arithmetic problem in disguise!" |
| **Strategy switching** | Model abandons a failing approach and tries a different method | After ~4K iterations | "This algebraic approach is getting complicated. Let me try geometric reasoning instead." |
| **Language mixing** | Model switches between English and Chinese mid-reasoning (specific to R1-Zero) | From early training | "So we need 找到最大值... the maximum is at x=π/4" |
| **Exploration** | Model explicitly considers multiple approaches before committing | After ~5K iterations | "I can approach this three ways: induction, direct computation, or generating functions. Let me try induction first." |
| **Metacognition** | Model comments on its own reasoning difficulty or confidence | After ~6K iterations | "This is a tricky step — I'm not fully confident. Let me double-check." |

The language mixing behavior is particularly noteworthy because it was not present in the SFT base model (which was trained on English and Chinese separately) and was never rewarded. It appears because the model's internal representation sometimes finds it easier to express certain reasoning steps in one language versus the other, and the RL objective (which cares only about correctness) does not penalize this. The Stage 3 SFT fixes the language mixing by training on monolingual data.

The "aha moment" behavior is the most discussed in the community. It manifests as the model producing text like "Wait, I think I see it now..." or "Oh! This simplifies to..." after a period of unsuccessful exploration. This is emergent: the model was never trained to produce such text, and the reward function gives no credit for expressing insight. The behavior persists because outputs containing these moments are statistically more likely to arrive at the correct answer (the model has genuinely restructured its approach), and so they receive higher reward and are reinforced by the GRPO gradient.

#### 8.1.10 Benchmark Results — Complete Table

| Benchmark | DeepSeek-R1 | DeepSeek-R1-Zero | DeepSeek-V3 (base) | GPT-4o | Claude 3.5 Sonnet | o1-preview | o1-mini |
|---|---|---|---|---|---|---|---|
| AIME 2024 (pass@1) | **79.8%** | 71.0% | 39.2% | 9.3% | 16.0% | 44.6% | 63.6% |
| MATH-500 | **97.3%** | 95.9% | 90.2% | 76.6% | 78.3% | 85.5% | 90.0% |
| Codeforces (percentile) | **96.3** | 80.3 | 58.7 | 23.0 | — | 93.4 | 90.6 |
| GPQA Diamond | **71.5%** | 58.7% | 59.1% | 49.9% | 65.0% | 73.3% | 60.0% |
| LiveCodeBench (2408–2501) | **65.9%** | 50.4% | 40.5% | 33.4% | — | 63.9% | 53.8% |
| MMLU | **90.8%** | 82.1% | 88.5% | 87.2% | 88.3% | 90.8% | 85.2% |
| IFEval (prompt strict) | **83.3%** | 63.5% | 86.1% | 84.3% | — | — | — |
| AlpacaEval 2.0 (LC) | **87.6%** | — | 70.0% | 57.5% | — | — | — |

Key observations:

1. **R1-Zero vs R1.** R1-Zero (pure RL, no SFT stages) is remarkably strong on reasoning benchmarks (71.0% AIME, 95.9% MATH-500) but degraded on general tasks (82.1% MMLU vs 90.8%, 63.5% IFEval vs 83.3%). The four-stage pipeline recovers general capability without sacrificing reasoning.

2. **AIME 2024.** The flagship result: 79.8% pass@1 on a competition math exam that GPT-4o achieves 9.3% on. This is an 8.6x improvement from RL methodology alone. With majority voting (consensus@64), DeepSeek-R1 reaches 97.3% on AIME 2024.

3. **Codeforces.** The 96.3 percentile means R1 outperforms 96.3% of human competitive programmers on the Codeforces rating system. This is achieved by solving problems that require multi-step algorithmic reasoning, not just code translation.

4. **MATH-500 at 97.3%.** Of the 500 problems, R1 gets 486–487 correct. The remaining 13–14 are typically problems that require visual/diagrammatic reasoning or highly specialized domain knowledge (e.g., advanced topology).

#### 8.1.11 Practical Reproduction Guide

Groups that have successfully reproduced GRPO-style training (including Open-R1, SimpleRL, TinyZero, and STILL-2) report the following critical implementation details:

**Infrastructure.** For a 7B-parameter model with G=16: minimum 4× A100 80GB or equivalent. The memory bottleneck is storing G=16 output sequences (each up to 32K tokens) simultaneously for the advantage computation. With G=64 on a 7B model, 8× A100 is the minimum.

**Training data.** For math reasoning: GSM8K (8.5K problems), MATH (12K problems), competition math collections (AIME, AMC, Putnam). For code reasoning: APPS, MBPP, CodeContests. A combined dataset of 20–50K problems with verifiable answers is sufficient for meaningful RL gains on 7B models.

**Common pitfalls:**
1. **Reward sparsity.** If the model's pass@G rate is below 5% on the training set, the advantage signal is too sparse for learning. Solution: start with easier problems or use a warmer SFT initialization.
2. **Reward hacking.** The model finds a shortcut that produces the correct answer format without genuine reasoning (e.g., memorizing common answer patterns). Solution: use a diverse training set and monitor for suspiciously short outputs that get high rewards.
3. **KL explosion.** The policy diverges too far from the reference, producing degenerate outputs. Solution: increase β (the KL penalty coefficient) or decrease the learning rate.
4. **The "rocky phase."** Between 30% and 50% of training, output quality often dips temporarily as the model transitions from SFT-style patterns to RL-discovered reasoning patterns. Do not early-stop during this phase. The recovery typically occurs within 500–1000 additional iterations.

### 8.2 RetroAgent — The Full Algorithm

**Reference:** Li et al., "RetroAgent: Enhancing LLM-based Agents via Retrospective Self-Improvement with Evolving Experience," arXiv:2603.08561, March 2026.

RetroAgent achieves the current state of the art in runtime agent evolution — agents that improve through accumulated experience without any weight updates to the underlying LLM. The paper frames agent decision-making as a Markov Decision Process and introduces three interconnected mechanisms: hindsight self-reflection with dual numerical-linguistic feedback, a capability-evolution intrinsic reward, and a SimUtil-UCB memory retrieval policy that balances relevance, utility, and exploration. This section reproduces the complete formulation.

#### 8.2.1 MDP Formulation

The agent's decision process is formalized as an MDP:

```
M = (S, A, P, R, γ)
```

where:
- **S** is the state space. Each state s_t encodes the entire interaction history up to time t:
  ```
  s_t = (o_0, a_0, o_1, a_1, ..., a_{t-1}, o_t)
  ```
  where o_0 is the initial observation (task description), a_i are actions taken by the agent, and o_i are observations from the environment. This is the standard history-based state for partially observable environments — the agent has no access to the true environment state, only its accumulated observations.

- **A** is the action space — all possible actions the agent can take (tool calls, code generation, navigation commands, etc.), dependent on the specific environment.

- **P**: S × A → Δ(S) is the transition function. P(s_{t+1} | s_t, a_t) gives the probability of the next state given the current state and action. In practice, this is the environment's response to the agent's action.

- **R**: S × A → ℝ is the reward function. R(s_t, a_t) = r^ext_{t+1} is the external (environment-provided) reward. In many agent benchmarks, the reward is sparse: r^ext = 1 on task success, r^ext = 0 otherwise.

- **γ** ∈ [0, 1] is the discount factor.

#### 8.2.2 Standard Objective

The standard RL objective for the agent policy π_θ is:

```
J_Standard(θ) = E_{τ ~ π_θ · P} [ Σ_{t=0}^{T} γ^t · r^ext_{t+1} ]
```

where τ = (s_0, a_0, r_1, s_1, a_1, r_2, ...) is a trajectory sampled by executing policy π_θ in environment with transition dynamics P.

#### 8.2.3 RetroAgent Composite Objective

RetroAgent augments the standard objective with an intrinsic reward signal derived from self-reflection:

```
J_RetroAgent(θ) = E_{τ ~ Π_θ(·|x, M) · P} [ Σ_{t=0}^{T} γ^t (r^ext_{t+1} + r^int_{t+1}) ]
```

where:
- **x** is the task instruction
- **M** is the experience memory buffer
- **Π_θ** is the memory-augmented policy: Π_θ(a_t | s_t, x, M) — the agent conditions its actions on retrieved memories in addition to the current state
- **r^int_{t+1}** is the intrinsic reward (defined in Section 8.2.5)

The mixture policy Π_θ operates as follows: at the start of each episode, relevant experiences are retrieved from M and prepended to the agent's context. The agent then acts according to its base policy π_θ conditioned on this augmented context. Formally:

```
Π_θ(a_t | s_t, x, M) = π_θ(a_t | [retrieved(x, M); s_t])
```

where [retrieved(x, M); s_t] denotes the concatenation of retrieved memory content with the current state in the LLM's context window.

#### 8.2.4 Self-Reflection Mechanism

After each episode (complete task attempt), the agent performs hindsight self-reflection on its trajectory τ. The reflection function f_reflect produces a structured tuple:

```
z = f_reflect(τ) = (φ_{(x,τ)}, c, l)
```

where:
- **φ_{(x,τ)}** ∈ [0, 1]: the potential score — a continuous measure of subtask completion rate. This is computed by the LLM evaluating the trajectory against the task's subtask decomposition. For a task with K subtasks, φ = (number of completed subtasks) / K.

- **c** ∈ {0, 1}: binary success prediction — the agent's self-assessment of whether the task was completed successfully. This is compared against the actual external reward indicator I^ext = 1(r^ext > 0) to train the reflection model (see Section 8.2.6).

- **l**: natural-language lesson — a free-form text description of what worked, what failed, and what to do differently. These lessons are the content that gets stored in memory and retrieved for future episodes.

The potential score φ is the critical numerical signal. Unlike binary success/failure, φ captures partial progress. An agent that completes 3 of 5 subtasks (φ = 0.6) has learned more than one that completed 0 (φ = 0.0), even though both receive r^ext = 0 (task failure). This dense signal drives the intrinsic reward.

#### 8.2.5 Intrinsic Numerical Feedback — Capability-Evolution Reward

The intrinsic reward at episode k for task type x is defined as the improvement in potential score over the running baseline:

```
R^int_k = max(0, φ_{(x,τ),k} - Φ_x)
```

where Φ_x is the baseline potential for task type x, updated after each episode:

```
Φ_x = max(Φ_x, Ī^ext_k)
```

and Ī^ext_k is the running average of external success indicators over the most recent N episodes of task type x:

```
Ī^ext_k = (1/N) Σ_{j=1}^{N} I^ext(j)_k
```

where I^ext(j)_k ∈ {0, 1} is the binary success indicator for the j-th most recent episode of task type x.

**Interpretation:** The intrinsic reward is positive only when the agent achieves higher partial progress than its established baseline. Once the agent can reliably complete 60% of subtasks (Φ_x = 0.6), only episodes achieving > 60% completion generate intrinsic reward. This creates an automatic curriculum: easy subtasks are mastered first (generating reward), then the reward threshold ratchets up, forcing the agent to learn harder subtasks.

The max(0, ...) clipping ensures that failures below the baseline produce zero intrinsic reward rather than negative reward. This prevents the pathological case where a single bad episode (due to environment stochasticity, not agent error) would reduce the intrinsic reward landscape for all future episodes.

#### 8.2.6 RL-Trained Reflection Variant

The paper also presents a variant where the reflection mechanism itself is trained via RL. The reflection reward is:

```
R^reflect = R^ext · 1(c = I^ext)
```

where:
- R^ext is the external task reward
- c is the agent's predicted success (from the reflection tuple)
- I^ext = 1(r^ext > 0) is the actual success indicator
- 1(·) is the indicator function

This reward is positive only when the agent's success prediction matches reality AND the task succeeded. The reward is zero if the agent predicted success but actually failed (overconfident), or if the agent succeeded but predicted failure (underconfident), or if the task simply failed. This trains the reflection to be well-calibrated.

The joint objective for the RL-trained variant combines the decision-making objective with the reflection objective:

```
J = J_RetroAgent(θ) + λ_reflect · E_{τ ~ Π_θ · P} [ R^reflect ]
```

where λ_reflect is the weight on the reflection loss (paper uses λ_reflect = 0.5).

#### 8.2.7 SimUtil-UCB Retrieval — Complete Formulation

The SimUtil-UCB retrieval policy selects which memories to inject into the agent's context. It balances three competing objectives: semantic relevance, empirical utility, and exploration of under-retrieved memories.

**Memory buffer structure.** Each memory entry is a tuple:

```
m_i = (x_i, l_i, τ_i, u_i, n_i, d_i)
```

where:
- x_i: the task instruction from which this memory was generated
- l_i: the natural-language lesson (from the reflection tuple)
- τ_i: the full trajectory (stored for optional replay, not used in retrieval scoring)
- u_i: the running utility estimate (exponential moving average, initialized to 0.5)
- n_i: the retrieval count (number of times this memory has been retrieved)
- d_i: the creation date (used for optional recency weighting, not in the main formulation)

**Step 1: Semantic relevance filter.** Compute cosine similarity between the current task x and each stored task x_i using sentence embeddings E(·):

```
s_rel(x, x_i) = E(x) · v_i / (||E(x)|| · ||v_i||)
```

where v_i = E(x_i) is the pre-computed embedding of the stored task. Apply a hard threshold: only memories with s_rel ≥ 0.4 are candidates for retrieval. This eliminates obviously irrelevant memories and reduces the candidate set from potentially thousands to typically 10–50.

**Step 2: Utility update.** After each episode where memory m_i was retrieved, update its utility estimate using exponential moving average (EMA):

```
u_i := (1 - β_util) · u_i + β_util · û_t
```

where û_t is the observed utility of the memory in the current episode. The paper uses û_t = 1.0 if the task succeeded and û_t = 0.0 if it failed. β_util = 0.1 (the EMA decay rate).

**Step 3: UCB exploration bonus.** Compute the Upper Confidence Bound exploration score for each candidate memory:

```
u^(i)_{util-UCB} = u_i + κ · √(ln N / n_i)
```

where:
- u_i is the current utility estimate for memory i
- N is the total number of retrieval operations performed so far (across all episodes)
- n_i is the number of times memory i has been retrieved
- κ = 1.0 is the exploration coefficient (controls exploration vs exploitation tradeoff)

For memories that have never been retrieved (n_i = 0), the UCB score is set to +∞, ensuring they are retrieved at least once.

**Step 4: Combined score.** The final retrieval score combines semantic relevance and utility-UCB:

```
S(m_i | x, M) = α · s_rel(x, x_i) + (1 - α) · u^(i)_{util-UCB}
```

where α ∈ [0, 1] controls the tradeoff between relevance and utility. The paper uses α = 0.5 as the default. Higher α prioritizes semantic similarity (useful when the memory buffer is large and diverse); lower α prioritizes empirical utility (useful when the memory buffer is small and well-curated).

The top-k memories by combined score are retrieved and prepended to the agent's context. The paper uses k = 3 for ALFWorld and WebShop, k = 5 for Sokoban and MineSweeper (which benefit from more heuristics).

#### 8.2.8 Ablation Results — Component-by-Component

The paper provides exhaustive ablations showing the contribution of each component:

| Configuration | ALFWorld | WebShop | Sokoban | MineSweeper | Avg |
|---|---|---|---|---|---|
| **Full RetroAgent** | **78.4%** | **67.2%** | **54.3%** | **41.7%** | **60.4%** |
| − SimUtil-UCB (use random retrieval) | 63.1% | 53.4% | 35.2% | 33.0% | 46.2% |
| − UCB exploration (κ=0) | 73.1% | 63.8% | 48.7% | 38.1% | 55.9% |
| − Utility scoring (α=1, similarity only) | 70.2% | 60.1% | 45.2% | 36.5% | 53.0% |
| − Similarity (α=0, utility-UCB only) | 62.4% | 55.3% | 38.1% | 34.2% | 47.5% |
| − Intrinsic reward (R^int = 0) | 71.8% | 61.5% | 47.9% | 37.3% | 54.6% |
| − Language lessons (numerical only) | 68.3% | 58.7% | 42.6% | 35.8% | 51.4% |
| − Numerical feedback (lessons only) | 72.5% | 62.9% | 49.1% | 38.5% | 55.8% |
| − Self-reflection entirely | 60.1% | 51.8% | 27.2% | 32.8% | 43.0% |
| GRPO baseline (no memory) | 60.1% | 51.8% | 27.2% | 32.8% | 43.0% |
| Reflexion baseline | 72.1% | 58.9% | 35.8% | 36.2% | 50.8% |
| ExpeL baseline | 68.3% | 55.2% | 41.5% | 35.1% | 50.0% |

Key findings from the ablation:

1. **Self-reflection is the foundation.** Removing it entirely reduces RetroAgent to the GRPO baseline. All +17.4% average improvement comes from the reflection-and-memory system.

2. **SimUtil-UCB is the largest single contributor.** Replacing it with random retrieval drops performance by 14.2% (from 60.4% to 46.2%). Even simple semantic retrieval (α=1) underperforms the full system by 7.4%.

3. **The UCB exploration term contributes 4.5% on average.** The impact is largest on Sokoban (+5.6%) where novel spatial configurations require diverse heuristics, and smallest on MineSweeper (+3.6%) where a smaller set of core rules suffices.

4. **Dual feedback (numerical + linguistic) outperforms either alone.** Numerical-only drops 9.0% average; linguistic-only drops 4.6% average. The numerical signal provides calibrated retrieval scoring; the linguistic signal provides the actionable content.

5. **Intrinsic reward contributes 5.8% on average.** Its main effect is accelerating early learning — the agent discovers effective strategies faster because partial progress is rewarded, not just final success.

#### 8.2.9 Final Results — Full Comparison

| Benchmark | RetroAgent | GRPO (base) | Reflexion | ExpeL | AutoAgent | Improvement over GRPO |
|---|---|---|---|---|---|---|
| ALFWorld | **78.4%** | 60.1% | 72.1% | 68.3% | 65.7% | **+18.3%** |
| WebShop | **67.2%** | 51.8% | 58.9% | 55.2% | 62.3% | **+15.4%** |
| Sokoban | **54.3%** | 27.2% | 35.8% | 41.5% | 38.4% | **+27.1%** |
| MineSweeper | **41.7%** | 32.8% | 36.2% | 35.1% | 37.9% | **+8.9%** |

The Sokoban improvement is the largest (+27.1%) because spatial reasoning puzzles benefit enormously from accumulated heuristics. Lessons like "never push a box against a wall unless the goal cell is on that wall" are transferable across thousands of Sokoban levels. Each such heuristic eliminates an entire class of dead-end moves, and they compound multiplicatively.

**RetroAgent hyperparameters (complete):**

| Parameter | Value | Notes |
|---|---|---|
| Memory buffer size | 500 | Max stored memories per task type |
| Retrieval top-k | 3–5 | 3 for ALFWorld/WebShop, 5 for Sokoban/MineSweeper |
| Similarity threshold | 0.4 | Cosine similarity minimum for candidate filtering |
| α (relevance vs utility) | 0.5 | Equal weight to similarity and utility-UCB |
| κ (UCB exploration) | 1.0 | Standard UCB coefficient |
| β_util (EMA decay) | 0.1 | Slow adaptation of utility estimates |
| λ_reflect (reflection weight) | 0.5 | For RL-trained reflection variant |
| Embedding model | gte-large-en-v1.5 | Sentence embedding for semantic similarity |
| Base LLM | GPT-4o / Claude 3.5 Sonnet | Results reported for both |
| Max episode length | 30 actions | Varies by environment |
| Episodes per task | 10 | For learning curve experiments |

### 8.3 MemRL — The Full Algorithm

**Reference:** Chen et al., "MemRL: A Reinforcement Learning Framework for Memory-Augmented LLM Agents," arXiv:2601.03192, January 2026.

MemRL introduces a principled framework for memory-augmented agents where the LLM backbone is frozen and all learning occurs in the external memory system. The key insight is model-memory decoupling: the LLM provides general reasoning capability, while the memory system provides task-specific adaptation. This section presents the complete formulation.

#### 8.3.1 Intent-Experience-Utility (IEU) Triplet

The fundamental memory unit in MemRL is the IEU triplet:

```
M = {(z_i, e_i, Q_i)}_{i=1}^{|M|}
```

where for each memory entry i:
- **z_i** (intent): a natural-language description of the problem or query that generated this memory. Used as the key for semantic retrieval.
- **e_i** (experience): a structured record of the solution — the actions taken, the outcome, and a distilled insight. This is the value that gets injected into the LLM's context when the memory is retrieved.
- **Q_i** (utility): a scalar quality score in [0, 1] that estimates how useful this memory is for future tasks. Initialized to 0.5 (neutral prior) and updated via Monte Carlo Q-learning after each task completion.

```python
@dataclass
class IEUMemory:
    intent: str          # z_i: "How to handle rate limiting in FastAPI"
    experience: str      # e_i: "Use slowapi middleware with Redis backend..."
    utility: float       # Q_i: 0.73 (learned via Q-updates)
    retrieval_count: int  # n_i: 12 (times retrieved)
    success_count: int    # s_i: 9 (times task succeeded after retrieval)
    created_at: float     # timestamp
    last_retrieved: float # timestamp
```

#### 8.3.2 Two-Phase Retrieval

MemRL uses a two-phase retrieval pipeline that separates breadth (find relevant memories) from depth (select useful memories):

```
Phase A: SEMANTIC FILTER
━━━━━━━━━━━━━━━━━━━━━━━
Input:   Current task description T
         Full memory store M = {(z_i, e_i, Q_i)}
Method:  Embed T using sentence transformer: v_T = Embed(T)
         For each memory i, compute cosine similarity:
           sim_i = (v_T · v_{z_i}) / (||v_T|| · ||v_{z_i}||)
         Return top-K candidates by sim_i
         (K = 50 in paper, tunable from 20 to 100)
Cost:    1 embedding computation + ANN search, < 10ms with FAISS
Output:  C = {m_{j_1}, m_{j_2}, ..., m_{j_K}} — candidate set

Phase B: Q-VALUE SELECTION
━━━━━━━━━━━━━━━━━━━━━━━━
Input:   Candidate set C from Phase A
         Current context (not used in basic formulation)
Method:  For each candidate m_j ∈ C:
           score_j = Q_j
         Return top-k by score_j
         (k = 3 to 5 in paper)
Cost:    K scalar comparisons, < 1ms
Output:  R = {m_{r_1}, ..., m_{r_k}} — retrieved set
```

The two-phase design is critical for scaling. Phase A uses dense vector search (sub-linear in |M| with approximate nearest neighbor indices) to reduce the search space. Phase B uses a simple scalar comparison (linear in K, but K is small). The combined retrieval cost is dominated by Phase A and is < 50ms even with |M| = 100K memories.

#### 8.3.3 Q-Value Update — Monte Carlo

After each completed task, the Q-values of all retrieved memories are updated using Monte Carlo returns:

```
For each memory m_i that was retrieved during the task:
    Q_i ← Q_i + α · (R_task - Q_i)
```

where:
- α = 0.05 is the learning rate (slow adaptation to prevent oscillation)
- R_task ∈ {0, 1} is the binary task outcome (0 = failure, 1 = success)

This is the simplest form of incremental Monte Carlo estimation. The Q-value converges to the average task success rate conditioned on retrieving that memory:

```
Q_i → E[R_task | m_i was retrieved]    as number of retrievals → ∞
```

The paper also presents an extended update rule that accounts for the number of memories retrieved simultaneously:

```
Q_i ← Q_i + (α / k) · (R_task - Q_i)
```

where k is the number of memories retrieved for the task. The (1/k) factor reduces the credit assigned to each individual memory when multiple memories are retrieved together, preventing the well-known credit assignment problem where all retrieved memories receive the same update regardless of their individual contribution.

**Decay mechanism.** Memories that are not retrieved for a long time have their Q-values decayed toward the prior:

```
If memory m_i has not been retrieved in the last T_decay episodes:
    Q_i ← (1 - δ) · Q_i + δ · Q_prior
```

where Q_prior = 0.5 (neutral), δ = 0.01 (slow decay), and T_decay = 50 episodes. This prevents stale memories from permanently occupying high-Q slots.

#### 8.3.4 Model-Memory Decoupling

The architectural principle of MemRL: the LLM backbone is completely frozen — its weights never change. All adaptation happens in the memory store (new entries are added, Q-values are updated, entries are decayed or pruned).

```
┌─────────────────────────────────────────────────┐
│ FROZEN: LLM Backbone                            │
│ (GPT-4o, Claude Sonnet, Llama 3, etc.)          │
│                                                  │
│ Input: [System Prompt]                           │
│      + [Retrieved Memories (top-k by Q-value)]   │
│      + [Task Description]                        │
│      + [Conversation History]                    │
│                                                  │
│ Output: Actions, tool calls, responses           │
└─────────────────────────────────────────────────┘
          ▲ retrieved memories          │ task outcome
          │                             ▼
┌─────────────────────────────────────────────────┐
│ PLASTIC: External Memory System                  │
│                                                  │
│ ┌─────────────────┐  ┌────────────────────────┐ │
│ │ Memory Store     │  │ Retrieval Policy       │ │
│ │ {(z, e, Q)}     │  │ Phase A: embedding sim │ │
│ │ grows over time  │  │ Phase B: Q-value rank  │ │
│ └────────┬────────┘  └───────────┬────────────┘ │
│          │    Q-value updates     │              │
│          │    (Monte Carlo)       │              │
│          └────────────────────────┘              │
└─────────────────────────────────────────────────┘
```

This decoupling provides three practical advantages:

1. **Zero fine-tuning cost.** The LLM is used as-is via API. When a better model is released, swap it in and the accumulated memory transfers. No retraining, no GPU cluster, no risk of catastrophic forgetting.

2. **Stability.** Online RL on LLM weights risks catastrophic forgetting — improving on Task A degrades Task B. Q-value updates on a memory store cannot break the underlying model. The worst case is a bad memory entry getting a high Q-value, which is trivially diagnosed (inspect the entry) and fixed (reset its Q-value or delete it).

3. **Interpretability.** Every memory entry is a readable (intent, experience, utility) tuple. You can audit why the agent chose a particular approach by examining which memories were retrieved and their Q-values. This is critical for regulated environments where "the model learned it during training" is not an acceptable explanation.

#### 8.3.5 Results — Full Benchmark Comparison

| Benchmark | MemRL | RAG (static) | Self-RAG | Mem0 | MemoryPalace | No Memory |
|---|---|---|---|---|---|---|
| HLE (hard reasoning) | **34.2%** | 27.1% | 29.8% | 28.3% | 30.1% | 22.5% |
| BigCodeBench | **68.7%** | 62.4% | 64.1% | 63.2% | 65.0% | 58.3% |
| ALFWorld | **71.3%** | 58.2% | 61.7% | 60.4% | 63.8% | 48.6% |
| Lifelong Agent Bench | **56.8%** | 43.1% | 47.3% | 45.9% | 49.2% | 35.4% |

The improvement over static RAG ranges from 6–14 percentage points. The largest gains are on benchmarks requiring cross-episode learning (ALFWorld: +13.1%, Lifelong Agent Bench: +13.7%), where the Q-value mechanism accumulates genuine learning signal. The smallest gain is on BigCodeBench (+6.3%), where individual task context matters more than cross-task memory.

**Ablation of MemRL components:**

| Configuration | ALFWorld | Lifelong Agent Bench |
|---|---|---|
| Full MemRL | **71.3%** | **56.8%** |
| − Q-value selection (random from Phase A) | 63.5% | 47.2% |
| − Phase A (random retrieval) | 56.1% | 40.8% |
| − Q-value decay | 69.8% | 54.1% |
| − Experience field (intent-only retrieval) | 65.2% | 49.6% |
| − All memory (base LLM) | 48.6% | 35.4% |

The Q-value selection (Phase B) contributes the most incremental value over simple semantic retrieval (+7.8% on ALFWorld, +9.6% on Lifelong Agent Bench). This validates the core claim: learned utility scoring is superior to relevance-only retrieval.

### 8.4 Memento-II — A Formal Framework for Memory-Augmented Agents

**Reference:** Hu et al., "Memento-II: A Formal Framework for Memory-Augmented Agent Decision Making," arXiv:2512.22716, December 2025.

Memento-II provides the theoretical foundation that RetroAgent and MemRL lack: a formal proof that memory-augmented policy iteration converges to the optimal policy as the memory capacity grows. While RetroAgent and MemRL are empirically effective algorithms, Memento-II answers the question: is there a principled reason to believe that adding memory to an agent will converge to better behavior?

#### 8.4.1 Memory-Augmented MDP (M-MDP)

Memento-II augments the standard MDP with an explicit memory component:

```
M-MDP = (S, A, P, R, γ, W, Ω, F_read, F_write)
```

where (S, A, P, R, γ) is the standard MDP and:
- **W** is the memory space — the set of all possible memory states. Each w ∈ W represents the contents of the agent's memory at a given time.
- **Ω** is the observation space — what the agent perceives from the environment (which may be a subset of the true state S in partially observable settings).
- **F_read**: W × S → A is the read function — the policy that maps the current memory state and environment state to an action. This is the "how do I use my memories to decide what to do" function.
- **F_write**: W × S × A × R × S' → W is the write function — the function that updates the memory after each transition. This is the "what do I remember from this experience" function.

The combined state of the M-MDP is the pair (s, w) — the environment state and the memory state. The agent's augmented policy operates on this combined state:

```
π^M(a | s, w) = F_read(w, s)
```

The memory evolves according to:

```
w_{t+1} = F_write(w_t, s_t, a_t, r_t, s_{t+1})
```

This formalization captures all existing memory systems as special cases:
- **Markdown Brain (Section 7.1):** W = set of possible file contents, F_write = append to Corrections.md, F_read = LLM conditions on loaded files
- **Event-sourced (Section 7.2):** W = set of event logs, F_write = append event, F_read = project events into state → policy
- **MemRL (Section 8.3):** W = set of IEU triplets with Q-values, F_write = add entry + Q-update, F_read = two-phase retrieval → context injection

#### 8.4.2 Read-Write Learning Equivalence

The central theoretical result of Memento-II maps memory operations to policy iteration:

```
Reading = Policy Improvement
  F_read(w, s) selects actions based on accumulated memory.
  A better read function (better retrieval, better use of memories)
  directly improves the policy.

Writing = Policy Evaluation
  F_write(w, s, a, r, s') updates memory based on observed transitions.
  Better write functions (better reflection, better distillation)
  produce more accurate evaluations of which strategies work,
  which is the information that the read function (policy) needs.
```

This is not just an analogy — Memento-II proves that the alternating cycle of "write to memory after episode" → "read from memory to make decisions" is formally equivalent to a form of generalized policy iteration (GPI), the foundational algorithm of reinforcement learning (Sutton & Barto, Chapter 4).

#### 8.4.3 Convergence Guarantee

The main theorem of Memento-II (Theorem 3.1 in the paper):

**Theorem (Convergence of Entropy-Regularized M-MDP Policy Iteration).** Let (S, A, P, R, γ, W, Ω, F_read, F_write) be an M-MDP with finite state space, finite action space, and finite memory capacity |W| = C. Define the entropy-regularized objective:

```
J_H(π^M) = E_{τ ~ π^M} [ Σ_{t=0}^{∞} γ^t (r_t + α_H · H(π^M(· | s_t, w_t))) ]
```

where H(·) is the Shannon entropy and α_H > 0 is the entropy coefficient.

Under the following conditions:
1. The reward function R is bounded: |R(s, a)| ≤ R_max for all (s, a)
2. The memory write function F_write is deterministic given (w, s, a, r, s')
3. The read function F_read is updated to maximize the entropy-regularized Q-function at each iteration

Then the sequence of policies {π^M_n} produced by alternating write (evaluation) and read (improvement) steps converges to the optimal entropy-regularized policy π^{M*} as the number of iterations n → ∞. Furthermore, as the memory capacity C → ∞, the optimal M-MDP policy converges to the optimal policy of the underlying POMDP:

```
lim_{C → ∞} J_H(π^{M*}_C) = J_H(π^{POMDP*})
```

**In plain language:** if you give a memory-augmented agent enough memory capacity and let it iterate between "use memories to improve decisions" and "update memories based on outcomes," it will converge to the best possible behavior for its environment. As memory capacity grows, the gap between the memory-augmented agent and an agent with perfect information about the environment shrinks to zero.

**Why this matters practically.** Before Memento-II, every memory system for agents was a heuristic. Practitioners added memory because it "felt right" and validated it empirically. Memento-II provides the formal justification: memory-augmented policy iteration is a sound algorithm with convergence guarantees. This transforms reflective memory from a design pattern into a control-theoretic object with well-understood properties.

#### 8.4.4 Practical Implications

The convergence theorem has three actionable implications for system builders:

**1. Memory capacity determines the ceiling.** The theorem shows that performance improves monotonically with memory capacity (up to the POMDP optimal). In practice, this means:
- Context-window memory (limited to ~200K tokens): ceiling is relatively low
- External memory with retrieval (limited to storage capacity): ceiling is much higher
- The retrieval quality (F_read) determines how much of the ceiling is actually achieved

**2. Write quality is as important as read quality.** The theorem treats F_write (memory update) and F_read (memory retrieval) as dual operations. In practice, most engineering effort goes into retrieval (fancy embedding models, HNSW indices, reranking). The theorem suggests equal effort should go into the write side: what gets stored, how it is distilled, and when entries are updated or pruned.

**3. Entropy regularization prevents premature convergence.** The entropy term α_H · H(·) prevents the policy from collapsing to a deterministic strategy too quickly. In the memory context, this means the retrieval policy should maintain exploration (retrieve diverse memories, not just the highest-Q ones). This is exactly what RetroAgent's UCB exploration term achieves.

The connection between Memento-II's theory and RetroAgent's practice:
- Memento-II's F_write = RetroAgent's self-reflection mechanism
- Memento-II's F_read = RetroAgent's SimUtil-UCB retrieval
- Memento-II's entropy regularization ≈ RetroAgent's UCB exploration bonus
- Memento-II's convergence guarantee applies to RetroAgent under the stated conditions

### 8.5 Training vs. Runtime Evolution — Complete Decision Framework

The choice between fine-tuning the model's weights (training-time evolution) and evolving its behavior through memory at runtime (inference-time evolution) is the most consequential architectural decision in agent development. This section provides a rigorous decision framework with specific criteria, cost models, and evidence.

#### 8.5.1 Decision Matrix

| Criterion | Fine-tune (weight updates) | Runtime memory (no weight updates) |
|---|---|---|
| **Data requirement** | >10K trajectories minimum; >100K for robust gains on large models | Works from first episode; meaningful improvement with 50–500 episodes |
| **Compute cost** | $1K–$100K+ per training run (GPU hours for full fine-tune); $100–$5K for LoRA/QLoRA | $0.01–$0.10 per episode (LLM inference for reflection + embedding) |
| **Latency to improve** | Days to weeks (data collection + training pipeline + evaluation) | Immediate (next episode uses new memory) |
| **Risk of regression** | High: catastrophic forgetting, mode collapse, reward hacking | Low: monotonically improving under mild assumptions (Memento-II theorem) |
| **Model access required** | Full weights (open-source or self-hosted); not possible with proprietary APIs | API-only access sufficient; works with any model |
| **Generalization** | Broad: changes the model's capabilities across all contexts | Narrow: changes behavior only when relevant memories are retrieved |
| **Interpretability** | Low: weight changes are opaque; no way to "read" what was learned | High: every memory entry is a readable (intent, experience, utility) tuple |
| **Rollback** | Hard: requires checkpointing model weights; expensive storage | Easy: delete bad memories; Q-value reset |
| **Ceiling** | Higher: can learn genuinely new reasoning patterns, new output formats | Lower: bounded by base model's inherent capabilities + context window |
| **Persistence** | Permanent: learned behaviors are embedded in weights | Requires external storage: memory must be persisted across sessions |
| **Multi-tenant** | One model per fine-tune target (or one LoRA adapter per tenant) | One model + per-tenant memory store (cheap and easy) |
| **Best for** | Capabilities the base model fundamentally lacks | Domain-specific knowledge, user preferences, error avoidance, adaptation |

#### 8.5.2 When to Fine-Tune

Fine-tuning is warranted when:

1. **The base model cannot perform the task at all**, even with perfect instructions, examples, and retrieved memories. This indicates a capability gap that only weight updates can close. Example: a base model that cannot write CUDA kernels will not learn CUDA from in-context examples alone — it needs training data with CUDA code.

2. **You have abundant verified data.** The minimum viable dataset depends on the task and model size:
   | Model Size | Min SFT Data | Min RL Data (GRPO) | Notes |
   |---|---|---|---|
   | 1–3B | 5K examples | 2K prompts × G=16 | Overfitting risk above 50K examples |
   | 7–13B | 10K examples | 5K prompts × G=16 | Sweet spot for most practitioners |
   | 30–70B | 20K examples | 10K prompts × G=32 | Requires multi-node training |
   | 200B+ | 50K+ examples | 20K+ prompts × G=64 | DeepSeek-R1 scale |

3. **The task distribution is stable.** Fine-tuning optimizes for the distribution of the training data. If the task distribution shifts (new codebases, new APIs, new user patterns), the fine-tuned model's advantage erodes. Retraining cycle must be faster than distribution shift.

4. **The improvement must generalize across all users and contexts.** Fine-tuning changes the model for everyone. Runtime memory is per-user or per-tenant.

5. **You can afford the infrastructure.** Cost model for a single GRPO training run:
   | Component | Cost (7B model, G=16) | Cost (70B model, G=64) |
   |---|---|---|
   | GPU rental (A100 80GB) | $500–$2K (4 GPUs, 1–3 days) | $20K–$80K (32+ GPUs, 1–2 weeks) |
   | Data curation | $500–$5K (human review) | $5K–$50K (expert annotation) |
   | Evaluation | $100–$500 (automated evals) | $1K–$5K (automated + human evals) |
   | Total per run | **$1.1K–$7.5K** | **$26K–$135K** |

#### 8.5.3 When to Use Runtime Memory

Runtime memory is warranted when:

1. **The base model can perform the task but makes avoidable mistakes.** The model has the capability but lacks domain-specific knowledge. Example: a coding agent that knows Python syntax but doesn't know your team's conventions for error handling — a few retrieved memory entries fix this.

2. **Adaptation must be immediate.** A new user starts using the agent today and needs personalized behavior today, not after a retraining cycle. Runtime memory starts accumulating from the first episode.

3. **You are using a proprietary model via API.** No weight access means no fine-tuning. Memory is the only adaptation mechanism.

4. **Interpretability and auditability matter.** Regulated environments (finance, healthcare, legal) may require explaining why the agent took a specific action. "The model retrieved Memory #4731 which says 'always check drug interactions before recommending dosage changes'" is auditable. "The model's attention head 47, layer 63, activated strongly on this token" is not.

5. **The task distribution shifts frequently.** New projects, new team members, evolving codebases. Memory adapts continuously; fine-tuning requires a retraining cycle.

6. **Multi-tenant personalization is required.** One base model + per-tenant memory stores is far cheaper than one fine-tuned model per tenant.

#### 8.5.4 The Hybrid Approach — Three-Phase Pipeline

The optimal strategy for high-stakes, high-volume agent deployments is a three-phase hybrid:

```
Phase 1: PRE-DEPLOYMENT (offline, one-time)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Collect expert trajectories (500–10K demonstrations)
2. SFT on demonstrations → baseline capability
3. GRPO with verifiable rewards → reasoning behaviors
4. Evaluate on held-out tasks → verify no regression
5. Deploy fine-tuned model as the base

Input:  Raw pre-trained model
Output: Fine-tuned model with task-specific reasoning
Cost:   $1K–$100K (one-time)
Time:   1–4 weeks

Phase 2: POST-DEPLOYMENT (online, continuous)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Agent runs tasks using fine-tuned model
2. After each task: generate IEU memory entry (MemRL) or
   hindsight reflection + lesson (RetroAgent)
3. Memory accumulates domain-specific knowledge
4. Retrieval policy improves via Q-learning (MemRL) or
   SimUtil-UCB (RetroAgent)
5. Monitor: track success rate, retrieval utility, memory growth

Input:  Task stream + fine-tuned model
Output: Growing memory store with calibrated Q-values
Cost:   $0.01–$0.10 per episode (reflection LLM calls)
Time:   Continuous

Phase 3: PERIODIC DISTILLATION (offline, recurring)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Export high-Q memories (top 20% by Q-value)
2. Convert to (prompt, optimal_response) training pairs:
   - prompt = memory intent + task context
   - response = memory experience (the successful approach)
3. SFT/GRPO retrain incorporating new demonstrations
4. Evaluate on held-out tasks + production replay
5. Redeploy updated model; optionally reset memory store

Input:  Accumulated memories + existing fine-tuned model
Output: Updated fine-tuned model with distilled experience
Cost:   $500–$10K per cycle
Cadence: Every 4–8 weeks

     ┌─────────────────────────────────────┐
     │                                     │
     ▼                                     │
  Phase 1 ──► Phase 2 ──► Phase 3 ──────┘
  (one-time)  (continuous)  (periodic)
```

#### 8.5.5 Cost Comparison — Concrete Scenario

For a coding agent handling 100 tasks/week at an organization with 20 developers:

| Component | Fine-tune only | Memory only | Hybrid |
|---|---|---|---|
| **Initial training** | $5,000 | $0 | $5,000 |
| **Monthly training compute** | $5,000 (biweekly retrains) | $0 | $2,500 (every 8 weeks) |
| **Monthly inference cost** | $400 (fine-tuned model) | $500 (+$100 retrieval overhead) | $450 |
| **Monthly memory storage** | $0 | $5 (vector DB + metadata) | $5 |
| **Monthly total** | $5,400 | $505 | $2,955 |
| **Improvement latency** | 2–4 weeks | Immediate | Immediate + periodic boost |
| **Expected improvement at month 1** | +5–8% (after first retrain) | +5–8% (from memory) | +5–8% (from memory) |
| **Expected improvement at month 3** | +15–20% | +8–12% | +20–25% |
| **Expected improvement at month 6** | +18–22% (plateau) | +10–15% (plateau) | +25–30% (continuing) |
| **Interpretability** | Low | High | High (memory) + Low (weights) |
| **Risk** | Medium (catastrophic forgetting) | Low | Low–Medium |

The hybrid approach costs more than memory-only ($2,955 vs $505/month) but delivers the highest total improvement (+25–30% at month 6 vs +10–15%). The key advantage is that Phase 3 (distillation) converts runtime-learned knowledge into permanent model capability, breaking through the memory-only ceiling.

The fine-tune-only approach costs the most ($5,400/month) and has a 2–4 week latency floor for every improvement. It also carries the highest risk of catastrophic forgetting — a bad retraining run can erase previous gains.

Memory-only is by far the cheapest ($505/month) and most accessible option (no GPU cluster needed, works with API-only models). It produces meaningful improvements from day one. For most teams starting out with agent development, this is the recommended approach until task volume justifies the hybrid investment.

#### 8.5.6 Decision Flowchart

```
START: Do you have weight access to the model?
│
├─► NO (proprietary API: GPT-4o, Claude, Gemini)
│   → Runtime memory is your only option.
│     Use MemRL (if you want simplicity) or
│     RetroAgent (if you want exploration + linguistic feedback).
│     Skip to Phase 2 of the hybrid pipeline.
│
└─► YES (open-source: Llama, Qwen, DeepSeek, Mistral)
    │
    ├─► Do you have >10K verified training examples?
    │   │
    │   ├─► YES
    │   │   │
    │   │   ├─► Is the task distribution stable?
    │   │   │   │
    │   │   │   ├─► YES → Full hybrid pipeline (Phases 1-2-3)
    │   │   │   │
    │   │   │   └─► NO → Memory-only (Phase 2) with periodic
    │   │   │         light SFT when distribution stabilizes
    │   │   │
    │   │   └─► Budget > $5K/month for training compute?
    │   │       │
    │   │       ├─► YES → Full hybrid pipeline
    │   │       │
    │   │       └─► NO → One-time fine-tune (Phase 1) + memory (Phase 2)
    │   │             Skip Phase 3 (periodic distillation)
    │   │
    │   └─► NO (< 10K examples)
    │       │
    │       ├─► Can you generate data via the agent itself?
    │       │   (rejection sampling from a stronger model)
    │       │   │
    │       │   ├─► YES → Generate synthetic data → Phase 1 → Phase 2
    │       │   │
    │       │   └─► NO → Memory-only (Phase 2) until you accumulate
    │       │         enough high-Q memories to justify distillation
    │       │
    │       └─► Start with memory-only. Revisit when data accumulates.
    │
    └─► Key constraint: latency
        │
        ├─► Must improve immediately (new deployment, new domain)
        │   → Memory-only (Phase 2) first, fine-tune later
        │
        └─► Can wait 2–4 weeks for first improvement
            → Fine-tune first (Phase 1), then add memory (Phase 2)
```

#### 8.5.7 The Convergence of Training and Runtime Approaches

A key insight from the 2025–2026 period: training-time and runtime evolution are converging. Evidence:

1. **GRPO trains agents with runtime-style rewards.** The rule-based reward function (pass/fail on test cases, correct/incorrect on math) is essentially the same signal that runtime memory systems use to update Q-values. The difference is that GRPO bakes this signal into weights, while MemRL stores it in Q-values.

2. **RetroAgent's RL-trained reflection variant** (Section 8.2.6) trains the reflection mechanism using RL. This is a hybrid: the base policy adapts via runtime memory, but the reflection policy (which determines what to remember) is trained via gradient descent.

3. **Distillation (Phase 3 of the hybrid pipeline)** explicitly converts runtime-learned memories into training data. High-Q memories become SFT examples. Runtime evolution feeds training evolution.

4. **Memento-II's convergence theorem** shows that both approaches are solving the same optimization problem (maximize expected reward in an MDP) — they are different algorithms for the same objective, with different computational tradeoffs.

The practical prediction: by late 2026, the distinction between "training" and "runtime" evolution will blur further. Systems like Hermes Agent's Atropos pipeline (Section 7.7) already close this loop automatically. The trajectory is toward continuous learning systems that seamlessly interleave gradient-based updates (when weights are accessible) with memory-based adaptation (always available), using the same reward signals for both.

#### 8.5.8 Open Problems

Several fundamental questions remain unresolved as of early 2026:

1. **Credit assignment in multi-memory retrieval.** When an agent retrieves 5 memories and succeeds, which memory deserves credit? MemRL's (1/k) factor is a crude approximation. Shapley value-based attribution would be more principled but is combinatorially expensive.

2. **Memory interference.** Can retrieving contradictory memories harm performance? RetroAgent's UCB exploration can surface a memory that contradicts the agent's current strategy, causing confusion. No existing system explicitly detects or resolves memory conflicts.

3. **Scaling laws for memory.** We have scaling laws for model parameters (Chinchilla) and training data (Kaplan et al.). There are no equivalent scaling laws for memory capacity — how many memories does an agent need for a given task complexity? How does memory quality vs quantity trade off?

4. **Forgetting in memory systems.** Humans forget, and forgetting is beneficial — it prevents irrelevant old experiences from interfering with current behavior. MemRL's Q-decay is a simple forgetting mechanism. Is there a principled theory of optimal forgetting for agent memories?

5. **Transfer across environments.** RetroAgent's memories are specific to the environment they were learned in (ALFWorld memories don't help with WebShop). Can memories be abstracted to transfer across environments? This is the memory-system equivalent of domain adaptation in supervised learning.

These open problems define the research frontier for agent evolution. The algorithms in this chapter — GRPO, RetroAgent, MemRL, and the Memento-II framework — provide the foundation. The next generation of work will address these gaps.

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
