# Skill Design Patterns That Enable Evolution

The previous chapters described *what* production agents build — skills, memories, rules. This chapter extracts the *patterns* that make those artifacts evolve effectively. Each pattern comes from a real system: proactive-agent, self-improving-agent, capability-evolver, Hermes, Claude Code, or Devin. Each has been tested against actual user workloads.

Six patterns. Each solves a specific failure mode in agent self-improvement.

---

## Pattern 1: The Heartbeat Pattern

**Source:** `proactive-agent` skill on ClawHub (1,200+ installs)

**The problem:** Agents are reactive. They respond to user messages. But memory and workspace state can become stale between interactions — files get outdated, context drifts, important changes go unnoticed.

**The solution:** A periodic self-check that reviews the agent's entire workspace, identifies gaps or stale information, and triggers updates proactively.

### How It Works

The proactive-agent skill installs a `HEARTBEAT.md` file that the agent is instructed to re-read at regular intervals:

```markdown
<!-- HEARTBEAT.md -->
# Heartbeat Protocol

## Trigger
Every 10 minutes of active session time, OR at session start.

## Procedure
1. Read all workspace files: MEMORY.md, USER.md, TOOLS.md, SOUL.md
2. Read recent conversation history (last 20 messages)
3. Check each file against current reality:
   - Is any information stale? (tools changed, preferences shifted)
   - Is any information missing? (new tool discovered, new pattern observed)
   - Are there contradictions between files?
4. For each gap found:
   - If minor: update the relevant file directly
   - If major: flag for user confirmation before updating
5. Log the heartbeat result to SESSION-STATE.md
```

### Implementation Details

The heartbeat is not a cron job — there is no background scheduler. Instead, the skill injects a trigger condition into the agent's system prompt:

```
After every 10 tool calls, check: have you reviewed HEARTBEAT.md
in this session? If not, do so now. If you have, check whether
10 minutes have elapsed since the last heartbeat. If so, run the
heartbeat protocol.
```

This is a soft trigger — the agent may skip it if deep in a complex task. But in practice, the self-evaluation checkpoint (Pattern 3 in Hermes, every 15 tool calls) provides a natural point to run the heartbeat.

### What the Heartbeat Catches

| Stale State | How Detected | Action |
|-------------|-------------|--------|
| MEMORY.md lists a tool that was removed | Tool inventory check against available tools | Remove stale entry |
| USER.md says "prefers npm" but user switched to pnpm | Recent conversation shows `pnpm` commands | Update preference |
| TOOLS.md missing a newly installed CLI tool | `which` or `command -v` checks | Add tool entry |
| SOUL.md personality traits contradict recent behavior | Conversation analysis shows drift | Flag for user review |

### Why Cron-Like, Not Event-Driven

An event-driven approach (trigger on every file change, every tool install) would be more precise but creates two problems:

1. **Token cost:** Checking after every event is expensive. A 10-minute heartbeat amortizes the cost across many events.
2. **Noise:** Most individual events don't warrant a memory update. The heartbeat batches them, letting the agent identify *patterns* rather than reacting to individual changes.

The heartbeat is a garbage collector for agent state — it runs periodically, identifies dead references, and cleans them up.

---

## Pattern 2: The WAL (Write-Ahead Logging) Pattern

**Source:** `proactive-agent` skill, `SESSION-STATE.md` protocol

**The problem:** LLM context compaction happens unpredictably. When the context window fills, the system summarizes older conversation turns — and that summary loses detail. If the agent hasn't externalized its current state to disk *before* compaction fires, that state is gone.

**The solution:** Write critical state to a file *before* generating the response, not after. The file acts as a write-ahead log — a recovery point that survives compaction.

### The Database Analogy

In databases, a Write-Ahead Log (WAL) ensures durability: the transaction is written to the log *before* it modifies the actual data. If the system crashes mid-operation, the log enables recovery.

For agents, the "crash" is context compaction. The "log" is `SESSION-STATE.md`.

```
Without WAL:
  Agent works on complex task (20 tool calls)
  → Context fills up
  → Compaction fires: summarizes everything into 500 tokens
  → Agent "forgets" intermediate reasoning, partial results, current strategy
  → Agent restarts the task from scratch or makes inconsistent decisions

With WAL:
  Agent works on complex task
  → Every 5 tool calls: writes current state to SESSION-STATE.md
    - What I'm trying to accomplish
    - What I've done so far
    - What I plan to do next
    - Key decisions made and why
  → Context fills up
  → Compaction fires: summarizes conversation
  → Agent reads SESSION-STATE.md: full state recovered
  → Agent continues seamlessly
```

### SESSION-STATE.md Format

```markdown
<!-- SESSION-STATE.md — written by agent, read at compaction recovery -->
# Session State

## Current Objective
Migrating the API from Express to Fastify. User wants zero downtime.

## Progress
- [x] Audit all Express routes (47 routes found)
- [x] Set up Fastify project structure
- [x] Migrate auth middleware (passport → fastify-passport)
- [ ] Migrate route handlers (12/47 done)
- [ ] Update tests
- [ ] Deploy behind feature flag

## Key Decisions
- Using fastify-express compatibility layer for gradual migration
- NOT rewriting route handlers — wrapping them with fastify-express plugin
- User explicitly said: keep Express error handling patterns

## Blockers
- Route /api/webhooks/stripe uses req.rawBody — need to verify
  Fastify equivalent before migrating

## Last Updated
After migrating routes 1-12 (auth, users, teams).
Next: routes 13-24 (projects, deployments).
```

### When to Write

The critical insight: write *before* the response, not after. The sequence is:

```
1. Agent receives user message or tool result
2. Agent updates SESSION-STATE.md with current state    ← WAL write
3. Agent generates response / executes next tool call
4. If compaction happens during step 3, state is safe
```

Writing after the response is too late — compaction may have already fired during response generation.

### Codex Parallel

OpenAI Codex's `POST /responses/compact` endpoint returns `encrypted_content` — a compressed representation of the conversation state. This is a server-side WAL: the state is preserved in the API's storage rather than on the agent's filesystem. But it loses 86.3% of information (see Chapter 9). The filesystem WAL preserves everything the agent writes.

The advantage of the filesystem approach: the agent controls *what* is preserved. A 200-line `SESSION-STATE.md` can capture the 10 most important facts from a 50,000-token conversation. The API's compaction algorithm doesn't have that judgment.

---

## Pattern 3: The Solidification Pipeline

**Source:** `self-improving-agent` skill on ClawHub (OpenClaw ecosystem)

**The problem:** Agents learn things during sessions — a useful command, a gotcha about a library, a user preference. But not every observation deserves permanent storage. Writing every learning to permanent memory creates noise, bloat, and contradictions.

**The solution:** A two-stage pipeline. Accumulate observations in a staging area (`.learnings/`). Promote to permanent files only when evidence accumulates past a threshold.

### The Pipeline

```
Session observations
        │
        ▼
┌──────────────────┐
│  .learnings/     │  Stage 1: Raw observations
│  ├── 2026-04-15  │  - One file per session
│  ├── 2026-04-16  │  - Everything goes here
│  ├── 2026-04-17  │  - No quality filter
│  └── 2026-04-19  │
└────────┬─────────┘
         │
         │  Threshold check: 3+ related observations
         │
         ▼
┌──────────────────┐
│  Permanent files  │  Stage 2: Proven knowledge
│  ├── AGENTS.md   │  - Build commands, conventions
│  ├── TOOLS.md    │  - Available tools, usage patterns
│  └── SOUL.md     │  - Agent personality, communication style
└──────────────────┘
```

### Threshold Logic

The promotion threshold is the critical design parameter. Too low → noise. Too high → useful knowledge never gets promoted.

The `self-improving-agent` uses a **3-observation threshold**:

```
Observation 1 (April 15):
  "User corrected me: use `pnpm` not `npm` for this project"
  → Written to .learnings/2026-04-15.md
  → NOT promoted yet (could be one-time preference)

Observation 2 (April 16):
  "User's CI pipeline uses pnpm. Lock file is pnpm-lock.yaml."
  → Written to .learnings/2026-04-16.md
  → NOT promoted yet (2 observations, threshold is 3)

Observation 3 (April 17):
  "User asked me to add a dependency and I used npm — user corrected
   me again. This is clearly a project-wide convention."
  → Written to .learnings/2026-04-17.md
  → PROMOTED: Add to AGENTS.md: "Package manager: pnpm (not npm)"
```

### Promotion Categories

| Destination | What Gets Promoted | Example |
|-------------|-------------------|---------|
| `AGENTS.md` | Build commands, test commands, project structure, coding conventions | "Run tests: `pnpm test --coverage`" |
| `TOOLS.md` | Available tools, usage patterns, tool-specific gotchas | "ffmpeg is installed; use `-c:v libx264` for H.264" |
| `SOUL.md` | Communication style, personality traits, response preferences | "User prefers terse responses, no emojis" |

### Why Not Promote Immediately

Immediate promotion has three failure modes that the solidification pipeline avoids:

1. **Transient context:** The user says "use npm for this" in one conversation but has pnpm everywhere else. Promoting immediately captures the exception, not the rule.

2. **Contradictory observations:** On Monday the user wants verbose explanations. On Tuesday they want terse responses. With immediate promotion, the memory oscillates. With the pipeline, the agent sees both observations and can identify the pattern (verbose for learning, terse for routine tasks).

3. **Memory bloat:** A 200-line AGENTS.md is useful. A 2,000-line AGENTS.md wastes context tokens and confuses the model. The threshold ensures only repeatedly validated knowledge consumes permanent context budget.

### Dreaming as Batch Solidification

OpenClaw's **Dreaming** process (Chapter 5) is the automated version of this pipeline. During idle periods, Dreaming reviews accumulated daily notes and runs the promotion logic:

```
Dreaming process:
  1. Read all .learnings/ files from the past 7 days
  2. Cluster related observations (semantic similarity)
  3. For each cluster with 3+ observations:
     a. Synthesize into a single statement
     b. Check against existing permanent files for contradictions
     c. If contradiction: resolve using most recent evidence
     d. If new: append to appropriate permanent file
  4. Prune .learnings/ files older than 30 days
```

Dreaming is a garbage collector + promoter + deduplicator in one pass.

---

## Pattern 4: The Genome/Capsule Pattern

**Source:** `capability-evolver` skill on ClawHub

**The problem:** Skills describe procedures. But agents also discover reusable *patterns* (code snippets, configurations, heuristics) and *fixes* (specific solutions to specific bugs). These don't fit the SKILL.md format.

**The solution:** A structured evolution system with three artifact types: genes (reusable patterns), capsules (proven fixes), and an event log (audit trail). Parent IDs create a traceable evolution tree.

### The Three Artifacts

```
┌─────────────────────────────────────────────┐
│  genes.json                                  │
│  Reusable patterns that work across contexts │
│                                              │
│  {                                           │
│    "id": "gene_017",                         │
│    "parent_id": "gene_003",                  │
│    "pattern": "retry-with-backoff",          │
│    "code": "async function retry(fn, ...",   │
│    "contexts_used": 14,                      │
│    "success_rate": 0.93                      │
│  }                                           │
├─────────────────────────────────────────────┤
│  capsules.json                               │
│  Proven fixes for specific failure modes     │
│                                              │
│  {                                           │
│    "id": "cap_042",                          │
│    "parent_id": null,                        │
│    "trigger": "ECONNREFUSED on localhost",   │
│    "fix": "Check if service is running...",  │
│    "verified": true,                         │
│    "times_applied": 7                        │
│  }                                           │
├─────────────────────────────────────────────┤
│  events.jsonl                                │
│  Append-only audit trail                     │
│                                              │
│  {"ts":"...", "type":"gene_created", ...}    │
│  {"ts":"...", "type":"capsule_applied", ...} │
│  {"ts":"...", "type":"gene_mutated", ...}    │
└─────────────────────────────────────────────┘
```

### The Evolution Tree

The `parent_id` field creates a traceable lineage:

```
gene_001: "basic-retry"
  └── gene_003: "retry-with-backoff" (added exponential backoff)
        └── gene_017: "retry-with-backoff-and-jitter" (added jitter)
              └── gene_024: "retry-with-circuit-breaker" (added failure threshold)
```

Each mutation is a new gene with a link to its parent. The events log records *when* and *why* each mutation occurred:

```jsonl
{"ts":"2026-03-12T14:30:00Z","type":"gene_mutated","gene_id":"gene_017","parent_id":"gene_003","reason":"Added jitter after observing thundering herd in retry storms","session":"sess_abc"}
{"ts":"2026-03-19T09:15:00Z","type":"gene_mutated","gene_id":"gene_024","parent_id":"gene_017","reason":"Added circuit breaker after 3 sessions with cascading retry failures","session":"sess_def"}
```

### Genes vs. Skills vs. Capsules

| Artifact | Granularity | Example | Lifetime |
|----------|------------|---------|----------|
| Skill (SKILL.md) | Full procedure (20+ steps) | "Deploy to Kubernetes" | Long (months) |
| Gene (genes.json) | Reusable pattern (1-10 lines) | "Retry with backoff" | Long, evolves via mutation |
| Capsule (capsules.json) | Specific fix (1-5 lines) | "ECONNREFUSED → check port" | Medium (until root cause resolved) |

Skills are *what to do*. Genes are *how to do it well*. Capsules are *what to do when it breaks*.

### Security Concern

The `capability-evolver` skill has a significant security gap: in early versions, genes could contain arbitrary code that the agent executes. Production deployments should add:

1. **Sandboxing:** Execute gene code in an isolated environment
2. **Git tracking:** Every gene mutation is a commit, reviewable by humans
3. **Approval gates:** Genes above a complexity threshold require human approval
4. **Rate limiting:** Maximum N gene mutations per session

The audit trail (events.jsonl) provides forensics but not prevention. Defense in depth is required.

---

## Pattern 5: Progressive Disclosure for Skill Loading

**Source:** Hermes Agent, Claude Code Agent Skills system

**The problem:** A mature agent has 50-200+ skills. Loading all of them into context wastes tokens and confuses the model. The model's attention dilutes over irrelevant skill text, and it may hallucinate tool calls from skills that aren't relevant to the current task.

**The solution:** Three-level progressive disclosure. Load only names and descriptions by default. Fetch full content only when the agent determines a skill is relevant.

### The Three Levels

```
Level 0 — Catalog (always in context)
┌──────────────────────────────────────────────────┐
│  Available skills:                                │
│  - git-interactive-rebase: Clean up commit        │
│    history with squash, fixup, reword, reorder.   │
│  - kubernetes-pod-debugging: Diagnose pod          │
│    failures — CrashLoopBackOff, OOMKilled, etc.   │
│  - python-project-setup: Initialize Python project │
│    with pyproject.toml, ruff, pytest, CI.          │
│  ... (200 more entries)                            │
│                                                    │
│  ~100 tokens per entry = ~20K tokens for 200 skills│
│  With FTS5 search: ~10 relevant × 100 = 1K tokens │
└──────────────────────────────────────────────────┘

Level 1 — Full skill (loaded on demand)
┌──────────────────────────────────────────────────┐
│  skill_view("kubernetes-pod-debugging")           │
│                                                    │
│  Returns: When to Use, Quick Reference, Procedure, │
│  Pitfalls, Verification                            │
│  ~500-1500 tokens                                  │
└──────────────────────────────────────────────────┘

Level 2 — Section (loaded for follow-up detail)
┌──────────────────────────────────────────────────┐
│  skill_view("kubernetes-pod-debugging", "pitfalls")│
│                                                    │
│  Returns: Only the Pitfalls section                │
│  ~100-300 tokens                                   │
└──────────────────────────────────────────────────┘
```

### Why Progressive Disclosure Matters

The token economics are dramatic:

```
200 skills × 800 tokens average = 160,000 tokens (naive loading)
200 skills × 100 tokens (Level 0) = 20,000 tokens (catalog only)
FTS5 narrows to 10 → 1,000 tokens + 1 activated = 1,800 tokens

Savings: 98.9% vs. naive loading
```

But the bigger problem isn't tokens — it's **attention dilution**. When the model sees 160K tokens of skill text, its attention over the user's actual question degrades. The model may follow instructions from an irrelevant skill, hallucinate tool calls mentioned in a different skill's procedure, or lose track of the conversation buried under skill text.

Progressive disclosure keeps the model focused: it sees a short catalog, decides which skill is relevant, then loads only that skill's content.

### The Description Problem (Revisited)

From the Hermes SkillDesignBook:

> *"If a skill doesn't trigger, the problem is almost never the instructions — it's the description."*

The Level 0 catalog is the skill's entire search surface. If the description doesn't match what users actually say, the skill is invisible:

```
Bad description:
  "Kubernetes management"
  → Doesn't match: "my pod keeps crashing"

Good description:
  "Diagnose and fix common Kubernetes pod failures including
   CrashLoopBackOff, ImagePullBackOff, OOMKilled, and pending pods"
  → Matches: "my pod keeps crashing" (CrashLoopBackOff)
  → Matches: "can't pull the image" (ImagePullBackOff)
  → Matches: "pod killed for memory" (OOMKilled)
```

The description should include:
- Technical terms for the problem
- Natural language phrases users actually say
- Specific symptoms and error messages
- 2-4 sentences, under 100 tokens

### Claude Code's Variant

Claude Code implements progressive disclosure through its Agent Skills system with a slightly different architecture:

```
User message arrives
  ↓
Match against skill index (name + description fields only)
  ↓
0 matches → No skills loaded (saves all skill tokens)
1-3 matches → Full skill content loaded into context
4+ matches → Top 3 by relevance score loaded
```

The matching is pure text matching against `name` and `description` — the skill body is never searched for activation. This reinforces the description-first principle: if the skill's name and description don't match the user's intent, the skill's instructions are irrelevant because they'll never be seen.

---

## Pattern 6: The Self-Verification Loop

**Source:** Devin 2.2 (February 2026)

**The problem:** Agents generate plausible output that may be wrong. Traditional CI/CD catches errors after submission. But by then, the context of *why* the code was written is gone — the agent has moved on or the session has ended.

**The solution:** The agent reviews its own output before submitting, catches issues, fixes them, and verifies the fix — all within the same session, while context is still fresh.

### Devin's Loop

Devin 2.2 introduced systematic self-verification as a core workflow step, not an optional add-on:

```
┌────────────────┐
│  1. Plan        │  Break task into steps
└───────┬────────┘
        │
        ▼
┌────────────────┐
│  2. Implement   │  Write code in full Linux sandbox
└───────┬────────┘
        │
        ▼
┌────────────────┐
│  3. Self-Review │  Read own diff, check for issues:
│                 │  - Logic errors
│                 │  - Missing edge cases
│                 │  - Style violations
│                 │  - Security issues
└───────┬────────┘
        │
   Issues found?
   ┌────┴────┐
   │ Yes     │ No
   ▼         ▼
┌────────┐  ┌──────────────────┐
│ 4. Fix │  │ 5. Run tests     │
└───┬────┘  └───────┬──────────┘
    │               │
    └───────────────┤
                    │
               Tests pass?
               ┌────┴────┐
               │ Yes     │ No → back to Fix
               ▼         │
        ┌─────────────┐  │
        │ 6. Visual    │  │
        │    verify    │◄─┘
        │    (desktop) │
        └──────┬──────┘
               │
               ▼
        ┌─────────────┐
        │ 7. Send      │  Screen recording of tests
        │    recording │  attached to PR for review
        │    to user   │
        └─────────────┘
```

### Desktop Verification

Devin has full Linux desktop access — it can open browsers, run GUI applications, and take screenshots. The self-verification loop exploits this:

```
For a frontend change:
  1. Write the code
  2. Run the dev server
  3. Open the browser to the affected page
  4. Screenshot the result
  5. Compare against expected behavior
  6. If wrong: fix and re-screenshot
  7. Record a video of the working feature
  8. Attach video to PR
```

The screen recording serves dual purposes: it forces the agent to verify its work visually (not just by running tests), and it gives the human reviewer a walkthrough of the change.

### Self-Verification as Within-Session Evolution

Self-verification is a form of evolution — but compressed into a single session. The agent:

1. Generates an initial solution (generation 1)
2. Evaluates it against criteria (fitness function)
3. Identifies weaknesses (selection pressure)
4. Produces an improved version (generation 2)
5. Re-evaluates (next fitness check)

This is the same optimize-evaluate-improve loop that cross-session evolution uses for skills and memory. The difference is timescale: self-verification operates in minutes, skill evolution operates over weeks.

### What Self-Verification Catches

From Devin 2.2's published metrics on self-caught issues:

| Issue Type | Frequency | Example |
|-----------|-----------|---------|
| Missing imports | High | Added a function but forgot to import its dependency |
| Incomplete error handling | High | Happy path works but error cases throw unhandled exceptions |
| Test coverage gaps | Medium | Tests pass but don't cover the new code path |
| Style inconsistencies | Medium | New code uses different patterns than surrounding code |
| Logic errors | Low-Medium | Off-by-one errors, wrong comparison operators |
| Security issues | Low | SQL injection, path traversal in user input handling |

### The Limitation

Self-verification catches issues the agent can detect by re-reading its own output. It does not catch:

- **Subtle design errors:** The code works but the approach is wrong for the architecture
- **Performance issues:** The code is correct but creates N+1 queries or O(n²) loops
- **Cross-session learning:** Devin doesn't get better at avoiding the *same* mistakes across sessions

This is the key gap: Devin's self-verification is powerful within a session but creates no persistent improvement. Each new session starts from scratch. Compare with Hermes, where a mistake caught by self-evaluation creates a skill or memory update that prevents the same mistake in future sessions.

---

## Pattern Summary

| Pattern | Source | What It Solves | Persistence |
|---------|--------|---------------|-------------|
| Heartbeat | proactive-agent | Stale memory, missed updates | Across sessions |
| WAL | proactive-agent | State loss during compaction | Within + across sessions |
| Solidification | self-improving-agent | Noise in permanent memory | Across sessions |
| Genome/Capsule | capability-evolver | Granular pattern reuse + fixes | Across sessions |
| Progressive Disclosure | Hermes, Claude Code | Context waste, attention dilution | Within session |
| Self-Verification | Devin 2.2 | Incorrect output before submission | Within session |

### Combining Patterns

No single pattern is sufficient. The most effective agents combine multiple patterns:

```
Hermes:
  Progressive Disclosure + Self-Evaluation (15-call checkpoint)
  + Solidification (SKILL.md creation from observations)

proactive-agent:
  Heartbeat + WAL + Solidification pipeline

capability-evolver:
  Genome/Capsule + audit trail (events.jsonl)

Devin:
  Self-Verification loop (within-session only)
```

The missing combination that no production system implements yet: **Devin's self-verification + Hermes's cross-session learning**. An agent that catches its own mistakes AND creates skills to prevent those mistakes in future sessions would close the loop between within-session and across-session evolution.

### The Pattern Selection Guide

| Your Agent's Primary Failure Mode | Start With |
|-----------------------------------|-----------|
| Forgets things between sessions | Heartbeat + Solidification |
| Loses state during long tasks | WAL |
| Memory gets noisy and contradictory | Solidification pipeline (3-observation threshold) |
| Repeats the same debugging steps | Genome/Capsule |
| Wastes tokens loading irrelevant context | Progressive Disclosure |
| Produces incorrect output on first attempt | Self-Verification loop |
