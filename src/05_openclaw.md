# OpenClaw / ClawHub — The Self-Improving-Agent Skill

OpenClaw (350K+ GitHub stars) is the open-source personal AI agent. ClawHub is its skill marketplace: 13K+ skills, 1.5M+ downloads. You can install a skill that makes the agent self-improving. That sentence is the most interesting thing about this ecosystem.

The agent itself doesn't have a built-in learning loop. The community builds the learning loop *as skills* — installable, composable, and shared through ClawHub. Four of these self-evolution skills have significant adoption.

---

## The Top Self-Evolution Skills (by downloads, April 2026)

| Skill | Downloads | Stars | What It Does |
|-------|----------|-------|-------------|
| **proactive-agent** | 145K | 712 | Hal Stack: SOUL.md + MEMORY.md + HEARTBEAT.md + WAL Protocol |
| **capability-evolver** | 35K | 66 | Genome Evolution Protocol: scan → analyze → propose → validate → apply |
| **self-improving-agent** | 16K | 132 | Perceive gap → search → experiment → solidify |
| **self-evolve** | ~10K | — | Full self-modification authority |

These are not research prototypes. They're installed by real users, run in production, and their download counts reflect actual adoption through the ClawHub marketplace.

---

## proactive-agent (145K downloads) — The Hal Stack

The most downloaded self-evolution skill. It turns OpenClaw into a stateful, memory-retaining agent with autonomous background operations. The implementation is ambitious: 8 workspace files, a write-ahead log protocol, and a compaction recovery system.

### The 8 Workspace Files

| File | Purpose | When Written |
|------|---------|-------------|
| `ONBOARDING.md` | First-session questionnaire results | Once, on install |
| `SOUL.md` | Agent personality, values, behavioral rules | Set by user, rarely changes |
| `USER.md` | Accumulated user profile (preferences, context, history) | Updated continuously |
| `AGENTS.md` | Agent-maintained operational notes | Updated when agent learns |
| `MEMORY.md` | Persistent facts and knowledge base | Updated each session |
| `SESSION-STATE.md` | Current session status, active tasks, blockers | Updated per interaction |
| `HEARTBEAT.md` | Autonomous cron schedule and status | Updated by cron system |
| `memory/YYYY-MM-DD.md` | Daily session logs | Created daily |

### WAL Protocol (Write-Ahead Logging)

Borrowed from database systems. The agent records critical details *before* responding to the user:

```
1. User sends message
2. Agent reads all 8 workspace files
3. Agent writes intent + key facts to SESSION-STATE.md
   (the write-ahead log)
4. Agent generates response
5. Agent updates MEMORY.md, USER.md, AGENTS.md as needed
```

The WAL exists because LLM context windows can be truncated. If the context is compacted mid-conversation, the agent loses its working memory. With WAL, it recovers by reading SESSION-STATE.md.

### Working Buffer

During the "compaction danger zone" (when the context window is 70%+ full), the agent captures the current exchange in a working buffer within SESSION-STATE.md. This is the minimum viable context the agent needs to continue operating coherently after truncation.

### Compaction Recovery

When context truncation occurs:

1. Agent detects reduced context (system notification or missing conversation history)
2. Reads SESSION-STATE.md for the working buffer and last known state
3. Reads MEMORY.md for persistent facts
4. Reads USER.md for user profile
5. Reconstructs conversational coherence from these files
6. Resumes — the user may not notice the truncation happened

### Autonomous Crons vs. Prompted Crons

The Hal Stack includes a cron system with two modes:

| Mode | Trigger | Execution Context |
|------|---------|-------------------|
| **Autonomous Crons** | `systemEvent` — timer fires automatically | Isolated `agentTurn` — agent runs without user input |
| **Prompted Crons** | User interaction triggers a check | Within the existing conversation turn |

Autonomous crons enable background operations: the agent can check for updates, run maintenance on its memory, review and consolidate learnings, or execute scheduled tasks. The HEARTBEAT.md file tracks what ran, when, and whether it succeeded.

---

## capability-evolver (35K downloads) — The Genome Evolution Protocol

This skill treats the agent's capabilities as a genome that evolves through a structured cycle. It's the most systematically designed self-evolution skill in the ecosystem.

### The Evolution Cycle

```
Scan → Analyze → Propose → Validate → Apply
  │                                      │
  └──────────── feedback ────────────────┘
```

1. **Scan**: Examine recent interactions for capability gaps, failures, and inefficiencies
2. **Analyze**: Compare against known patterns (genes) and proven fixes (capsules)
3. **Propose**: Generate candidate improvements with expected impact
4. **Validate**: Test proposed changes against known-good baselines
5. **Apply**: Commit the change to the agent's configuration or skills

### Three Persistence Files

| File | Format | Contents |
|------|--------|----------|
| `genes.json` | JSON array | Reusable patterns — successful strategies that the agent has discovered |
| `capsules.json` | JSON array | Proven fixes — specific solutions to specific problems, with context |
| `events.jsonl` | JSON Lines | Audit trail — every evolution event timestamped and categorized |

### Six Strategies

The skill supports different evolution modes depending on the team's risk tolerance:

| Strategy | Behavior |
|----------|----------|
| `balanced` | Default. Even mix of improvement and stabilization |
| `innovate` | Bias toward trying new approaches, higher risk tolerance |
| `harden` | Focus on robustness and error reduction, minimal experimentation |
| `repair-only` | Only fix broken things, no proactive improvement |
| `early-stabilize` | Aggressive stabilization for new deployments |
| `steady-state` | Minimal changes, only evolve when metrics degrade |

### Three Execution Modes

| Mode | Human Involvement | Use Case |
|------|-------------------|----------|
| **Fully automated** | None — agent decides and applies | Personal assistants, low-risk tasks |
| **Human-in-the-loop** | Agent proposes, human approves | Production systems, team environments |
| **Continuous background** | Runs on schedule, queues proposals for review | Enterprise deployments |

---

## self-improving-agent (16K downloads) — The Solidification Mechanism

This skill implements a specific learning pattern: observe a gap, search for solutions, test them, and promote the winner to permanent agent configuration.

### The Improvement Loop

```
Perceive Gap
    │
    ▼
Search Solutions (web, docs, existing skills)
    │
    ▼
Design Experiment (hypothesis + test)
    │
    ▼
Run Experiment
    │
    ▼
Select Winner (if multiple candidates)
    │
    ▼
Solidify (promote to permanent configuration)
```

### Solidification = Promotion

Raw learnings start in `.learnings/` as timestamped markdown files. The key mechanism is *promotion* — moving a validated learning from the scratch directory to permanent agent configuration:

| Promotion Target | When Used |
|-----------------|-----------|
| `.learnings/` | Initial capture — raw, unvalidated |
| `AGENTS.md` | Operational knowledge the agent should always have |
| `TOOLS.md` | Tool-specific usage patterns and gotchas |
| `SOUL.md` | Behavioral rules and personality adjustments |
| `CLAUDE.md` | Claude Code memory integration (cross-platform) |

### Heartbeat-Driven Consolidation

The skill includes a cron that periodically scans `.learnings/` for items with 3+ related issues. When it finds a cluster, it:

1. Groups related learnings
2. Synthesizes a consolidated insight
3. Promotes the synthesis to the appropriate target file (AGENTS.md, TOOLS.md, etc.)
4. Archives the individual learning files

This prevents the `.learnings/` directory from growing unbounded while ensuring validated patterns graduate to permanent memory.

---

## Security Warnings

Every self-evolution skill in ClawHub carries security flags. The warnings are explicit:

```
⚠ This skill can:
  - Execute shell commands
  - Modify configuration files
  - Access system files
  - Write to the filesystem
  - Modify its own behavior
```

An agent that can rewrite its own skills can also rewrite its own constraints. Five mitigation patterns have emerged across the ecosystem:

| Pattern | Implementation | Limitation |
|---------|---------------|-----------|
| **Sandboxing** | Run agent in Docker/VM, limit filesystem access | Reduces capability alongside risk |
| **Git tracking** | All skill/config changes committed to a repo | Audit trail only — doesn't prevent bad changes |
| **Human approval** | Agent proposes changes, human approves | Latency; defeats the purpose of autonomy |
| **Rate limiting** | Cap skill mutations per session (e.g., max 3 edits) | Arbitrary threshold; doesn't distinguish good from bad |
| **Constitution file** | Immutable rules the agent cannot modify (SOUL.md pattern) | Agent can still work around constraints via new skills |

None of these are complete solutions. The fundamental tension: an agent powerful enough to improve itself is powerful enough to break itself. The community consensus is to combine sandboxing + git tracking + rate limiting as a practical baseline, with human approval for production deployments.

The `self-evolve` skill (10K downloads) takes the opposite position — it grants the agent full self-modification authority with minimal guardrails. Its README is explicit: "This skill gives the agent complete control over its own evolution. Use at your own risk." It exists, it has adoption, and it represents a real design choice in the ecosystem.
