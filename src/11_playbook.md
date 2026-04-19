# The Production Self-Evolution Playbook

This chapter synthesizes every pattern from the previous ten chapters into a single actionable guide. Five levels, from "you can do this today" to "proceed with extreme caution." Each level references the production system that does it best and the specific implementation details.

---

## Level 1: Filesystem Memory (Day 1)

**Effort:** 30 minutes. **Impact:** Immediate.

Every agent should have this. It is the single highest-ROI intervention in agent self-evolution: a plain-text file that loads into the system prompt at session start.

### What to Create

Create one file at the root of your project:

```markdown
# CLAUDE.md / AGENTS.md / GEMINI.md

## Build & Test
- Install: `pnpm install`
- Test: `pnpm test`
- Lint: `pnpm run lint`
- Type check: `tsc --noEmit`

## Architecture
- src/api/ — FastAPI routes (thin controllers)
- src/services/ — Business logic (no I/O)
- src/models/ — SQLAlchemy models
- src/workers/ — Celery task definitions

## Coding Conventions
- Use dataclasses, not dicts, for structured data
- All public functions need docstrings (Google style)
- Tests use pytest with fixtures in conftest.py
- Prefer pathlib over os.path

## Known Gotchas
- The Stripe webhook handler uses raw body — don't add
  middleware that parses the body before it
- Redis connection pool maxes at 20 — don't open more
  in tests or CI will hang
```

### Sizing Rules

From production data across Claude Code, Codex, and Cursor:

| Metric | Recommended | Why |
|--------|------------|-----|
| Total length | 50-200 lines | Longer wastes context (see context anxiety, Chapter 10) |
| Token count | 1K-4K tokens | Claude Code caps at 4K per file for a reason |
| Sections | 3-6 | More than 6 and the model's attention dilutes |
| Per-entry length | 1-2 lines | Concise entries are more reliably followed |

### Which File Name

| System | File | Auto-loaded |
|--------|------|------------|
| Claude Code | `CLAUDE.md` | Yes (discovered by walking CWD upward) |
| Codex | `AGENTS.md` | Yes (fixed path at repo root) |
| Gemini | `GEMINI.md` | Yes (repo root) |
| Cursor | `.cursor/rules/*.mdc` | Yes (glob-matched or always-apply) |
| All agents | `README.md` | Usually included in context by default |

If your team uses multiple AI tools, maintain parallel files or use a single `AGENTS.md` (the most tool-agnostic name).

### The /init Pattern

Both Claude Code and Codex offer (or propose) an `/init` command that auto-generates a starter memory file by scanning the project:

```
/init scans:
  - package.json / pyproject.toml / Cargo.toml → build commands
  - .github/workflows/ → CI configuration
  - Directory structure → architecture overview
  - .eslintrc / ruff.toml / rustfmt.toml → coding conventions
  - README.md → project description
```

If your tool doesn't have `/init`, manually create the file. The 30 minutes you spend is repaid across every future session.

---

## Level 2: Auto-Learning (Week 1)

**Effort:** 1-4 hours setup. **Impact:** Compounds over weeks.

Manual memory files are a start. But the real value comes when the agent *automatically* extracts learnings from interactions and updates memory without human intervention.

### Cursor Approach: Continual-Learning Plugin

Cursor's continual-learning system works via hooks:

```
Session ends (stop hook fires)
  ↓
Transcript mining:
  - Extract corrections: "No, use pnpm not npm"
  - Extract preferences: "I prefer concise responses"
  - Extract facts: "This project uses Postgres 15"
  ↓
AGENTS.md update:
  - Deduplicate against existing entries
  - Add new entries in appropriate sections
  - Remove contradicted entries
```

The key design decision: updates happen at session end, not during the session. This avoids the noise of mid-session observations that may not be significant.

### Claude Code Approach: Auto Memory

Claude Code stores auto-generated memories in `~/.claude/projects/[project]/memory/`:

```
~/.claude/
  projects/
    my-api/
      memory/
        2026-04-15-auth-patterns.md
        2026-04-16-test-conventions.md
        2026-04-19-deployment-notes.md
```

Constraints:
- **200 lines maximum** per memory file
- **25KB total** across all project memory files
- Auto-pruned when limits are exceeded (oldest entries dropped)
- User can view and edit stored memories

The cap is deliberate — it prevents the context anxiety problem (Chapter 10) where accumulated memory consumes too much of the context window.

### Windsurf Approach: Auto-Generated Memories

Windsurf generates memories automatically from user interactions. Observed characteristics:

- **Indexing delay:** ~48 hours for memories to be fully processed and available
- **Accuracy:** ~78% accuracy in extracted facts (measured by user corrections)
- **No explicit cap:** Memories accumulate without a hard limit
- **Opaque:** Users cannot easily view or edit the stored memories

The 78% accuracy is the key trade-off: auto-learning introduces errors that must be corrected. Compare with Cursor's human-only rules (100% accuracy by construction) and Claude Code's capped auto-memory (200-line limit bounds the damage from errors).

### Copilot Approach: Agentic Memory with Code Citations

GitHub Copilot's memory system (2026) adds a novel feature: memories include **citations** to the code that generated them:

```
Memory entry:
  "This project uses zod for request validation"
  Citation: src/api/middleware/validate.ts:12-35

Memory entry:
  "API tests use supertest with in-memory SQLite"
  Citation: tests/api/setup.ts:1-20, tests/api/users.test.ts:5-15
```

Citations serve two purposes:
1. **Verification:** The agent (or human) can check whether the memory is still accurate by reading the cited code
2. **Staleness detection:** If the cited code changes, the memory is flagged for review

Copilot also implements **28-day validation**: memories that haven't been confirmed by new evidence in 28 days are demoted or removed. This prevents stale memories from accumulating.

### Comparison

| System | Auto-learns | Accuracy | Limit | User can edit | Staleness handling |
|--------|------------|---------|-------|--------------|-------------------|
| Cursor | Session-end extraction | ~95% (hook-based) | No explicit | Yes (.mdc files) | Manual |
| Claude Code | During session | ~90% | 200 lines / 25KB | Yes | Auto-prune oldest |
| Windsurf | Background | ~78% | None | Limited | None |
| Copilot | With citations | ~92% | Not published | Yes | 28-day validation |

---

## Level 3: Skill Accumulation (Month 1)

**Effort:** Days to set up well. **Impact:** 68% fewer tool calls on repeated tasks (Hermes data).

For agents that perform repeated complex tasks — deployments, project setup, debugging sessions — skill accumulation is the next level.

### Hermes Approach: Autonomous SKILL.md Creation

Hermes creates skills automatically when the self-evaluation checkpoint (every 15 tool calls) detects a reusable procedure:

```
Trigger conditions:
  - 5+ tool calls for a single repeatable task → Create skill
  - Error then recovery → Create troubleshooting skill
  - Non-obvious workflow → Create workflow skill

Skill format: agentskills.io standard
  - name + description (the search surface)
  - When to Use (activation conditions)
  - Procedure (step-by-step)
  - Pitfalls (common errors)
  - Verification (how to confirm success)
```

The result: 68% fewer tool calls after one month of regular use on similar tasks (measured across Hermes deployments on Python project setup).

### Claude Code Approach: .claude/skills/*.md

Claude Code uses progressive disclosure for skill loading:

```
Level 0: skills_list() — name + description (~100 tokens/skill)
  Always in context for matching

Level 1: skill_view("skill-name") — full content (~500-1500 tokens)
  Loaded when the agent matches a skill to the current task

Level 2: skill_view("skill-name", "section") — specific section
  Loaded for follow-up detail
```

The progressive disclosure architecture (Chapter 7) is the key enabler. Without it, 100+ skills would consume 80K+ tokens — making the agent slower and less accurate.

### OpenClaw Approach: ClawHub Marketplace + Community Skills

OpenClaw treats skills as a shared resource. ClawHub hosts 13,000+ community-contributed skills:

```
Popular skills by downloads:
  1. web-scraping          (142K downloads)
  2. data-analysis-pandas  (128K downloads)
  3. docker-management     (97K downloads)
  4. git-workflow           (89K downloads)
  5. api-integration        (76K downloads)
```

The marketplace model means agents don't need to learn everything from scratch. A new Hermes instance can install community skills for common tasks and only create custom skills for project-specific workflows.

### The agentskills.io Standard

For skill interoperability across systems, the `agentskills.io` standard defines a common format:

```yaml
---
name: skill-name
description: >
  2-4 sentences covering symptoms, technical terms,
  and natural language phrases users actually say.
version: 1.0.0
author: author-name
license: MIT
platforms: [linux, macos]
metadata:
  hermes:
    tags: [tag1, tag2]
    requires_toolsets: [terminal]
---

## When to Use
[Activation conditions]

## Procedure
[Step-by-step instructions]

## Pitfalls
[Common errors and how to avoid them]

## Verification
[How to confirm the skill worked]
```

Skills written in this format work across Hermes, OpenClaw, and any system that implements the `agentskills.io` loader.

---

## Level 4: Learned Rules (Month 3+)

**Effort:** Significant infrastructure. **Impact:** 52% → 78% resolution rate (Cursor Bugbot).

This is the gold standard — and only one production system does it at scale: Cursor's Bugbot.

### What Makes Bugbot Different

Most agents learn from binary signals: task succeeded or failed. Bugbot learns from **three rich feedback signals**:

| Signal | Source | What It Reveals |
|--------|--------|----------------|
| Reactions | Developer emoji reactions to Bugbot's PR comments | Agreement/disagreement with specific suggestions |
| Replies | Developer text replies to Bugbot's PR comments | Why a suggestion was wrong or how to improve it |
| Human reviewer comments | Code review comments on the same PR | What the human reviewer caught that Bugbot missed |

### The Rule Lifecycle

```
┌──────────────────┐
│  Candidate Rule   │  Generated from patterns in feedback
│                   │  "When X happens, do Y instead of Z"
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Trial Period     │  Rule applied to new PRs
│  (accumulate      │  Developer reactions tracked
│   positive signal)│
└────────┬─────────┘
         │
    Threshold met?
    ┌────┴────┐
    Yes       No (consistent negative)
    │         │
    ▼         ▼
┌────────┐  ┌────────┐
│ Active │  │Disabled│
│ Rule   │  │ Rule   │
└────────┘  └────────┘
```

### The Three Signals in Detail

**Signal 1: Reactions.** When Bugbot comments on a PR ("This function should handle the null case"), the developer can react with thumbs up/down. Thumbs up across multiple PRs → the underlying rule gains confidence.

**Signal 2: Replies.** When a developer replies with a correction ("No, this is intentional because..."), Bugbot extracts the correction as a negative signal for the rule and potentially generates a counter-rule.

**Signal 3: Human reviewer comments.** When a human reviewer catches something on the same PR that Bugbot missed, Bugbot learns what it should have caught. This is the most valuable signal — it teaches Bugbot about blind spots.

### The Result

```
Before learned rules:  52% resolution rate
After learned rules:   78% resolution rate
Improvement:           +26 percentage points (50% relative improvement)
```

### Why Most Agents Can't Do This

Learned rules require:

1. **Real feedback signals** — not just success/fail, but *why* something was right or wrong
2. **High volume** — enough data points per rule to establish statistical significance
3. **Structured feedback** — reactions and replies, not free-form text
4. **Long time horizon** — rules need weeks of data to validate

Most agents have none of these. A personal coding assistant gets sparse, unstructured feedback. A ChatGPT-style agent gets no feedback at all (the user moves on). Bugbot works because it operates on code review — a domain with natural, structured feedback built into the workflow.

### Replicating the Pattern

If you want learned rules for your agent:

1. **Identify your feedback signal.** Where do users naturally indicate quality? (Reactions, corrections, ratings, repeat usage)
2. **Structure the signal.** Make it easy for users to give specific feedback. (Not "was this helpful?" but "was this specific suggestion correct?")
3. **Accumulate before promoting.** A rule needs 10+ positive signals before activation. A single positive is noise.
4. **Demote on negative.** Consistent negative feedback → disable the rule. Don't wait for overwhelming evidence.
5. **Scope narrowly.** Rules like "always add null checks" are too broad. Rules like "in this project's auth middleware, always validate token expiry" are actionable.

---

## Level 5: Self-Modification (Experimental)

**Effort:** Research-level. **Impact:** Unknown. **Risk:** High.

No production system does safe self-modification at scale. Everything in this section is experimental.

### OpenClaw's Genome Evolution Protocol

The `capability-evolver` skill (Chapter 7) implements a structured self-modification system:

```
genes.json    — Reusable patterns with parent IDs (evolution tree)
capsules.json — Proven fixes for specific failure modes
events.jsonl  — Append-only audit trail
```

The agent can mutate its own genes (modify reusable code patterns) and create new capsules (fixes). Parent IDs create a traceable evolution tree.

### Required Safety Measures

| Measure | Purpose | Implementation |
|---------|---------|---------------|
| Sandboxing | Prevent self-modifications from accessing production systems | Execute gene code in isolated container |
| Git tracking | Every mutation is auditable | Commit each gene/capsule change with a descriptive message |
| Human approval gates | High-impact changes require review | Changes above a complexity threshold need human merge |
| Rate limiting | Prevent runaway mutation loops | Maximum N gene mutations per session |
| Rollback capability | Revert bad mutations | Git history enables instant rollback to any prior state |

### Security Gaps in Practice

The `capability-evolver` skill has demonstrated real security concerns:

- **Hardcoded API credentials:** Early versions stored API keys directly in gene code
- **Unrestricted file access:** Genes could read/write any file in the workspace
- **No execution sandboxing:** Gene code ran with the same permissions as the agent

These are not theoretical risks — they were observed in actual deployments. Self-modification without defense in depth is dangerous.

### The Honest Assessment

Self-modification is the most powerful and most dangerous level of agent evolution. The potential: an agent that discovers better patterns, proves them in practice, and integrates them permanently. The risk: an agent that modifies itself into a broken or unsafe state.

No production system has solved this trade-off. The safe path: run Levels 1-4 well before attempting Level 5. Most teams will get more value from Level 2 (auto-learning) and Level 3 (skill accumulation) than from self-modification.

---

## The Decision Matrix

| Your Situation | Start With | Then Add | Timeline |
|---------------|-----------|---------|----------|
| Solo developer, one project | CLAUDE.md + auto memory (Level 1-2) | Skills after 1 month of regular use | Day 1 → Month 1 |
| Team, shared repo | AGENTS.md + Cursor continual-learning (Level 1-2) | Bugbot-style learned rules if volume supports it | Day 1 → Month 3+ |
| Personal assistant agent | Hermes MEMORY.md + SKILL.md (Level 1-3) | Honcho user modeling for deep personalization | Week 1 → Month 3 |
| Custom agent product | Filesystem memory + auto extraction (Level 1-2) | Skill library + feedback-driven rules | Day 1 → Month 6 |
| Research / experimental | All above levels | Self-modification with full safety measures (Level 5) | Month 6+ |

### The Common Mistake

The most common mistake: skipping Level 1 and jumping to Level 3 or 4. Teams build sophisticated skill systems before writing a basic memory file. The result: the agent can create skills but doesn't know the project's build command.

Start with Level 1. It takes 30 minutes and provides more value per token than any other intervention.

### Cost-Benefit by Level

| Level | Setup Cost | Ongoing Cost | Failure Mode | Recovery |
|-------|-----------|-------------|-------------|----------|
| 1: Filesystem Memory | 30 min | ~0 (human edits) | Stale entries | Edit the file |
| 2: Auto-Learning | 1-4 hours | Tokens for extraction | Noisy/wrong entries | Prune + cap |
| 3: Skill Accumulation | Days | Tokens for creation + storage | Skills drift from reality | Edit/delete skills |
| 4: Learned Rules | Weeks | Infrastructure + monitoring | Rules that reduce quality | Demotion mechanism |
| 5: Self-Modification | Months | Security infrastructure | Unsafe mutations | Git rollback |

Each level is more powerful but also more costly and risky. The right level depends on your volume, your feedback signals, and your risk tolerance.
