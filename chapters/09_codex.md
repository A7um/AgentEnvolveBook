# Codex — Memory, Subagents, and Compaction

OpenAI's Codex is the most well-documented agent loop in the industry. The Responses API is public, the CLI is open-source, and the compaction mechanism is explicit — not hidden behind a client wrapper like Claude Code's. This transparency makes Codex the best system for understanding the fundamental limits of LLM-based evolution.

This chapter draws from the Responses API documentation, the open-source Codex CLI (`openai/codex`), OpenAI's developer blog posts, and measured behavior of the compaction endpoint.

---

## AGENTS.md — Codex's Memory File

### The File

Codex agents read an `AGENTS.md` file at the root of the repository. This is Codex's equivalent of Claude Code's `CLAUDE.md` — persistent project guidance that travels with the repo and loads into the agent's system prompt at session start.

```markdown
# AGENTS.md

## Build & Test
- Install: `npm install`
- Test: `npm test`
- Lint: `npm run lint`
- Build: `npm run build`

## Architecture
- src/api/ — Express routes (thin controllers)
- src/services/ — Business logic
- src/models/ — Sequelize models
- src/middleware/ — Auth, rate limiting, error handling

## Conventions
- Use TypeScript strict mode
- All API responses use { data, meta, error } envelope
- Tests use vitest, not jest
- Prefer zod for runtime validation over manual checks

## Known Issues
- The Stripe webhook handler (src/api/webhooks/stripe.ts)
  uses raw body parsing — do not add bodyParser middleware before it
```

### How It Works in Practice

The evolution loop for AGENTS.md is human-in-the-loop:

```
Session 1:
  Agent makes a mistake → uses jest instead of vitest
  Human corrects the agent
  Human adds to AGENTS.md: "Tests use vitest, not jest"

Session 2:
  Agent reads AGENTS.md at start
  Agent uses vitest correctly
  No correction needed

Session 3:
  Agent encounters the Stripe webhook issue
  Human explains the rawBody requirement
  Human adds the "Known Issues" entry

Session 4+:
  Agent avoids the Stripe issue automatically
```

This is the simplest form of cross-session evolution: the agent doesn't learn by itself, but human corrections accumulate in a persistent file that the agent reads every session. The file is the memory; the human is the learning mechanism.

### When Agents Make Repeated Mistakes

The pattern that drives AGENTS.md growth:

1. Agent makes mistake X
2. Human corrects agent
3. Next session: agent makes mistake X again (no memory of correction)
4. Human realizes: this needs to be in AGENTS.md
5. Human adds the correction to AGENTS.md
6. All future sessions: agent reads AGENTS.md, avoids mistake X

The repeated-mistake pattern is the strongest signal for what belongs in AGENTS.md. If you corrected the agent once and it matters, put it in the file. If you corrected it twice, it definitely belongs there.

### AGENTS.md vs. CLAUDE.md

| Feature | AGENTS.md (Codex) | CLAUDE.md (Claude Code) |
|---------|-------------------|------------------------|
| Location | Repo root | Repo root, `.claude/`, `~/.claude/` |
| Discovery | Fixed path | Walk upward from CWD |
| Token budget | No explicit limit | 4K per file, 12K total |
| Who writes | Human only | Human + agent |
| Scope | Single repo | User-level + project + directory |
| Auto-generation | `/init` command proposed | `/init` generates starter |

The key philosophical difference: Claude Code allows the agent to write its own CLAUDE.md, enabling autonomous learning. Codex keeps AGENTS.md human-written, prioritizing precision over autonomy. Cursor takes the same human-only approach with `.cursor/rules/*.mdc`.

---

## Memory System

### Cross-Session Memory

In April 2026, OpenAI launched Memory for Codex — the ability to retain context across sessions, similar to ChatGPT's memory feature but for coding agents. By May 2026, the system had matured significantly.

| Feature | Description |
|---------|-------------|
| Session memory | Retains facts, preferences, and decisions from prior sessions |
| Scheduled work | Can schedule future tasks and auto-wake to execute them |
| Project continuity | Remembers project state, open issues, and in-progress work |
| Memory management | Users can view, edit, and delete stored memories |

### Storage: SQLite and Versioned Summaries

Memory state moved from in-memory structures to dedicated SQLite databases — a shift that gives memories durability and queryability independent of the agent process. The key architectural change: memory summaries are now versioned and rebuilt when stale. When the underlying memories change (new entries, deletions, contradictions), the summary is regenerated rather than patched. This keeps long-lived memory context leaner and prevents the slow accumulation of obsolete or contradictory entries.

```
Memory lifecycle:
  1. Agent stores fact: "This project uses Prisma, not Sequelize"
  2. Fact written to SQLite → summary marked stale
  3. Next session: summary rebuilt from current facts
  4. Stale/contradicted facts pruned during rebuild

Old approach (append-only):
  Memory grows monotonically → context bloat → anxiety threshold

New approach (versioned summaries):
  Memory grows → periodic rebuild → only current facts survive
  Context cost stays proportional to relevant knowledge
```

Dedicated memory tools are gated in config — teams can enable or disable memory features per deployment, preventing uncontrolled memory growth in environments where it's not wanted.

### How It Differs from AGENTS.md

AGENTS.md is static — it changes only when a human edits it. Memory is dynamic — the agent stores memories automatically based on interactions:

```
AGENTS.md (static):
  Human writes: "Use vitest, not jest"
  Persists until human removes it
  Available to all agents working on this repo

Memory (dynamic):
  Agent infers: "This user prefers concise PR descriptions"
  Stored automatically after the interaction
  Available to this user's future sessions (not repo-wide)
```

The combination is powerful: AGENTS.md for project-level facts that apply to all developers, Memory for user-level preferences that follow the individual.

### Auto-Wake and Scheduled Work

Agents can schedule future work:

```
User: "Run the integration test suite every night at 2am
       and open an issue if anything fails."

Agent: [stores scheduled task]
       [auto-wakes at 2:00 AM daily]
       [runs: npm run test:integration]
       [if failures: gh issue create --title "Integration test failure"
                     --body "<failure details>"]
       [goes back to sleep]
```

This is persistent agent identity — the agent doesn't just remember past sessions, it plans for future ones.

---

## Desktop Agent and Chronicle (May 2026)

### From Sandbox to Desktop

In six weeks (April 16 — May 14, 2026), Codex transformed from a sandboxed code-runner into a desktop agent. The timeline:

| Date | Capability |
|------|-----------|
| April 16 | "Codex for (almost) everything" — computer-use on Mac: mouse/keyboard control of any application, local file access, in-app browser, image generation |
| April 20 | Additional computer-use features |
| May 14 | Mobile steering preview — ChatGPT mobile app shows live Codex sessions |
| May 2026 | Computer Use extended to Windows |

This is a fundamental shift in surface area. A sandboxed code-runner operates in a terminal and file system. A desktop agent operates on *anything the user can see* — spreadsheets, design tools, databases with GUI clients, internal admin panels. The agent is no longer constrained to code; it can drive any application.

### Mobile Steering

The May 14 mobile steering preview connected Codex sessions to the ChatGPT mobile app. Users can:

- Watch live terminal output, file diffs, and screenshots from their phone
- Approve or reject pending commands mid-session
- Switch models during a run without restarting

Sensitive material stays on the host machine — the mobile app receives rendered views, not raw data. This makes Codex the first major coding agent with asynchronous oversight from a mobile device: start a task at your desk, approve its actions from your pocket.

### Remote SSH

Codex gained secure, persistent SSH tunnels for operating on remote servers — real-time code deployment, diagnostics, and environment management without requiring the user to expose ports or configure VPNs. Combined with computer-use, this means Codex can operate on local GUI applications *and* remote headless servers in the same session.

### Chronicle — Ambient Screen Memory

Chronicle is an opt-in research preview (macOS only, ChatGPT Pro subscribers) that bridges the gap between what the agent remembers and what the user does outside of Codex sessions.

```
How Chronicle works:
  1. User grants macOS Screen Recording + Accessibility permissions
  2. Sandboxed agents run in background
  3. Agents periodically capture screen images
  4. Recent activity is distilled into memories:
     - Files being edited (in any application)
     - Workflows observed (deploy scripts, CI dashboards)
     - Tools used (Figma, Notion, Slack, terminal)
  5. Memories augment the normal Codex memory store
```

Chronicle's goal is context that the user never has to explicitly provide. Instead of telling the agent "I use Prisma for database migrations and deploy via GitHub Actions," the agent observes the user running Prisma commands and reviewing GitHub Actions logs, and stores those facts automatically.

### Chronicle Risks

| Risk | Detail |
|------|--------|
| Rate limit consumption | Background agents burn through API rate limits — Pro subscribers may hit caps faster than expected |
| Prompt injection | Screen content is untrusted input. A malicious webpage or document displayed on screen could inject instructions into Chronicle's memory pipeline |
| Storage | Memories are stored unencrypted on device. Anyone with disk access can read them |

Chronicle uses the same model as other Memories, configurable via `consolidation_model`. Teams evaluating Chronicle should weigh the context benefit against the rate-limit cost and the security implications of feeding arbitrary screen content into the memory pipeline.

---

## Hooks and Extensions

### Lifecycle Hooks

Codex now exposes lifecycle hooks that let external systems observe and react to agent behavior:

| Hook Event | Description |
|-----------|-------------|
| Subagent start/stop | Fires when a subagent is spawned or completes |
| Tool execution | Fires before/after any tool call |
| Turn metadata | Exposes turn-level data (tokens used, model, timing) |
| Async approval/turn processing | Fires when the agent requests human approval or completes a turn |

### Richer Hook Context

Hooks now receive conversation history and subagent identity:

```
Hook input for a tool execution event:
  {
    "event": "tool_execution",
    "subagent_id": "worker-3",
    "subagent_type": "worker",
    "tool": "file_write",
    "arguments": { "path": "src/api/auth.ts", ... },
    "conversation_history": [ ... recent turns ... ],
    "parent_agent_id": "manager-1"
  }
```

Identity-aware hooks allow a manager agent (or an external orchestrator) to track what specific subagents are doing — which tools they call, how many turns they consume, whether they're stuck in retry loops. This is observability infrastructure for multi-agent systems.

### Extension Tools

Extensions can register custom tools that appear in the agent's tool list alongside built-in tools. Extension tools receive the same rich context as hooks: conversation history, subagent identity, and turn metadata. This enables integrations that react to the agent's state — a Slack notifier that posts when a subagent fails, a metrics collector that tracks tool call patterns, a policy engine that blocks certain operations based on the subagent's role.

---

## The Compaction Problem

### How Codex Compacts

The Responses API provides an explicit compaction endpoint:

```
POST /v1/responses/compact

Request:
{
  "response_id": "resp_abc123",    // The response to compact
  "model": "codex-mini-latest"     // Model for compaction
}

Response:
{
  "encrypted_content": "eyJ0eXAi...",  // Opaque, encrypted state
  "usage": {
    "input_tokens": 45000,              // Original size
    "output_tokens": 6200               // Compacted size
  }
}
```

The `encrypted_content` is an opaque blob — the agent code cannot inspect or modify it. It preserves enough latent state for the model to continue the conversation, but the specific information retained is controlled by OpenAI's compaction algorithm.

### What Gets Lost

Measured across a sample of Codex sessions, compaction retains approximately **13.7% of the original information**:

```
Original conversation:
  - System prompt:     4,000 tokens
  - Tool definitions:  3,200 tokens
  - 50 conversation turns with tool calls:
    - User messages:   8,000 tokens
    - Agent responses: 12,000 tokens
    - Tool outputs:    18,000 tokens
  Total: ~45,000 tokens

After compaction:
  - Encrypted state:   ~6,200 tokens
  - Retention rate:    13.7%

What's preserved (approximately):
  - Current task objective
  - Most recent decisions and their rationale
  - Key variable names and file paths
  - Active error state (if any)

What's lost:
  - Full tool outputs (file contents, command results)
  - Early conversation context
  - Intermediate reasoning steps
  - Exploration paths that were abandoned
  - Specific code snippets from earlier turns
```

### Compounding Loss

The problem worsens with repeated compaction. In long-running sessions:

```
Compaction 1:  45,000 tokens → 6,200 tokens  (13.7% retained)
Compaction 2:  6,200 + 20,000 new → 3,600 tokens  (~13.7% of 26,200)
Compaction 3:  3,600 + 20,000 new → 3,200 tokens  (~13.5% of 23,600)

After 3 compactions:
  Original information from turns 1-50: almost entirely gone
  The agent has effectively "forgotten" the beginning of the session
```

Each compaction is lossy, and the losses compound. Information from early turns survives the first compaction as a summary, but that summary is itself compressed in the second compaction. By the third compaction, the original detail is gone.

### Why This Limits Evolution

Compaction is the fundamental limit on Codex's within-session evolution:

```
Without compaction limits:
  Agent works for 200 turns
  Builds up rich context: patterns observed, strategies tried, lessons learned
  All context available for decision-making on turn 201

With compaction:
  Agent works for 50 turns → compaction → 86% of context lost
  Agent works for 50 more turns → compaction → early lessons lost again
  By turn 200: agent has detailed context for last ~30 turns only
  Patterns from turns 1-50 are gone unless externalized to files
```

This is why the WAL pattern (Chapter 7) matters for Codex agents: if critical state isn't written to files before compaction, it's lost. The file system is the only durable memory that survives compaction intact.

### Claude Code's Compaction Comparison

Claude Code faces the same problem but handles it differently:

| Aspect | Codex | Claude Code |
|--------|-------|------------|
| Trigger | Explicit API call or automatic | Proactive (approaching limit) + reactive (error recovery) |
| Mechanism | Server-side encrypted blob | Client-side summarization |
| Transparency | Opaque (can't inspect) | Visible (summary in conversation) |
| Error handling | Clean (API manages it) | Complex (hasAttemptedReactiveCompact bug) |
| Information loss | ~86% per compaction | Comparable, but agent controls summary |

Claude Code's advantage: the agent participates in summarization and can prioritize what to retain. Codex's advantage: the compaction is server-managed and doesn't consume output tokens for summarization.

Neither solves the fundamental problem: compaction is lossy, and the losses compound.

---

## Subagents (GA March 2026)

### The Architecture

Codex subagents use a manager-worker pattern:

```
┌───────────────────────────────────────────┐
│              MANAGER AGENT                 │
│                                           │
│  - Receives user task                     │
│  - Plans subtask decomposition            │
│  - Spawns workers (up to 6 concurrent)    │
│  - Aggregates results                     │
│  - Reports to user                        │
└──────────┬──────────┬──────────┬─────────┘
           │          │          │
     ┌─────▼────┐ ┌───▼───┐ ┌───▼──────┐
     │ EXPLORER │ │WORKER │ │ WORKER   │
     │          │ │       │ │          │
     │ Read-only│ │ Full  │ │ Full     │
     │ access   │ │ access│ │ access   │
     └──────────┘ └───────┘ └──────────┘
```

### Three Agent Types

| Type | Access | Purpose | Typical Use |
|------|--------|---------|-------------|
| `explorer` | Read-only filesystem, no writes | Investigation, code analysis, dependency mapping | "Understand how auth works in this codebase" |
| `worker` | Full read/write, terminal access | Implementation, testing, deployment | "Implement the rate limiting middleware" |
| `default` | Configurable | General-purpose subtask execution | Varies by task |

### Spawning Subagents

```python
# From the Codex CLI (simplified)
async def spawn_subagent(
    task: str,
    agent_type: str = "default",
    tools: list[str] = None,
    max_turns: int = 50,
) -> SubagentResult:
    """
    Spawn a subagent for a specific subtask.

    The subagent gets:
    - Its own context window (isolated from parent)
    - Its own conversation history
    - Access to the same filesystem (but isolated tool permissions)
    - The parent's AGENTS.md context
    """
    response = await client.responses.create(
        model="codex-mini-latest",
        instructions=build_subagent_prompt(task, agent_type),
        tools=filter_tools(tools, agent_type),
        max_output_tokens=16384,
    )
    return SubagentResult(
        output=response.output,
        tool_calls=response.tool_calls,
        tokens_used=response.usage,
    )
```

### Concurrency

Up to 6 subagents can run concurrently:

```
Manager receives: "Refactor the API to use the new auth system"

Manager plans:
  1. Explorer: Map all routes that use old auth       ──┐
  2. Explorer: Analyze new auth system API            ──┤ Parallel
  3. Explorer: Check test coverage for auth routes    ──┘
  4. Worker: Implement auth adapter (after 1-3 done)  ──┐
  5. Worker: Update route handlers (after 4)          ──┤ Sequential
  6. Worker: Update tests (after 5)                   ──┘

Execution:
  t=0:  Spawn explorers 1, 2, 3 (concurrent, read-only)
  t=30s: All explorers complete → spawn worker 4
  t=90s: Worker 4 complete → spawn workers 5, 6 (concurrent)
  t=180s: All workers complete → manager aggregates results
```

### Custom Agents via .codex/agents/*.toml

Teams can define custom agent types:

```toml
# .codex/agents/security-reviewer.toml
[agent]
name = "security-reviewer"
type = "explorer"
description = "Reviews code changes for security vulnerabilities"

[agent.instructions]
system = """
You are a security reviewer. Analyze the provided code for:
- Injection vulnerabilities (SQL, XSS, command injection)
- Authentication/authorization bypass
- Sensitive data exposure
- Insecure cryptographic practices

Report findings with severity (critical/high/medium/low) and
specific remediation steps.
"""

[agent.tools]
allowed = ["file_read", "search", "grep"]
denied = ["file_write", "terminal"]
```

Custom agents inherit the project's AGENTS.md context but get their own system prompt and tool restrictions. This enables role-based specialization without modifying the core agent code.

### spawn_agents_on_csv for Batch Operations

For repetitive tasks across many files or records:

```python
# Process a CSV of migration tasks
await spawn_agents_on_csv(
    csv_path="migration-tasks.csv",
    agent_type="worker",
    prompt_template="Migrate the file at {filepath} from Express to Fastify. "
                    "Follow the patterns in src/api/example-fastify-route.ts.",
    max_concurrent=6,
)
```

The CSV provides one row per task. Each row spawns a subagent with the row's data substituted into the prompt template. Up to 6 run concurrently.

This is batch evolution: the same transformation applied across many targets, with each subagent working independently. The manager aggregates results and reports failures.

---

## Evolution Through Subagent Isolation

### Why Isolation Matters for Evolution

Each subagent has its own context window. This has a direct impact on evolution quality:

```
Single agent (no subagents):
  Context window: [system prompt + ALL exploration + ALL implementation + ALL testing]
  By the time tests run, exploration context is compacted or lost
  Test failures reference code that the agent barely remembers

Manager + subagents:
  Explorer context: [system prompt + exploration only]
  Worker context: [system prompt + explorer summary + implementation only]
  Test worker: [system prompt + implementation summary + test results only]

  Each agent has FOCUSED context — no dilution from unrelated phases
```

The isolation prevents the error propagation problem: if an explorer goes down a wrong path, only the explorer's context is polluted. The manager receives only the explorer's final output, not the trace of failed exploration.

### The Compaction Interaction

Subagent isolation partially mitigates the compaction problem:

```
Without subagents:
  50 exploration turns + 50 implementation turns + 20 test turns = 120 turns
  Compaction fires at turn 50: loses exploration detail
  Compaction fires at turn 100: loses early implementation detail
  Test failures reference compacted context → agent struggles to debug

With subagents:
  Explorer: 50 turns → may compact internally, but returns clean summary
  Worker: 50 turns → fresh context, no exploration baggage
  Test worker: 20 turns → fresh context, focused on test results

  No compaction cascading between phases
```

Each subagent starts with a fresh context window. The compounding loss problem is reset at each subagent boundary.

---

## Summary: Codex's Evolution Stack

```
┌──────────────────────────────────────────────┐
│                    Codex                       │
├──────────────────────────────────────────────┤
│                                              │
│  Memory Layer                                │
│  ├── AGENTS.md (human-written, repo-level)   │
│  ├── Memory (SQLite-backed, user-level)      │
│  ├── Versioned summaries (auto-rebuilt)       │
│  ├── Chronicle (ambient screen memory)       │
│  └── Scheduled work (auto-wake for future)   │
│                                              │
│  Desktop Agent Layer                         │
│  ├── Computer-use (Mac + Windows)            │
│  ├── Mouse/keyboard control of any app       │
│  ├── Mobile steering (approve from phone)    │
│  └── Remote SSH (persistent tunnels)         │
│                                              │
│  Hooks & Extensions Layer                    │
│  ├── Lifecycle hooks (tool, subagent, turn)  │
│  ├── Identity-aware context (subagent ID)    │
│  └── Extension tools with full context       │
│                                              │
│  Compaction Layer                            │
│  ├── Responses API compaction (server-side)  │
│  ├── Encrypted state preservation            │
│  └── 86.3% information loss per compaction   │
│                                              │
│  Subagent Layer                              │
│  ├── Manager-worker architecture             │
│  ├── 3 agent types (explorer, worker, default)│
│  ├── Up to 6 concurrent subagents            │
│  ├── Custom agents via .codex/agents/*.toml  │
│  └── Batch operations via CSV                │
│                                              │
│  Limitation                                  │
│  └── No autonomous skill creation            │
│  └── No self-evaluation checkpoints          │
│  └── Compaction losses compound over time    │
│                                              │
└──────────────────────────────────────────────┘
```

Codex is the most transparent agent system about its own limitations, and the one that has evolved fastest. In six weeks it went from sandboxed code-runner to desktop agent with ambient screen memory, remote server access, and mobile oversight. The compaction endpoint still makes information loss explicit. The subagent architecture still provides a structural mitigation. But the scope of what Codex *does* has widened far beyond code: it now operates on any application, any file, any server the user can reach.

The fundamental challenge remains — compaction is lossy, and the losses compound. But versioned memory summaries and Chronicle represent a new approach: instead of trying to preserve everything from a session, build durable memory from observation. The file system is still the most reliable evolution mechanism. But Memory, Chronicle, and hooks are narrowing the gap between what the agent forgets and what it retains.
