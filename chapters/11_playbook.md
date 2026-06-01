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
| Gemini CLI | `GEMINI.md` | Yes (repo root); also tiered: `~/.gemini/GEMINI.md` (global) + per-project |
| Cursor | `.cursor/rules/*.mdc` | Yes (glob-matched or always-apply) |
| Copilot | `.github/copilot-instructions.md` + global `.agent.md` | Yes (repo-level + cross-workspace) |
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

## Level 1.5: Community Methodology Enforcement (Day 2)

**Effort:** 1 hour. **Impact:** Forces structured workflows from the first session.

A new evolution vector emerged in early 2025 and matured by mid-2026: the agent doesn't learn methodology from experience — it's **given** a methodology by the community. Superpowers (213K+ stars, 476K+ installs by May 2026) is the leading example, but the pattern is platform-agnostic.

### Hooks vs. Skills: Two Primitives

Community-authored methodology enforcement relies on two complementary primitives:

| Primitive | Type | When It Fires | Example |
|-----------|------|---------------|---------|
| Hook | Deterministic | At lifecycle events (start, stop, pre-commit, post-test) | "Before committing, run the linter" |
| Skill | Probabilistic | When the model matches the skill to the current task | "When writing a React component, follow this pattern" |

Hooks guarantee execution — the agent *must* run them at the specified event. Skills are advisory — the model decides when they're relevant. The combination is powerful: hooks enforce non-negotiable workflow steps while skills provide context-sensitive guidance.

### The Superpowers Pattern

Superpowers enforces a seven-phase development workflow through a combination of hooks and skills:

```
Phase 1: Brainstorming     ← Skill activation
Phase 2: Design            ← Skill activation
Phase 3: Planning          ← Skill activation  
Phase 4: Implementation    ← Subagent-driven development
Phase 5: TDD               ← Hook: tests must pass before proceeding
Phase 6: Code Review       ← Skill activation + hook
Phase 7: Finishing          ← Hook: cleanup checks
```

The "1% rule" is a key design choice: skills are activated even when the model's confidence that they're relevant is as low as 1%. This forces the agent into the structured workflow even when it would otherwise skip steps. The trade-off: occasional false activations vs. guaranteed methodology adherence.

### Cross-Platform Compatibility

The same methodology package works across multiple agent platforms:

| Platform | Hook Mechanism | Skill Mechanism |
|----------|---------------|-----------------|
| Claude Code | `hooks` in settings.json | `.claude/skills/*.md` |
| Codex CLI | Pre/post-task hooks | `AGENTS.md` inline skills |
| Cursor | `.cursor/rules/*.mdc` with lifecycle triggers | Rule files with glob matching |
| Gemini CLI | `GEMINI.md` workflow sections | `/memory` skill entries |
| Copilot CLI | `.agent.md` workflow definitions | Instruction files |

This cross-platform reach means a team can enforce the same methodology regardless of which agent individual developers prefer.

### When to Use This Level

Level 1.5 sits between filesystem memory and auto-learning because it requires no learning infrastructure — you install a package and the methodology is enforced immediately. It's particularly valuable for:

- **Teams with junior developers** using agents for the first time
- **Codebases where skipping tests or reviews is costly**
- **Organizations standardizing on a development methodology** across multiple agent tools

The risk: over-constrained agents that follow the methodology even when the task doesn't warrant it. A one-line config fix doesn't need seven phases. Good methodology packages include escape hatches for trivial tasks.

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

### Devin Approach: Persistent Memory + Auto Triage

Devin's persistent memory (shipped May 2026) addresses what Chapter 10 identified as its critical gap: no cross-session learning. The system combines two mechanisms:

- **Auto Triage:** Classifies incoming tasks against historical patterns and routes them to the appropriate workflow before execution begins
- **Persistent memory:** Facts, preferences, and project context survive across sessions and inform future task execution

The significance: Devin was the only major production agent without cross-session learning. Its addition confirms that persistent memory has become table stakes — every major agent now has it.

### Codex Chronicle: Ambient Memory from Screen Captures

Codex Chronicle introduces a novel form of passive learning: it captures periodic screenshots of the developer's screen and extracts contextual information:

```
Screen capture (every N minutes during active development)
  ↓
OCR + visual analysis:
  - IDE state: open files, cursor position, visible errors
  - Terminal output: build results, test failures
  - Browser tabs: documentation being consulted
  ↓
Context extraction:
  - "Developer frequently references the Stripe API docs"
  - "Build failures consistently involve the auth module"
  - "Developer switches between these 3 files for this feature"
```

This is a new category of learning signal — the agent learns not just from its own actions but from *observing the developer's workflow*. The privacy implications are significant and Codex Chronicle requires explicit opt-in.

### Gemini CLI Approach: Auto Memory from Session Transcripts

Gemini CLI's auto memory extracts skills and facts from session transcripts after each interaction:

```
Session ends
  ↓
Transcript analysis:
  - Extract reusable procedures ("how to deploy to staging")
  - Extract corrections ("actually use yarn, not npm")
  - Extract project facts ("the API rate limit is 100/min")
  ↓
/memory inbox:
  - User reviews extracted memories before they become active
  - Accept, reject, or edit each extracted memory
```

The `/memory inbox` pattern is a deliberate middle ground between fully automatic memory (Windsurf, ~78% accuracy) and fully manual memory (Level 1). The agent does the extraction work; the human approves the results. This achieves high accuracy without requiring the human to write memories from scratch.

### Comparison

| System | Auto-learns | Accuracy | Limit | User can edit | Staleness handling |
|--------|------------|---------|-------|--------------|-------------------|
| Cursor | Session-end extraction | ~95% (hook-based) | No explicit | Yes (.mdc files) | Manual |
| Claude Code | During session | ~90% | 200 lines / 25KB | Yes | Auto-prune oldest |
| Windsurf | Background | ~78% | None | Limited | None |
| Copilot | With citations | ~92% | Not published | Yes | 28-day validation |
| Devin | Auto Triage + persistent | ~90% | Not published | Yes | Task-driven refresh |
| Gemini CLI | Post-session + inbox review | ~95% (human-gated) | Not published | Yes (/memory inbox) | Manual review |
| Codex Chronicle | Ambient screen capture | ~85% | Not published | Yes | Recency-weighted |

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

### Gemini CLI Approach: Skill Extraction from Sessions

Gemini CLI includes a `skill-creator` skill — a meta-skill that generates new skills from session transcripts:

```
User completes a multi-step task
  ↓
skill-creator analyzes the transcript:
  - Identifies reusable multi-step procedures
  - Extracts error-recovery patterns
  - Captures tool-call sequences that worked
  ↓
Generates a skill in agentskills.io format
  ↓
Skill appears in /memory inbox for user review
```

This closes the loop between Level 2 (auto-learning) and Level 3 (skill accumulation): the agent automatically promotes repeated procedures from memory entries into structured skills. The human review step prevents low-quality skills from accumulating.

### Superpowers: Community-Provided Skills at Scale

Not all skills need to be learned from experience. Superpowers (213K+ stars by May 2026) and similar frameworks represent a different path: **community-authored skills installed as packages**.

| Source | Skills Available | Growth Model |
|--------|-----------------|-------------|
| Claude Code marketplace | 2,810+ skills, 425+ plugins | Official + community |
| ClawHub | 13,000+ skills | Community |
| Superpowers | Bundled methodology skills | Curated framework |
| Gemini CLI | Generated via skill-creator | Per-user + shared |

The insight: individual agents shouldn't learn everything from scratch. A new agent instance can install community skills for common tasks (deployment, testing, CI/CD) and reserve autonomous skill creation for project-specific workflows.

The distinction from Level 1.5: Superpowers at Level 1.5 enforces *methodology* (how to work). Skills at Level 3 encode *procedures* (how to do specific tasks). Both can come from the community, but they serve different purposes.

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

## What to Avoid: The Skills Security Problem

The rapid growth of agent-skills ecosystems has outpaced security practices. A May 2026 Snyk audit of public agent-skills packages found that **13% contained critical security flaws** — dependency vulnerabilities, hardcoded secrets, or code execution paths that bypass sandboxing.

### The Attack Surface

| Vector | Risk | Example |
|--------|------|---------|
| Malicious skill in marketplace | Skill executes arbitrary code with agent permissions | A "docker-cleanup" skill that exfiltrates `.env` files |
| Prompt injection via skill content | Skill text contains hidden instructions that override agent behavior | Skill description embeds "ignore previous instructions" payload |
| Supply-chain dependency | Skill depends on a compromised npm/pip package | Legitimate skill pulls a trojanized dependency |
| Over-permissive hooks | Hook fires on every lifecycle event with full filesystem access | Pre-commit hook reads and transmits SSH keys |
| The "1% rule" as attack surface | Low activation thresholds mean malicious skills fire even when barely relevant | Methodology skill activates on unrelated tasks to inject instructions |

### Defensive Practices

1. **Audit before install.** Read the skill source. Community-authored skills are code — treat them like any third-party dependency.
2. **Pin versions.** Don't auto-update skills. A benign skill can become malicious after a maintainer account is compromised.
3. **Sandbox skill execution.** Skills that execute commands should run in containers or restricted shells with no access to credentials.
4. **Prefer official marketplaces.** Claude Code's official marketplace and curated skill sets have review processes. Unvetted community sources do not.
5. **Monitor skill behavior.** Log what skills do when they activate. Unexpected network calls, file reads outside the project, or credential access are red flags.

The 13% critical flaw rate is an ecosystem problem, not a per-agent problem. As skills become the primary distribution mechanism for agent capabilities, the security posture of the skills ecosystem becomes as important as the security of the agents themselves.

---

## The Decision Matrix

| Your Situation | Start With | Then Add | Timeline |
|---------------|-----------|---------|----------|
| Solo developer, one project | CLAUDE.md + auto memory (Level 1-2) | Skills after 1 month of regular use | Day 1 → Month 1 |
| Team, shared repo | AGENTS.md + Superpowers methodology (Level 1-1.5) | Bugbot-style learned rules if volume supports it | Day 1 → Month 3+ |
| Multi-tool team | AGENTS.md + methodology enforcement (Level 1-1.5) | Cross-platform skills + auto-learning | Day 1 → Month 1 |
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
| 1.5: Methodology Enforcement | 1 hour | ~0 (community maintains) | Over-constrained workflow | Disable or tune activation thresholds |
| 2: Auto-Learning | 1-4 hours | Tokens for extraction | Noisy/wrong entries | Prune + cap |
| 3: Skill Accumulation | Days | Tokens for creation + storage | Skills drift from reality; **13% of community packages have security flaws** | Edit/delete skills; audit before install |
| 4: Learned Rules | Weeks | Infrastructure + monitoring | Rules that reduce quality | Demotion mechanism |
| 5: Self-Modification | Months | Security infrastructure | Unsafe mutations | Git rollback |

Each level is more powerful but also more costly and risky. The right level depends on your volume, your feedback signals, and your risk tolerance.
