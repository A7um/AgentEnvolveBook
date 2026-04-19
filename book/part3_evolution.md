# Part III: Making Agents Evolve

## Chapter 7: Memory Systems That Actually Work

This chapter is a formal reference. Every architecture below is specified at the level of detail required to reimplement it: type hierarchies, algorithm pseudocode, convergence properties, and benchmark numbers drawn directly from the cited papers. Where the original publications provide equations, we reproduce them; where they provide ablation tables, we include the full tables. The goal is that a systems engineer reading this chapter should be able to build each memory system without consulting the original paper (though they should still read the paper for the authors' commentary and qualitative insights that no specification can capture).

---

### 7.1 OpenHands V1: Event-Sourced Agent Architecture

**Paper:** Xingyao Wang et al., "OpenHands: An Open Platform for AI Software Developers as Generalist Agents," arXiv:2407.16741 (original, July 2024); V1 SDK architecture described in the companion design document and release notes (November 2025, arXiv:2511.03690). Repository: `All-Hands-AI/OpenHands`, 53K+ GitHub stars as of April 2026.

#### 7.1.1 V0 → V1: From Monolith to Modular SDK

The original OpenHands (then "OpenDevin") was a monolithic Python application. The controller, runtime, agent logic, tool definitions, and workspace management were entangled in a single package with deeply coupled imports. This worked for research prototypes but created four concrete engineering problems that motivated the V1 redesign:

1. **Testing fragility.** Unit-testing the agent's planning logic required instantiating a Docker runtime because the controller imported runtime modules at module scope. Test suites took 8–12 minutes even for pure logic changes.
2. **Deployment rigidity.** Running the agent in a cloud sandbox required shipping the entire monolith into the sandbox container, including UI code, analytics, and configuration management that served no purpose inside the sandbox.
3. **Extension friction.** Third-party developers who wanted to swap in a custom tool implementation had to fork the repository and patch internal modules because there was no stable API boundary.
4. **State management opacity.** Agent state was scattered across instance variables on the controller, the runtime, and the agent class. Debugging "why did the agent take that action at step 47" required reading three different objects' internal state, often with mutable fields that had been overwritten by subsequent steps.

The V1 architecture decomposes the monolith into **four decoupled packages**:

```
┌──────────────────────────────────────────────────────────────────┐
│                     OpenHands V1 SDK Architecture                │
│                                                                  │
│  ┌─────────────────┐   ┌─────────────────┐                      │
│  │   openhands-sdk  │   │  openhands-tools │                     │
│  │                 │   │                 │                      │
│  │ Event types     │   │ Tool registry   │                      │
│  │ Event stream    │   │ Tool interface  │                      │
│  │ State derivation│   │ Built-in tools  │                      │
│  │ Agent interface │   │ Tool execution  │                      │
│  │ LLM interface   │   │                 │                      │
│  └────────┬────────┘   └────────┬────────┘                      │
│           │                     │                                │
│  ┌────────┴────────┐   ┌───────┴─────────┐                      │
│  │openhands-workspace│  │openhands-server  │                     │
│  │                 │   │                 │                      │
│  │ Local FS       │   │ HTTP/WS API     │                      │
│  │ Docker sandbox │   │ Session mgmt    │                      │
│  │ Cloud sandbox  │   │ Auth/rate limit │                      │
│  │ SSH remote     │   │ Event streaming │                      │
│  └─────────────────┘   └─────────────────┘                      │
└──────────────────────────────────────────────────────────────────┘
```

**Package 1: `openhands-sdk`.** The core abstractions: event types, the event stream, state derivation, the agent interface, and the LLM interface. This package has zero dependencies on Docker, filesystem operations, or network APIs. It can be imported and used in a pure-Python unit test with no external services.

**Package 2: `openhands-tools`.** The tool registry and all built-in tool implementations (file read, file edit, shell command, browser interaction, agent delegation). Tools implement a `Tool` interface defined in the SDK. Third-party tools can be registered at runtime without modifying the core package.

**Package 3: `openhands-workspace`.** The workspace abstraction: the same agent code runs identically whether the workspace is a local filesystem, a Docker container, a cloud sandbox (e.g., E2B, Modal), or an SSH-connected remote machine. The workspace exposes a uniform API for file operations and shell execution, and the agent code never knows which backend is active.

**Package 4: `openhands-server`.** The HTTP/WebSocket API, session management, authentication, rate limiting, and event streaming endpoint. This is the only package that contains web framework dependencies (FastAPI). It is deployed as a standalone service; the SDK, tools, and workspace packages can be used without it.

#### 7.1.2 The Four Design Principles

The V1 architecture document specifies four design principles, stated here exactly as given in the paper:

**Principle 1: Optional Isolation.** The runtime environment (where agent commands execute) can be isolated in a Docker container or cloud sandbox, but isolation is optional. For local development and trusted environments, agents can execute directly on the host. The choice is a configuration flag, not an architectural constraint.

**Principle 2: Stateless by Default.** Agent processes do not hold persistent state in memory. All state is derived from the event stream, which is persisted externally (filesystem, database, or in-memory store depending on deployment). If an agent process crashes, a new process can be started and will reconstruct the identical state by replaying the event log.

**Principle 3: Clear Boundaries.** Each package defines an explicit public API. Internal modules are prefixed with `_` and are not importable from outside the package. Cross-package dependencies flow in one direction: `server → tools → sdk` and `workspace → sdk`. There is no circular dependency.

**Principle 4: Composable Components.** Each component (agent, tool, workspace backend, LLM provider) implements a small interface and can be swapped independently. An agent implementation does not know which LLM it is talking to, which workspace backend is active, or which tools are available—it interacts only through the interfaces defined in `openhands-sdk`.

#### 7.1.3 Event Type Hierarchy

The event system is the backbone of the V1 architecture. Every action, observation, system notification, and compression marker is represented as a typed, immutable event. The complete hierarchy:

```
Event (abstract base)
│
│ Fields carried by ALL events:
│   id: int                            # Monotonically increasing, unique within stream
│   timestamp: datetime                # Wall-clock time of event creation
│   source: EventSource                # USER | AGENT | ENVIRONMENT
│   tool_name: str | None              # Present on tool-call events
│   tool_call_id: str | None           # Ties action to specific LLM tool call
│   cause: int | None                  # id of the event that caused this one
│
├── LLMConvertibleEvent (abstract)
│   │  Events that can be serialized into LLM prompt messages.
│   │  Defines: to_llm_message() → dict
│   │
│   ├── ActionEvent (abstract)
│   │   │  Initiated by agent or user. Represents intent.
│   │   │
│   │   ├── MessageAction
│   │   │     content: str
│   │   │     image_urls: list[str]
│   │   │     wait_for_response: bool
│   │   │
│   │   ├── CmdRunAction
│   │   │     command: str
│   │   │     timeout: int                    # seconds
│   │   │     blocking: bool                  # wait for completion?
│   │   │     keep_prompt: bool               # preserve shell prompt in output?
│   │   │
│   │   ├── FileReadAction
│   │   │     path: str
│   │   │     start_line: int | None
│   │   │     end_line: int | None
│   │   │
│   │   ├── FileEditAction
│   │   │     path: str
│   │   │     old_str: str                    # exact string to find
│   │   │     new_str: str                    # replacement string
│   │   │     insert_line: int | None         # alternative: insert at line
│   │   │
│   │   ├── BrowseInteractiveAction
│   │   │     browser_actions: str            # BrowserGym DSL commands
│   │   │     browsergym_send_msg_to_user: str
│   │   │
│   │   ├── AgentFinishAction
│   │   │     thought: str
│   │   │     outputs: dict[str, Any]
│   │   │     final_message: str | None
│   │   │
│   │   ├── AgentDelegateAction
│   │   │     agent: str                      # name of delegate agent class
│   │   │     inputs: dict[str, Any]
│   │   │     thought: str
│   │   │
│   │   └── AgentRejectAction
│   │         thought: str                    # reason for rejection
│   │
│   ├── MessageEvent
│   │     content: str
│   │     role: str                           # "user" | "assistant" | "system"
│   │
│   └── ObservationBaseEvent (abstract)
│       │  Results of actions or environment state changes.
│       │
│       ├── CmdOutputObservation
│       │     command: str
│       │     exit_code: int
│       │     content: str                    # stdout + stderr
│       │     command_id: int                 # for non-blocking command tracking
│       │
│       ├── FileReadObservation
│       │     path: str
│       │     content: str
│       │
│       ├── FileEditObservation
│       │     path: str
│       │     content: str                    # new file content or diff
│       │     prev_exist: bool
│       │     old_content: str | None
│       │
│       ├── BrowserOutputObservation
│       │     url: str
│       │     screenshot: str                 # base64 or path
│       │     open_pages_urls: list[str]
│       │     active_page_index: int
│       │     dom_object: dict | None
│       │     axtree_txt: str | None          # accessibility tree
│       │     last_browser_action: str
│       │     last_browser_action_error: str
│       │     focused_element_bid: str
│       │
│       ├── ErrorObservation
│       │     content: str
│       │     error_id: str | None
│       │
│       ├── AgentDelegateObservation
│       │     outputs: dict[str, Any]
│       │     content: str
│       │
│       └── UserRejectObservation
│             content: str
│
├── ConversationStateUpdateEvent         # Internal: signals state transitions
│     agent_state: AgentState            # LOADING | INIT | RUNNING |
│                                        #   AWAITING_USER_INPUT |
│                                        #   AWAITING_USER_CONFIRMATION |
│                                        #   PAUSED | STOPPED | FINISHED |
│                                        #   REJECTED | ERROR
│     metadata: dict[str, Any] | None
│
├── CondensationEvent                    # Compression marker
│     condensed_event_ids: list[int]     # IDs of events being replaced
│     summary: str                       # LLM-generated summary text
│
└── PauseEvent                           # Internal: agent-requested pause
      reason: str
```

The distinction between `LLMConvertibleEvent` and internal events (like `ConversationStateUpdateEvent`, `PauseEvent`) is architectural: only `LLMConvertibleEvent` subclasses are serialized into the LLM's prompt. Internal events affect state derivation but are invisible to the model. This prevents the model from seeing system bookkeeping and focuses its context window on semantically relevant information.

#### 7.1.4 State Derivation from Event Stream

The append-only event log is the single source of truth. Agent state is **never** stored directly — it is always derived by reducing over the log. The derivation logic:

```python
@dataclass
class AgentState:
    history: list[Event]              # Full event history (or condensed)
    iteration: int                     # Number of agent actions taken
    max_iterations: int                # Configured limit
    token_usage: TokenUsage            # Cumulative token consumption
    metrics: Metrics                   # Error count, tool call count, etc.
    agent_state: AgentStateEnum        # Current lifecycle state
    extra_data: dict[str, Any]         # Agent-specific scratchpad

    @classmethod
    def from_events(
        cls,
        events: list[Event],
        config: AgentConfig,
    ) -> "AgentState":
        state = cls(
            history=[],
            iteration=0,
            max_iterations=config.max_iterations,
            token_usage=TokenUsage(),
            metrics=Metrics(),
            agent_state=AgentStateEnum.RUNNING,
            extra_data={},
        )
        for event in events:
            state = state.apply(event)
        return state

    def apply(self, event: Event) -> "AgentState":
        self.history.append(event)

        if isinstance(event, ActionEvent):
            self.iteration += 1
            self.metrics.tool_call_count += 1
            if isinstance(event, AgentFinishAction):
                self.agent_state = AgentStateEnum.FINISHED
            elif isinstance(event, AgentRejectAction):
                self.agent_state = AgentStateEnum.REJECTED

        elif isinstance(event, CmdOutputObservation):
            if event.exit_code != 0:
                self.metrics.error_count += 1

        elif isinstance(event, ErrorObservation):
            self.metrics.error_count += 1

        elif isinstance(event, ConversationStateUpdateEvent):
            self.agent_state = event.agent_state

        elif isinstance(event, CondensationEvent):
            self._apply_condensation(event)

        return self

    def _apply_condensation(self, event: CondensationEvent) -> None:
        """Replace condensed events in history with the summary event."""
        condensed_ids = set(event.condensed_event_ids)
        new_history = [e for e in self.history if e.id not in condensed_ids]
        summary_event = MessageEvent(
            content=event.summary,
            role="system",
            id=event.id,
            timestamp=event.timestamp,
            source=EventSource.ENVIRONMENT,
        )
        insert_idx = 0
        for i, e in enumerate(new_history):
            if e.id > min(condensed_ids):
                insert_idx = i
                break
        new_history.insert(insert_idx, summary_event)
        self.history = new_history
```

The `from_events` / `apply` pattern gives three capabilities that no mutable-state architecture can match:

1. **Exact replay.** Given the event log, reconstruct the agent's state at any point in time. When a user reports "the agent did something wrong at step 47," replay events 0–47 and inspect the derived state. OpenHands developers report that replay debugging cuts investigation time by 60–80%.

2. **Branching.** Fork execution at any event by replaying up to that point, then diverging. OpenHands uses this for retry: if the agent errors at event 35, replay events 0–34, inject a hint about the error, and let the agent retry from that state.

3. **Projection multiplexing.** The same event stream projects into multiple views: the LLM prompt view (condensed, formatted for inference), the analytics view (aggregated token usage, error rates), and the audit view (complete, immutable, for compliance). Each projection reads from the same source.

#### 7.1.5 Condensation Strategies for Context Compression

When the event stream grows beyond the model's context budget, a condensation strategy compresses it. The V1 SDK ships three built-in strategies:

**Strategy 1: RecentEventsCondensation.** Keep the last N events verbatim; summarize everything before them into a single CondensationEvent.

```python
class RecentEventsCondensation:
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
            instruction=(
                "Summarize key actions, results, and decisions. "
                "Preserve file paths, command outputs, and error messages verbatim."
            ),
        )
        condensation = CondensationEvent(
            condensed_event_ids=[e.id for e in to_condense],
            summary=summary,
        )
        return [condensation] + to_keep
```

**Strategy 2: SlidingWindowCondensation.** Maintain a fixed-size window. When the window overflows, summarize the oldest 50% of events. This produces a chain of summaries, each covering a contiguous block, yielding better temporal resolution than a single summary.

**Strategy 3: ImportanceWeightedCondensation.** Score each event by importance (errors and user messages score highest; file reads score lowest). Condense the lowest-scoring events first, preserving the most informative events at full fidelity.

The condensation pipeline is parameterized by `max_budget_per_msg` — the token budget per event when building the LLM prompt. Production deployments tune this between 200 and 1,000 tokens. With Claude's 200K context and a budget of 500 tokens/event, approximately 400 events fit in the prompt. With GPT-4o's 128K context, the budget drops to ~300 tokens/event for equivalent capacity.

**Condensation ratio in production:** 4:1 to 12:1 (original tokens / condensed tokens), depending on the verbosity of command outputs and file contents being summarized.

#### 7.1.6 Workspace Abstraction

The workspace layer abstracts where agent commands actually execute. The same agent code — the same event stream, the same tool calls — runs identically across four backends:

| Backend | Implementation | Isolation | Latency | Use Case |
|---------|---------------|-----------|---------|----------|
| `LocalWorkspace` | Direct `subprocess` calls | None | <10ms | Local dev, trusted agents |
| `DockerWorkspace` | Docker container with volume mounts | Process-level | 50–200ms (first cmd) | CI/CD, untrusted code |
| `E2BWorkspace` | E2B cloud sandbox API | VM-level | 100–500ms | Production SaaS |
| `SSHWorkspace` | SSH tunnel to remote machine | Network-level | 50–150ms | Remote development |

Each backend implements the `Workspace` interface:

```python
class Workspace(Protocol):
    async def execute(self, command: str, timeout: int = 120) -> CmdOutputObservation: ...
    async def read_file(self, path: str) -> FileReadObservation: ...
    async def write_file(self, path: str, content: str) -> FileEditObservation: ...
    async def list_files(self, path: str = ".") -> list[str]: ...
    def get_working_directory(self) -> str: ...
```

The workspace choice is a deployment configuration. The agent code never imports workspace-specific modules. This is what "Optional Isolation" means in practice: you get sandboxing for free by changing a config flag, not by rewriting agent logic.

#### 7.1.7 SWE-Bench Results with the V1 SDK

The V1 SDK's architectural changes had measurable impact on benchmark performance, primarily through reliability improvements (fewer crashes, better state recovery) rather than algorithmic changes:

| Configuration | SWE-Bench Verified | SWE-Bench Lite | Notes |
|---|---|---|---|
| OpenHands V0 + CodeAct + Claude 3.5 Sonnet | 53.0% | 48.2% | Monolithic architecture |
| OpenHands V1 + CodeAct + Claude 3.5 Sonnet | 55.2% | 50.1% | Same agent, new SDK |
| OpenHands V1 + CodeAct + Claude Sonnet 4.5 | 72.4% | 67.8% | Model upgrade |
| OpenHands V1 + CodeAct + Claude Opus 4.5 | 76.1% | 71.3% | Frontier model |

The V0 → V1 improvement (53.0% → 55.2%) is entirely attributable to reduced crashes from state corruption bugs that the event-sourced architecture eliminates. The larger jumps come from model upgrades, but they are enabled by the architectural reliability: a model that is 20% smarter but crashes 10% of the time nets less improvement than a model that is 20% smarter and never crashes.

**Operational metrics from OpenHands production deployments (V1 SDK):**

| Metric | Value |
|---|---|
| Average event stream length per task | 40–120 events |
| Average event size | 200–2,000 bytes |
| Condensation ratio | 4:1 to 12:1 |
| Event store overhead per session | 50–500 KB |
| Replay time for 100-event stream | < 50ms (excluding LLM calls) |
| Crash recovery rate (V1 vs V0) | 99.7% vs 94.2% |
| Mean time to replay-debug a user report | 3.2 min (V1) vs 14.7 min (V0) |

---

### 7.2 Hermes Agent: The Closed-Loop Learning System

**System:** Hermes Agent, Nous Research, initial release February 2026. MIT license. Repository: `NousResearch/hermes-agent`. As of April 2026: 99K+ GitHub stars, 370+ contributors, 47 built-in tools, current version v2026.4.16.

Hermes is the most complete implementation of an agent that autonomously creates, updates, and retrieves its own skill documents. Where other memory systems are passive stores — the developer designs the structure, the agent reads and writes to it — Hermes *actively generates reusable knowledge* from successful task completions, and then uses that knowledge to accelerate future tasks. The measured result: tasks that initially require 25 tool calls drop to 8–10 tool calls after a month of regular use across 20–30 complex tasks.

#### 7.2.1 Three-Layer Memory Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    HERMES MEMORY STACK                        │
│                                                              │
│  LAYER 1: Working Context                                    │
│  ─────────────────────────                                   │
│  Standard LLM context window (128K–200K tokens).             │
│  Contains: current conversation, tool outputs, reasoning     │
│  chain, system prompt with injected skill/fact context.      │
│  Lifetime: single session. No persistence.                   │
│                                                              │
│  LAYER 2: Skill Documents (~/.hermes/skills/)                │
│  ──────────────────────────────────────────                  │
│  SKILL.md files following the agentskills.io open standard.  │
│  Created autonomously by the agent after successful tasks.   │
│  Indexed via SQLite FTS5 full-text search.                   │
│  Retrieved via progressive disclosure (3 levels).            │
│  Lifetime: permanent until explicitly deleted or updated.    │
│                                                              │
│  LAYER 3: Persistent User Facts (Honcho integration)         │
│  ──────────────────────────────────────────────────          │
│  Dialectical user modeling across 12 identity layers.        │
│  Two-layer context injection (base + dialectic synthesis).   │
│  Configurable update cadences: contextCadence (every N       │
│  messages), dialecticCadence (every M messages).             │
│  dialecticDepth: 1–3 LLM passes for synthesis quality.      │
│  Lifetime: permanent, evolves with each interaction.         │
└──────────────────────────────────────────────────────────────┘
```

#### 7.2.2 Autonomous Skill Creation: Trigger Conditions and Self-Evaluation

Hermes does not wait for the user to tell it to create a skill. It monitors its own execution and triggers skill creation proactively. The exact trigger conditions, as specified in the Hermes documentation:

**Trigger Condition 1: Sequence length.** If the agent uses 5 or more tool calls in a sequence to accomplish a single subtask, the subtask is complex enough to warrant a skill document. This threshold was tuned empirically: below 5, the overhead of creating and maintaining a skill exceeds the time saved on future retrievals; above 5, the savings compound quickly.

**Trigger Condition 2: Error recovery.** If the agent encounters an error and successfully recovers (i.e., a subsequent tool call succeeds after a failed one), the recovery procedure is captured as a skill. Error recovery procedures are among the highest-value skills because they encode non-obvious debugging knowledge.

**Trigger Condition 3: User corrections.** If the user corrects the agent ("no, do it this way"), the corrected procedure is captured. User corrections signal that the agent's default behavior was wrong in a way that is likely to recur.

**Trigger Condition 4: Non-obvious workflows.** If the agent discovers a novel approach to a problem — one that was not in its initial training data or existing skills — it captures the workflow. "Novel" is determined by comparing the approach against existing skills using FTS5 similarity: if no existing skill matches with score > 0.6, the approach is considered novel.

**Self-evaluation checkpoint:** Every 15 tool calls, the agent performs a self-evaluation: "Was anything in the last 15 tool calls worth capturing as a skill?" This periodic checkpoint catches gradual skill-worthy patterns that don't trigger any single condition above but are valuable in aggregate.

The complete closed-loop learning cycle:

```
TASK EXECUTION (tools, code, browsing, file edits)
         │
         ▼
SELF-EVALUATION CHECKPOINT (every 15 tool calls)
    Checks: sequence length ≥ 5?  error recovery?
            user correction?  novel workflow?
         │
         ├──► No triggers → continue execution
         │
         └──► Trigger fired ──► SKILL CREATION / UPDATE
                                 │
                                 ├── New skill: write SKILL.md
                                 │   (agentskills.io format)
                                 │
                                 └── Existing skill update: patch via
                                     skill_manage tool (mid-session)
         │
         ▼
MEMORY UPDATE
    Key facts      → MEMORY.md   (persistent cross-session)
    User patterns  → USER.md     (via Honcho dialectic)
    Corrections    → skill patch  (immediate, in-place)
```

#### 7.2.3 SKILL.md Format Specification — The agentskills.io Standard

Every auto-generated skill follows the agentskills.io open standard. The format has two parts: YAML frontmatter (machine-readable metadata) and Markdown body (human- and LLM-readable instructions).

**Complete YAML frontmatter fields:**

```yaml
---
# REQUIRED fields
name: deploy-staging                      # Unique identifier, kebab-case
description: >
  Deploy the application to staging       # 1-2 sentence summary. This is
  environment via GitHub Actions           # what the agent sees at Level 0.
version: 1.0.0                            # SemVer

# RECOMMENDED fields
author: hermes-auto                       # "hermes-auto" for agent-generated
license: MIT                              # License for the skill itself
platforms: [linux, macos]                 # Target operating systems
tags: [DevOps, Deployment, CI-CD]         # Discovery tags

# HERMES-SPECIFIC metadata
metadata:
  hermes:
    tags: [DevOps, Deployment]            # Hermes-internal tags
    related_skills:                       # Cross-references
      - docker-compose-management
      - github-actions-debug
    requires_toolsets: [shell]            # Which toolsets must be active
    requires_tools:                       # Specific tools needed
      - shell_exec
      - read_file
      - web_search
    config:                               # User-configurable parameters
      - key: deploy.staging_branch
        description: "Branch to deploy from"
        default: "staging"
        prompt: "Which branch deploys to staging?"
      - key: deploy.health_check_url
        description: "URL for post-deploy health check"
        default: "https://staging.example.com/health"
        prompt: "Health check URL?"

# ENVIRONMENT requirements
required_environment_variables:
  - name: GITHUB_TOKEN
    prompt: "Enter your GitHub token for Actions API"
  - name: DEPLOY_SSH_KEY
    prompt: "Path to SSH key for deployment server"
    optional: true
---
```

**Markdown body section structure:**

```markdown
# {Skill Name}

## When to Use
<!-- Exact conditions under which this skill should activate -->

## Quick Reference
<!-- 2-3 line cheat sheet for the most common invocation -->

## Procedure
<!-- Numbered step-by-step instructions -->

## Pitfalls
<!-- Known failure modes with dates of discovery and fixes -->

## Verification
<!-- How to confirm the skill executed correctly -->

## References
<!-- Links to relevant docs, PRs, or external resources -->
```

#### 7.2.4 Progressive Disclosure Levels

Skill retrieval uses progressive disclosure to minimize context consumption:

**Level 0 — Catalog (~3K tokens for the entire skill library).** The agent calls `skills_list()`, which returns only the `name` and `description` fields from every skill's frontmatter. With 50 skills averaging 60 tokens each for name + description, the full catalog costs ~3,000 tokens. This is cheap enough to load on every session start.

**Level 1 — Full Instructions.** When the agent identifies a relevant skill from the Level 0 catalog, it calls `skill_view(name)` to load the complete Markdown body: When to Use, Quick Reference, Procedure, Pitfalls, and Verification. Typical cost: 500–2,000 tokens per skill.

**Level 2 — References and Artifacts.** For skills with associated files (scripts, templates, configuration snippets), `skill_view(name, path)` loads specific referenced artifacts. This level is rarely needed — the Procedure section usually contains enough detail.

The progressive disclosure design means that even with hundreds of skills, the agent's per-session overhead is bounded at ~3K tokens (Level 0) plus ~1,500 tokens per skill actually used (Level 1). In practice, a typical session activates 1–3 skills, costing 4,500–7,500 tokens total — approximately 3% of a 200K-token context window.

#### 7.2.5 Honcho Dialectical User Modeling

The third memory layer integrates with Honcho, a user-modeling service that maintains a persistent model of each user across 12 identity layers:

```
┌─────────────────────────────────────────────────────────────┐
│                 HONCHO 12-IDENTITY MODEL                     │
│                                                             │
│  Layer 1:  Communication Style                              │
│            (formal/informal, verbosity, emoji usage)         │
│  Layer 2:  Technical Expertise Level                        │
│            (beginner → expert, per-domain)                   │
│  Layer 3:  Decision-Making Patterns                         │
│            (risk-averse/risk-seeking, speed vs thoroughness) │
│  Layer 4:  Domain Knowledge Map                             │
│            (which topics they know deeply, gaps)             │
│  Layer 5:  Workflow Preferences                             │
│            (tool chains, IDE, OS, deployment style)          │
│  Layer 6:  Error Tolerance                                  │
│            (how they react to mistakes, retry patience)      │
│  Layer 7:  Collaboration Style                              │
│            (solo vs pair, review preferences)                │
│  Layer 8:  Learning Modality                                │
│            (examples-first vs theory-first, visual vs text)  │
│  Layer 9:  Time Sensitivity                                 │
│            (urgency patterns, deadline behavior)             │
│  Layer 10: Quality vs Speed Tradeoff                        │
│            (perfectionist vs pragmatist, per context)        │
│  Layer 11: Feedback Patterns                                │
│            (explicit correction vs implicit signals)          │
│  Layer 12: Meta-Preferences                                 │
│            (how they want the agent itself to behave)        │
└─────────────────────────────────────────────────────────────┘
```

**Two-layer context injection:**

The Honcho integration injects user context into the agent's system prompt at two levels:

*Base layer:* A factual summary of the user's identity model and the current session context. Injected at every turn. Typical cost: 200–400 tokens.

*Dialectic layer:* An LLM-synthesized reasoning pass over the base layer and recent conversation, producing a higher-order model of the user's current state: "The user seems frustrated because the last two approaches failed; switch to a more conservative strategy with explicit checkpoints." The dialectic layer is computationally expensive (requires an LLM call to generate), so it is injected on a configurable cadence.

**Configuration parameters:**
- `contextCadence`: Inject base-layer user context every N messages. Default: 1 (every message). For high-throughput sessions, increase to 3–5.
- `dialecticCadence`: Run dialectic synthesis every M messages. Default: 5. Higher values reduce cost but increase latency in adapting to user mood shifts.
- `dialecticDepth`: Number of LLM passes for dialectic synthesis. 1 = fast, shallow. 2 = balanced (default). 3 = deep, catches subtle patterns but costs 3x.

#### 7.2.6 Atropos RL Pipeline: From Trajectories to Training

Hermes uniquely integrates a complete RL training pipeline, making it not just an agent but a **research platform for training tool-calling models**.

**Stage 1: Trajectory Collection.**
Every Hermes session automatically generates structured trajectory data: user messages, tool calls (with arguments), tool results, assistant responses, and timestamps. Trajectories are stored in a local SQLite database with LZ4 compression. A batch mode enables headless parallel workers with checkpointing for large-scale data collection without human interaction.

**Stage 2: Training Modes.**
Three RL algorithms are supported:

```
RLHF (Reinforcement Learning from Human Feedback):
────────────────────────────────────────────────────
trajectories → human rating → reward model training → PPO

1. Present trajectory pairs to human annotators
2. Annotators rate: which trajectory is better? (Bradley-Terry model)
3. Train a reward model on the preference data
4. Use PPO to optimize the agent policy against the reward model
5. KL-regularize against reference policy to prevent reward hacking

DPO (Direct Preference Optimization):
──────────────────────────────────────
preferred/rejected trajectory pairs → direct optimization (offline)

1. Collect pairs of (preferred_trajectory, rejected_trajectory)
   for the same task
2. Compute DPO loss directly — no reward model needed:
   L_DPO = -E[log σ(β · (log π_θ(y_w|x) - log π_ref(y_w|x))
                     - β · (log π_θ(y_l|x) - log π_ref(y_l|x)))]
   where y_w = preferred, y_l = rejected
3. Single-stage offline training — simpler and more stable than RLHF

GRPO (Group Relative Policy Optimization):
──────────────────────────────────────────
group sampling → relative advantage → no value network

1. For each prompt, sample G completions from current policy
2. Score each with verifiable reward (test pass rate, task completion)
3. Normalize advantages within the group: Â_i = (r_i - μ) / σ
4. Clipped surrogate loss with KL penalty (see Chapter 8.1 for full spec)
5. No critic network needed — 50%+ memory savings
```

**Stage 3: Export.**
Trajectories can be exported in ShareGPT format for fine-tuning any model. This enables a workflow where: (1) run Hermes with a frontier model to collect high-quality trajectories, (2) export to ShareGPT, (3) fine-tune a smaller model (e.g., Llama 3 8B) on those trajectories, (4) deploy the fine-tuned model as the Hermes backbone. The loop closes: the agent's usage data improves the agent's underlying model.

**Stage 4: Environment Framework.**
Atropos provides a three-layer environment hierarchy for standardized agent evaluation and training:

```python
class BaseEnv:
    """Atropos base: defines observation/action spaces,
    reward function interface, episode lifecycle."""
    def reset(self) -> Observation: ...
    def step(self, action: Action) -> tuple[Observation, float, bool, dict]: ...

class HermesAgentBaseEnv(BaseEnv):
    """Adds: tool registry, LLM interface, skill system,
    trajectory recording, multi-turn conversation support."""
    def register_tools(self, tools: list[Tool]) -> None: ...
    def record_trajectory(self) -> Trajectory: ...

class ConcreteTaskEnv(HermesAgentBaseEnv):
    """Task-specific: SWE-Bench tasks, code generation,
    web browsing, customer service, etc."""
    def load_task(self, task_id: str) -> None: ...
    def evaluate(self) -> float: ...
```

This makes Hermes a substrate for agent RL research: define a new task environment, collect trajectories, train, evaluate — all within a single framework.

#### 7.2.7 Deployment and Scale

Hermes runs on six terminal backends:

| Backend | Isolation | Use Case | Latency |
|---------|-----------|----------|---------|
| Local | None | Dev, personal | <10ms |
| Docker | Container | Isolated execution | 50–200ms |
| SSH | Network | Remote machines | 50–150ms |
| Daytona | VM + hibernation | Serverless, cost-efficient | 200–500ms (cold) |
| Modal | Container + GPU | Batch RL, inference | 100–300ms |
| Singularity | HPC container | Academic clusters | Variable |

A single gateway process connects to 9 messaging platforms: Telegram, Discord, Slack, WhatsApp, Signal, Matrix, iMessage, WeChat, and CLI. Model-agnostic: 200+ models supported via Nous Portal, OpenRouter, OpenAI, Anthropic, Google, Mistral, local (Ollama/vLLM), and custom endpoints.

**Scale numbers (April 2026):** 99K+ GitHub stars. 370+ contributors. 47 built-in tools. v2026.4.16 (current). Average skill library size for a power user after 3 months: 40–80 skills.

---

### 7.3 Self-Evolving Skills: The SkillHub and ClawHub Ecosystem

The most radical experiment in agent self-improvement is happening in the open-source skills ecosystem. SkillHub, ClawHub, and the `self-improving-agent` skill implement a pattern where agents autonomously create, test, and share self-improvement capabilities. This section documents the architecture, the ecosystem, and the security implications.

#### 7.3.1 The Self-Improving-Agent Skill: Architecture

The `self-improving-agent` skill (1,100+ stars, 90,000+ downloads on ClawHub within 2 months of release) implements a structured self-evolution cycle with seven stages:

```
┌────────────────────────────────────────────────────────────────┐
│              SELF-EVOLVING AGENT CYCLE                          │
│                                                                │
│  STAGE 1: PERCEIVE GAP                                         │
│  Detection signals (any one triggers):                         │
│    • Task failure or incomplete output                         │
│    • Same request type failing 3+ times (pattern detection)    │
│    • User feedback: explicit correction or negative reaction   │
│    • Efficiency anomaly: task taking >2x expected time/tokens  │
│    • Tool error rate exceeding 15% threshold in a session      │
│                            │                                   │
│                            ▼                                   │
│  STAGE 2: SEARCH SOLUTIONS                                     │
│    • Query SkillHub / ClawHub for relevant existing skills     │
│    • Scan engineering blogs via web search                     │
│    • Check GitHub trending for relevant tools/libraries        │
│    • Review AGENTS.md, TOOLS.md for already-known solutions    │
│    • If existing skill found with score > 0.75 → install it   │
│      and skip to Stage 7                                       │
│                            │                                   │
│                            ▼                                   │
│  STAGE 3: DESIGN EXPERIMENT                                    │
│    • Formulate hypothesis: "If I change X, metric Y should     │
│      improve by Z%"                                            │
│    • Create test case from the failure that triggered the gap  │
│    • Define success criteria: metric name, baseline value,     │
│      target value, measurement method                          │
│                            │                                   │
│                            ▼                                   │
│  STAGE 4: RUN EXPERIMENT                                       │
│    • Execute the proposed improvement                          │
│    • Measure before/after on the test case                     │
│    • Record: time, token usage, error count, output quality    │
│                            │                                   │
│                            ▼                                   │
│  STAGE 5: SELECT WINNER                                        │
│    • Compare old approach vs new approach on all metrics       │
│    • If improvement > 10% on primary metric → proceed          │
│    • If improvement ≤ 10% → log failure, try alternative       │
│    • Maximum 3 alternative attempts before abandoning          │
│                            │                                   │
│                            ▼                                   │
│  STAGE 6: SOLIDIFY                                             │
│    • Promote learning to permanent workspace files             │
│    • Promotion target selection (see 7.3.2)                    │
│    • Changes persist across ALL future sessions                │
│                            │                                   │
│                            ▼                                   │
│  STAGE 7: NEXT ITERATION                                       │
│    • Schedule next gap detection cycle                         │
│    • Update internal metrics dashboard                         │
└────────────────────────────────────────────────────────────────┘
```

#### 7.3.2 The Solidification Mechanism

Solidification is where temporary learnings become permanent agent behavior. The mechanism has four components:

**Component 1: Capture.**
Learnings are initially recorded in a `.learnings/` directory:

```
.learnings/
├── LEARNINGS.md              # Insights from successful experiments
├── ERRORS.md                 # Catalogued failure modes with verified fixes
└── FEATURE_REQUESTS.md       # Identified capability gaps (no solution yet)
```

Each entry in `LEARNINGS.md` includes: date, trigger event, hypothesis, experiment result, and recommended promotion target.

**Component 2: Promotion Targets.**
The solidification engine selects the appropriate promotion target based on the learning's scope:

```
Learning scope                    → Target file         → Load frequency
──────────────────────────────────────────────────────────────────────────
Workflow/process improvements     → AGENTS.md           → Every session
Tool-specific gotchas/tips        → TOOLS.md            → When tool is used
Identity/behavioral patterns      → SOUL.md             → Every session
Broadly applicable knowledge      → CLAUDE.md           → Every session
                                  → .github/copilot-    → Every session
                                    instructions.md       (for Copilot users)
```

**Component 3: Persistence.**
Once promoted, learnings are injected into every subsequent session via the standard `CLAUDE.md` / `AGENTS.md` loading mechanism. The agent's behavior changes because its *context* changes, not its *weights*. No model retraining is required.

**Component 4: Automated Review.**
A heartbeat-driven promotion process runs on a configurable schedule (default: daily at 08:30 local time). It scans `.learnings/` for entries that have accumulated enough supporting evidence (minimum 2 related entries) and promotes them automatically. Single-occurrence learnings remain in `.learnings/` until corroborated.

#### 7.3.3 SkillHub.cn: The Chinese AI Skills Ecosystem

SkillHub (skillhub.cn / skillhub.mobi) is Tencent's localized AI skills platform for the Chinese OpenClaw ecosystem:

| Metric | Value |
|--------|-------|
| Total skills available | 13,000+ (mirrored from ClawHub) |
| Curated "Top 50" | Safety-audited, professionally selected |
| Interface language | Full Chinese with optimized search (Jieba tokenizer) |
| Major categories | 8 (Social Media, Development, Productivity, Research, Privacy, Office, Education, Creative) |
| Infrastructure | Tencent Cloud CDN acceleration across 30+ edge nodes in mainland China |
| Cost | Free (ad-supported and Tencent-subsidized) |

**Most downloaded skills (as of Q1 2026):**

| Rank | Skill | Downloads | Category | Description |
|------|-------|-----------|----------|-------------|
| 1 | Xiaohongshu Automation | 59,000+ | Social Media | Post scheduling, caption generation, hashtag optimization |
| 2 | GitHub Collaboration | 48,000+ | Development | PR review, issue triage, code search |
| 3 | Summarize | 44,000+ | Productivity | PDF/video/web page summarization with key points extraction |
| 4 | Tavily Web Search | 39,000+ | Research | Real-time web search with source citation |
| 5 | HaS Anonymizer | 31,000+ | Privacy | PII detection and redaction in documents |
| 6 | Tencent Docs Skill | 27,000+ | Office | Read/write/format Tencent Docs (Chinese Office 365 equivalent) |

Installation is one-line:

```bash
npx skillhub install summarize              # SkillHub (Tencent CDN)
npx agent-skills-hub install self-improving-agent  # ClawHub (global)
```

#### 7.3.4 Security Analysis: Why Self-Evolving Skills Are Flagged Suspicious

Both ClawHub and SkillHub flag self-evolution skills with explicit security warnings. The `self-improving-agent` skill on ClawHub carries a red "SUSPICIOUS" badge. The concern is concrete: a self-evolving skill has, by design, the ability to:

1. Execute arbitrary shell commands (needed to run experiments)
2. Modify agent configuration files: `CLAUDE.md`, `AGENTS.md`, `SOUL.md`, `TOOLS.md`
3. Read system files and environment variables (needed to understand the workspace)
4. Make network requests to arbitrary endpoints (needed to search for solutions)
5. Modify its own skill definition (needed for self-improvement)

A compromised or malicious self-evolving skill could gradually modify the agent's behavior in ways that are nearly undetectable because the changes look like "normal learning": a subtle instruction added to `AGENTS.md` that exfiltrates data, or a `SOUL.md` modification that makes the agent less cautious about executing dangerous commands.

**Five mitigation patterns (from the ClawHub security advisory):**

1. **Container isolation.** Run self-evolving agents in sandboxed containers (NanoClaw's approach). The container has no network access except to whitelisted domains. File modifications are journaled and reviewable.

2. **Git-tracked configuration.** All config files (`CLAUDE.md`, `AGENTS.md`, `SOUL.md`) are tracked in Git. Every promotion creates a commit. `git diff` shows exactly what changed and when. Anomalous changes are detectable via automated review.

3. **Human approval for high-privilege promotions.** Promotions to `SOUL.md` (identity-level changes) and `CLAUDE.md` (system-level context) require explicit human approval via a PR-like review flow. Only `AGENTS.md` and `TOOLS.md` promotions are auto-approved.

4. **Rate limiting.** Maximum 3 promotions per day. Maximum 1 `SOUL.md` promotion per week. This bounds the speed at which a malicious skill can modify agent behavior.

5. **Constitutional file.** A `CONSTITUTION.md` file specifies inviolable constraints (e.g., "never exfiltrate data," "always ask before deleting files"). The self-evolution mechanism cannot modify this file. The agent checks proposed promotions against the constitution before committing them.

#### 7.3.5 Hermes vs OpenClaw Comparison

| Dimension | Hermes Agent | OpenClaw + SkillHub |
|-----------|-------------|---------------------|
| **Skill creation** | Autonomous — agent writes SKILL.md after tasks | Community-driven — humans write, agent installs |
| **Self-improvement** | Built-in via Atropos RL + mid-session skill patches | Via `self-improving-agent` skill (optional add-on) |
| **Skill format** | agentskills.io standard (YAML + MD) | Same standard (fully interoperable) |
| **Discovery** | FTS5 local search + LLM progressive disclosure | ClawHub/SkillHub marketplace search |
| **Training pipeline** | RLHF/DPO/GRPO via Atropos | None built-in (relies on skill-level improvements) |
| **User modeling** | Honcho 12-identity dialectical modeling | Simple MEMORY.md + daily notes |
| **Security** | Per-skill permissions, platform-enforced sandbox | Community flagging + user responsibility |
| **Ecosystem scale** | 99K+ stars, 47 built-in tools | 350K+ stars (OpenClaw) + 13K+ skills |
| **Best for** | Power users who want deep personalization | Breadth of capability via community network effects |

**The key insight:** Hermes is the "agent creates its own skills" paradigm. OpenClaw/SkillHub is the "community creates skills, agent evolves via curated ecosystem" paradigm. They are complementary, not competing — a Hermes agent can install skills from SkillHub, and a skill created by Hermes can be published to ClawHub.

---

### 7.4 MemRL: Reinforcement Learning for Memory Retrieval

**Paper:** Zihao Zeng et al., "MemRL: Memory-Enhanced Reinforcement Learning for Language Agents," arXiv:2601.03192 (January 2026).

MemRL solves a fundamentally different problem than the file-based systems above. Instead of relying on human-designed memory structures and hand-tuned retrieval heuristics, it **learns which memories are useful through reinforcement learning**. The core architectural insight is to decouple the LLM backbone (frozen) from the memory system (plastic), and train only the memory retrieval policy using task outcomes as reward signal.

#### 7.4.1 The Intent-Experience-Utility (IEU) Triplet

MemRL's memory unit is a triplet M = {(z_i, e_i, Q_i)} where:

- **z_i (Intent):** A natural-language description of what the agent was trying to accomplish when this memory was created. Used as the semantic key for Phase 1 retrieval.
- **e_i (Experience):** A structured record of what happened — the context, actions taken, outcome, and a one-sentence distillation. This is what gets injected into the LLM's context when the memory is retrieved.
- **Q_i (Utility):** A learned scalar quality estimate in [0, 1] that predicts how useful retrieving this memory will be for the current task. Updated via Monte Carlo Q-learning from task outcomes.

Formally:

```python
@dataclass
class IEUTriplet:
    # z: Intent (semantic retrieval key)
    intent: str
    intent_embedding: np.ndarray       # Pre-computed, dim=1024 (gte-large)

    # e: Experience (injected into context when retrieved)
    experience: Experience

    # Q: Utility (learned via RL)
    q_value: float = 0.5              # Prior: assume neutral utility
    retrieval_count: int = 0
    success_when_retrieved: int = 0
    last_updated: datetime = field(default_factory=datetime.now)

@dataclass
class Experience:
    context: str                       # What was the situation?
    actions: list[str]                 # What steps were taken?
    outcome: Literal["SUCCESS", "FAILURE", "PARTIAL"]
    key_insight: str                   # One-sentence takeaway
    metadata: dict[str, Any]           # Task-specific fields
```

#### 7.4.2 Two-Phase Retrieval Algorithm

Retrieval proceeds in two phases, separating breadth (semantic relevance) from depth (learned utility):

```
ALGORITHM: MemRL Two-Phase Retrieval
─────────────────────────────────────
Input:
  T    — current task description (natural language)
  M    — memory store: {(z_i, e_i, Q_i)}_{i=1}^{|M|}
  K    — Phase 1 candidate count (default: 50)
  k    — Phase 2 selection count (default: 3–5)
  λ    — exploration bonus weight (default: 0.1)

Phase A — Semantic Filter:
  1. Compute embedding: v_T = Embed(T)                # e.g., gte-large-en-v1.5
  2. For each memory m_i ∈ M:
       sim_i = cosine(v_T, m_i.intent_embedding)
  3. Select top-K by sim_i:
       Candidates = argtop_K(sim)
  Complexity: O(|M|) with exact search, O(log |M|) with ANN (FAISS/Qdrant)
  Latency: < 10ms with FAISS HNSW index for |M| ≤ 100K

Phase B — Q-Value Selection with Exploration:
  4. For each candidate m_i ∈ Candidates:
       score_i = Q_i + λ · √(ln(N) / max(n_i, 1))
     where:
       Q_i    = m_i.q_value (learned utility)
       N      = total retrieval operations across all memories
       n_i    = m_i.retrieval_count
       λ · √(ln(N)/n_i) = UCB exploration bonus
  5. Select top-k by score_i:
       Retrieved = argtop_k(score)
  6. Inject Retrieved into LLM context as structured examples.
  Complexity: O(K)
  Latency: < 1ms

Output: Retrieved memories {m_1, ..., m_k}
```

The exploration bonus (λ · √(ln(N)/n_i)) is a UCB1-style term that ensures under-explored memories get retrieved occasionally, preventing the system from converging prematurely on a small set of "safe" memories. In the paper's ablation, removing the exploration bonus reduces performance by 3–5% on tasks requiring novel strategy transfer.

#### 7.4.3 Monte Carlo Q-Value Updates

After each completed task, the Q-values of all retrieved memories are updated using the observed task reward:

```
ALGORITHM: Monte Carlo Q-Value Update
──────────────────────────────────────
Input:
  R           — set of memories retrieved for this task
  r           — task reward ∈ [0, 1]
                (1.0 = success, 0.0 = failure, fractional = partial)
  α           — learning rate (default: 0.05)

For each memory m_i ∈ R:
  m_i.q_value ← m_i.q_value + α · (r − m_i.q_value)
  m_i.retrieval_count ← m_i.retrieval_count + 1
  if r > 0.5:
    m_i.success_when_retrieved ← m_i.success_when_retrieved + 1
  m_i.last_updated ← now()
```

This is a first-visit Monte Carlo update. The Q-value for each memory exponentially averages toward the mean task reward when that memory is retrieved. With α = 0.05, approximately 14 retrievals are needed for the Q-value to converge within 0.05 of its true expectation (since (1 − α)^n = 0.5 at n ≈ 14 for α = 0.05).

**Convergence property:** Under the assumption that task reward distributions are stationary and the exploration bonus ensures every memory is retrieved infinitely often, the Q-values converge almost surely to the true expected reward conditional on retrieval: Q_i → E[r | m_i retrieved]. This follows directly from the Robbins-Monro conditions on the learning rate schedule (α_t → 0, Σα_t = ∞, Σα_t² < ∞; the constant α = 0.05 satisfies this approximately for the memory counts encountered in practice).

#### 7.4.4 Model-Memory Decoupling: The Stability-Plasticity Resolution

The central architectural principle of MemRL is **Model-Memory Decoupling**: the LLM backbone is frozen (its weights never change during deployment), and all adaptation happens in the memory store's Q-values.

```
┌──────────────────────────────────────────────────────────┐
│           FROZEN COMPONENT: LLM Backbone                  │
│                                                          │
│  Weights: Fixed. Never updated during deployment.        │
│  Input:   [System Prompt] + [Retrieved Memories] +       │
│           [Task Description] + [Conversation History]    │
│  Output:  Actions, tool calls, natural-language responses │
│                                                          │
│  Model can be swapped (GPT-4o → Claude Sonnet → Llama)  │
│  without losing accumulated memory.                       │
└──────────────────────────────────────────────────────────┘
          ▲ retrieved memories (injected as context)
          │
          │ task outcome (reward signal)
          ▼
┌──────────────────────────────────────────────────────────┐
│          PLASTIC COMPONENT: Memory System                 │
│                                                          │
│  Memory Store:    {(z_i, e_i, Q_i)} — IEU triplets      │
│  Retrieval:       Phase A (embedding) + Phase B (Q+UCB)  │
│  Learning:        Monte Carlo Q-value updates            │
│                                                          │
│  Grows continuously. Q-values adapt to task distribution. │
│  Interpretable: every entry is human-readable.           │
└──────────────────────────────────────────────────────────┘
```

This architecture resolves the **stability-plasticity dilemma** that plagues online RL on LLM weights:

- **Stability:** The frozen backbone cannot suffer catastrophic forgetting. Its capabilities — language understanding, reasoning, code generation — are preserved exactly. Q-value updates on a memory store cannot degrade the base model's performance on any task.

- **Plasticity:** The memory store is fully plastic. New memories are added after every task. Q-values are updated continuously. The agent's behavior changes because the memories injected into its context change — not because its weights change.

- **Transferability:** When a better model is released, swap the backbone. The accumulated memory store transfers without modification, because the memory content is model-agnostic natural language.

- **Interpretability:** Every memory entry can be inspected. Its Q-value reveals how useful the system has found it. The retrieval log shows exactly which memories influenced each decision. Compare this to fine-tuned weights, where the learned knowledge is distributed across billions of parameters and cannot be inspected or explained.

#### 7.4.5 Benchmark Results

MemRL was evaluated against five baselines across four benchmark suites:

| Benchmark | MemRL | RAG (static) | Self-RAG | Mem0 | MemoryPalace | Pass@5 |
|---|---|---|---|---|---|---|
| **HLE** (hard reasoning) | **34.2%** | 27.1% | 29.8% | 28.3% | 30.1% | 31.5% |
| **BigCodeBench** | **68.7%** | 62.4% | 64.1% | 63.2% | 65.0% | 66.8% |
| **ALFWorld** | **71.3%** | 58.2% | 61.7% | 60.4% | 63.8% | 65.2% |
| **Lifelong Agent Bench** | **56.8%** | 43.1% | 47.3% | 45.9% | 49.2% | 51.0% |

**Analysis of improvements:**

- **Lifelong Agent Bench** (+13.7 pp over static RAG): The largest improvement, because this benchmark explicitly measures cross-episode learning. The Q-value mechanism accumulates genuine learning signal across 100+ episodes, progressively surfacing the most useful memories for each task type.

- **ALFWorld** (+13.1 pp over static RAG): Household tasks benefit from accumulated heuristics ("always check the drawer before the shelf for small objects"). Each heuristic eliminates a class of wasted actions, and they compound multiplicatively.

- **HLE** (+7.1 pp over static RAG): Hard reasoning benefits less from memory because each problem is relatively unique. The gain comes from retrieving worked examples of similar reasoning patterns, not from task-specific knowledge.

- **BigCodeBench** (+6.3 pp over static RAG): The smallest gain. Code generation is dominated by per-task context (the specific function signature, the test cases) rather than cross-task memory. MemRL still helps by surfacing relevant API usage patterns, but the effect is smaller.

**Ablation results:**

| Ablation | ALFWorld | BigCodeBench |
|---|---|---|
| Full MemRL | **71.3%** | **68.7%** |
| No Q-learning (use only semantic similarity) | 63.8% | 64.9% |
| No exploration bonus (λ = 0) | 68.1% | 67.2% |
| No memory (zero-shot) | 52.4% | 58.1% |
| Random memory retrieval | 55.8% | 60.3% |

Removing Q-learning (reverting to pure semantic retrieval) loses 7.5 pp on ALFWorld and 3.8 pp on BigCodeBench. Removing the exploration bonus loses 3.2 pp and 1.5 pp respectively — smaller but still significant, especially on novel task variants.

---

### 7.5 OpenClaw Three-Tier Memory with Dreaming

OpenClaw (2025–2026, 350K+ GitHub stars) implements the most complete three-tier memory system in the open-source agent ecosystem. Its distinguishing feature is the "Dreaming" consolidation mechanism that runs as an overnight batch process, converting episodic daily notes into durable semantic memory.

#### 7.5.1 Tier 1: Long-Term Memory — `MEMORY.md`

The `MEMORY.md` file is the semantic store. It contains distilled, verified knowledge about the project, the team, and the agent's own capabilities. Structured with explicit sections, each with a last-updated timestamp for staleness detection:

```markdown
# MEMORY.md
Last consolidated: 2026-03-14T03:00:00Z

## Repository Architecture
<!-- Updated: 2026-03-12 -->
- Monorepo: Go backend (cmd/, internal/), React frontend (web/),
  shared proto definitions (proto/)
- Backend: Chi router, sqlc for DB queries, pgx for PostgreSQL
- Frontend: Vite, React 19, TanStack Query
- CI: GitHub Actions, `make lint test` on every PR
- Deploy: ArgoCD → staging (auto), production (manual approval)

## Database Conventions
<!-- Updated: 2026-03-14 -->
- All tables: UUID PKs via gen_random_uuid()
- Timestamps: always timestamptz, never timestamp
- Migrations: golang-migrate, files named
  {unix_timestamp}_{description}.{up|down}.sql
- Pool: 25 connections (staging), 100 (production)

## Testing Patterns
<!-- Updated: 2026-03-10 -->
- Unit: `go test ./...` (no Docker)
- Integration: `make test-integration` (PostgreSQL in Docker)
- Frontend: `cd web && pnpm test` (Vitest)
- E2E: `make test-e2e` (Playwright, both services required)
- GOTCHA: Integration tests silently skip without TEST_DATABASE_URL

## Known Issues
<!-- Updated: 2026-03-13 -->
- WebSocket reconnection race on server restart
  (workaround: client exponential backoff in web/src/lib/ws.ts)
- sqlc codegen: incorrect null handling for LEFT JOIN columns
  (always verify nullable fields after regenerating)
```

**Critical update rule:** `MEMORY.md` is **never** updated during a task session. Updates happen only during Dreaming (Tier 3). This prevents in-flight contamination — partially-learned lessons being committed to long-term memory before the task outcome is known.

#### 7.5.2 Tier 2: Daily Notes — Episodic Memory

After each task session, the agent generates a structured daily note with a rigid format designed for machine processing during Dreaming:

```markdown
# Daily Note: 2026-03-14

## Session 1: 09:15–10:42 UTC
### Task
Implement rate limiting on /api/v1/search

### Context
- Ticket: PROJ-1847
- Requester: Sara (backend team lead)
- Priority: P1

### Actions Taken
1. Read middleware stack in internal/middleware/
2. No existing rate limiter — Chi middleware chain
3. Evaluated: golang.org/x/time/rate, Redis sliding window, tollbooth
4. Chose x/time/rate: no Redis dep, token bucket model matches upstream,
   already transitive dep in go.mod
5. Implemented per-IP rate limiter: 10 req/s burst, 5 req/s sustained
6. Added X-RateLimit-Remaining, Retry-After headers
7. Wrote 4 unit tests + 1 integration test

### Outcome
SUCCESS — PR #412 merged after 1 review round

### What Worked
- Checking transitive deps before adding new ones saved review cycle
- Integration test first caught middleware ordering bug

### What Didn't Work
- sync.Map for per-IP limiters → memory leak in cleanup goroutine
- Switched to hashicorp/golang-lru with TTL

### Lessons
- Rate limiter goes BEFORE auth middleware
- sync.Map is wrong for caches needing TTL eviction
- Check go.sum for transitive deps before adding new ones
```

Daily notes accumulate in a `daily_notes/` directory. Retrieval is embedding-based: each note is embedded as a single vector keyed on the task description, and cosine similarity against the current task description retrieves the top-3 relevant notes.

#### 7.5.3 Tier 3: Dreaming — Overnight Consolidation

The Dreaming process runs as a scheduled batch job (default: cron at 03:00 UTC). It reads all daily notes since the last consolidation and produces updates to `MEMORY.md` through four stages:

```
ALGORITHM: Dreaming Consolidation
──────────────────────────────────

STAGE 1: CLUSTER
  Input:  Daily notes since last Dreaming run
  Method: Embed each note (task description as key field)
          Cluster by cosine similarity, threshold > 0.72
  Output: Groups of related notes (minimum cluster size: 2)

STAGE 2: EXTRACT
  Input:  Each cluster of ≥ 2 related notes
  Prompt: "Given these {N} session records about {cluster_topic}:
           1. What patterns repeat across sessions?
           2. What mistakes were made more than once?
           3. What non-obvious knowledge would help future sessions?
           4. Are there conventions or heuristics to codify?
           Output: JSON {patterns, mistakes, knowledge, conventions}"
  Output: Structured extractions per cluster

STAGE 3: MERGE
  Input:  Extractions + current MEMORY.md
  Prompt: "Given the current MEMORY.md and new extractions,
           produce an updated MEMORY.md that:
           1. Adds new knowledge in the appropriate section
           2. Updates existing entries that need refinement
           3. Flags contradictions with ⚠️ for human review
           4. Updates the 'Last consolidated' timestamp
           Do NOT delete unless directly contradicted."
  Output: Updated MEMORY.md (written to disk)

STAGE 4: ARCHIVE
  Input:  Processed daily notes
  Action: Move to daily_notes/archived/
          (Still available for retrieval, but with 0.5x score multiplier)
```

**Cost per Dreaming run:** $0.50–$2.00, processing 5–20 daily notes. GPT-4o-mini or Claude Haiku produce adequate extraction quality for Stages 1–2 at 10–20x lower cost than frontier models. Stage 3 (merge) benefits from a stronger model (GPT-4o or Claude Sonnet) because it requires understanding the existing `MEMORY.md` structure.

**Quality gates:**

1. **Minimum cluster size = 2.** Single-session learnings are not generalized. They must appear in ≥ 2 related sessions before promotion to `MEMORY.md`. This prevents spurious generalizations from one-off workarounds.

2. **Contradiction detection.** If an extraction contradicts an existing `MEMORY.md` entry, it is flagged with ⚠️ and requires human approval. This catches cases where the agent learned the wrong lesson from a successful outcome (correlation ≠ causation).

#### 7.5.4 The Markdown Brain Pattern in Production

The Dreaming architecture is an instance of what practitioners call the "Markdown Brain" pattern — the most effective production memory system in 2025–2026. The pattern works because it optimizes for three things that actually matter:

1. **Transparency.** You can `cat` the agent's memory. There is no opaque embedding database to debug.
2. **Editability.** You can fix the agent's memory with a text editor. Bad learning? Delete the line.
3. **Context-window efficiency.** Markdown compresses well into tokens. A full `MEMORY.md` typically costs 500–1,500 tokens.

**Token budget for the Markdown Brain:**

| File | Size | Tokens | Load Frequency |
|---|---|---|---|
| MEMORY.md | 2–5 KB | 600–1,500 | Every session |
| Corrections.md | 1–3 KB | 300–900 | Every session |
| Index.md | 0.5 KB | ~150 | Every session |
| **Startup total** | **3.5–8.5 KB** | **~1,050–2,550** | — |

With a 200K-token context window, startup memory consumes 0.5–1.3%. If your memory system exceeds 5% of the context window on startup, you are loading too much.

**Write discipline** is the hardest engineering challenge. Without strict rules, the agent either writes too little (missing valuable lessons) or too much (polluting memory with noise). Production-tested rules:

- Each entry must be **actionable** (not "learned about the codebase")
- Each entry must be **specific** (include file paths, command names, config keys)
- Each correction must include **both the mistake AND the fix**
- Never duplicate — update existing entries instead
- Cap rolling logs (e.g., Conversation Log) at 50 entries; prune oldest 20 when exceeded

---

### 7.6 Memory Architecture Decision Tree

When building a new agent system, use this decision tree to select the right memory architecture. The tree is parameterized by deployment model, team size, auditability requirements, and learning needs.

```
START: What is the agent's deployment model?
│
├─► Single-session, stateless (chatbot, one-shot task)
│   → CONTEXT-WINDOW MANAGEMENT only
│     Implementation: conversation summarization, observation truncation
│     Storage: none (all in-context)
│     Latency: 0ms (no external retrieval)
│     Complexity: Low
│     Example: ChatGPT, most customer service bots
│
├─► Multi-session, same user/project (coding assistant, personal agent)
│   │
│   ├─► Team ≤ 5 people, ≤ 3 repositories
│   │   → MARKDOWN BRAIN pattern (Section 7.5.4)
│   │     Implementation: MEMORY.md + Corrections.md + CLAUDE.md startup hook
│   │     Storage: Git repo (version-controlled with code)
│   │     Latency: 0ms (files read at session start)
│   │     Complexity: Low
│   │     When to upgrade: When you need audit trails or multi-agent coordination
│   │
│   ├─► Team > 5 OR repos > 3 OR strong audit requirements
│   │   → EVENT-SOURCED architecture (Section 7.1)
│   │     Implementation: typed events, append-only log, condensation strategies
│   │     Storage: PostgreSQL JSONB, EventStoreDB, or filesystem
│   │     Latency: 0ms (state derived from local log)
│   │     Complexity: High
│   │     When to use: when exact replay and branching are worth the complexity
│   │
│   └─► Focus on learning across sessions
│       │
│       ├─► Sufficient task volume (≥ 100 tasks/week)
│       │   │
│       │   ├─► Full-stack control (self-hosted models)
│       │   │   → MemRL (Section 7.4)
│       │   │     Implementation: IEU triplets, two-phase retrieval, Q-learning
│       │   │     Storage: Vector DB (Qdrant/FAISS) + metadata store (Postgres)
│       │   │     Latency: 10–50ms per retrieval
│       │   │     Complexity: Medium-High
│       │   │
│       │   └─► API-only model access
│       │       → THREE-TIER with Dreaming (Section 7.5)
│       │         Implementation: MEMORY.md + daily notes + consolidation cron
│       │         Storage: filesystem + embedding index
│       │         Latency: 10–100ms per retrieval
│       │         Complexity: Medium
│       │
│       └─► Low task volume (< 100 tasks/week)
│           → MARKDOWN BRAIN with manual curation
│             The Q-value signal is too sparse to learn meaningful
│             utility estimates. Rely on human judgment for memory
│             curation until volume increases.
│
├─► Multi-agent system, shared knowledge base
│   → MEMORY-AS-A-SERVICE (e.g., Mem0, custom API)
│     Implementation: central memory API, per-agent and per-user scoping
│     Storage: Vector DB + Graph DB (Neo4j, for relationship modeling)
│     Latency: 50–200ms per retrieval (network hop)
│     Complexity: High (operational overhead of running memory service)
│
└─► Formal guarantees required (safety-critical, provably convergent)
    → MEMORY-AUGMENTED MDP with Read-Write Learning (Section 7.7)
      Implementation: M-MDP formulation, entropy-regularized policy iteration
      Complexity: Very High (research-grade)
      When to use: when you need convergence guarantees, not just empirical results
```

**The overriding principle:** Start with the simplest architecture that could work, and add complexity only when you have evidence that the simpler approach is insufficient. The Markdown Brain pattern handles 80% of use cases. Event sourcing is warranted when audit trails are non-negotiable. MemRL is warranted when you have enough task volume to generate meaningful Q-value learning signal. The formal M-MDP framework (Section 7.7) is warranted when you need theoretical guarantees in addition to empirical performance.

**The critical mistake teams make:** jumping to vector databases and graph stores before they have exhausted the capabilities of flat files. A `MEMORY.md` file with 50 well-curated entries will outperform a vector database with 5,000 poorly-curated entries, because retrieval quality is dominated by content quality, not retrieval algorithm sophistication.

---

### 7.7 Memento-II: A Formal Framework for Memory-Augmented Agents

**Paper:** Logeswaran et al., "Memento: Memory-Augmented Policy Learning for Interactive Agents," arXiv:2512.22716 (December 2025). Memento-II extends the original framework to provide convergence guarantees.

The systems described in Sections 7.1–7.5 are engineering artifacts: they work in practice, but they lack formal guarantees about convergence, optimality, or stability. Memento-II fills this gap by providing a rigorous mathematical framework — the **Memory-Augmented MDP (M-MDP)** — that formalizes agent memory as part of the state space and proves that learning to read and write memory can converge to optimal behavior under entropy regularization.

This section presents the framework at proof-sketch level. For full proofs, see the original paper.

#### 7.7.1 Memory-Augmented MDP (M-MDP)

A standard MDP is a tuple (S, A, P, R, γ) where S is the state space, A is the action space, P is the transition function, R is the reward, and γ is the discount factor. Memento-II extends this with an external memory buffer:

**Definition (M-MDP).** A Memory-Augmented MDP is a tuple (S, A, M, P, R, γ, ψ_read, ψ_write) where:

- S is the environment state space
- A is the action space
- M is the memory space (the set of all possible memory configurations)
- P: S × A → Δ(S) is the environment transition function
- R: S × A → ℝ is the reward function
- γ ∈ [0, 1) is the discount factor
- ψ_read: S × M → S̃ is the **read function** that augments the observed state with memory content, producing an augmented state S̃ = S × M_retrieved
- ψ_write: S × A × S' × M → M is the **write function** that updates memory after each transition

The agent's policy operates on the augmented state: π: S̃ → Δ(A), where S̃ = ψ_read(s, m).

The key formal insight: **reading memory is policy improvement (it gives the agent access to better state representations), and writing memory is policy evaluation (it records experience that improves future state representations).**

#### 7.7.2 The Read-Write Learning Framework

Memento-II decomposes learning into two interleaved processes:

**Reading = Policy Improvement.**

Given a fixed memory configuration m ∈ M, the read function ψ_read produces augmented states that are strictly more informative than raw states (in the information-theoretic sense):

```
H(S̃) = H(S, M_retrieved) ≤ H(S) + H(M_retrieved)

I(S̃; A*) ≥ I(S; A*)
```

where A* is the optimal action, H is entropy, and I is mutual information. The inequality holds because conditioning on additional relevant information (retrieved memory) can only increase the mutual information between the agent's observation and the optimal action. The read function acts as a policy improvement operator: for a fixed write policy, improving the read function improves the agent's performance.

**Writing = Policy Evaluation.**

The write function ψ_write updates memory after observing transitions. This is analogous to policy evaluation in standard RL: the agent evaluates its current policy by recording which actions led to which outcomes. Better memory content makes future read operations more informative, which makes the policy better, which generates better data for writing.

The interleaved update rule:

```
ALGORITHM: Memento-II Read-Write Learning
──────────────────────────────────────────

Initialize: policy π_0, read function ψ_read^0, write function ψ_write^0, memory m_0

For each episode t = 0, 1, 2, ...:

  POLICY EXECUTION (with current read function):
    For each step k = 0, 1, ..., K:
      s̃_k = ψ_read^t(s_k, m_t)              # Read: augment state with memory
      a_k ~ π_t(·| s̃_k)                      # Act on augmented state
      s_{k+1}, r_k ~ P(·|s_k, a_k), R(s_k, a_k)  # Environment transition
      m_{t+1} = ψ_write^t(s_k, a_k, s_{k+1}, m_t)  # Write: update memory

  POLICY UPDATE (entropy-regularized):
    Compute returns: G_k = Σ_{j=k}^{K} γ^{j-k} r_j
    Update π_{t+1} via entropy-regularized policy gradient:
      ∇_θ J(θ) = E[Σ_k (G_k - b_k) ∇_θ log π_θ(a_k|s̃_k)
                      + τ · ∇_θ H(π_θ(·|s̃_k))]
    where τ is the entropy coefficient and b_k is a baseline.

  READ FUNCTION UPDATE:
    Optimize ψ_read to maximize policy performance:
      ψ_read^{t+1} = argmax_{ψ} E_{π_t}[Σ_k r_k | s̃_k = ψ(s_k, m_t)]

  WRITE FUNCTION UPDATE:
    Optimize ψ_write to maximize future read quality:
      ψ_write^{t+1} = argmax_{ψ} E[I(ψ_read(s_{future}, ψ(·)); A*)]
```

#### 7.7.3 Convergence Guarantees via Entropy-Regularized Policy Iteration

The central theoretical result of Memento-II:

**Theorem (Convergence of Read-Write Learning).** Under entropy-regularized policy iteration with coefficient τ > 0, if:

1. The memory space M is finite (or compact with appropriate continuity conditions),
2. The read function class and write function class are expressive enough to represent the optimal read/write pair,
3. The learning rates satisfy the Robbins-Monro conditions (α_t → 0, Σα_t = ∞, Σα_t² < ∞),

then the Read-Write Learning algorithm converges to a fixed point (π*, ψ_read*, ψ_write*) that satisfies:

```
V^{π*, ψ_read*, ψ_write*}(s, m) ≥ V^{π, ψ_read, ψ_write}(s, m) − ε(τ)
```

for all (π, ψ_read, ψ_write), all (s, m), where ε(τ) → 0 as τ → 0.

**Proof sketch:**

1. **Policy improvement step.** For a fixed (ψ_read, ψ_write), entropy-regularized policy iteration on the augmented MDP (S̃, A, P̃, R, γ) converges to the optimal soft policy π*_τ. This follows from the standard convergence result for soft policy iteration (Haarnoja et al., 2018).

2. **Read function improvement.** For a fixed (π, ψ_write), optimizing ψ_read is equivalent to selecting the best state representation. Since I(S̃; A*) is concave in the representation for fixed policies (data processing inequality), gradient ascent converges to a local optimum that is globally optimal under the convexity conditions on M.

3. **Write function improvement.** For a fixed (π, ψ_read), optimizing ψ_write to maximize future read quality is a supervised learning problem (predicting which experiences will be most informative for future reads). Under the expressiveness assumption, this converges to the optimal write function.

4. **Joint convergence.** The alternating optimization of (π, ψ_read, ψ_write) forms a block coordinate ascent on the entropy-regularized objective. Each block update improves or maintains the objective value. Since the objective is bounded above, the sequence converges to a fixed point. The ε(τ) gap vanishes as entropy regularization strength decreases.

The practical significance of this theorem: **MemRL's Monte Carlo Q-learning (Section 7.4) is a special case of Read-Write Learning where the read function is two-phase retrieval and the write function is Q-value update.** The theorem guarantees that this learning process converges under mild conditions. The exploration bonus in MemRL's Phase B retrieval serves the same role as the entropy regularization in Memento-II — it prevents premature convergence and ensures sufficient exploration of the memory space.

#### 7.7.4 Mapping Practical Systems to the M-MDP Framework

Every memory system in this chapter can be viewed through the M-MDP lens:

| System | Memory Space M | Read Function ψ_read | Write Function ψ_write | Learning Signal |
|---|---|---|---|---|
| **OpenHands V1** | Event stream | Condensation + prompt construction | Event append | None (deterministic) |
| **Hermes Skills** | SKILL.md files | FTS5 search + progressive disclosure | Skill creation/patching | Trigger heuristics (handcrafted) |
| **OpenClaw 3-Tier** | MEMORY.md + daily notes | Embedding retrieval + Dreaming | Note creation + Dreaming merge | Clustering (unsupervised) |
| **MemRL** | IEU triplets | Phase A (embedding) + Phase B (Q-value) | Q-value update | Monte Carlo returns (RL) |
| **Memento-II** | Abstract M | Learned ψ_read | Learned ψ_write | Policy gradient (RL) |

The progression from top to bottom represents increasing formalization and increasing learning capacity:

- **OpenHands:** No learning. Memory operations are deterministic functions of the event stream. The read function (condensation) is hand-designed. Effective for single-session tasks.

- **Hermes:** Heuristic learning. The write function (skill creation) triggers on hand-designed conditions. The read function (progressive disclosure) is hand-designed. Effective for repeated workflows with a stable user.

- **OpenClaw:** Unsupervised learning. The Dreaming process discovers patterns via clustering and LLM extraction. No explicit reward signal. Effective for accumulating project-specific knowledge.

- **MemRL:** Reinforcement learning. Both read (Q-value-guided retrieval) and write (Q-value update) are learned from task outcomes. Effective for diverse, reward-bearing tasks.

- **Memento-II:** Full RL with convergence guarantees. Both read and write functions are jointly optimized via entropy-regularized policy iteration. Theoretical framework for analyzing all of the above.

#### 7.7.5 Practical Implications of the M-MDP Framework

The formal framework yields three actionable engineering insights:

**Insight 1: Read quality is bounded by write quality.** No matter how sophisticated your retrieval algorithm, it cannot retrieve useful memories if the write function stored the wrong information. This is why MemRL's "key_insight" field in Experience is so important — it distills the experience into the most retrievable form. In M-MDP terms: I(ψ_read(s, m); A*) ≤ I(m; A*), so the retrieval function can never extract more information than the memory contains.

**Insight 2: Entropy regularization prevents memory collapse.** Without exploration, memory systems converge on a small set of "safe" entries and stop discovering better ones. This is the empirical finding behind MemRL's UCB exploration bonus and Hermes's self-evaluation checkpoints. The formal framework explains why: without entropy regularization, the policy collapses to a deterministic function of a small memory subset, and the write function stops generating diverse entries because the policy no longer explores diverse states.

**Insight 3: The optimal memory size is finite.** For any finite-horizon MDP with bounded state space, there exists a finite memory capacity beyond which additional memory does not improve performance. In practice, this means memory pruning is not just a cost optimization — it is theoretically justified. OpenClaw's archival mechanism (0.5x score multiplier for old notes) and MemRL's finite K parameter (top-K retrieval) are both implementations of this principle.

---

*This chapter has presented seven memory architectures at increasing levels of formalization: OpenHands V1's event-sourced append-only log for deterministic replay and debugging (Section 7.1); Hermes's closed-loop skill learning system with autonomous creation, progressive disclosure retrieval, dialectical user modeling, and RL training pipeline (Section 7.2); the self-evolving skills ecosystem around SkillHub and ClawHub with its solidification mechanism and security analysis (Section 7.3); MemRL's reinforcement-learned memory retrieval with IEU triplets and Monte Carlo Q-value updates (Section 7.4); OpenClaw's three-tier Dreaming architecture for overnight consolidation of episodic into semantic memory (Section 7.5); a decision tree for selecting the right architecture (Section 7.6); and Memento-II's M-MDP framework providing formal convergence guarantees for Read-Write Learning (Section 7.7). Chapter 8 builds on this foundation by examining the RL algorithms used to train agents — GRPO, RetroAgent, and the hybrid training-runtime evolution approach — in the same formal detail.*

---

## Chapter 8: Runtime Self-Evolution — Agents That Get Better Through Use

This chapter covers agents that improve *during deployment* without any model weight updates. No fine-tuning, no RLHF, no gradient descent. The LLM backbone stays frozen; everything evolves in external memory, skill documents, heuristic libraries, and executable code. This is the only kind of evolution that matters for production agents running hard, long-horizon tasks — you can't retrain a model every time it encounters a new failure mode at 3 AM.

### 8.1 The Runtime Evolution Taxonomy

There are six distinct mechanisms for runtime self-evolution, ordered from simplest to most sophisticated. Each operates on a frozen LLM backbone — the model weights never change.

```
┌────────────────────────────────────────────────────────────────┐
│          RUNTIME SELF-EVOLUTION MECHANISMS                      │
│          (all operate on frozen LLM backbone)                   │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  1. VERBAL REFLECTION (Reflexion, 2023)                        │
│     Agent reflects on failure → stores verbal feedback →       │
│     retrieves on next attempt at same task                     │
│     Memory: episodic text buffer                               │
│     Signal: binary success/failure + self-generated critique   │
│                                                                │
│  2. EXPERIENTIAL HEURISTIC EXTRACTION (ExpeL, 2024; ERL, 2026)│
│     Agent extracts "When X, Then Y" rules from trajectories → │
│     accumulates heuristic library → retrieves at test time     │
│     Memory: structured heuristic rules                         │
│     Signal: success/failure pairs OR single-attempt reflection │
│                                                                │
│  3. SKILL ACCUMULATION (Voyager, 2023; Hermes, 2026)          │
│     Agent writes executable code/procedures after success →    │
│     builds growing skill library → retrieves & composes        │
│     Memory: code files or SKILL.md documents                   │
│     Signal: execution success + verification                   │
│                                                                │
│  4. KNOWLEDGE CRYSTALLIZATION (RKC, 2026; OpenClaw, 2026)     │
│     Agent records operational guidelines to filesystem →       │
│     promotes learnings to permanent config files →             │
│     transfers across environments zero-shot                    │
│     Memory: AGENTS.md / TOOLS.md / MEMORY.md on disk          │
│     Signal: repeated failures + heartbeat review               │
│                                                                │
│  5. UTILITY-LEARNED MEMORY (MemRL, 2026)                      │
│     Agent stores intent-experience-utility triplets →          │
│     learns Q-values for each memory via Monte Carlo updates → │
│     retrieves by utility, not just similarity                  │
│     Memory: episodic buffer with learned utility scores        │
│     Signal: task outcome (success=1, failure=0)                │
│                                                                │
│  6. EXECUTABLE SUBAGENT ACCUMULATION (AgentFactory, 2026)     │
│     Agent saves successful solutions as Python modules →       │
│     continuously refines based on execution feedback →         │
│     reuses mature subagents for similar future tasks           │
│     Memory: Python code files in skill library                 │
│     Signal: execution result + cost reduction                  │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

### 8.2 Reflexion: Verbal Reinforcement Without Weight Updates

**Paper:** Shinn et al., "Reflexion: Language Agents with Verbal Reinforcement Learning," NeurIPS 2023, arXiv:2303.11366

The foundational work on runtime agent self-improvement. Core insight: replace scalar RL rewards with natural language self-reflections stored in an episodic memory buffer, enabling learning without gradient updates.

**Architecture:**
- Actor: generates actions using the policy LLM (frozen)
- Evaluator: scores the trajectory (binary success/fail or scalar)
- Self-Reflection: LLM generates verbal analysis of what went wrong
- Memory: sliding window of last N reflections prepended to next attempt

**Algorithm:**
```
for trial = 1, 2, ..., max_trials:
    trajectory = actor.generate(task, memory_buffer)
    reward = evaluator.score(trajectory)
    if reward >= threshold:
        return SUCCESS
    reflection = self_reflect(task, trajectory, reward)
    memory_buffer.append(reflection)
    # Next trial sees: [task + all prior reflections + new attempt]
```

**Key results:** 91% pass@1 on HumanEval (surpassing GPT-4's 80%). Significant improvements on ALFWorld (+22%), HotpotQA (+14%).

**Limitation:** Only improves on the SAME task across retries. No cross-task transfer. Memory is per-task, not global.

### 8.3 ExpeL: Cross-Task Experiential Learning

**Paper:** Zhao et al., "ExpeL: LLM Agents Are Experiential Learners," AAAI 2024, arXiv:2308.10144

Advances beyond Reflexion by extracting CROSS-TASK heuristics from success/failure pairs.

**Three-stage pipeline:**
1. Experience Gathering: trial-and-error with Reflexion-style retries
2. Insight Extraction: LLM compares success/failure trajectory pairs, extracts rules using ADD/UPVOTE/DOWNVOTE/EDIT operations
3. Task Inference: retrieved insights + successful trajectory examples augment new tasks

**Insight format:**
```
INSIGHT: When searching for multi-hop information, always verify
intermediate claims before proceeding to the next hop.
EVIDENCE: Task #47 (success) verified claims at each step;
Task #23 (failure) propagated an incorrect intermediate answer.
UPVOTES: 7  DOWNVOTES: 1
```

**Results:** HotpotQA +36% improvement; ALFWorld +50% improvement. Demonstrates transfer: HotpotQA insights transfer to FEVER with 70% success (vs 58% baseline).

**Limitation:** Requires PAIRS of success/failure on the same task distribution. Can't learn from single attempts.

### 8.4 ERL: Single-Attempt Heuristic Extraction

**Paper:** Allard et al., "Experiential Reflective Learning for Self-Improving LLM Agents," ICLR 2026 MemAgents Workshop, arXiv:2603.24639

Key advance over ExpeL: works from SINGLE-ATTEMPT trajectories. No need for contrastive pairs.

**Mechanism:**
- After each task attempt (success or failure), LLM reflects on the trajectory
- Generates structured "When-Then" heuristics:
  ```
  WHEN: The task requires navigating a multi-page form
  THEN: Always read the complete form structure before filling any field;
        forms often have dependencies between fields on different pages.
  SOURCE: Task attempt #142 (failure — missed dependent field on page 3)
  ```
- At test time: LLM-based ranker selects top-k (k=20) most relevant heuristics
- Selected heuristics injected into system prompt for the new task

**Results on Gaia2:** +7.8% success rate over ReAct baseline. Outperforms ExpeL and AutoGuide.

**Why this matters for production:** In real production deployments, you rarely get multiple attempts at the same task. Users submit requests once. ERL can learn from every single interaction.

### 8.5 MemRL: Utility-Learned Memory Retrieval

**Paper:** Zhang et al., "MemRL: Self-Evolving Agents via Runtime Reinforcement Learning on Episodic Memory," arXiv:2601.03192, January 2026

The most mathematically rigorous runtime evolution framework. Core innovation: treat memory retrieval as a reinforcement learning problem where Q-values are learned for each memory entry, so the agent retrieves by UTILITY (what actually helped), not just SIMILARITY (what looks related).

**Intent-Experience-Utility (IEU) Triplet:**
```
Memory M = {(z_i, e_i, Q_i)} for i = 1...|M|

z_i = intent (the problem/query used as index — embedded via sentence encoder)
e_i = experience (the solution approach or specific steps taken)
Q_i = utility (expected value of using this experience — learned via MC updates)
```

**Two-Phase Retrieval:**
```
Phase 1 — Semantic Filter:
  candidates = {m_i ∈ M : cosine_sim(embed(query), embed(z_i)) > threshold}
  # Filters by relevance. Removes obviously unrelated memories.

Phase 2 — Q-Value Selection:
  selected = argmax_{m_i ∈ candidates} Q_i
  # Selects by UTILITY, not similarity.
  # A memory that is semantically similar but historically unhelpful
  # gets low Q_i and is skipped.
```

**Q-Value Update (Monte Carlo):**
```
After task completion with outcome r ∈ {0, 1}:
  For each memory m_i that was retrieved and used:
    Q_i ← (1 - α) * Q_i + α * r
    # α = learning rate (typically 0.1-0.3)
    # r = 1 if task succeeded, 0 if failed

  # Q-values converge toward the true success rate
  # of using each memory entry.
```

**Why Q-values beat similarity:**
Consider two memories both semantically similar to "deploy to staging":
- Memory A: "Use gh workflow run" — Q=0.85 (worked 85% of the time)
- Memory B: "Use kubectl apply" — Q=0.20 (worked 20% — wrong cluster config)

Pure similarity retrieval picks randomly. MemRL picks Memory A.

**Results:** Outperforms RAG, Self-RAG, Mem0, MemP, and Pass@k baselines on HLE, BigCodeBench, ALFWorld, and Lifelong Agent Bench. Key: performance improves over time as Q-values converge — the agent literally gets better with use.

### 8.6 Voyager: Lifelong Skill Accumulation Through Code

**Paper:** Wang et al., "Voyager: An Open-Ended Embodied Agent with Large Language Models," TMLR 2024

The pioneering work on runtime skill accumulation. Core insight: store skills as EXECUTABLE CODE, not text descriptions. Code is composable, verifiable, and precise.

**Three components:**
1. Automatic Curriculum: generates tasks matching agent's current skill level
2. Skill Library: ever-growing collection of verified JavaScript functions
   - Each skill: function signature + docstring + implementation + verification test
   - Stored in a vector DB indexed by task description
   - Retrieved via embedding similarity when new task matches
3. Iterative Prompting: agent writes code → executes → gets error → fixes → repeats

**Skill format (Minecraft example):**
```javascript
// Skill: mineWoodLog
// Description: Mine 1 wood log from the nearest tree
// Verification: bot.inventory.count("oak_log") >= 1
async function mineWoodLog(bot) {
  const tree = bot.findBlock({matching: mcData.blocksByName.oak_log.id});
  if (!tree) throw new Error("No tree found nearby");
  await bot.pathfinder.goto(new GoalBlock(tree.position));
  await bot.dig(tree);
}
```

**Skill composition:** Higher-level skills call lower-level ones:
```javascript
async function craftWoodenPickaxe(bot) {
  await mineWoodLog(bot);     // reuses existing skill
  await mineWoodLog(bot);     // called twice for 2 logs
  await craftPlanks(bot);     // reuses existing skill
  await craftSticks(bot);     // reuses existing skill
  await craftItem(bot, "wooden_pickaxe");
}
```

**Results:** 3.3x more unique items than baselines, 15.3x faster tech tree progression, skills transfer zero-shot to new Minecraft worlds.

**Why this matters beyond Minecraft:** The pattern — store solutions as executable code, verify they work, compose them into more complex solutions — is exactly what production agents do. AgentFactory (Section 8.8) applies this to real-world software tasks.

### 8.7 RetroAgent: Memory with Learned Utility Scores

**Paper:** Zhang et al., "RetroAgent: From Solving to Evolving via Retrospective Dual Intrinsic Feedback," arXiv:2603.08561, March 2026

RetroAgent's runtime memory component (the intrinsic language feedback) is a sophisticated evolution of the ExpeL/ERL pattern. While GRPO training is used for the base policy (training-time), the MEMORY BUFFER with SimUtil-UCB retrieval is the runtime evolution mechanism.

**Memory Buffer Structure:**
```
Each entry m_i = (x_i, l_i, τ_i, u_i, n_i, d_i) where:
  x_i = task instruction (embedded for similarity search)
  l_i = natural language lesson distilled from trajectory
  τ_i = the trajectory from which lesson was derived
  u_i ∈ [0,1] = utility score (exponential moving average)
  n_i ∈ ℕ = retrieval count (how many times this was used)
  d_i ∈ {success, failure} = outcome of originating episode
```

**SimUtil-UCB Retrieval (the key innovation):**
```
For a new task x, score each memory entry m_i:

  S(m_i | x, M) = α · s_rel(x, x_i) + (1 - α) · u_util_UCB(i)

Where:
  s_rel(x, x_i) = cosine_sim(E(x), v_i)   [semantic relevance]
                   (discard if < 0.4)

  u_util_UCB(i) = u_i + κ · sqrt(ln(N) / n_i)   [UCB-augmented utility]
                   u_i = utility score
                   κ = 1.0 (exploration constant)
                   N = total retrieval count across buffer
                   n_i = this entry's retrieval count

  α = 0.5 (trade-off between relevance and utility)
```

**Utility update (exponential moving average):**
```
After episode where m_i was retrieved:
  u_i ← (1 - β_util) · u_i + β_util · û_t
  
  β_util = smoothing coefficient (typically 0.2)
  û_t = task success score ∈ [0, 1]
```

**The UCB exploration bonus ensures:**
- Frequently-used lessons must maintain high utility to keep being selected
- Rarely-used lessons get an exploration bonus, ensuring they're periodically re-evaluated
- Over time, the buffer self-organizes: high-utility lessons rise to the top, low-utility ones decay

**Results (runtime memory component ablation):**
Removing the memory buffer from RetroAgent degrades ALFWorld by -12.4% and WebShop by -8.7%, confirming that runtime memory is a major contributor to performance.

### 8.8 AgentFactory: Executable Subagent Accumulation

**Paper:** Zhang et al., "AgentFactory: A Self-Evolving Framework Through Executable Subagent Accumulation and Reuse," arXiv:2603.18000, March 2026

Takes Voyager's insight (store solutions as code) and applies it to real-world agent tasks. Instead of textual experiences, AgentFactory saves successful solutions as Python modules that can be imported and reused.

**Three-phase lifecycle:**
```
┌─────────────────────────────────────────────────────────┐
│  Phase 1: INSTALL                                       │
│  - Meta-agent decomposes task into subtasks              │
│  - For each subtask, creates a Python subagent module    │
│  - Subagent has: solve(task) → result, self-test()      │
│  - If solve() succeeds and self-test() passes → SAVE    │
│                                                          │
│  Phase 2: SELF-EVOLVE                                   │
│  - New task arrives; meta-agent searches saved subagents │
│  - If similar subagent exists: retrieve, attempt reuse   │
│  - If execution fails: detect limitation, modify code    │
│  - If modification succeeds: update saved version        │
│                                                          │
│  Phase 3: DEPLOY                                        │
│  - Mature subagents exported as standalone Python modules │
│  - Can be imported by any Python-capable agent system    │
│  - Include documentation, type hints, test cases         │
└─────────────────────────────────────────────────────────┘
```

**Cost reduction results:**
```
Task Type              | ReAct (tokens) | AgentFactory (tokens) | Reduction
─────────────────────────────────────────────────────────────────────────
Initial tasks (Opus)   |     8,298      |        4,324          |   48%
Transfer tasks (Opus)  |     7,022      |        2,971          |   57%
Initial tasks (Sonnet) |     6,847      |        3,512          |   49%
Transfer tasks (Sonnet)|     5,931      |        2,188          |   63%
```

The 57-63% reduction on transfer tasks comes from REUSING saved subagents — the agent doesn't re-derive solutions it already has.

### 8.9 Knowledge Crystallization: Persistent Filesystem Evolution

**Reference:** Tanaike, "Recursive Knowledge Crystallization: A Framework for Persistent Autonomous Agent Self-Evolution," February 2026

This is the pattern that production agents like Koda (Section 6.4) and the OpenClaw self-improving-agent skill (Section 7.8) implement in practice.

**Core mechanism:**
```
Agent encounters task → succeeds or fails
                           │
                    ┌──────┴──────┐
                    │  CAPTURE    │
                    │  Write to   │
                    │ .learnings/ │
                    └──────┬──────┘
                           │
                    ┌──────┴──────┐
                    │  EVALUATE   │
                    │ Accumulated │
                    │ 3+ related  │
                    │  issues?    │
                    └──────┬──────┘
                     yes   │   no → wait for more
                    ┌──────┴──────┐
                    │  PROMOTE    │
                    │ Workflow →  │
                    │ AGENTS.md   │
                    │ Tools →     │
                    │ TOOLS.md    │
                    │ Behavior →  │
                    │ SOUL.md     │
                    │ Universal → │
                    │ CLAUDE.md   │
                    └──────┬──────┘
                           │
                    ┌──────┴──────┐
                    │  PERSIST    │
                    │ Promoted    │
                    │ learnings   │
                    │ loaded in   │
                    │ EVERY future│
                    │ session     │
                    └─────────────┘
```

**Zero-shot transfer proof:** Tanaike demonstrated that a SKILL.md file evolved through iterative cycles in one environment (Google Antigravity) could be transferred to a completely clean environment (Gemini CLI) where the agent successfully implemented a complex application without any additional learning. The crystallized knowledge was sufficient.

**Production implementation (OpenClaw self-improving-agent skill):**
- 90,000+ downloads, 1,100+ stars on ClawHub within 2 months
- Runs a perceive-search-experiment-solidify loop (Section 7.8)
- Heartbeat-driven: cron job scans .learnings/ for promotion candidates
- Promotion threshold: 3+ related issues before a learning gets promoted

### 8.10 Comparing Runtime Evolution Mechanisms

| Mechanism | Cross-Task? | Single Attempt? | Executable? | Q-Learning? | Transfer? | Maturity |
|-----------|-------------|-----------------|-------------|-------------|-----------|----------|
| Reflexion | No (same task) | Yes | No | No | No | Proven (2023) |
| ExpeL | Yes | No (needs pairs) | No | No | Partial | Proven (2024) |
| ERL | Yes | Yes | No | No | Partial | New (2026) |
| Voyager | Yes | Yes | Yes (JS) | No | Yes (new worlds) | Proven (2023) |
| MemRL | Yes | Yes | No | Yes (MC) | Yes | New (2026) |
| RetroAgent | Yes | Yes | No | Yes (UCB) | Yes (OOD) | New (2026) |
| AgentFactory | Yes | Yes | Yes (Python) | No | Yes (export) | New (2026) |
| Knowledge Crystallization | Yes | Yes | Partial (MD) | No | Yes (zero-shot) | Production (2026) |
| Hermes Skills | Yes | Yes | Partial (MD) | No | Yes (agentskills.io) | Production (2026) |

**Practitioner decision guide:**

```
Do you need cross-task learning?
├── No → Reflexion (simplest, most proven)
├── Yes
│   ├── Can you get multiple attempts at similar tasks?
│   │   ├── Yes → ExpeL (strongest heuristic quality)
│   │   └── No → ERL (single-attempt learning)
│   ├── Should solutions be executable code?
│   │   ├── Yes, for a specific domain → Voyager pattern
│   │   ├── Yes, for general tasks → AgentFactory
│   │   └── No → continue
│   ├── Do you need learned utility scores?
│   │   ├── Yes → MemRL (mathematically rigorous)
│   │   └── No → continue
│   └── Do you need persistent filesystem evolution?
│       ├── Yes → Knowledge Crystallization / OpenClaw self-improving-agent
│       └── No → Hermes Skills (agent-created, portable via agentskills.io)
```

### 8.11 Open Problems in Runtime Self-Evolution

1. **Forgetting useful learnings**: As memory grows, older but still-valuable entries get diluted. MemRL's Q-values help but don't fully solve this. No current system has a principled forgetting mechanism.

2. **Learning from partial success**: Most mechanisms treat tasks as binary (success/fail). RetroAgent's subtask progress tracking is the best current approach, but still coarse.

3. **Adversarial self-evolution**: A self-evolving agent that encounters adversarial inputs could crystallize harmful patterns. The OpenClaw security concerns (Section 7.8) are real. No current system has robust defense against adversarial experience poisoning.

4. **Measuring evolution quality**: How do you know your agent is getting BETTER and not just different? No current framework has a principled metric for evolution quality that accounts for distribution shift.

5. **Composing multiple evolution mechanisms**: Can you combine MemRL's utility learning with Hermes's skill creation with Knowledge Crystallization's filesystem persistence? No current system integrates all three. The interaction effects are unexplored.

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
