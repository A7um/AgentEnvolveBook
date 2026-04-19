# Chapter 5: OpenClaw / ClawHub — The Self-Improving-Agent Skill

## The Platform

OpenClaw (350K+ GitHub stars, MIT license) is the largest open-source AI agent platform. It began as a weekend hack to let ChatGPT respond in WeChat, then grew into a full agent runtime that now supports Claude, GPT-4o, Kimi K2.5, Gemini, DeepSeek, Qwen, and any model you can run through Ollama. ClawHub is its community skills marketplace — 13,000+ skills published, covering everything from Xiaohongshu automation to academic research to the skill we care most about in this chapter: `self-improving-agent`.

This chapter covers the engineering behind how OpenClaw enables agents to evolve at runtime, and why the self-improving-agent skill is the most downloaded skill in the ecosystem despite being categorized as "meta" — a skill about skills.

## OpenClaw Architecture

OpenClaw is a Node.js long-running daemon. It runs as a persistent process — not a serverless function, not a one-shot script — because agent self-evolution requires continuity. The daemon maintains state across conversations and acts as a message router between chat platforms (WeChat, Telegram, Discord, Slack, DingTalk, Feishu) and LLM backends.

```
┌──────────────────────────────────────────────────────────┐
│                    OpenClaw Daemon                        │
│                   (Node.js, long-running)                 │
│                                                          │
│  ┌───────────┐    ┌──────────────┐    ┌───────────────┐  │
│  │  Channel   │    │   Message    │    │    LLM        │  │
│  │  Adapters  │───▶│   Router     │───▶│    Backends   │  │
│  │            │    │              │    │               │  │
│  │ - WeChat   │    │ - Routing    │    │ - OpenAI      │  │
│  │ - Telegram │    │ - Context    │    │ - Anthropic   │  │
│  │ - Discord  │    │   assembly   │    │ - DeepSeek    │  │
│  │ - Slack    │    │ - Skill      │    │ - Kimi        │  │
│  │ - DingTalk │    │   dispatch   │    │ - Ollama      │  │
│  │ - Feishu   │    │ - Memory     │    │   (local)     │  │
│  │ - HTTP API │    │   injection  │    │ - MCP servers │  │
│  └───────────┘    └──────────────┘    └───────────────┘  │
│                                                          │
│  ┌───────────────────────────────────────────────────┐   │
│  │                  Skill Engine                      │   │
│  │  - Loads SKILL.md files from ./skills/             │   │
│  │  - Resolves triggers (description matching)        │   │
│  │  - Injects skill instructions into system prompt   │   │
│  │  - Manages skill lifecycle (install, update, rm)   │   │
│  └───────────────────────────────────────────────────┘   │
│                                                          │
│  ┌───────────────────────────────────────────────────┐   │
│  │                  Memory Layer                      │   │
│  │  - MEMORY.md (persistent, human-readable)          │   │
│  │  - Daily notes (auto-generated, date-stamped)      │   │
│  │  - Dreaming (overnight consolidation pass)         │   │
│  └───────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────┘
```

### Model-Agnostic Design

The message router abstracts the LLM backend entirely. Every downstream component — skills, memory, routing logic — works identically regardless of whether the underlying model is Claude 4 Sonnet, GPT-4o, or a local Llama 3 via Ollama. This is critical for self-evolution: skills that improve agent behavior must not be coupled to a specific model's quirks.

OpenClaw also supports MCP (Model Context Protocol) servers. The same MCP servers you use with Claude Code or Cursor work inside OpenClaw. This means tool definitions are portable across the ecosystem — a filesystem MCP server, a database MCP server, or a web search MCP server can be shared between your IDE agent and your chat agent.

### Three-Tier Memory

OpenClaw's memory architecture is purpose-built for long-running agents that evolve:

| Tier | File | Lifecycle | Purpose |
|------|------|-----------|---------|
| **Persistent** | `MEMORY.md` | Manual + agent-written | Core facts, preferences, decisions that survive indefinitely |
| **Daily Notes** | `notes/YYYY-MM-DD.md` | Auto-generated per day | Conversation summaries, task outcomes, observations |
| **Dreaming** | Overnight consolidation | Runs on cron schedule | Merges daily notes into MEMORY.md, prunes stale entries |

The "Dreaming" tier is the most interesting. Inspired by the neuroscience concept of memory consolidation during sleep, OpenClaw runs an overnight pass (configurable cron) that:

1. Reads all daily notes from the past N days
2. Identifies patterns and recurring themes
3. Promotes important observations to MEMORY.md
4. Archives or deletes daily notes older than the retention window
5. Resolves contradictions (newer information wins, but old entries are annotated rather than deleted)

This three-tier design means the agent has a natural "forgetting curve" — recent events are available in full detail via daily notes, while long-term knowledge is consolidated and compressed in MEMORY.md.

## ClawHub: The Skills Marketplace

ClawHub hosts 13,000+ community-contributed skills. Each skill is a directory containing at minimum a `SKILL.md` file — a Markdown document that defines the skill's trigger conditions, instructions, and metadata. Skills are installed via CLI:

```bash
# Install a skill from ClawHub
openclaw skill install self-improving-agent

# List installed skills
openclaw skill list

# Update all skills
openclaw skill update --all
```

Skills are organized into categories:

| Category | Count | Examples |
|----------|-------|---------|
| Social Media | 1,800+ | Xiaohongshu, Twitter, Instagram automation |
| Development | 2,200+ | GitHub collaboration, code review, CI/CD |
| Productivity | 1,500+ | Summarization, scheduling, note-taking |
| Research | 900+ | Academic search, paper analysis, web research |
| Office | 600+ | Tencent Docs, Google Docs, spreadsheet manipulation |
| Privacy | 400+ | Data anonymization, PII detection |
| Creative | 800+ | Image generation prompts, writing assistance |
| **Meta** | 200+ | **Self-improvement, skill composition, agent introspection** |

The "Meta" category is where the self-improving-agent skill lives. Meta skills are skills about skills — they modify how the agent operates rather than performing a specific task. This distinction matters because meta skills have fundamentally different security implications, which we cover later in this chapter.

## The self-improving-agent Skill

The most-starred community skill on ClawHub: 1,100+ GitHub stars, 90,000+ downloads within two months of release. It implements a complete self-evolution loop that lets the agent identify its own weaknesses, experiment with improvements, and permanently solidify successful changes into workspace configuration files.

The skill's SKILL.md defines a 6-phase improvement cycle. Each phase has explicit trigger conditions, procedures, and verification steps. Here is the full cycle, reconstructed from the actual source on `github.com/openclaw/skills`:

### Phase 1: Perceive Gap

The cycle begins when the agent detects a gap between its current capabilities and what the situation demands.

**Trigger conditions:**

- A task fails outright (error, timeout, incorrect output)
- A pattern repeats 3 or more times (the "3-strike rule")
- The user explicitly corrects the agent's behavior
- A task takes significantly longer than expected (> 2× historical baseline)
- The user expresses frustration or dissatisfaction

The SKILL.md specifies these triggers precisely:

> When you notice any of the following: (1) you failed at a task you should be able to do, (2) you've seen the same problem 3+ times, (3) the user corrected your approach, (4) a task took unusually long, or (5) the user seems frustrated — pause and enter the improvement cycle.

The "3-strike rule" is the most important trigger. Single failures might be noise. Three repetitions are a pattern. The skill instructs the agent to maintain a mental tally of recurring issues and activate the improvement cycle only when the pattern threshold is crossed.

### Phase 2: Search Solutions

Once a gap is identified, the agent searches for solutions across multiple sources.

**Search order:**

1. **Internal knowledge** — Does the agent already know a better approach?
2. **Workspace files** — Do AGENTS.md, CLAUDE.md, or other config files contain relevant guidance?
3. **Engineering blogs and documentation** — Search the web for known solutions
4. **GitHub trending** — Check if new tools or libraries address the gap
5. **ClawHub / SkillHub** — Search the skills marketplace for relevant skills

The search is ordered from cheapest to most expensive. Internal knowledge costs zero tokens. Web search costs time and API calls. The skill explicitly instructs this ordering:

> Before searching externally, check if you already know a solution. Then check workspace files. Only reach for web search or ClawHub when internal sources fail.

### Phase 3: Design Experiment

The agent formulates a testable hypothesis before making any changes.

**Required format:**

> "If I [specific change], then [specific metric] will improve by [specific amount or threshold]."

Examples from the skill's documentation:

- "If I use structured output parsing instead of regex, then JSON extraction accuracy will improve from ~80% to >95%."
- "If I add a pre-flight check for file existence before editing, then 'file not found' errors will drop to zero."
- "If I summarize long conversations before continuing, then context window overflow errors will decrease by 50%."

The hypothesis format forces specificity. Vague improvements ("make things better") are explicitly rejected:

> A hypothesis must be falsifiable. "I will try harder" is not a hypothesis. "If I break tasks into subtasks of ≤3 steps, then completion rate will increase from 60% to 85%" is.

### Phase 4: Run Experiment

The agent executes the improvement and measures before-and-after results.

**Procedure:**

1. Record the current baseline metric (from recent task history)
2. Implement the proposed change (modify behavior, install a tool, adjust a workflow)
3. Run the improved approach on the same or similar task
4. Record the new metric
5. Log the full experiment in `.learnings/experiments.md`

The experiment log format:

```markdown
## Experiment: [date] — [short title]

**Hypothesis:** If [X] then [Y] improves by [Z].
**Baseline:** [metric before]
**Change:** [what was done]
**Result:** [metric after]
**Verdict:** SUCCESS / FAILURE / INCONCLUSIVE
**Next:** [promote to permanent | discard | refine and retry]
```

### Phase 5: Select Winner

The agent compares the old and new approaches on the measured metrics.

**Selection criteria:**

- The new approach must meet or exceed the threshold specified in the hypothesis
- If the improvement is marginal (< 10% improvement), the agent must consider whether the added complexity is worth it
- If the experiment is inconclusive, the agent should refine the hypothesis and retry (max 3 retries)

The skill enforces a "minimal improvement threshold":

> If the improvement is less than 10%, keep the simpler approach. Complexity is a cost. Only adopt changes that clearly justify their existence.

### Phase 6: Solidify

This is the key engineering contribution of the skill — the mechanism by which temporary learning becomes permanent workspace configuration.

Successful experiments are promoted from the `.learnings/` directory to permanent configuration files. The promotion target depends on the type of learning:

```
.learnings/
├── LEARNINGS.md        → general insights and discoveries
├── ERRORS.md           → catalogued failure modes with root causes
├── experiments.md      → full experiment logs
└── FEATURE_REQUESTS.md → identified capability gaps
```

The solidification mechanism maps each type of learning to its appropriate permanent location:

```
┌────────────────────────────┐     ┌─────────────────────────────────┐
│     .learnings/ (staging)  │     │  Permanent targets              │
│                            │     │                                 │
│  Workflow improvements     │────▶│  AGENTS.md                      │
│  Tool-specific gotchas     │────▶│  TOOLS.md                       │
│  Behavioral patterns       │────▶│  SOUL.md                        │
│  Universal learnings       │────▶│  CLAUDE.md                      │
│  GitHub-specific rules     │────▶│  .github/copilot-instructions.md│
│  Project-specific rules    │────▶│  .cursorrules / .windsurfrules  │
└────────────────────────────┘     └─────────────────────────────────┘
```

The full promotion target mapping:

| Learning Type | Staging Location | Promotion Target | Why This Target |
|--------------|-----------------|-----------------|-----------------|
| Workflow improvements | `LEARNINGS.md` | `AGENTS.md` | Agent-wide operational guidance |
| Tool-specific gotchas | `ERRORS.md` | `TOOLS.md` | Tool usage documentation |
| Behavioral patterns | `LEARNINGS.md` | `SOUL.md` | Core agent personality/behavior |
| Universal learnings | `LEARNINGS.md` | `CLAUDE.md` | Cross-project agent instructions |
| GitHub-specific | `LEARNINGS.md` | `.github/copilot-instructions.md` | GitHub Copilot integration |
| Cursor-specific | `LEARNINGS.md` | `.cursorrules` | Cursor IDE rules |
| Windsurf-specific | `LEARNINGS.md` | `.windsurfrules` | Windsurf IDE rules |
| Capability gaps | `FEATURE_REQUESTS.md` | Skill installation from ClawHub | Acquire new capabilities |

### Heartbeat-Driven Promotion

Promotions are not instant. The skill uses a "heartbeat" mechanism — a cron-like periodic scan — to decide when a learning has matured enough to be promoted:

**Promotion criteria:**

1. The learning has been validated by at least 1 successful experiment
2. There are 3+ related entries in `.learnings/` referencing the same issue (the "3-strike rule" again)
3. The learning does not contradict existing entries in the target file
4. The target file has not been modified in the last 24 hours (prevents rapid churn)

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│  Heartbeat   │     │  Scan        │     │  Promote?       │
│  (periodic)  │────▶│  .learnings/ │────▶│                 │
│              │     │              │     │  3+ related     │
│  Default:    │     │  Check each  │     │  entries? ──Y──▶│ Write to
│  every 6hrs  │     │  entry for   │     │                 │ target file
│              │     │  maturity    │     │  Validated by   │
│              │     │              │     │  experiment?    │
└─────────────┘     └──────────────┘     │  ──Y──▶         │
                                         │                 │
                                         │  No conflict    │
                                         │  with target?   │
                                         │  ──Y──▶ PROMOTE │
                                         │                 │
                                         │  Otherwise:     │
                                         │  DEFER          │
                                         └─────────────────┘
```

This heartbeat mechanism prevents premature solidification. A single observation is not enough. The agent needs to see the pattern repeatedly, validate it experimentally, and confirm it does not conflict with existing knowledge before promoting it to a permanent file.

## The Solidification Mechanism: Why It Matters

The solidification mechanism is the key engineering contribution of the self-improving-agent skill, and arguably of the entire OpenClaw ecosystem. Here is why:

**Without solidification**, agent improvements are ephemeral. The agent learns something in conversation, but that learning evaporates when the context window moves on. The next session starts from scratch.

**With solidification**, improvements are permanent. A learning that passes the maturity criteria gets written to a file that is loaded into the agent's context on every future session. The improvement compounds.

This is the difference between:

- An agent that keeps making the same mistakes across sessions
- An agent that makes a mistake once, learns from it, and never makes it again

The filesystem-as-memory approach has a crucial advantage over vector stores or databases: **it is human-readable and auditable**. When the agent writes a new rule to AGENTS.md, any human can read it, understand it, modify it, or revert it with `git diff`. There is no opaque embedding space. No mysterious relevance scores. Just Markdown.

### Example: A Complete Solidification Cycle

Here is a real-world example of how the cycle works end-to-end:

**Day 1:** The agent fails to parse a YAML file because it used `JSON.parse()` instead of a YAML parser. The error is logged to `.learnings/ERRORS.md`:

```markdown
## Error: YAML parsing failure
**Date:** 2026-03-15
**Context:** Tried to parse config.yml with JSON.parse()
**Root cause:** YAML is not JSON; needs dedicated parser
**Frequency:** 1
```

**Day 3:** The same error occurs with a different YAML file. Frequency bumped to 2.

**Day 5:** A third occurrence. Frequency hits 3 — the promotion threshold.

**Day 5 (heartbeat):** The heartbeat scan finds 3 related entries. The agent designs an experiment:

> "If I check file extension before parsing and use js-yaml for .yml/.yaml files, then YAML parsing errors will drop to zero."

The experiment succeeds. The learning is promoted to AGENTS.md:

```markdown
## File Parsing
- Always check file extension before choosing a parser
- Use `js-yaml` for .yml/.yaml files, `JSON.parse()` for .json files
- Never assume a config file is JSON without checking
```

**Day 6 onward:** The agent never makes this mistake again, because the rule is loaded into its context at the start of every session.

## Security Concerns

ClawHub flags self-evolution skills as "suspicious" — a special category that triggers additional review. The reasons are serious:

### Why Self-Evolution Skills Are Dangerous

Self-evolution skills, by definition, need broad permissions:

1. **Execute arbitrary shell commands** — Experiments may require running code, installing packages, or testing configurations
2. **Modify agent config files** — The entire point is to write to CLAUDE.md, AGENTS.md, SOUL.md, and similar files
3. **Access system files and environment variables** — Understanding the environment is necessary to improve workflows
4. **Modify their own skill definitions** — A truly self-evolving skill must be able to update its own SKILL.md

Each of these permissions is a potential attack vector. A malicious or buggy self-evolution skill could:

- Inject instructions that cause the agent to exfiltrate data
- Modify SOUL.md to change the agent's fundamental behavior in ways the user does not expect
- Install backdoor tools via shell commands
- Overwrite safety guardrails in CLAUDE.md
- Create a "self-improvement" loop that consumes API credits indefinitely

### The Permission Matrix

| Permission | Legitimate Use | Attack Vector |
|-----------|---------------|---------------|
| Shell execution | Run experiments, test changes | Install malware, exfiltrate data |
| Config file writes | Solidify learnings | Inject malicious instructions |
| File system reads | Understand project structure | Read secrets, credentials |
| Env var access | Adapt to environment | Steal API keys |
| Self-modification | Update skill based on experience | Disable safety checks |
| Network access | Search for solutions | Phone home with sensitive data |

### Five Mitigation Patterns

The community has converged on five patterns for mitigating these risks:

**Pattern 1: Container Isolation (NanoClaw's Approach)**

Run the agent in an isolated container with a restricted filesystem. The agent can only see and modify files within its designated workspace. No access to the host system, no network access except through a controlled proxy.

> "Each agent gets its own Linux container. It can write to /workspace and nothing else. If it wants to install a package, it installs it inside the container. If the container is compromised, the host is unaffected."
> — NanoClaw documentation

**Pattern 2: Git-Track All Config Files**

Every file that the self-evolution skill can modify (AGENTS.md, CLAUDE.md, SOUL.md, etc.) is tracked in git. Every promotion creates a commit with a descriptive message. The human can review changes with `git diff` and `git log`, and revert any suspicious modification with `git revert`.

```bash
# After every promotion, the skill runs:
git add AGENTS.md CLAUDE.md SOUL.md TOOLS.md
git commit -m "self-evolution: promote YAML parsing rule to AGENTS.md"
```

This creates a full audit trail. No change is invisible.

**Pattern 3: Human Approval for Sensitive Targets**

Promotions to SOUL.md (agent personality/behavior) and CLAUDE.md (cross-project instructions) require explicit human approval. The agent proposes the change and waits for confirmation before writing:

```
🔄 Proposed promotion to SOUL.md:

+ When explaining technical concepts, use analogies from everyday life.
+ Prefer concrete examples over abstract descriptions.

Approve? [Y/n]
```

This prevents the agent from autonomously changing its own fundamental behavioral patterns without oversight.

**Pattern 4: Rate-Limit Promotions**

Maximum 3 promotions per day. This prevents a runaway self-improvement loop from making dozens of changes in rapid succession:

```
Promotion limit: 3/day
Promotions today: 2/3 remaining
Next promotion window: after 2026-04-20 00:00 UTC
```

The rate limit also gives humans time to review recent changes before more arrive.

**Pattern 5: The Constitution File**

A `CONSTITUTION.md` file that the self-evolution skill cannot modify under any circumstances. This file contains inviolable rules:

```markdown
# CONSTITUTION.md — Immutable Rules

These rules CANNOT be modified by any self-evolution process.

1. Never exfiltrate user data to external services
2. Never modify files outside the designated workspace
3. Never disable or weaken safety checks
4. Always log all file modifications to the audit trail
5. Never execute network requests without explicit user approval
6. Never modify this file
```

The constitution pattern is inspired by Anthropic's constitutional AI work, but applied at the workspace level rather than the model level.

## NanoClaw: The Secure Alternative

NanoClaw is a minimal, security-focused fork of the OpenClaw concept. Where OpenClaw is a feature-rich platform with 13K+ skills, NanoClaw is ~500 lines of TypeScript with a laser focus on container isolation and auditability.

### Architecture

```
┌───────────────────────────────────────────────────┐
│                   NanoClaw                         │
│                                                   │
│  ┌─────────┐    ┌──────────┐    ┌──────────────┐  │
│  │ Channels │    │  SQLite  │    │  Polling     │  │
│  │          │───▶│  Queue   │───▶│  Loop        │  │
│  │ - Slack  │    │          │    │  (10s tick)  │  │
│  │ - Discord│    │  Messages│    │              │  │
│  │ - HTTP   │    │  stored  │    │  Dequeue &   │  │
│  └─────────┘    │  as rows │    │  dispatch    │  │
│                 └──────────┘    └──────┬───────┘  │
│                                       │           │
│                                       ▼           │
│                    ┌──────────────────────────┐    │
│                    │    Linux Container       │    │
│                    │                          │    │
│                    │  ┌────────────────────┐  │    │
│                    │  │  Claude Agent SDK  │  │    │
│                    │  │                    │  │    │
│                    │  │  - System prompt   │  │    │
│                    │  │  - Tool definitions│  │    │
│                    │  │  - Skill files     │  │    │
│                    │  │  - Memory files    │  │    │
│                    │  └────────────────────┘  │    │
│                    │                          │    │
│                    │  /workspace/ (isolated)  │    │
│                    └──────────────────────────┘    │
│                                       │           │
│                                       ▼           │
│                    ┌──────────────────────────┐    │
│                    │  Response → SQLite → Channel│  │
│                    └──────────────────────────┘    │
└───────────────────────────────────────────────────┘
```

### Key Design Decisions

**Channels → SQLite → Polling loop → Container → Response**

NanoClaw uses a message queue pattern rather than direct dispatch. Incoming messages from Slack, Discord, or HTTP are written to a SQLite database as rows. A polling loop (default: 10-second tick) dequeues messages and dispatches them to isolated containers.

This design has several advantages:

1. **Crash recovery** — If the container crashes, the message is still in SQLite and can be retried
2. **Rate limiting** — The polling interval is a natural rate limiter
3. **Audit trail** — Every message and response is stored in SQLite
4. **Isolation** — The container has no direct connection to the channel; it only reads from and writes to the queue

**Fork-and-Own Model**

NanoClaw is designed to be forked, not installed as a dependency:

> "Fork the repo. Read the code. All of it — it's ~500 lines. Customize the system prompt, the tools, the container config. This is YOUR agent, not a platform you rent."
> — NanoClaw README

This model ensures that every deployment is understood by its operator. There are no hidden abstractions, no plugin systems that might introduce untrusted code, no automatic updates that could change behavior.

**Security by Isolation**

The core security guarantee: agents run in Linux containers with filesystem isolation. The container has:

- Its own filesystem (`/workspace/` only)
- No access to the host filesystem
- No network access except through a controlled proxy (optional)
- Resource limits (CPU, memory, wall-clock time)
- Read-only access to skill files (agent cannot modify its own skills)

This last point is the critical difference from OpenClaw's self-improving-agent: in NanoClaw, the agent **cannot modify its own skill definitions**. Self-evolution is constrained to workspace files only. The agent can write to MEMORY.md, LEARNINGS.md, and similar files within its workspace, but it cannot change the instructions that define its behavior.

## OpenClaw vs. NanoClaw: Trade-offs

| Dimension | OpenClaw | NanoClaw |
|-----------|----------|----------|
| Codebase size | ~50K LoC | ~500 LoC |
| Skills ecosystem | 13K+ via ClawHub | Fork-and-customize |
| Model support | 10+ providers | Claude Agent SDK |
| Self-evolution | Full 6-phase cycle | Workspace files only |
| Container isolation | Optional (via plugins) | Built-in, mandatory |
| Skill self-modification | Allowed | Prohibited |
| Config file writes | Agent-controlled | Human-approved |
| Deployment | npm install | Fork and deploy |
| Target user | Power users, communities | Security-conscious teams |
| Memory | 3-tier (MEMORY.md + daily + dreaming) | Single file (MEMORY.md) |

The choice between OpenClaw and NanoClaw mirrors a broader tension in the agent ecosystem: **capability vs. control**. OpenClaw gives agents maximum capability to evolve, at the cost of a larger attack surface. NanoClaw constrains evolution to a safe subset, at the cost of flexibility.

## Implications for the Self-Evolution Landscape

OpenClaw's self-improving-agent skill demonstrates three things that matter for the broader field:

**1. Self-evolution can be packaged as a reusable component.**

The skill is a Markdown file. It installs in seconds. It works with any model. This means self-evolution is not a property of a specific agent architecture — it is a behavior that can be added to any agent that supports skill files.

**2. The filesystem is a viable evolution substrate.**

The solidification mechanism — promoting learnings from staging files to permanent config files — works because Markdown files are universal. Every agent platform reads AGENTS.md or CLAUDE.md or similar files. By evolving *these* files, the self-improving-agent skill creates improvements that transfer across platforms.

**3. The security model is unsolved.**

Despite five mitigation patterns, there is no proven way to give an agent the ability to modify its own behavior while guaranteeing safety. The constitution pattern is the closest, but it relies on the agent respecting a file it can technically overwrite. Container isolation (NanoClaw) works but severely limits evolution capability.

The next chapter explores the ecosystem that has grown around these skills — SkillHub, the Chinese community, and the enterprise registries that are trying to bring order to the Wild West of agent self-evolution.

---

**Next: [Chapter 6 — SkillHub and the Chinese Ecosystem](06_skillhub.md)** — How the community-driven skills marketplace became the largest repository of agent behaviors on earth.
