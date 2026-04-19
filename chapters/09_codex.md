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

## Memory Preview (April 2026)

### Cross-Session Memory

In April 2026, OpenAI announced a Memory Preview for Codex — the ability to retain context across sessions, similar to ChatGPT's memory feature but for coding agents.

The announced capabilities:

| Feature | Description |
|---------|-------------|
| Session memory | Retains facts, preferences, and decisions from prior sessions |
| Scheduled work | Can schedule future tasks and auto-wake to execute them |
| Project continuity | Remembers project state, open issues, and in-progress work |
| Memory management | Users can view, edit, and delete stored memories |

### How It Differs from AGENTS.md

AGENTS.md is static — it changes only when a human edits it. Memory Preview is dynamic — the agent stores memories automatically based on interactions:

```
AGENTS.md (static):
  Human writes: "Use vitest, not jest"
  Persists until human removes it
  Available to all agents working on this repo

Memory Preview (dynamic):
  Agent infers: "This user prefers concise PR descriptions"
  Stored automatically after the interaction
  Available to this user's future sessions (not repo-wide)
```

The combination is powerful: AGENTS.md for project-level facts that apply to all developers, Memory Preview for user-level preferences that follow the individual.

### Auto-Wake and Scheduled Work

The most novel feature in the Memory Preview: agents that can schedule future work.

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

This is a step toward persistent agent identity — the agent doesn't just remember past sessions, it plans for future ones. But the implementation details (how memory is stored, how scheduling works, what the token budget is) are not yet fully public.

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
│  ├── Memory Preview (auto-learned, user-level)│
│  └── Scheduled work (auto-wake for future)   │
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

Codex is the most transparent agent system about its own limitations. The compaction endpoint makes information loss explicit. The subagent architecture provides a structural mitigation. But the fundamental challenge remains: most of what the agent learns within a session is lost when the session ends or compacts.

The file system — AGENTS.md, progress files, externalized state — is the only evolution mechanism that survives compaction intact. For Codex agents, writing to files is not optional; it's the only durable memory.
