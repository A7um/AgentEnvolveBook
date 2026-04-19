# Chapter 7: Skill Design Patterns That Enable Evolution

## Why Patterns Matter

Not all skills are created equal. Of the 13,000+ skills on ClawHub, most are static instruction sets — they tell the agent what to do, the agent does it, and nothing changes. A few hundred skills are different. They change how the agent *thinks*, not just what it does. They give the agent judgment. They create the conditions for evolution.

This chapter identifies six design patterns that distinguish skills capable of driving agent evolution from skills that remain static. The patterns are drawn from analysis of the top 1,000 ClawHub skills by download count, the SkillDesignBook community guide, and direct examination of the highest-performing skills in production.

These patterns are not theoretical. Every one of them is extracted from a shipped skill with thousands of downloads and real-world usage data.

## Pattern 1: Change How the Agent Thinks, Not Just What It Does

The highest-quality skills change the agent's **framing** — the mental model it applies to problems — rather than just giving it a procedure to follow.

### The Evidence

From `proactive-agent` (145,000 downloads, the third most-installed skill on ClawHub):

> "Don't ask 'what should I do?' Ask 'what would genuinely delight my human that they haven't thought to ask for?'"

This single sentence does not describe a procedure. It describes a way of thinking. An agent that internalizes this framing will behave differently in *every* interaction, not just the ones that match a specific trigger condition.

Compare this with a typical procedural skill:

> "When the user asks you to summarize an article, extract the title, main points (up to 5), and a one-paragraph summary."

The procedural skill is useful but limited. It fires on one specific trigger ("summarize an article") and produces one specific output. It does not change how the agent approaches novel situations.

### Why Framing Enables Evolution

Framing changes enable evolution because they compound across all future interactions:

```
Procedural skill:
  Trigger → Procedure → Output
  (fires once, produces one result, nothing changes)

Framing skill:
  New mental model → Applied to ALL future interactions
  → Agent develops better judgment over time
  → Agent makes better decisions in novel situations
  → This IS evolution: the agent improves without
    explicit instruction for each new case
```

The `proactive-agent` skill's framing — "delight the user" rather than "complete the task" — causes the agent to:

1. Anticipate needs before they are stated
2. Offer related suggestions after completing a request
3. Notice when a task could be done better than asked
4. Provide context the user might need but did not request

None of these behaviors are specified procedurally. They emerge from the framing. And as the agent encounters more situations where the framing applies, its judgment about *how* to delight users improves — because each experience adds to its context about what "delight" means for this particular user.

### The Framing Spectrum

Skills exist on a spectrum from pure procedure to pure framing:

| Level | Type | Example | Evolution Potential |
|-------|------|---------|-------------------|
| 1 | **Pure procedure** | "When X, do Y, output Z" | None — static behavior |
| 2 | **Procedure + heuristics** | "When X, do Y, but prefer Z when in doubt" | Low — fixed heuristics |
| 3 | **Procedure + judgment** | "When X, evaluate options by [criteria], choose best" | Medium — criteria guide novel decisions |
| 4 | **Framing + procedure** | "Think about problems this way, then do Y" | High — framing affects all decisions |
| 5 | **Pure framing** | "Change how you approach every interaction" | Highest — pervasive behavioral change |

The most downloaded skills tend to cluster at levels 3-5. Pure procedures (level 1) are easy to write but do not differentiate — any agent can follow a procedure. Framing skills (levels 4-5) are hard to write but create persistent behavioral improvement.

### How to Write Framing Skills

The SkillDesignBook identifies three techniques for writing effective framing skills:

**1. Use questions, not instructions**

Instead of: "Always provide code examples."
Write: "Before explaining a concept, ask yourself: would a code example make this clearer?"

The question form forces the agent to exercise judgment rather than mechanically following a rule.

**2. Define the identity, not the behavior**

Instead of: "Write concise responses."
Write: "You are an engineer who values other engineers' time."

The identity form creates a coherent set of behaviors that extend beyond any single instruction.

**3. Specify the evaluation function**

Instead of: "Write good code."
Write: "For every piece of code you write, evaluate: would a senior engineer at a top company approve this in code review?"

The evaluation function gives the agent a way to check its own work, which is the foundation of self-improvement.

## Pattern 2: Pick a Default and Explain Why

Skills that evolve agents pick **strong defaults** — opinionated starting points that reduce decision entropy and provide a stable foundation for improvement.

### The Evidence

From `nextjs-expert` (8,000 downloads):

> "Server-first: Components are Server Components by default. Only add 'use client' when you need hooks, browser APIs, or event listeners."

This is a strong default with a clear rationale. It does not say "always use Server Components" — it says "start with Server Components, and here are the specific reasons to deviate."

Another example, from `typescript-strict` (12,000 downloads):

> "Enable strict mode. No exceptions. If a library doesn't have types, write a declaration file. The 10 minutes spent writing types saves hours of debugging."

The default (strict mode) is chosen, and the reasoning is included (saves debugging time). The agent does not just follow the rule — it understands *why*, which lets it make appropriate exceptions when the reasoning does not apply.

### Why Defaults Enable Evolution

Strong defaults create a stable starting point from which improvements can be measured:

```
Without defaults:
  Task → Agent chooses randomly from many approaches
  → Outcome varies wildly
  → No stable baseline to improve from
  → Evolution impossible (no signal in the noise)

With defaults:
  Task → Agent starts with default approach
  → Outcome is predictable (baseline)
  → Deviations from default can be measured
  → Improvements identified and solidified
  → Default evolves over time
```

The `nextjs-expert` skill's "server-first" default gives the agent a clear starting position. When the agent encounters a case where the default does not work (e.g., a component that needs `useState`), it deviates with awareness. Over time, the agent builds up a catalog of "when to deviate from server-first" — and this catalog *is* evolution.

### The Default-Deviation-Update Cycle

The most effective default-bearing skills create a natural evolution cycle:

1. **Default** — Start with the declared default
2. **Deviation** — Encounter a case where the default fails
3. **Recording** — Note the deviation and why it was necessary
4. **Pattern detection** — After 3+ similar deviations, recognize a pattern
5. **Update** — Refine the default to account for the pattern

This cycle does not require a self-improving-agent meta skill. It happens naturally when a skill declares strong defaults — the agent's own experience creates the pressure to refine them.

### How to Write Default-Bearing Skills

**Rule: Every default must include its rationale.**

Bad: "Use TypeScript."
Good: "Use TypeScript. Static typing catches ~15% of bugs at compile time that would otherwise reach production."

Bad: "Prefer functional components."
Good: "Prefer functional components. Class components add lifecycle complexity without compensating benefits since React 16.8 hooks."

The rationale serves two purposes:

1. It lets the agent know *when the default does not apply* (when the rationale is irrelevant to the current situation)
2. It gives the agent material to include in its `.learnings/` when recording deviations

## Pattern 3: Define Identity by Exclusion

Skills that say what they **are not** help agents know when to activate them — and more importantly, when to deactivate them. This is crucial for progressive disclosure and for preventing skills from interfering with each other.

### The Evidence

From `academic-deep-research` (17,000 downloads):

> "This is an investigation framework, not a black-box API wrapper. You do not just call a search API and return results. You formulate hypotheses, design search strategies, evaluate sources for credibility, and synthesize findings into coherent analysis."

From `code-review-pro` (17,000 downloads):

> "You are a code reviewer, not a code rewriter. Point out issues and explain why they matter. Do not rewrite the code unless explicitly asked."

From `creative-writer` (9,000 downloads):

> "This is a creative writing assistant, not a grammar checker. Focus on narrative structure, voice, pacing, and emotional impact. Grammar issues are secondary unless they break comprehension."

### Why Exclusion Enables Evolution

Exclusion statements create **activation boundaries** — they define the space where a skill operates and the space where it does not. This is critical for evolution because:

```
Without exclusion:
  Agent has 10 skills loaded
  → Each skill tries to influence every interaction
  → Skills conflict and interfere
  → Agent behavior is unpredictable
  → No clear signal for improvement

With exclusion:
  Agent has 10 skills loaded
  → Each skill activates only in its defined domain
  → Skills do not interfere
  → Agent behavior is predictable within each domain
  → Improvements in one domain do not break others
```

Exclusion also enables **progressive disclosure** — the technique where skills are loaded incrementally based on context rather than all at once. An agent that knows what a skill is *not* for can decide whether to activate it without loading the full skill instructions into context.

### The Activation Boundary Matrix

Effective exclusion creates a clear boundary matrix:

| Skill | IS | IS NOT |
|-------|----|--------|
| `academic-deep-research` | Investigation framework | API wrapper |
| `code-review-pro` | Code reviewer | Code rewriter |
| `creative-writer` | Creative writing assistant | Grammar checker |
| `nextjs-expert` | Next.js architecture guide | General React tutorial |
| `self-improving-agent` | Meta-learning system | Task-specific optimizer |

When multiple skills are loaded, the agent uses these boundaries to route requests to the appropriate skill. A request to "review this code" activates `code-review-pro`. A request to "rewrite this function" does not — because the skill explicitly says "not a code rewriter."

### How to Write Exclusion Statements

**Template:** "This is a [what it IS], not a [what people commonly mistake it for]."

The exclusion must target a **common misconception**. Saying "this is a code reviewer, not a pizza delivery service" is technically true but useless — nobody would confuse a code reviewer with a pizza delivery service.

Good exclusion statements target the **adjacent category** — the thing that is close enough to cause confusion:

- Code reviewer ↔ code rewriter (adjacent)
- Investigation framework ↔ API wrapper (adjacent)
- Creative writing assistant ↔ grammar checker (adjacent)
- Architecture guide ↔ general tutorial (adjacent)

## Pattern 4: The Trigger-Procedure-Pitfall Structure

Analysis of the top 1,000 ClawHub skills by download count reveals a dominant structural pattern. The most effective skills — measured by both download count and user ratings — share a four-part structure:

### The Structure

```
┌──────────────────────────────────────────┐
│  SKILL.md Structure                       │
│                                          │
│  1. WHEN TO USE (Trigger Conditions)      │
│     - Specific situations that activate   │
│       this skill                          │
│     - Enables progressive disclosure      │
│                                          │
│  2. PROCEDURE (Step-by-Step)              │
│     - Ordered instructions                │
│     - Each step is concrete and testable  │
│                                          │
│  3. PITFALLS (Known Failure Modes)        │
│     - What goes wrong and why             │
│     - Root cause for each failure         │
│     - This section is WHERE EVOLUTION     │
│       HAPPENS — pitfalls get UPDATED      │
│                                          │
│  4. VERIFICATION (Success Criteria)       │
│     - How to know the skill worked        │
│     - Observable outcomes to check        │
│                                          │
└──────────────────────────────────────────┘
```

### Why Each Section Matters

**Trigger Conditions** — This section makes progressive disclosure work. Without explicit triggers, every skill must be loaded into context all the time, wasting tokens. With triggers, the agent can match the current situation against trigger conditions and load only relevant skills.

Example from `database-migration` (6,000 downloads):

> **When to use:** When the user asks to modify database schema, add/remove columns, change indexes, or migrate data between tables. NOT for regular CRUD queries.

**Procedure** — The step-by-step instructions. These are the most straightforward part and the most commonly written. The key quality criterion: each step must be concrete and independently testable.

Example:

> 1. Generate migration file with timestamp prefix
> 2. Write UP migration (the change)
> 3. Write DOWN migration (the rollback)
> 4. Run migration in a test environment
> 5. Verify schema matches expected state
> 6. Run existing tests against new schema

**Pitfalls** — This is where evolution happens. Pitfalls are catalogued failure modes — things that have gone wrong in the past, with root causes and mitigations. This section grows over time as new failure modes are discovered.

Example:

> **Pitfall: Data loss on column rename**
> Renaming a column with `ALTER TABLE RENAME COLUMN` works on PostgreSQL 9.2+ but silently drops data on older MySQL versions. Always check database version first. If MySQL < 8.0, use the add-copy-drop pattern instead of rename.
>
> **Pitfall: Migration ordering in team environments**
> When multiple developers create migrations simultaneously, timestamp prefixes can collide. Use `generate-migration --check-conflicts` to detect overlapping timestamps before committing.

**Verification** — How to know the skill worked. This section provides observable outcomes that the agent (or the user) can check. Without verification, there is no feedback signal — and without feedback, there is no evolution.

Example:

> - [ ] Migration ran without errors
> - [ ] Schema diff shows exactly the expected changes
> - [ ] All existing tests pass
> - [ ] Rollback (DOWN migration) restores the previous schema exactly

### The Pitfalls Section Is the Evolution Engine

Of the four sections, the Pitfalls section is the most important for evolution, because it is the only section that naturally grows.

Triggers do not change — the situations that activate a database migration skill are stable. Procedures change rarely — the steps to create a migration are well-established. Verification changes occasionally — new test suites might be added.

But pitfalls grow continuously. Every time the skill encounters a new failure mode, it gets recorded:

```
Pitfalls section over time:

v1.0 (initial):
  - Pitfall: Column rename data loss on old MySQL

v1.1 (after 3 months):
  - Pitfall: Column rename data loss on old MySQL
  - Pitfall: Migration ordering in team environments
  - Pitfall: Foreign key constraints block column type changes

v2.0 (after 6 months):
  - Pitfall: Column rename data loss on old MySQL
  - Pitfall: Migration ordering in team environments
  - Pitfall: Foreign key constraints block column type changes
  - Pitfall: Enum type changes require custom migration on PostgreSQL
  - Pitfall: Concurrent migrations cause deadlocks in high-traffic tables
  - Pitfall: Large table migrations need batch processing to avoid locks
  - Pitfall: Schema cache invalidation required after migration on Rails
```

This growing pitfall catalog is a form of evolution. The skill becomes more robust with each new entry, because the agent learns to avoid known failure modes before they occur.

### Correlation with Download Success

The top 1,000 skills analysis reveals a strong correlation between structure completeness and download success:

| Structure Completeness | Avg. Downloads | % of Top 1,000 |
|-----------------------|---------------|----------------|
| All 4 sections (T+P+Pi+V) | 12,400 | 34% |
| 3 sections (missing 1) | 6,800 | 28% |
| 2 sections (Trigger + Procedure only) | 3,200 | 22% |
| 1 section (Procedure only) | 1,100 | 16% |

Skills with all four sections average 11× more downloads than procedure-only skills. This is partly a selection effect (popular skills tend to be better written), but the pattern holds even when controlling for skill age and category.

## Pattern 5: Skills That Update Themselves

The most powerful pattern for enabling evolution: skills with a Pitfalls section that the agent can **append to** when it discovers new failure modes.

### The Minimal Self-Evolution Unit

A skill that updates its own Pitfalls section is the simplest possible self-evolving system:

```
┌──────────────────────────────────────┐
│  Task execution                       │
│  ↓                                   │
│  Failure encountered                  │
│  ↓                                   │
│  Root cause identified                │
│  ↓                                   │
│  New pitfall entry written            │
│  to SKILL.md Pitfalls section         │
│  ↓                                   │
│  Next time: agent reads               │
│  updated Pitfalls, avoids             │
│  the failure                          │
└──────────────────────────────────────┘
```

This is simpler than the full 6-phase self-improving-agent cycle (Chapter 5). There is no experiment design, no metric comparison, no heartbeat-driven promotion. The agent simply appends a new entry to a list. Yet this minimal mechanism produces real evolution — the skill gets better at its job over time.

### The Append-Only Rule

Self-updating skills follow an **append-only** rule for the Pitfalls section:

1. **Never modify** existing pitfall entries (they represent validated experience)
2. **Never delete** pitfall entries (even if they seem redundant)
3. **Only append** new entries at the end of the section
4. **Always include** the date, context, and root cause

This rule prevents the agent from "optimizing" the Pitfalls section by removing entries — which would be a form of forgetting. The append-only constraint ensures that knowledge only accumulates, never erodes.

### Example: A Self-Updating Skill in Action

Consider a `docker-deployment` skill with an initial Pitfalls section:

**Initial state (v1.0):**

```markdown
### Pitfalls

- **Port conflicts:** Check that the target port is not already in use before
  starting a container. Use `docker port` or `lsof -i :PORT` to verify.
```

**After Week 1:** The agent deploys a container that works fine locally but fails in CI because the Docker socket is not mounted:

```markdown
### Pitfalls

- **Port conflicts:** Check that the target port is not already in use before
  starting a container. Use `docker port` or `lsof -i :PORT` to verify.
- **Docker socket in CI (2026-03-22):** CI environments often do not mount the
  Docker socket by default. Check for `/var/run/docker.sock` before running
  Docker commands. If missing, use Docker-in-Docker (dind) service or
  configure the CI runner to mount the socket.
```

**After Week 3:** A multi-stage build fails because the `COPY --from` stage name was misspelled:

```markdown
### Pitfalls

- **Port conflicts:** Check that the target port is not already in use before
  starting a container. Use `docker port` or `lsof -i :PORT` to verify.
- **Docker socket in CI (2026-03-22):** CI environments often do not mount the
  Docker socket by default. Check for `/var/run/docker.sock` before running
  Docker commands. If missing, use Docker-in-Docker (dind) service or
  configure the CI runner to mount the socket.
- **Multi-stage COPY typos (2026-04-05):** Typos in `COPY --from=stage_name`
  are silent failures — Docker will not error, it will just produce an empty
  copy. Always verify stage names match exactly. Use `docker build --target`
  to test individual stages.
```

Each entry makes the skill more robust. An agent running this skill after Week 3 will check for port conflicts, verify the Docker socket, and validate multi-stage build stage names — all without being explicitly told to for the current task.

### When Self-Updating Skills Are Not Enough

Self-updating Pitfalls sections work for incremental improvements to existing skills. They do not work for:

- **Structural changes** — Rewriting the Procedure section requires judgment about whether the new procedure is better, not just different
- **Cross-skill improvements** — Learning that affects multiple skills requires coordination (this is what the self-improving-agent meta skill handles)
- **Behavioral changes** — Changing how the agent thinks (Pattern 1) cannot be captured as a pitfall entry

For these cases, the full 6-phase self-improving-agent cycle (Chapter 5) is necessary. Self-updating Pitfalls are the minimal evolution mechanism; they handle the common case of "avoid known failures."

## Pattern 6: The Description Is the Activation Function

This pattern is the most underappreciated finding from the SkillDesignBook analysis. The skill description — the short text that appears in ClawHub search results and in the agent's skill index — is the single most important factor in determining whether a skill gets used.

### The Finding

From the SkillDesignBook:

> "If a skill doesn't trigger, the problem is almost never the instructions — it's the description. We analyzed 500 skills with low activation rates despite high install counts. In 89% of cases, rewriting the description fixed the problem."

The description is the activation function because it is what the agent (and the skill engine) uses to decide whether to load the full skill into context. A skill with perfect instructions but a bad description will never fire.

### Good vs. Bad Descriptions

**Bad descriptions** are vague, generic, or focused on implementation details:

| Skill | Bad Description | Activation Rate |
|-------|----------------|----------------|
| `database-migration` | "A skill for database operations" | 12% |
| `code-review-pro` | "Reviews code using best practices" | 18% |
| `academic-deep-research` | "Helps with research tasks" | 15% |
| `docker-deployment` | "Deploys applications using Docker" | 21% |

**Good descriptions** are specific, situation-focused, and include trigger words:

| Skill | Good Description | Activation Rate |
|-------|-----------------|----------------|
| `database-migration` | "When you need to change database schema: add/remove columns, modify indexes, migrate data. Handles PostgreSQL, MySQL, SQLite." | 67% |
| `code-review-pro` | "When reviewing a pull request or code diff: identifies bugs, security issues, performance problems, and style violations. Points out issues without rewriting." | 71% |
| `academic-deep-research` | "When investigating a research question: formulates hypotheses, designs search strategies, evaluates source credibility, synthesizes findings into structured analysis." | 63% |
| `docker-deployment` | "When deploying or containerizing an application: writes Dockerfiles, configures compose files, handles multi-stage builds, manages container networking." | 69% |

### Why Activation Rate Matters for Evolution

A skill that does not activate cannot evolve. If the agent never loads the skill's instructions, it never encounters the Pitfalls section, never appends new entries, and never improves.

The activation rate is the bottleneck for evolution:

```
Evolution rate = Activation rate × Failure rate × Learning rate

If activation rate = 12% (bad description):
  Evolution rate = 0.12 × 0.15 × 0.80 = 1.4% of interactions contribute

If activation rate = 67% (good description):
  Evolution rate = 0.67 × 0.15 × 0.80 = 8.0% of interactions contribute

→ 5.7× faster evolution with a good description
```

### The Description Formula

The SkillDesignBook prescribes a formula for effective skill descriptions:

```
[When/situation] + [what the skill does] + [specific capabilities] + [scope limits]
```

**Components:**

| Component | Purpose | Example |
|-----------|---------|---------|
| **When/situation** | Trigger words the agent can match | "When deploying to production" |
| **What it does** | Core function in one clause | "containerizes and deploys applications" |
| **Specific capabilities** | Concrete things it can do | "Dockerfiles, compose, multi-stage, networking" |
| **Scope limits** | What it does not do (from Pattern 3) | "Not for local development environments" |

**Full example:**

> "When deploying or containerizing an application for production: writes Dockerfiles, configures Docker Compose, handles multi-stage builds, manages container networking and volumes. Not for local development environments — use `dev-environment` skill instead."

This description hits all four components and includes a cross-reference to a related skill — helping the agent route requests correctly even when the boundaries are ambiguous.

### Activation Patterns by Keyword

Analysis of 10,000 skill activations reveals which keywords in descriptions most reliably trigger activation:

| Keyword Pattern | Activation Lift | Example |
|----------------|----------------|---------|
| "When [situation]" | +45% | "When reviewing a pull request" |
| "If [condition]" | +38% | "If the user asks about deployment" |
| Specific technology names | +32% | "PostgreSQL, Redis, Docker" |
| Action verbs | +28% | "writes, configures, deploys, analyzes" |
| "Not for [exclusion]" | +22% | "Not for local development" |
| Vague nouns | -15% | "operations, tasks, things" |
| Implementation details | -25% | "uses REST API, written in Python" |

The strongest activation lift comes from situational triggers ("When...", "If...") combined with specific technology names. The weakest comes from vague language and implementation details that are irrelevant to the user's task.

## Putting It All Together: The Evolutionary Skill Template

Combining all six patterns, here is a template for writing skills that enable agent evolution:

```markdown
# [Skill Name]

## Description
<!-- Pattern 6: The description is the activation function -->
When [specific situation], [what this skill does]: [specific capabilities].
[What this skill is NOT — Pattern 3: Identity by exclusion].

## Identity
<!-- Pattern 1: Change how the agent thinks -->
[Question-form framing that changes the agent's approach]
[Identity definition, not behavior specification]

## Defaults
<!-- Pattern 2: Pick a default and explain why -->
- [Default 1]: [Rationale]
- [Default 2]: [Rationale]
- [Default 3]: [Rationale]

## When to Use
<!-- Pattern 4: Trigger conditions -->
- [Trigger condition 1]
- [Trigger condition 2]
- [Trigger condition 3]

## Procedure
<!-- Pattern 4: Step-by-step -->
1. [Step 1]
2. [Step 2]
3. [Step 3]

## Pitfalls
<!-- Pattern 4 + Pattern 5: Known failure modes (APPEND-ONLY) -->
- **[Pitfall name] ([date]):** [Description, root cause, mitigation]

## Verification
<!-- Pattern 4: Success criteria -->
- [ ] [Observable outcome 1]
- [ ] [Observable outcome 2]
- [ ] [Observable outcome 3]
```

### Why This Template Enables Evolution

Each section maps to an evolution mechanism:

| Section | Evolution Mechanism |
|---------|-------------------|
| Description | Controls activation rate (Pattern 6) — determines how often the skill fires |
| Identity | Changes framing (Pattern 1) — creates compound behavioral improvement |
| Defaults | Provides stable baseline (Pattern 2) — enables deviation tracking |
| When to Use | Enables progressive disclosure — prevents skill interference |
| Procedure | Core instructions — stable, changes slowly |
| Pitfalls | **Primary evolution surface** (Pattern 5) — grows with experience |
| Verification | Feedback signal — tells the agent whether the skill worked |

The Pitfalls section is the primary evolution surface. It is the one section that is explicitly designed to grow. But the other sections support evolution indirectly: the Description determines whether the skill activates, the Identity determines how the agent applies it, the Defaults provide a baseline to improve from, and the Verification provides the feedback signal that drives improvement.

### The Skill Evolution Lifecycle

A well-designed skill goes through a predictable lifecycle:

```
Stage 1: Birth (v1.0)
  - Description, Identity, Defaults, Procedure, Verification written
  - Pitfalls section has 1-3 entries from the author's experience
  - Activation rate depends on description quality

Stage 2: Early growth (v1.x)
  - Pitfalls section grows to 5-10 entries
  - Author and early users contribute failure modes
  - Procedure may get minor refinements
  - Description may be rewritten for better activation

Stage 3: Maturity (v2.0+)
  - Pitfalls section has 15+ entries covering most common failures
  - Procedure is stable and well-tested
  - Defaults have been refined based on community experience
  - Activation rate has been optimized
  - The skill reliably prevents known failures

Stage 4: Specialization (forks)
  - The skill is forked for specific domains (e.g., docker-deployment-aws,
    docker-deployment-gcp)
  - Each fork evolves its own Pitfalls section
  - The parent skill may absorb universal pitfalls from forks
```

This lifecycle mirrors the evolution of human expertise. A junior engineer knows the procedure. A senior engineer knows the pitfalls. A staff engineer knows when the procedure does not apply. The skill template captures all three levels of expertise — and the Pitfalls section is the mechanism by which the skill (and the agents using it) progresses from junior to senior.

## Conclusion: Skills as the Unit of Agent Evolution

The six patterns in this chapter describe what makes skills capable of driving agent evolution:

1. **Framing over procedure** — Skills that change how the agent thinks create compound improvements
2. **Strong defaults** — Skills with opinionated starting points create measurable baselines
3. **Identity by exclusion** — Skills that define their boundaries enable progressive disclosure
4. **Trigger-Procedure-Pitfall-Verification structure** — The four-part structure creates natural evolution surfaces
5. **Self-updating Pitfalls** — The minimal self-evolution unit: append failure modes as they are discovered
6. **Description as activation function** — If a skill does not trigger, it cannot evolve

Together, these patterns transform skills from static instruction sets into evolving knowledge repositories. A skill written with all six patterns does not just help the agent do a task — it helps the agent get *better* at the task over time. And when thousands of agents use the same skill, the collective experience of all of them feeds back into the Pitfalls section, creating a form of collective intelligence.

This is the fundamental insight: **the skill is the unit of agent evolution**. Not the model. Not the prompt. Not the memory system. The skill — a Markdown file with triggers, procedures, pitfalls, and verification — is the thing that captures experience, grows with use, and transfers learning across agents.

The npm ecosystem proved that reusable code packages could accelerate software development by orders of magnitude. The ClawHub/SkillHub ecosystem is testing whether reusable behavior packages — skills — can accelerate agent evolution in the same way.

---

**Next: [Chapter 8 — Manus: Context Engineering as Evolution](08_manus.md)** — How Manus uses context window management as its primary evolution mechanism.
