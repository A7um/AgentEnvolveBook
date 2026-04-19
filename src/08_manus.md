# Chapter 8: Manus — Context Engineering as Evolution

## The Most Rapidly Evolved Agent

Manus is the clearest case study in agent evolution through context engineering rather than model improvement. Founded in early 2025, the company reportedly reached $100M ARR within eight months and was acquired by Meta for approximately $2-3B — making it one of the fastest value-creation stories in AI history. The technical engine behind this trajectory was not a novel model architecture or a proprietary training run. It was context engineering: the discipline of shaping what the model sees, when it sees it, and how cheaply it can process it.

What makes Manus distinctive in the self-evolution landscape is that the *system itself* evolved — not just the agent's memory or skills, but the fundamental architecture. The team rebuilt the agent framework five times in under a year. Each rebuild was driven by discoveries about how to better shape context for the underlying language model.

This chapter draws primarily from Yichao "Peak" Ji's public talk "Context Engineering for AI Agents" (delivered at a technical conference in 2025), the Manus technical blog, and public reporting on the company's architecture.

## The "Stochastic Gradient Descent" Philosophy

### Five Rewrites in Eight Months

The Manus team describes their development process with a revealing metaphor: **"stochastic gradient descent on the architecture space."** Just as SGD iteratively adjusts model weights by following noisy gradients, the Manus team iteratively adjusted their agent architecture by following noisy signals from production usage.

Each of the five rewrites addressed a specific failure mode discovered in production:

| Rewrite | Primary Discovery | What Changed |
|---------|-------------------|--------------|
| v1 → v2 | Prompt structure affects tool-call accuracy more than tool definitions | Restructured system prompt hierarchy |
| v2 → v3 | KV-cache misses dominate cost at scale | Redesigned entire context pipeline for cache stability |
| v3 → v4 | Single-agent context windows hit limits on complex tasks | Introduced multi-agent architecture with context isolation |
| v4 → v5 | Tool proliferation degrades model selection accuracy | Implemented logit-space tool masking |

The critical insight is that none of these rewrites involved changing the underlying model. Every improvement came from better understanding of how context shapes model behavior. As Ji put it: this is a "manual process of architecture searching, prompt fiddling, and empirical guesswork."

### Why Context Engineering Outpaces Model Training

For a startup shipping product on a weekly cadence, context engineering has a fundamental advantage over model training:

```
Model training feedback loop:
  Collect data → Train → Evaluate → Deploy → Observe
  Timeline: weeks to months
  Cost: $100K–$10M per iteration

Context engineering feedback loop:
  Observe failure → Hypothesize context change → Deploy → Observe
  Timeline: hours to days
  Cost: ~$0 per iteration (same API, different prompts)
```

This speed differential explains why Manus evolved faster than competitors who were investing in fine-tuning. Context engineering is a faster gradient signal. The tradeoff is that it requires deep understanding of model internals — particularly the attention mechanism and the KV-cache — to do well.

### The Architecture Search Analogy

The metaphor of architecture search is precise. In neural architecture search (NAS), researchers explore a space of possible network topologies to find high-performing designs. Manus did the same thing, but for agent architectures:

- The "search space" is the set of possible context structures, tool configurations, and multi-agent topologies
- The "evaluation function" is production task completion rate and cost
- The "search algorithm" is human engineers observing failure modes and hypothesizing improvements

This is not automated self-evolution in the way that MemRL or ADAS automate optimization. It is *human-driven meta-evolution* — but it is evolution nonetheless. The system gets better through accumulated experience, just mediated by human engineers rather than automated feedback loops.

## KV-Cache as the #1 Optimization Target

### The Economics of Cached Context

The single most impactful technical insight in the Manus architecture is that **KV-cache hit rate is the primary metric for agent system economics**. This is not an exaggeration — it is arithmetic.

Production Manus agents have an average input-to-output token ratio of approximately **100:1**. For every token the model generates, it processes ~100 tokens of context. This means the cost structure is overwhelmingly dominated by input processing:

| Component | Tokens | Cost (uncached) | Cost (cached) |
|-----------|--------|-----------------|---------------|
| Input context | 100K | $0.30 | $0.03 |
| Output generation | 1K | $0.015 | $0.015 |
| **Total** | 101K | **$0.315** | **$0.045** |

The difference between a 0% cache hit rate and a 90%+ cache hit rate is a **7x reduction in per-request cost**. At $100M ARR, this is the difference between a viable business and financial ruin.

```
    Cost per request ($)
    │
0.35├─ ■ No caching ($0.315)
    │
0.30├─
    │
0.25├─
    │
0.20├─
    │
0.15├─
    │
0.10├─
    │
0.05├─ ■ With 90%+ cache hits ($0.045)
    │
0.00└──────────────────────────────────
```

### The Three Principles of Cache-Friendly Context

Manus codified three principles that every agent system should follow for cache optimization:

#### Principle 1: Stable Prefixes

The KV-cache works by matching exact token prefixes. If any token in the prefix changes, all subsequent cached computations are invalidated. This has a counterintuitive implication: **never put timestamps, random IDs, or session-varying content at the beginning of your prompt.**

```
❌ Bad: timestamp at prefix
┌──────────────────────────────┐
│ Current time: 2026-04-19...  │ ← Changes every request
│ System instructions...       │ ← Cache MISS (prefix changed)
│ Tool definitions...          │ ← Cache MISS (prefix changed)
│ Conversation history...      │ ← Cache MISS (prefix changed)
└──────────────────────────────┘

✅ Good: stable content first
┌──────────────────────────────┐
│ System instructions...       │ ← Cache HIT (stable)
│ Tool definitions...          │ ← Cache HIT (stable)
│ Conversation history...      │ ← Cache HIT (append-only)
│ Current time: 2026-04-19...  │ ← Only this is new
└──────────────────────────────┘
```

This seems obvious in retrospect, but many agent frameworks insert timestamps, request IDs, or dynamically computed metadata at the top of the system prompt — silently destroying cache performance.

#### Principle 2: Append-Only Context

Once an action has been recorded in the conversation history, it must never be modified. Manus enforces strictly append-only context: new observations, tool results, and agent actions are always appended to the end of the history, never inserted into or modifying earlier entries.

This extends to serialization. Tool call arguments and results are serialized as JSON with **deterministic key ordering** (`sort_keys=True` in Python, or equivalent). This is critical because:

```python
# These are semantically identical but produce different token sequences:
{"action": "click", "target": "#submit"}
{"target": "#submit", "action": "click"}

# Different token sequences → different KV-cache keys → cache MISS
```

**The `sort_keys` bug** is one of the most insidious performance issues in agent systems. Non-deterministic JSON serialization — where key order depends on hash randomization or insertion order — silently breaks KV-cache across requests. The tokens look different to the model even though the semantic content is identical. Manus discovered this was responsible for a significant portion of their early cache misses.

Deterministic serialization checklist:
- JSON: use `sort_keys=True` or equivalent
- Python dicts: do not rely on insertion order for serialization
- Tool definitions: use a canonical ordering for parameters
- Environment state: serialize with consistent field ordering

#### Principle 3: Explicit Cache Breakpoints

Modern inference APIs (Claude, OpenAI) support explicit cache breakpoint markers that tell the inference engine where to segment the KV-cache. Manus places these strategically:

```
┌────────────────────────────────────┐
│ System prompt                      │
│ (rarely changes)                   │
├─── CACHE BREAKPOINT ───────────────┤  ← Segment 1: reused across all requests
│ Tool definitions                   │
│ (changes only on deploys)          │
├─── CACHE BREAKPOINT ───────────────┤  ← Segment 2: reused within a session
│ Conversation history turns 1-N    │
│ (append-only)                      │
├─── CACHE BREAKPOINT ───────────────┤  ← Segment 3: reused within a turn
│ Current turn context               │
│ (new each request)                 │
└────────────────────────────────────┘
```

The minimum recommendation is a breakpoint at the end of the system prompt. More sophisticated systems place breakpoints at the end of each conversation turn, enabling partial cache reuse even when old turns are eventually evicted.

### Cache-Aware Context Pipeline

The full Manus context pipeline assembles the prompt in strict cache-optimal order:

```
┌─────────────────────────────────────────────────────┐
│                  CONTEXT ASSEMBLY                     │
│                                                       │
│  1. System prompt (static per deployment)             │
│     ↓                                                 │
│  2. Tool definitions (static per deployment)          │
│     ↓                                                 │
│  3. Agent persona / role (static per session type)    │
│     ↓                                                 │
│  4. Conversation history (append-only)                │
│     ↓                                                 │
│  5. Retrieved knowledge (varies per turn)             │
│     ↓                                                 │
│  6. Current observation (new each turn)               │
│     ↓                                                 │
│  7. Dynamic metadata (timestamps, token counts)       │
│                                                       │
│  Cache hit probability: HIGH ──────────────── LOW     │
└─────────────────────────────────────────────────────┘
```

Everything that changes frequently is pushed to the end. Everything stable is anchored at the beginning. This is the core architectural principle.

## Tool Masking via Logit Manipulation

### The Tool Proliferation Problem

As Manus's capabilities grew, the number of available tools expanded significantly. This created a tension:

- **More tools = more capable agent** (can handle more task types)
- **More tools = worse tool selection** (model accuracy drops with more options)
- **Dynamic tool filtering breaks KV-cache** (removing tools changes the prefix)

The naive solution — dynamically including only relevant tools in each request — destroys cache performance because the tool definitions section is near the top of the context. Any change there invalidates all subsequent cached computation.

### The Logit-Space Solution

Manus's solution is elegant: **keep all tool definitions in every request, but mask unavailable tools in logit space during decoding.**

```
┌───────────────────────────────────────────────┐
│              TOOL MASKING ARCHITECTURE          │
│                                                 │
│  Context (stable):                              │
│  ┌─────────────────────────────────────┐       │
│  │ System prompt                        │       │
│  │ ALL tool definitions (always present)│       │  ← Never changes
│  │ Conversation history                 │       │     = Cache stable
│  └─────────────────────────────────────┘       │
│                                                 │
│  Decoding (dynamic):                            │
│  ┌─────────────────────────────────────┐       │
│  │ Model generates token probabilities  │       │
│  │         ↓                            │       │
│  │ Apply logit mask:                    │       │
│  │   browser_click    → allowed (1.0)   │       │
│  │   browser_navigate → allowed (1.0)   │       │
│  │   shell_execute    → MASKED (-∞)     │       │
│  │   shell_write_file → MASKED (-∞)     │       │
│  │         ↓                            │       │
│  │ Sample from masked distribution      │       │
│  └─────────────────────────────────────┘       │
│                                                 │
└───────────────────────────────────────────────┘
```

The model "sees" all tools in its context (preserving cache), but at the moment of token generation, certain tool-call tokens are assigned probability -∞, making them impossible to select. This achieves the same effect as removing tools from the prompt, without any cache cost.

### Consistent Tool Naming for Group Masking

To make logit masking practical, Manus uses consistent tool name prefixes that enable group-based operations:

| Prefix | Tool Group | Example Tools |
|--------|-----------|---------------|
| `browser_` | Web interaction | `browser_click`, `browser_navigate`, `browser_scroll`, `browser_type` |
| `shell_` | Terminal operations | `shell_execute`, `shell_write_file`, `shell_read_file` |
| `file_` | File management | `file_create`, `file_edit`, `file_delete` |
| `search_` | Information retrieval | `search_web`, `search_docs`, `search_code` |
| `deploy_` | Deployment | `deploy_preview`, `deploy_production` |

When the agent is in a "browser-only" phase (e.g., researching before coding), the system masks all non-`browser_` prefixed tools. When transitioning to coding, it unmasks `shell_` and `file_` tools while masking `deploy_` tools.

This prefix convention enables:
1. Group-level enable/disable without per-tool configuration
2. Consistent cache behavior regardless of which tools are active
3. Easy addition of new tools within existing groups

### State Machine for Tool Availability

Manus implements a state machine that governs tool availability transitions:

```
                    ┌──────────┐
          ┌────────►│ RESEARCH │────────┐
          │         └──────────┘        │
          │         browser_*: ✓        │
          │         search_*:  ✓        │ user provides
    task   │         shell_*:  ✗        │ requirements
  assigned │         file_*:   ✗        │
          │         deploy_*:  ✗        ▼
    ┌─────┴──┐                    ┌──────────┐
    │ INTAKE  │                   │ PLANNING │
    └────────┘                    └────┬─────┘
                                      │ plan approved
                                      ▼
                                ┌──────────┐
                                │ BUILDING │◄─────┐
                                └────┬─────┘      │
                                browser_*: ✓      │ tests fail
                                shell_*:   ✓      │
                                file_*:    ✓      │
                                deploy_*:  ✗      │
                                     │            │
                                     ▼            │
                                ┌──────────┐      │
                                │ TESTING  │──────┘
                                └────┬─────┘
                                     │ tests pass
                                     ▼
                                ┌──────────┐
                                │ DEPLOY   │
                                └──────────┘
                                browser_*: ✓
                                shell_*:   ✓
                                file_*:    ✓
                                deploy_*:  ✓
```

Each state transition changes only the logit mask, never the tool definitions in context. The cache remains stable across all phase transitions.

## Multi-Agent Architecture as Evolution

### Why Single-Agent Hits a Ceiling

The single-agent paradigm — one model call with one context window handling an entire task — hits fundamental limits as task complexity grows:

1. **Context budget**: Complex tasks require research context, code context, test results, deployment logs. These compete for the same token budget.
2. **Attention dilution**: As context grows, the model's attention over early content degrades. Critical instructions from the system prompt receive less attention weight.
3. **Error propagation**: A mistake in step 3 of a 20-step plan pollutes the context for all subsequent steps.
4. **Specialization impossible**: The same system prompt must handle research, planning, coding, testing, and deployment — optimizing for one hurts others.

### Manus's Multi-Agent Topology

Manus addresses these limits with a multi-agent architecture where the user interacts with only one agent — the **executor** — while other agents operate in isolated context windows:

```
┌─────────────────────────────────────────────────────┐
│                    USER                              │
│                      │                               │
│                      ▼                               │
│              ┌───────────────┐                       │
│              │   EXECUTOR    │  ← User-facing        │
│              │  (orchestrator)│    Full conversation  │
│              └───┬───┬───┬──┘    history             │
│                  │   │   │                            │
│        ┌─────────┘   │   └──────────┐                │
│        ▼             ▼              ▼                 │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐          │
│  │ PLANNER  │  │KNOWLEDGE │  │SPECIALIST │          │
│  │          │  │          │  │           │          │
│  │ Isolated │  │ Isolated │  │ Isolated  │          │
│  │ context  │  │ context  │  │ context   │          │
│  └──────────┘  └──────────┘  └───────────┘          │
│                                                       │
│  Each agent has:                                      │
│  - Own system prompt (optimized for its role)         │
│  - Own conversation history (relevant subset)         │
│  - Own tool set (role-appropriate tools only)         │
│  - Own KV-cache (independent cache lifecycle)         │
└─────────────────────────────────────────────────────┘
```

### Context Isolation as Error Containment

The most underappreciated benefit of multi-agent architecture is **error containment**. When a specialist agent makes a mistake — generates buggy code, retrieves irrelevant information, or goes down a wrong path — that mistake exists only in the specialist's context window. The executor receives only the specialist's final output, not the full trace of failed attempts.

This is analogous to process isolation in operating systems. A crash in one process doesn't corrupt another's memory space. In Manus:

```
Specialist agent context:          Executor agent context:
┌────────────────────────┐        ┌────────────────────────┐
│ System: "You are a     │        │ System: "You are an    │
│ coding specialist..."  │        │ orchestrator..."       │
│                        │        │                        │
│ Attempt 1: buggy code  │        │ User: "Build me a     │
│ Error: TypeError...    │        │ landing page"          │
│ Attempt 2: still buggy │        │                        │
│ Debug: found the issue │        │ [Specialist result]:   │
│ Attempt 3: works!      │        │ "Here is the working   │
│                        │        │  landing page code..." │
│ Result: working code   │        │                        │
└────────────────────────┘        └────────────────────────┘

The executor never sees the 3 failed attempts.
Its context stays clean.
```

### Independent Evolution per Agent

Each agent in the Manus topology evolves its context management independently:

- **Planner**: Optimized for long-horizon reasoning, minimal tool definitions, heavy use of structured output
- **Knowledge agent**: Optimized for retrieval, heavy `search_*` tool use, short conversation history
- **Specialist agents**: Optimized for domain-specific execution, domain-specific system prompts, task-scoped history
- **Executor**: Optimized for user interaction, full conversation history, all tool groups available

When the Manus team discovers a better system prompt for the planner, they can deploy it without affecting any other agent's cache. When they add tools for the specialist, the executor's cache remains stable. This is **modular evolution** — changes to one component don't cascade through the system.

### Information Flow Between Agents

The agents communicate through structured message passing, not shared context:

```
Executor                    Planner
   │                           │
   │  "User wants a blog.      │
   │   Tech stack: Next.js.    │
   │   Requirements: ..."      │
   │ ─────────────────────────►│
   │                           │  (Planner works in
   │                           │   isolated context)
   │  {                        │
   │    "steps": [             │
   │      {"phase": "setup",   │
   │       "tools": ["shell"]},│
   │      {"phase": "code",    │
   │       "tools": ["file"]}, │
   │      ...                  │
   │    ]                      │
   │  }                        │
   │ ◄─────────────────────────│
   │                           │
   ▼                           │
```

The planner receives a compressed summary of the user's request, not the full conversation. The executor receives a structured plan, not the planner's reasoning trace. Each agent operates on the minimum information it needs.

## What Manus Teaches About Evolution

### Evolution Without SKILL.md or MEMORY.md

Manus does not use file-based memory in the way Claude Code (CLAUDE.md) or Hermes (SKILL.md, MEMORY.md) do. There is no per-user learning file that accumulates preferences. There is no skill library that grows with experience.

Instead, Manus's evolution is **systemic**:

| Evolution Mechanism | How It Works | Analogy |
|-------------------|-------------|---------|
| Architecture rewrites | Entire framework rebuilt when better context patterns discovered | Speciation events |
| KV-cache optimization | Prompt structure refined for cache hit rates | Metabolic efficiency |
| Tool masking | Logit-space control of tool availability without context changes | Phenotypic plasticity |
| Multi-agent topology | Agents evolve independently within isolated contexts | Modular organism design |

This is **meta-evolution**: the system for building agents evolves, not just the agent's behavior on individual tasks. Each of the five rewrites represents a generation of the system, with the "fitness function" being production task completion rate and cost.

### The Compounding Effect of KV-Cache Optimization

KV-cache optimization has a compounding property that makes it particularly powerful as an evolution mechanism:

1. **First order**: Direct cost savings (10x reduction in input processing cost)
2. **Second order**: Cheaper requests → can afford longer contexts → better task performance
3. **Third order**: Better performance → more users → more usage data → better architecture insights
4. **Fourth order**: Architecture insights → next rewrite → even better cache performance

```
┌──────────────┐     ┌───────────────┐     ┌──────────────┐
│ Better cache  │────►│ Lower cost    │────►│ Longer       │
│ hit rates     │     │ per request   │     │ contexts     │
└──────────────┘     └───────────────┘     └──────┬───────┘
       ▲                                          │
       │                                          ▼
┌──────┴───────┐     ┌───────────────┐     ┌──────────────┐
│ Architecture │◄────│ More usage    │◄────│ Better task  │
│ improvements │     │ data          │     │ performance  │
└──────────────┘     └───────────────┘     └──────────────┘
```

### Comparison: File-Based vs. Systemic Evolution

| Dimension | File-Based (Claude Code, Hermes) | Systemic (Manus) |
|-----------|----------------------------------|-------------------|
| What evolves | Agent's knowledge/skills/memory | System architecture |
| Who drives evolution | Agent + user | Engineering team |
| Evolution speed | Per-session (fast) | Per-rewrite (slow) |
| Evolution scope | Individual agent behavior | All agents globally |
| Persistence | Files in project directory | Deployed infrastructure |
| Risk of degradation | Memory bloat, stale skills | Architecture dead-ends |
| Transferability | User-specific | All users benefit |

Neither approach is strictly better. File-based evolution enables per-user personalization that systemic evolution cannot. Systemic evolution enables architectural improvements that no file-based system can achieve. The most powerful agent systems will likely combine both.

### The Five-Rewrite Pattern as Organizational Evolution

The five rewrites also represent an organizational evolution. Each rewrite forced the team to:

1. **Abandon sunk costs**: Throw away working code when a better context pattern was discovered
2. **Re-derive first principles**: Question assumptions about how agents should structure context
3. **Measure what matters**: Shift metrics from "does it work" to "what's the cache hit rate"
4. **Encode discoveries**: Each rewrite crystallized the previous iteration's lessons into architecture

This is remarkably similar to how self-evolving agents are supposed to work: observe outcomes, extract patterns, crystallize them into reusable structure. The difference is that at Manus, the "agent" doing the evolving was the engineering team, not the software itself.

## Implications for Agent Builders

### Design Your Context Pipeline for Cache

The single most actionable takeaway from Manus is: **design your context pipeline with KV-cache as the primary optimization target.** This means:

1. Audit your prompt assembly order. Put stable content first, dynamic content last.
2. Never modify historical context. Append only.
3. Use deterministic serialization everywhere. Test this explicitly.
4. Place explicit cache breakpoints at segment boundaries.
5. Measure cache hit rates in production. If you're not measuring, you're not optimizing.

### Use Logit Masking for Tool Management

If you have more than ~10 tools and need to restrict availability based on agent state:

1. Define all tools in every request (cache-stable)
2. Use consistent naming prefixes for tool groups
3. Implement state-machine-driven logit masks
4. Measure: tool selection accuracy should improve while cache hit rate stays high

### Consider Multi-Agent When Context Pressure Grows

The signals that you need multi-agent architecture:

- Context regularly exceeds 50% of the model's window
- You're seeing attention degradation on early instructions
- Error propagation from early steps is corrupting later work
- You need different system prompts for different task phases

### Meta-Evolution is Underrated

Most agent builders focus on making their agent better at tasks. Manus focused on making their *system for building agents* better. This is a fundamentally different optimization target, and it compounded faster.

The question for every agent team: are you only evolving the agent, or are you also evolving the system that produces the agent?

---

**Next: [Chapter 9 — Codex](09_codex.md)** — How OpenAI Codex implements evolution through context compaction and subagent isolation.
