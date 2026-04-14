# Part II: Architecture Patterns for Production Agents

---

## Chapter 4: Tool Design — The Agent's Hands

> *"An agent is only as capable as the tools it can wield."*
> — Anthropic, Building Effective Agents (2024)

The relationship between an AI agent and its tools is not merely functional — it is constitutive. An agent without tools is a language model. An agent with poorly designed tools is a liability. An agent with well-designed, composable, discoverable tools is a system that can reason its way through the real world. This chapter examines the principles, protocols, and patterns that define the state of the art in agent tool design.

### 4.1 Tool Design Philosophy: "Giving Claude a Computer"

Anthropic's guiding metaphor for tool design is deceptively simple: *give the model a computer*. The idea is not to give the model a rigid API with predetermined functions, but to provide a flexible environment where it can observe, reason, and act — much the way a human developer uses a workstation.

This philosophy was articulated in detail by Thariq Shihipar, engineering lead for Claude Code, through the concept of **"seeing like an agent"** — understanding how a model perceives, selects, and sequences the tools available to it. The insight is that tool design is not a one-shot specification problem. It is an empirical, iterative discipline where the engineer must:

1. **Read the model's outputs** — watch where it struggles, what it misuses, what it avoids.
2. **Evolve the action space** — add, remove, rename, and restructure tools based on observed behavior.
3. **Shape affordances to model strengths** — tools should match how the model decomposes problems, not how a human would organize an API.

This process produced several hard-won principles at Anthropic:

**The 20-Tool Ceiling.** Claude Code operates with roughly 20 tools. Each new tool represents another decision point the model must evaluate on every turn. Anthropic maintains a high bar for additions because expanding the tool set increases decision entropy — the model spends more tokens reasoning about *which* tool to use before it can reason about *how* to use it.

```
┌──────────────────────────────────────────────────────┐
│              Claude Code Core Tools (~20)             │
├──────────────────────────────────────────────────────┤
│  Read      │  Write     │  Edit      │  Bash        │
│  Grep      │  Glob      │  Agent     │  TodoWrite   │
│  WebSearch │  WebFetch  │  AskUser   │  ...          │
└──────────────────────────────────────────────────────┘
        ▲                                    ▲
        │  Each tool = one more decision     │
        │  point per model turn              │
        └────────────────────────────────────┘
```

**Tool Obsolescence Is Real.** The shift from `Todos` to `Tasks` in Claude Code illustrates that tools must be generalized, not just added. As model capabilities evolve, a tool that was helpful yesterday can constrain behavior tomorrow. Dead tools are worse than no tools — they consume context and confuse selection.

**Context Construction Over Context Injection.** Moving from RAG-style context injection (push documents into the prompt) to agent-driven search (let the model `grep`, `glob`, and read its way to relevant files) fundamentally changed Claude Code's behavior. When models actively construct their own context, they exhibit better locality of reasoning and fewer hallucinated dependencies.

**The AskUserQuestion Saga.** Building Claude's question-asking capability took three attempts. First, the team added a `question` parameter to an existing tool — the model ignored it. Second, they tried a message-based approach — the model confused questions with statements. The winning solution was a dedicated `AskUserQuestion` tool with a modal interface that halts the agent loop until the user responds. The lesson: *even the best model cannot overcome a poorly shaped affordance*.

### 4.2 The Model Context Protocol (MCP): The USB-C of AI Tools

Before MCP, every AI application that wanted to connect to external tools faced the **N×M integration problem**: N applications each needed custom connectors for M data sources. This was the same problem the software industry solved with the Language Server Protocol (LSP) for IDE-language integration — and MCP solves it for AI-tool integration.

**MCP** (Model Context Protocol) is an open standard introduced by Anthropic in November 2024, donated to the Linux Foundation's Agentic AI Foundation in December 2025 (co-founded by Anthropic, Block, and OpenAI). It is a stateful, transport-agnostic, client-server protocol built on JSON-RPC 2.0 that standardizes how AI applications connect to external tools, data sources, and services.

```
                    The N×M Problem → The N+M Solution

   Before MCP:                         After MCP:
   ┌────────┐                          ┌────────┐
   │ App  1 │──┐  ┌──│ Tool A │        │ App  1 │──┐
   │ App  2 │──┼──┼──│ Tool B │        │ App  2 │──┤  MCP    ┌──│ Tool A │
   │ App  3 │──┘  └──│ Tool C │        │ App  3 │──┤ Protocol├──│ Tool B │
   │  ...   │        │  ...   │        │  ...   │──┘         └──│ Tool C │
   └────────┘        └────────┘        └────────┘              └────────┘

   N × M custom connectors             N + M implementations
```

#### MCP Architecture: The Three-Layer Model

MCP defines three roles:

```
┌─────────────────────────────────────────────────────────┐
│                        HOST                              │
│  (Claude Desktop, Cursor, VS Code, custom agent)         │
│                                                          │
│   ┌─────────────┐    ┌─────────────┐                     │
│   │  MCP Client │    │  MCP Client │    ...              │
│   │  (Server A) │    │  (Server B) │                     │
│   └──────┬──────┘    └──────┬──────┘                     │
└──────────┼──────────────────┼────────────────────────────┘
           │ JSON-RPC 2.0    │ JSON-RPC 2.0
     ┌─────▼─────┐     ┌─────▼─────┐
     │ MCP Server│     │ MCP Server│
     │ (Postgres)│     │  (GitHub) │
     └───────────┘     └───────────┘
```

- **Host**: The AI application (Claude Desktop, Cursor, a custom Python agent). The host manages the LLM, user interactions, and lifecycle of MCP clients.
- **Client**: A connector within the host. Each client maintains a 1:1 stateful session with exactly one MCP server. Clients handle capability negotiation and protocol lifecycle.
- **Server**: A service that exposes capabilities to the AI. Servers can be local processes (communicating via `stdio`) or remote services (communicating via Streamable HTTP with OAuth 2.1 authentication).

#### The Five MCP Primitives

MCP defines five primitives that servers can expose:

| Primitive    | Direction        | Description                                       |
|-------------|------------------|---------------------------------------------------|
| **Tools**    | Server → Model   | Functions the model can invoke (e.g., `createPR`)  |
| **Resources**| Server → Client  | Data the model can read (e.g., file contents)      |
| **Prompts**  | Server → User    | Templated workflows (e.g., "summarize this repo")  |
| **Sampling** | Server → Client  | Server-initiated LLM calls for recursive reasoning |
| **Elicitation** | Server → User | Server-initiated requests for user input           |

#### MCP in Practice: A Minimal Server

A minimal MCP server in TypeScript exposes a single tool:

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "weather-server",
  version: "1.0.0"
});

server.tool(
  "get_weather",
  "Get current weather for a city",
  { city: z.string().describe("City name") },
  async ({ city }) => {
    const data = await fetch(
      `https://api.weather.example/v1?city=${encodeURIComponent(city)}`
    );
    const json = await data.json();
    return {
      content: [{
        type: "text",
        text: `${city}: ${json.temp}°F, ${json.condition}`
      }]
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
```

This server communicates over `stdio` — the host launches it as a subprocess, sends JSON-RPC messages on stdin, and reads responses from stdout. For remote deployment, the same server can be served over Streamable HTTP with OAuth 2.1 for authentication.

#### The Protocol Lifecycle

```
Client                              Server
  │                                    │
  │──── initialize ───────────────────>│
  │<─── initialize (capabilities) ─────│
  │──── initialized ──────────────────>│
  │                                    │
  │──── tools/list ───────────────────>│
  │<─── [tool definitions] ───────────│
  │                                    │
  │──── tools/call {get_weather} ─────>│
  │<─── {result: "NYC: 72°F, Sunny"} ─│
  │                                    │
```

The `initialize` handshake negotiates capabilities — a server that does not support `sampling` simply omits it from its capability declaration. This makes MCP extensible without breaking backward compatibility.

#### MCP Adoption (as of Early 2026)

MCP is natively supported in Claude Code, Cursor, VS Code (GitHub Copilot), Windsurf, and OpenAI's tooling. The ecosystem includes thousands of community-built servers for databases, APIs, cloud services, and developer tools. The protocol is governed by the Agentic AI Foundation under the Linux Foundation — the same governance model as Kubernetes and Linux.

### 4.3 Progressive Disclosure: Start Minimal, Discover on Demand

A five-server MCP setup can easily consume over 100,000 tokens just in tool definitions:

| MCP Server | Tools | Token Cost |
|-----------|-------|------------|
| GitHub    | 35    | ~26,000    |
| Slack     | 11    | ~21,000    |
| Sentry    | 5     | ~3,000     |
| Grafana   | 5     | ~3,000     |
| Jira      | 12    | ~17,000    |
| **Total** | **68**| **~70,000+** |

Before the agent reads a single user message, its context window is already 35-50% consumed. Anthropic reported internal cases where tool definitions consumed 134,000 tokens before optimization.

**Progressive disclosure** solves this by loading tool definitions on demand rather than upfront:

```
Traditional Loading:                Progressive Disclosure:
┌─────────────────────┐            ┌─────────────────────┐
│ System Prompt        │            │ System Prompt        │
│ ─────────────────── │            │ ─────────────────── │
│ Tool: github.star    │            │ Tool Search Tool     │
│ Tool: github.fork    │            │   (~500 tokens)      │
│ Tool: github.pr      │            │                      │
│ Tool: github.issue   │            │                      │
│ Tool: slack.post     │            │                      │
│ Tool: slack.read     │            │  [User message]      │
│ ... (68 tools)       │            │                      │
│ ~70,000 tokens       │            │  Agent: "I need to   │
│                      │            │  create a PR..."     │
│ [User message]       │            │  → searches "github" │
│                      │            │  → loads github.pr   │
│                      │            │    (~2,000 tokens)   │
└─────────────────────┘            └─────────────────────┘
```

Research from Anthropic and Cursor shows this approach yields **47-85% token savings** while maintaining full access to the complete tool library.

### 4.4 Tool Search Tool and Programmatic Tool Calling

Anthropic introduced two advanced tool use features (November 2025) that change the economics of tool-intensive agents:

#### Tool Search Tool

The Tool Search Tool allows Claude to dynamically discover tools from catalogs of up to 10,000. Instead of loading all definitions upfront, tools are marked with `defer_loading: true` and discovered on demand.

Two search variants are available:
- **Regex** (`tool_search_tool_regex_20251119`): Claude constructs Python regex patterns to search tool names and descriptions.
- **BM25** (`tool_search_tool_bm25_20251119`): Claude uses natural language queries for keyword-based search.

```json
{
  "tools": [
    {
      "type": "tool_search_tool_regex_20251119",
      "name": "tool_search"
    },
    {
      "type": "function",
      "function": {
        "name": "github_create_pr",
        "description": "Create a pull request on GitHub"
      },
      "defer_loading": true
    },
    {
      "type": "function",
      "function": {
        "name": "slack_post_message",
        "description": "Post a message to a Slack channel"
      },
      "defer_loading": true
    }
  ]
}
```

When Claude needs to interact with GitHub, it searches for "github" and receives 3-5 relevant `tool_reference` blocks. Only those tools are loaded into context. The Tool Search Tool itself consumes approximately 500 tokens — an **85% reduction** compared to loading all tool definitions.

#### Programmatic Tool Calling

Traditional tool calling requires a round trip through the model for every tool invocation:

```
Model → tool_use(search_logs) → API → result (50,000 tokens) → Model
Model → tool_use(filter_errors) → API → result (5,000 tokens) → Model
Model → tool_use(count_by_type) → API → result (200 tokens) → Model
```

Each intermediate result pollutes the context window. Programmatic Tool Calling lets Claude write code that calls tools within a sandboxed execution environment:

```python
# Claude writes this code in a code_execution block
results = tool.search_logs(query="error", timeframe="24h")
errors = [r for r in results if r["level"] == "ERROR"]
by_type = Counter(e["type"] for e in errors)
result = {"total": len(errors), "by_type": dict(by_type.most_common(10))}
```

Only the final `result` variable enters the model's context — intermediate data is processed in the sandbox and discarded. On agentic search benchmarks like BrowseComp and DeepSearchQA, adding programmatic tool calling was the key factor that fully unlocked agent performance.

Tools opt in via the `allowed_callers` field:

```json
{
  "name": "search_logs",
  "allowed_callers": ["code_execution_20260120"]
}
```

### 4.5 CodeAct: Replacing Tool Calls with Executable Code

While Anthropic's approach refines the tool calling paradigm, a more radical alternative has emerged: **CodeAct** — using executable code as the agent's action mechanism rather than structured tool calls.

The CodeAct paradigm, introduced in a 2024 ICML paper and adopted by both **OpenHands** (formerly OpenDevin) and **Manus AI**, rests on a single observation: *the most common failure mode in autonomous agents is the model describing what it would do instead of doing it*. When the action space is natural language or rigid JSON function calls, the model produces articulate plans it never executes. When the action space is executable code, there is no gap between intention and action.

```
┌────────────────────────────────────────────────────────────┐
│                    Traditional Tool Calls                    │
├────────────────────────────────────────────────────────────┤
│  Model: "I should search for weather data"                  │
│  → tool_use: {"name": "search", "query": "weather NYC"}    │
│  ← result: {"temp": 72, "condition": "sunny"}              │
│  Model: "Now I should format this..."                       │
│  → tool_use: {"name": "format", "template": "..."}         │
│  ← result: "NYC: 72°F, Sunny"                              │
│  (2 round trips, 2 model inferences)                        │
├────────────────────────────────────────────────────────────┤
│                    CodeAct Pattern                           │
├────────────────────────────────────────────────────────────┤
│  Model writes and executes:                                 │
│  ```python                                                  │
│  data = search("weather NYC")                               │
│  result = f"{data['city']}: {data['temp']}°F, "             │
│           f"{data['condition']}"                             │
│  print(result)                                              │
│  ```                                                        │
│  (1 model inference, 1 execution)                           │
└────────────────────────────────────────────────────────────┘
```

#### OpenHands CodeAct Agent

OpenHands' CodeAct Agent (the primary agent since v2.1, November 2024) implements this through a function calling interface that provides a small set of expressive tools:

| Tool                   | Description                                       |
|-----------------------|---------------------------------------------------|
| `execute_bash`         | Execute any Linux bash command                    |
| `execute_ipython_cell` | Run Python code in an IPython environment         |
| `browser`              | Interact with web pages via Playwright            |
| `web_read`             | Read and convert webpage content to markdown      |
| `str_replace_editor`   | Precise string replacement in files               |
| `edit_file`            | LLM-based file editing                            |

Each tool maps to a specific action type. The model can combine multiple operations in a single code block, handle conditional logic, iterate over results, and debug itself when execution fails.

#### Manus and the CodeAct Architecture

Manus AI took the CodeAct pattern further by making executable Python the *sole* action mechanism. Rather than having discrete tool calls for "Search", "Browse", and "Execute", Manus provides a Python library of helper functions and lets the model import and use them in generated code:

```python
# Manus generates this as its "action"
import manus_tools as mt

results = mt.web_search("best restaurants in NYC")
for r in results[:5]:
    page = mt.browse(r["url"])
    review = mt.extract(page, schema={"name": str, "rating": float})
    mt.save_to_memory("restaurants", review)

summary = mt.generate_report("restaurants")
mt.deliver(summary)
```

The sandbox executes this code, and the model observes the output. If something fails, the model adjusts the code and tries again — essentially debugging itself. The CodeAct paper (ICML 2024) found that agents using code for actions had significantly higher success rates on complex tool-using tasks compared to those limited to text or JSON tool calls.

**The tradeoff**: CodeAct increases the model's action space (anything expressible in Python) but also increases the risk surface. Sandboxing, resource limits, and careful library design are essential.

### 4.6 Principles for Effective Tools

Drawing from Anthropic's published guidelines, Cursor's engineering practices, and the CodeAct research, we can distill a set of principles for designing effective agent tools:

#### 1. Clear Purpose and Documentation

Tools should be described with the same care as a public API. The model reads the tool description as its only guide for usage:

```json
{
  "name": "str_replace_editor",
  "description": "Replace exact string occurrences in a file. The old_string must uniquely identify the target location — include 3-5 lines of surrounding context if needed. Fails if old_string matches zero or multiple locations.",
  "parameters": {
    "path": {
      "type": "string",
      "description": "Absolute path to the file to modify"
    },
    "old_string": {
      "type": "string",
      "description": "The exact text to find and replace (must be unique in the file)"
    },
    "new_string": {
      "type": "string",
      "description": "The replacement text (must differ from old_string)"
    }
  }
}
```

Notice how the description includes *constraints* ("must uniquely identify"), *guidance* ("include 3-5 lines of surrounding context"), and *failure modes* ("fails if old_string matches zero or multiple locations"). This is prompt engineering applied to tool definitions.

#### 2. Composability Over Comprehensiveness

Prefer a small number of composable primitives over a large number of specialized tools:

```
❌ Bad: 47 specialized tools
   create_python_file, create_js_file, create_ts_file,
   edit_python_function, edit_js_function, edit_class_method,
   search_python_imports, search_js_imports, ...

✅ Good: 8 composable tools
   Read, Write, Edit, Bash, Grep, Glob, Agent, TodoWrite
```

Claude Code's eight core tools can handle virtually any software development task through composition. `Bash` alone is a universal adapter — anything expressible as a shell command is reachable.

#### 3. Token Efficiency

Every byte in a tool's input and output consumes context budget. Design tools to minimize token waste:

- **Structured outputs** over free-form text (JSON with specified fields)
- **Pagination** for large result sets (return 20 items, not 2,000)
- **Filters** at the tool level (search with constraints, don't return everything)
- **Summaries** over raw data (let the tool pre-process when possible)

#### 4. Safety Annotations

Production tools should carry metadata about their risk level:

```python
RISK_LEVELS = {
    "read_file":     "LOW",     # Read-only, no side effects
    "write_file":    "MEDIUM",  # Modifies state, reversible
    "execute_bash":  "HIGH",    # Arbitrary code execution
    "deploy":        "CRITICAL" # Production-affecting, irreversible
}
```

These annotations enable permission systems where the agent can use low-risk tools autonomously but must request approval for high-risk operations.

#### 5. Idempotency and Error Handling

Tools should be safe to retry. An agent that encounters a transient error should be able to call the tool again without creating duplicate side effects:

```python
# Idempotent: calling twice with same input = same result
def create_or_update_file(path: str, content: str) -> dict:
    """Write content to path. Safe to call multiple times."""
    with open(path, 'w') as f:
        f.write(content)
    return {"status": "ok", "path": path}

# NOT idempotent: calling twice = duplicate records
def insert_record(data: dict) -> dict:
    """Insert a new database record. NOT safe to retry."""
    return db.insert(data)
```

Tools that cannot be made idempotent should document this clearly and support idempotency keys where possible.

#### 6. Observability

Every tool call should produce enough information for the model (and human operators) to understand what happened:

```json
{
  "status": "error",
  "error_type": "FileNotFoundError",
  "message": "/src/app.tsx does not exist",
  "suggestion": "Check if the file path is correct. Use Glob to find matching files.",
  "available_files": ["src/App.tsx", "src/app.ts"]
}
```

Error messages should be *diagnostic* — they should help the model self-correct rather than simply report failure.

### 4.7 The Tool Design Feedback Loop

Tool design for agents is not a specification exercise. It is a continuous empirical process:

```
┌──────────────────────────────────────────────────────────┐
│                 Tool Design Feedback Loop                  │
│                                                           │
│    ┌──────────┐     ┌──────────┐     ┌──────────┐        │
│    │  Design  │────>│  Deploy  │────>│ Observe  │        │
│    │  Tools   │     │  Tools   │     │  Agent   │        │
│    └────▲─────┘     └──────────┘     └────┬─────┘        │
│         │                                  │              │
│         │           ┌──────────┐           │              │
│         └───────────│  Refine  │<──────────┘              │
│                     │  Tools   │                          │
│                     └──────────┘                          │
│                                                           │
│  Questions to ask at each iteration:                      │
│  • Where does the agent hesitate or choose wrong tools?   │
│  • Which tools are never used? (Remove them)              │
│  • Which multi-tool sequences are common? (Compose them)  │
│  • Where does the agent waste tokens? (Optimize I/O)      │
│  • What does the agent try to do but can't? (Add tools)   │
└──────────────────────────────────────────────────────────┘
```

Anthropic's Thariq Shihipar summarizes: *"Designing an agent's tools is more like raising a child than writing a spec. You have to watch what they do, understand why, and adjust the environment accordingly."*

---

## Chapter 5: Multi-Agent Orchestration

> *"The future is not a single, all-knowing agent. It is a society of specialized agents that coordinate, delegate, and verify each other's work."*

Single-agent systems hit fundamental ceilings: context window limits, tool-selection complexity, lack of self-verification, and cognitive overload on long-horizon tasks. Multi-agent orchestration is the architectural response — decomposing work across specialized agents that each operate within their competence, coordinate through well-defined protocols, and produce verified outputs through adversarial evaluation.

This chapter surveys the dominant multi-agent patterns that have emerged in production systems, from Anthropic's foundational workflow patterns through OpenAI Codex's manager-worker hierarchy, Claude Code's subagent model, Cursor's parallel worktree agents, and Google's Agent-to-Agent protocol.

### 5.1 Anthropic's Agent Coordination Patterns

Anthropic's "Building Effective Agents" guide (December 2024) and subsequent engineering publications define a taxonomy of coordination patterns, ordered by increasing complexity. The guiding principle: *start with the simplest pattern that solves your problem, and add complexity only when it demonstrably improves outcomes*.

#### Pattern 1: Prompt Chaining (Sequential Pipeline)

The simplest multi-step pattern: decompose a task into a sequence of steps, each handled by a separate LLM call with a focused prompt.

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│ Extract  │────>│ Validate │────>│Transform │────>│ Generate │
│ entities │     │ entities │     │  data    │     │  report  │
└──────────┘     └──────────┘     └──────────┘     └──────────┘
    Step 1           Step 2          Step 3           Step 4
```

Each step receives the output of the previous step plus a specialized prompt. Gate checks between steps can validate outputs before proceeding.

**When to use**: Tasks that are naturally sequential with clear handoff points. Automating evaluation pipelines. Document processing workflows.

#### Pattern 2: Parallelization (Fan-Out / Fan-In)

When subtasks are independent, run them simultaneously:

```
                    ┌──────────────┐
              ┌────>│ Security     │────┐
              │     │ Review       │    │
┌──────────┐  │     └──────────────┘    │     ┌──────────────┐
│ Code     │──┼────>┌──────────────┐    ├────>│  Aggregate   │
│ Submitted│  │     │ Style        │    │     │  Results     │
└──────────┘  │     │ Review       │────┘     └──────────────┘
              │     └──────────────┘    │
              └────>┌──────────────┐    │
                    │ Test         │────┘
                    │ Coverage     │
                    └──────────────┘
```

Two sub-patterns:
- **Sectioning**: Split a task by data (e.g., review different files in parallel)
- **Voting**: Run the same task multiple times and aggregate (e.g., 3 security reviewers vote)

#### Pattern 3: Orchestrator-Worker

A central LLM dynamically breaks down tasks, delegates to worker LLMs, and synthesizes results. Unlike parallelization, subtasks are not predetermined — the orchestrator decides at runtime based on the specific input.

```python
from anthropic import Anthropic

client = Anthropic()
MODEL = "claude-sonnet-4-6"

class FlexibleOrchestrator:
    """Orchestrator-Worker pattern: decompose tasks dynamically."""

    def __init__(self, orchestrator_prompt: str, worker_prompt: str):
        self.orchestrator_prompt = orchestrator_prompt
        self.worker_prompt = worker_prompt

    def process(self, task: str, context: dict = None) -> dict:
        # Phase 1: Orchestrator analyzes and decomposes
        analysis = client.messages.create(
            model=MODEL,
            max_tokens=4096,
            system=self.orchestrator_prompt.format(
                task=task, context=context or {}
            ),
            messages=[{"role": "user", "content": task}]
        ).content[0].text

        subtasks = self._parse_tasks(analysis)

        # Phase 2: Workers execute subtasks
        worker_results = []
        for subtask in subtasks:
            result = client.messages.create(
                model=MODEL,
                max_tokens=4096,
                system=self.worker_prompt,
                messages=[{
                    "role": "user",
                    "content": subtask["description"]
                }]
            ).content[0].text
            worker_results.append({
                "task": subtask["name"],
                "result": result
            })

        return {"analysis": analysis, "worker_results": worker_results}
```

**When to use**: Coding products that make complex changes to multiple files. Search tasks that gather information from multiple sources. Any task where subtasks cannot be predicted in advance.

#### Pattern 4: Evaluator-Optimizer (Generator-Verifier)

Inspired by Generative Adversarial Networks, this pattern separates *generation* from *evaluation*:

```
┌──────────────────────────────────────────────────────────┐
│              Generator-Verifier Loop                      │
│                                                           │
│  ┌───────────┐  output   ┌───────────┐  feedback         │
│  │           │──────────>│           │──────────┐        │
│  │ Generator │           │ Evaluator │          │        │
│  │           │<──────────│           │          │        │
│  └───────────┘  critique └───────────┘          │        │
│       ▲                                          │        │
│       │              Iterate 5-15x               │        │
│       └──────────────────────────────────────────┘        │
│                                                           │
│  Key insight: The same model that wrote the code          │
│  will praise the code. Separate evaluation from           │
│  generation for honest assessment.                        │
└──────────────────────────────────────────────────────────┘
```

Anthropic's Prithvi Rajasekaran demonstrated this powerfully in frontend design: a generator creates HTML/CSS/JS, an evaluator navigates the live page using Playwright MCP, interacts with the interface, scores it against calibrated criteria, and feeds critiques back to the generator. Five to fifteen iterations produce dramatically better results than single-pass generation.

**Critical finding**: Calibrating the evaluator requires few-shot examples with detailed scoring. Without calibration, evaluators default to either excessive praise or excessive criticism. The "taste" of the evaluator — how heavily it pushes for aesthetic risk-taking, for example — meaningfully affects the quality ceiling.

#### Pattern 5: Shared State with Message Passing

For complex multi-agent systems, agents share state through a common data store and communicate through structured messages:

```
┌─────────────────────────────────────────────────────┐
│                   Shared State Store                  │
│  ┌─────────────┬──────────────┬──────────────────┐  │
│  │ Task Queue  │ Agent Status │ Execution Log    │  │
│  │ ─────────── │ ──────────── │ ──────────────── │  │
│  │ task_001: ✓ │ agent_A: idle│ [14:01] A: done  │  │
│  │ task_002: ▶ │ agent_B: busy│ [14:02] B: start │  │
│  │ task_003: ○ │ agent_C: idle│ [14:02] C: error │  │
│  └─────────────┴──────────────┴──────────────────┘  │
└──────┬──────────────┬───────────────┬────────────────┘
       │              │               │
  ┌────▼────┐   ┌─────▼────┐   ┌─────▼────┐
  │ Agent A │   │ Agent B  │   │ Agent C  │
  │ (Code)  │   │ (Test)   │   │ (Review) │
  └─────────┘   └──────────┘   └──────────┘
```

This pattern enables agent teams that can coordinate asynchronously, claim tasks from a queue, and handle failures through retry and compensation mechanisms.

### 5.2 OpenAI Codex Subagents: Manager-Worker Architecture

OpenAI Codex (GA March 2026) implements a hierarchical multi-agent system where a **manager agent** decomposes tasks and orchestrates **subagents** that execute in parallel.

#### Three Built-in Agent Roles

| Role      | Access     | Purpose                                          |
|-----------|-----------|--------------------------------------------------|
| `default` | Read/Write | General-purpose single-task operations            |
| `worker`  | Read/Write | Focused implementation and fixes                 |
| `explorer`| Read-only  | Codebase scanning, call graph tracing, context maps |

The explorer-first pattern is central: before making changes, an explorer agent maps the relevant codebase, identifies dependencies, and builds a context map that worker agents use to scope their edits.

#### Configuration and Concurrency

```toml
# .codex/config.toml
[agents]
max_threads = 6      # Up to 6 concurrent agent threads
max_depth = 1        # Direct children only, no recursive nesting
job_max_runtime_seconds = 1800  # 30-minute timeout per worker

[agents.pr_explorer]
description = "Read-only codebase explorer for gathering evidence."
config_file = "agents/pr_explorer.toml"

[agents.reviewer]
description = "Reviews code for correctness, security, and test risks."
config_file = "agents/reviewer.toml"
```

The `max_depth = 1` constraint is intentional: deeper nesting turns broad delegation into repeated fan-out, increasing token usage, latency, and resource consumption unpredictably.

#### Inter-Agent Communication

Codex provides specialized tools for agent coordination:

| Tool            | Description                                    |
|----------------|------------------------------------------------|
| `spawn_agent`   | Create a new subagent with a message           |
| `send_input`    | Send a message to an existing subagent         |
| `get_agent_status` | Check subagent progress                     |

The manager maintains awareness of overall state while each subagent maintains only its focused context. When subagents complete, their results flow back to the manager for synthesis.

#### CSV Batch Processing

For highly parallel workloads, Codex supports `spawn_agents_on_csv` — one worker subagent per CSV row, running concurrently up to `max_threads`, with combined results exported to CSV:

```
Input CSV:                    Output CSV:
┌────────┬─────────┐         ┌────────┬─────────┬────────┬──────────┐
│ file   │ task    │         │ file   │ task    │ status │ result   │
├────────┼─────────┤   ───>  ├────────┼─────────┼────────┼──────────┤
│ auth.ts│ review  │         │ auth.ts│ review  │ done   │ {...}    │
│ db.ts  │ review  │         │ db.ts  │ review  │ done   │ {...}    │
│ api.ts │ review  │         │ api.ts │ review  │ error  │ timeout  │
└────────┴─────────┘         └────────┴─────────┴────────┴──────────┘
```

### 5.3 Claude Code Subagents: Depth-1 Delegation with Clean Context

Claude Code's subagent model prioritizes **context isolation**. The core insight: when a subagent processes a task, all verbose intermediate work (file reads, test output, search results, log parsing) stays inside the subagent's context. Only the summary returns to the parent.

#### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        MAIN AGENT                            │
│  Context: Full conversation + all prior tool results         │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  Agent("Explore authentication patterns in src/auth/")  │ │
│  └────────────────────────┬────────────────────────────────┘ │
│                           │                                  │
│              ┌────────────▼─────────────┐                    │
│              │      SUBAGENT            │                    │
│              │  Own 200K token context  │                    │
│              │  ──────────────────────  │                    │
│              │  Read src/auth/login.ts  │                    │
│              │  Read src/auth/oauth.ts  │                    │
│              │  Grep "session" **/*.ts  │                    │
│              │  Read src/middleware.ts   │                    │
│              │  ...verbose exploration  │                    │
│              │  ──────────────────────  │                    │
│              │  Returns: 200-word       │                    │
│              │  summary only            │                    │
│              └──────────────────────────┘                    │
│                                                              │
│  Main agent receives summary, continues with clean context   │
└──────────────────────────────────────────────────────────────┘
```

#### Depth-1 Constraint

Subagents cannot spawn further subagents. This constraint prevents:

1. **Recursive explosion** — unbounded agent nesting consuming infinite resources
2. **Context pollution** — each level accumulates its own context overhead
3. **Debugging nightmares** — tracking multi-level agent chains is intractable
4. **Unpredictable costs** — nested agents make token usage unforeseeable

#### Built-in Subagent Types

| Agent    | Model  | Tools      | Purpose                              |
|----------|--------|-----------|--------------------------------------|
| Explore  | Haiku  | Read-only  | File discovery, code search          |
| Plan     | Inherit| Read-only  | Architectural exploration            |
| General  | Inherit| All tools  | Terminal commands in separate context |
| Guide    | Haiku  | None       | Answers questions about Claude Code  |

#### Custom Subagents

Teams define custom subagents as Markdown files with YAML frontmatter:

```markdown
---
name: code-reviewer
description: Reviews code for security issues, performance problems, and style violations
model: sonnet
tools: ["Read", "Grep", "Glob"]
permissionMode: plan
---

You are a senior code reviewer. Analyze the provided code for:
1. Security vulnerabilities (injection, auth bypass, data exposure)
2. Performance issues (N+1 queries, unnecessary allocations)
3. Style violations against the project's conventions

Return a structured review with severity levels: CRITICAL, WARNING, INFO.
```

Place this file at `.claude/agents/code-reviewer.md` and invoke with `@"code-reviewer" review the auth changes`.

#### Parallel Execution

When tasks are independent, Claude launches multiple subagents in a single message:

```
User: "Review the auth module for security issues, run the test suite
       for the API layer, and check the database migration for breaking
       changes."

Claude spawns 3 subagents simultaneously:
  → Agent 1: Security review (code-reviewer agent, read-only)
  → Agent 2: Test runner (general agent, bash access)
  → Agent 3: Migration checker (explore agent, read-only)

Each runs in its own context, returns summary to main agent.
```

### 5.4 Cursor Parallel Agents: Git Worktree Isolation

Cursor (v2.0, October 2025) introduced a fundamentally different approach to multi-agent parallelism: **git worktree isolation**. Rather than sharing a context window or filesystem, each agent operates in its own fully isolated copy of the repository.

```
┌─────────────────────────────────────────────────────────┐
│                  Repository (main)                        │
│  /workspace/my-project/                                  │
│  └── main branch                                         │
│                                                           │
│  ┌─────────────────────┐  ┌─────────────────────┐       │
│  │ Worktree 1          │  │ Worktree 2          │       │
│  │ ../feat-auth/       │  │ ../feat-payments/   │       │
│  │ branch: feature/auth│  │ branch: feature/pay │       │
│  │ Agent 1: working... │  │ Agent 2: working... │       │
│  └─────────────────────┘  └─────────────────────┘       │
│                                                           │
│  ┌─────────────────────┐  ┌─────────────────────┐       │
│  │ Worktree 3          │  │ Worktree 4          │       │
│  │ ../fix-bug-2174/    │  │ ../add-tests/       │       │
│  │ branch: hotfix/2174 │  │ branch: tests/api   │       │
│  │ Agent 3: working... │  │ Agent 4: working... │       │
│  └─────────────────────┘  └─────────────────────┘       │
│                                                           │
│  Up to 8 agents × independent branches × clean merges    │
└─────────────────────────────────────────────────────────┘
```

#### Key Characteristics

- **Up to 8 concurrent agents**, each in its own worktree
- **Maximum 20 worktrees per workspace** (configurable via `cursor.worktreeMaxCount`)
- **Shared object database** — worktrees share git history, no duplicate data
- **Automatic cleanup** — configurable via `cursor.worktreeCleanupIntervalHours`
- **Full isolation** — file edits and indexes are completely separate

#### Usage

```bash
# Manual worktree creation
git worktree add ../feat-auth -b feature/authentication
git worktree add ../feat-payments -b feature/payments

# In Cursor UI: /worktree starts a task in an isolated checkout
# /best-of-n runs the same task across multiple models in separate worktrees
# /delete-worktree removes a worktree when done
```

The `/best-of-n` command is particularly powerful: it runs the same task across multiple models (e.g., Sonnet, Opus, GPT-4) in separate worktrees, then a parent agent compares results and lets you pick the best one — or merge parts from different implementations.

#### When Worktree Isolation Shines

Worktree-based parallelism works best when features are independent. If two agents need to modify the same file, merge conflicts are inevitable. The pattern maps naturally to ticket-driven workflows:

```
Ticket DATA-1234: "Add user analytics"
  → Worktree 1: DATA-1234-backend  (API endpoints)
  → Worktree 2: DATA-1234-frontend (Dashboard UI)
  → Worktree 3: DATA-1234-tests    (Integration tests)

Each agent works independently, commits to its branch,
opens a PR, and merges to main.
```

### 5.5 Google ADK and the Agent-to-Agent (A2A) Protocol

While MCP standardizes how agents connect to *tools*, Google's Agent-to-Agent (A2A) protocol (April 2025) standardizes how agents connect to *each other*. The two protocols are complementary:

```
┌──────────────────────────────────────────────────────────┐
│                Protocol Landscape                         │
│                                                           │
│  MCP: Agent ←→ Tools                                     │
│  "How do I use this database / API / service?"            │
│                                                           │
│  A2A: Agent ←→ Agent                                     │
│  "How do I delegate this task to a specialized agent?"    │
│                                                           │
│  ┌────────┐   A2A    ┌────────┐   MCP   ┌──────────┐    │
│  │Agent A │ ────────>│Agent B │ ───────>│ Database │    │
│  │(Client)│          │(Remote)│         │ (Server) │    │
│  └────────┘          └────────┘         └──────────┘    │
└──────────────────────────────────────────────────────────┘
```

#### Agent Cards: The Agent's Business Card

Every A2A-enabled agent publishes an **Agent Card** — a JSON document at a well-known URL that describes its identity, capabilities, and how to interact with it:

```json
{
  "name": "DataAnalyst",
  "description": "Analyzes datasets and provides business insights",
  "url": "https://agents.example.com/data-analyst/a2a",
  "version": "1.0.0",
  "capabilities": {
    "streaming": true,
    "pushNotifications": false
  },
  "defaultInputModes": ["text/plain"],
  "defaultOutputModes": ["text/plain"],
  "skills": [
    {
      "id": "analyze-sales",
      "name": "Sales Analysis",
      "description": "Analyze sales data and identify trends",
      "tags": ["analytics", "sales"]
    },
    {
      "id": "generate-report",
      "name": "Report Generation",
      "description": "Create formatted reports from data",
      "tags": ["reporting", "documents"]
    }
  ],
  "authentication": {
    "schemes": ["oauth2"]
  }
}
```

Agent Cards are discoverable at `https://{domain}/.well-known/agent-card.json`, following the same convention as `.well-known/openid-configuration` for OAuth.

#### A2A Communication: JSON-RPC Over HTTP

A2A uses JSON-RPC 2.0 over HTTP for inter-agent communication:

```json
// Client agent sends a task
{
  "jsonrpc": "2.0",
  "id": "task-001",
  "method": "message/send",
  "params": {
    "message": {
      "messageId": "msg-001",
      "role": "user",
      "parts": [
        {
          "kind": "text",
          "text": "Analyze Q4 sales data and identify top 3 trends"
        }
      ]
    }
  }
}

// Remote agent responds
{
  "jsonrpc": "2.0",
  "id": "task-001",
  "result": {
    "taskId": "task-abc123",
    "contextId": "session-xyz",
    "status": {
      "state": "completed"
    },
    "artifacts": [
      {
        "parts": [
          {
            "kind": "text",
            "text": "Top 3 Q4 Trends:\n1. 23% increase in..."
          }
        ]
      }
    ]
  }
}
```

#### Google ADK Integration

Google's Agent Development Kit (ADK) makes A2A integration trivial:

```python
from google.adk import Agent
from google.adk.a2a.utils.agent_to_a2a import to_a2a

research_agent = Agent(
    name="research_assistant",
    model="gemini-2.0-flash",
    description="Summarizes topics, answers questions, provides analysis",
    instruction="You are a thorough research assistant..."
)

# One function call: Agent Card + JSON-RPC endpoints + SSE streaming
a2a_app = to_a2a(research_agent, port=8001)

# Agent Card auto-served at /.well-known/agent-card.json
# JSON-RPC handler at /
```

On the client side:

```python
from google.adk.agents import RemoteA2aAgent

data_agent = RemoteA2aAgent(
    agent_card_url="http://localhost:8001/.well-known/agent-card.json"
)

# The client agent discovers capabilities from the Agent Card
# and delegates tasks using A2A protocol
result = await data_agent.send("Analyze Q4 sales trends")
```

### 5.6 When NOT to Use Multi-Agent Systems

Multi-agent systems introduce coordination overhead that is not always justified. Anthropic's consistent advice: *you should consider adding complexity only when it demonstrably improves outcomes*.

#### The Overhead Budget

| Overhead Type         | Cost                                          |
|----------------------|-----------------------------------------------|
| Orchestration tokens | 500-2,000 tokens per delegation               |
| Context duplication  | Each agent needs background context            |
| Latency              | Sequential: additive. Parallel: max of workers |
| Error compounding    | Each agent has P(error); combined = 1 - ∏(1-p) |
| Coordination bugs    | Agents misunderstand scope, duplicate work     |

#### Decision Framework

```
Should you use multi-agent?

  Is the task decomposable into independent subtasks?
    ├── No  → Single agent. Don't force decomposition.
    └── Yes
         │
  Does a single context window fit the full task?
    ├── Yes → Single agent. Simpler is better.
    └── No
         │
  Do subtasks require different tools or permissions?
    ├── No  → Single agent with tool subsets.
    └── Yes
         │
  Is verification important (code review, QA)?
    ├── No  → Single agent or simple pipeline.
    └── Yes → Multi-agent with evaluator.
         │
  Use the simplest pattern that works:
  Pipeline > Parallelization > Orchestrator-Worker > Agent Teams
```

Anthropic's multi-agent research system learned this the hard way: *"Early agents made errors like spawning 50 subagents for simple queries."* Explicit scaling rules were embedded in prompts — simple fact-finding requires 1 agent with 3-10 tool calls; direct comparisons might need 2-3; comprehensive research might need 5+.

### 5.7 Production Patterns: A Summary

| Pattern               | Topology          | When to Use                                  |
|----------------------|-------------------|----------------------------------------------|
| **Pipeline**          | A → B → C         | Sequential steps with clear handoffs          |
| **Router**            | Router → {A,B,C}  | Input classification to specialized handlers  |
| **Orchestrator-Worker** | Orch ⇄ {W1..Wn} | Dynamic task decomposition                   |
| **Evaluator-Optimizer** | Gen ⇄ Eval       | Quality-critical tasks needing iteration      |
| **Agent Teams**       | Lead ⇄ {T1..Tn}  | Persistent parallel workers on shared state   |
| **Worktree Parallel** | {A1..A8}          | Independent features in isolated checkouts    |
| **Federated (A2A)**   | Client ⇄ Remote   | Cross-organization agent delegation           |

---

## Chapter 6: Long-Horizon Agent Harnesses

> *"The hardest problem in agentic AI is not making the agent smart. It is making it persistent."*

A single context window is a single sprint. Real software projects are marathons. Building a full-stack application, debugging a complex system, or implementing a multi-feature specification requires work that spans hours, hundreds of thousands of tokens, and multiple context windows. This chapter examines the harness designs that make long-horizon agent work possible — from Anthropic's battle-tested initializer-coder pattern through their GAN-inspired three-agent architecture, and the academic frameworks (ReCAP, PLAN-AND-ACT, ALAS) that formalize the underlying principles.

### 6.1 The Long-Running Agent Problem

The fundamental challenge is simple to state and difficult to solve: **how do you maintain coherent progress across context window boundaries?**

```
Context Window 1          Context Window 2          Context Window 3
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│ Read spec         │     │ ??? What was I   │     │ ??? Where did I  │
│ Plan features     │     │     working on?  │     │     leave off?   │
│ Implement auth    │     │ ??? What's done? │     │ ??? What's left? │
│ Implement users   │     │ ??? What's the   │     │ ??? Is the app   │
│ [context full]    │     │     state of the │     │     even working? │
│                   │     │     codebase?    │     │                  │
└──────────────────┘     └──────────────────┘     └──────────────────┘
         ▲                        ▲                        ▲
         │                        │                        │
    200K tokens              Fresh context            Fresh context
    consumed                 No memory                No memory
```

Without a harness, each new context window starts from scratch. The agent has no memory of prior decisions, no understanding of the current codebase state, and no plan for what to do next. It may re-implement features that already work, break existing functionality, or declare the project "complete" when critical features are missing.

### 6.2 Anthropic's Two-Part Solution: Initializer + Coding Agent

Anthropic's "Effective Harnesses for Long-Running Agents" (2025) introduced a two-agent pattern that became the foundation for production long-horizon coding:

```
┌─────────────────────────────────────────────────────────────────┐
│                    Long-Running Agent Harness                    │
│                                                                  │
│  Session 1: INITIALIZER AGENT                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ 1. Read app_spec.txt                                       │ │
│  │ 2. Create feature_list.json (200 testable features)        │ │
│  │ 3. Create init.sh (dev environment setup)                  │ │
│  │ 4. Initialize git repository                               │ │
│  │ 5. Create claude-progress.txt                              │ │
│  │ 6. Commit: "Initial setup"                                 │ │
│  │ 7. (Optional) Begin implementation                         │ │
│  └────────────────────────────────────────────────────────────┘ │
│                              │                                   │
│                    Structured Handoff                             │
│                              │                                   │
│  Sessions 2..N: CODING AGENT                                    │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ 1. pwd                                                     │ │
│  │ 2. Read claude-progress.txt                                │ │
│  │ 3. Read feature_list.json                                  │ │
│  │ 4. git log --oneline -20                                   │ │
│  │ 5. Run ./init.sh (start dev server)                        │ │
│  │ 6. Run end-to-end test (verify app works)                  │ │
│  │ 7. Fix any existing bugs                                   │ │
│  │ 8. Pick highest-priority unfinished feature                │ │
│  │ 9. Implement + test one feature                            │ │
│  │ 10. Commit progress                                        │ │
│  │ 11. Update claude-progress.txt                             │ │
│  │ 12. Update feature_list.json                               │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

#### The Initializer Agent

The initializer runs once, in the first session, with a specialized prompt:

**Task 1: Create `feature_list.json`** — A comprehensive list of 200 testable features, each with:

```json
{
  "features": [
    {
      "id": 1,
      "name": "User can create an account",
      "description": "Registration form with email and password",
      "passes": false,
      "testing_steps": [
        "Step 1: Navigate to /register",
        "Step 2: Fill in email and password fields",
        "Step 3: Click 'Create Account' button",
        "Step 4: Verify redirect to dashboard",
        "Step 5: Verify welcome message displays"
      ]
    }
  ]
}
```

Features can only be marked as passing (`"passes": false` → `"passes": true`). They can never be removed, edited, or reordered. This ensures no functionality is forgotten or silently dropped.

**Task 2: Create `init.sh`** — A script that future agents can run to set up and start the development environment:

```bash
#!/bin/bash
# init.sh — Environment setup for autonomous coding sessions

set -e

# Install dependencies
npm install

# Start development server in background
npm run dev &
DEV_PID=$!

# Wait for server to be ready
echo "Waiting for dev server..."
for i in {1..30}; do
    if curl -s http://localhost:3000 > /dev/null 2>&1; then
        echo "Dev server ready at http://localhost:3000"
        break
    fi
    sleep 1
done

echo "PID: $DEV_PID"
```

**Task 3: Initialize git** — Create the repository with an initial commit containing `feature_list.json`, `init.sh`, and project structure.

**Task 4: Create `claude-progress.txt`** — A human- and machine-readable progress log:

```
# Claude Progress Log
## Session 1 (Initializer) — 2025-11-15
- Created feature_list.json with 200 features
- Set up Next.js project structure
- Created init.sh for dev environment
- Implemented basic routing (features 1-5)
- 5/200 features passing

## Next priorities:
- Authentication system (features 6-15)
- Database schema and migrations (features 16-25)
```

#### The Coding Agent

Every subsequent session uses a coding agent prompt that follows a strict startup sequence:

```
A typical session starts with:

[Agent] I'll start by getting my bearings.
[Tool] bash: pwd
[Tool] read: claude-progress.txt
[Tool] read: feature_list.json

[Agent] Let me check recent work.
[Tool] bash: git log --oneline -20

[Agent] Let me start the dev server and verify the app works.
[Tool] bash: ./init.sh
[Tool] bash: curl http://localhost:3000
[Tool] puppeteer: navigate to /, send message, verify response

[Agent] The app is working. Feature 16 (database migrations)
        is the highest-priority unfinished feature. Starting
        implementation...
```

The critical insight: **fix before build**. The agent always verifies the app works *before* implementing new features. If the previous session left bugs, the agent fixes them first. Without this discipline, agents pile new features on top of broken foundations.

### 6.3 Common Failure Modes and Solutions

Anthropic documented four common failure modes from their long-running agent experiments:

#### Failure Mode 1: Agent Tries to Do Too Much at Once

**Symptom**: The agent attempts to implement 10 features in a single context window. Quality degrades as the context fills. The agent starts cutting corners, skipping tests, and producing broken code.

**Solution**: Feature list + incremental progress. The feature list decomposes the project into 200 small, testable units. The coding agent is instructed to pick *one* feature per session and implement it thoroughly.

```
❌ "Implement the entire authentication system"
✅ "Implement feature #6: User can log in with email/password"
```

#### Failure Mode 2: Agent Declares Victory Too Early

**Symptom**: The agent implements core happy paths and marks the project as "complete," ignoring edge cases, error handling, and secondary features.

**Solution**: Verification against the feature list. The agent can only mark a feature as passing after:
1. Implementing the feature
2. Running the test steps defined in `feature_list.json`
3. Verifying each step passes

The feature list is the *source of truth* — if `feature_list.json` says 195/200 features pass, that is the project's actual completion status, regardless of what the agent claims.

#### Failure Mode 3: Agent Loses Track of State

**Symptom**: A new session starts and the agent doesn't know what was done before. It re-implements features that already work, introduces regressions, or starts the project from scratch.

**Solution**: Structured artifacts for state transfer. The combination of three files provides complete state:

| Artifact               | Purpose                           |
|------------------------|-----------------------------------|
| `claude-progress.txt`  | What happened and what's next     |
| `feature_list.json`    | What works and what doesn't       |
| `git log`              | What changed and when             |

Each coding session begins by reading all three. This takes ~2,000 tokens — a trivial cost for full situational awareness.

#### Failure Mode 4: Agent Can't Test Its Work

**Symptom**: The agent implements a feature but has no way to verify it works. It marks the feature as "done" based on code review alone, missing runtime bugs.

**Solution**: `init.sh` with dev server setup + end-to-end testing. The `init.sh` script provides a reproducible way to start the development environment. Combined with browser automation (Puppeteer MCP, Playwright MCP), the agent can:

1. Start the dev server
2. Navigate to the relevant page
3. Perform the test steps from `feature_list.json`
4. Verify expected behavior
5. Only then mark the feature as passing

### 6.4 The Three-Agent Architecture: Planner-Generator-Evaluator

Anthropic's March 2026 evolution of the harness design introduced a **three-agent architecture** that addresses a deeper problem: *agents asked to evaluate their own work tend to confidently praise it, even when it is clearly mediocre*.

```
┌────────────────────────────────────────────────────────────────┐
│           Three-Agent Architecture (Anthropic, 2026)           │
│                                                                 │
│  ┌──────────┐                                                  │
│  │ PLANNER  │  Input: 1-4 sentence prompt                      │
│  │          │  Output: Full product spec with:                  │
│  │          │    - Feature decomposition                        │
│  │          │    - Sprint planning                              │
│  │          │    - Evaluation criteria                          │
│  └────┬─────┘                                                  │
│       │ spec                                                    │
│       ▼                                                         │
│  ┌──────────┐     ┌───────────┐                                │
│  │GENERATOR │────>│ EVALUATOR │                                │
│  │          │     │           │  Navigates live pages           │
│  │  Builds  │     │  Scores   │  via Playwright MCP            │
│  │  code,   │<────│  against  │  Checks 27+ criteria           │
│  │  one     │     │  criteria │  Returns specific              │
│  │  sprint  │     │           │  critiques                     │
│  │  at a    │     │           │                                │
│  │  time    │     │           │                                │
│  └──────────┘     └───────────┘                                │
│       ▲                │                                        │
│       │   feedback     │                                        │
│       └────────────────┘                                        │
│       Iterate 5-15 times                                        │
│       (up to 4+ hours)                                          │
│                                                                 │
│  Results comparison:                                            │
│  ┌──────────────────┬───────────┬──────────┬──────────────┐    │
│  │ Setup            │ Time      │ Cost     │ Quality      │    │
│  ├──────────────────┼───────────┼──────────┼──────────────┤    │
│  │ Solo (no eval)   │ 20 min    │ $9       │ Core broken  │    │
│  │ Full harness     │ 6 hrs     │ $200     │ Functional + │    │
│  │                  │           │          │ AI features  │    │
│  └──────────────────┴───────────┴──────────┴──────────────┘    │
└────────────────────────────────────────────────────────────────┘
```

#### The Planner

Takes a 1-4 sentence prompt (e.g., "Build a clone of claude.ai with real-time chat") and expands it into a full product specification:

- Feature decomposition into sprints
- Technical architecture (React, Vite, Tailwind stack)
- Evaluation criteria per feature
- Priority ordering

The planner is prompted to be *ambitious about scope* and to focus on product context rather than detailed technical implementation. Over-specifying technical details constrains the generator; the planner provides *what* to build, not *how*.

#### The Generator

Works in sprints, picking up one feature at a time from the spec. Each sprint:
1. Reads the current codebase state
2. Implements one feature
3. Commits progress with descriptive messages
4. Updates progress artifacts

The generator uses the same structured handoff pattern from the two-agent architecture: `claude-progress.txt`, feature lists, and git history.

#### The Evaluator

The evaluator is the critical innovation. It operates **independently** of the generator, with:
- Its own fresh context (no accumulated generator state)
- Calibrated scoring criteria with few-shot examples
- Live interaction with the running application via Playwright MCP

For frontend work, the evaluator checks 27+ criteria across four dimensions:

| Dimension      | Example Criteria                                  |
|---------------|---------------------------------------------------|
| Design Quality | Layout coherence, color consistency, typography   |
| Originality    | Unique visual identity, creative interactions     |
| Craft          | Attention to detail, micro-interactions, polish   |
| Functionality  | Core features work, error handling, edge cases    |

The evaluator navigates live pages, clicks buttons, fills forms, and files specific bug reports: *"`fillRectangle` exists but doesn't fire on `mouseUp`."*

**Key finding**: Calibrating the evaluator is crucial. Without few-shot examples of what "good" and "bad" look like, the evaluator defaults to either uniform praise or uniform criticism. The scoring rubric must be concrete and grounded in examples.

#### Context Resets vs. Compaction

The three-agent architecture uses **context resets** (clearing the window entirely and starting fresh) rather than **compaction** (summarizing and condensing the context). This was a key architectural decision:

```
Compaction:                          Context Reset:
┌─────────────────┐                 ┌─────────────────┐
│ Turn 1           │                 │ (cleared)        │
│ Turn 2           │                 │                  │
│ [compacted: T1-2]│                 │ Handoff artifact:│
│ Turn 3           │                 │ - Progress file  │
│ Turn 4           │                 │ - Feature list   │
│ [compacted: T1-4]│                 │ - Git history    │
│ Turn 5           │                 │ - Next steps     │
│ ...              │                 │                  │
│ Drift accumulates│                 │ Clean slate with │
│ Errors compound  │                 │ structured state │
└─────────────────┘                 └─────────────────┘
```

Compaction introduces lossy compression — summaries lose nuance, errors accumulate, and the model gradually drifts from the original plan. Context resets are more expensive per transition (the handoff artifact costs tokens) but prevent the cumulative degradation that compaction allows.

**Note**: The choice between resets and compaction depends on the model. Anthropic found that Sonnet 4.5 exhibited "context anxiety" — rushing to finish as it approached the context limit — making resets essential. Opus 4.5 largely eliminated this behavior, allowing continuous sessions with automatic compaction. The harness must evolve with the model.

### 6.5 Stanford ReCAP: Recursive Context-Aware Reasoning and Planning

**ReCAP** (Recursive Context-Aware Reasoning and Planning), presented at NeurIPS 2025 by Zhang, Chen, Xu, Pentland, and Pei (Stanford/MIT), formalizes the recursive decomposition pattern that production harnesses use intuitively.

#### The Three Mechanisms

1. **Plan-Ahead Task Decomposition**: Instead of generating one subtask at a time (as in ReAct), ReCAP produces a *complete ordered subtask list*, executes the first item, and refines the remainder based on execution results.

2. **Structured Context Re-Injection**: When returning from a recursive subtask, the parent plan is re-injected into the context. This maintains cross-level coherence — the agent always knows how its current subtask fits into the bigger picture.

3. **Memory-Efficient Execution**: A sliding-window mechanism bounds the active prompt so costs scale linearly with task depth, not exponentially.

```
                    ReCAP Context Tree

                    ┌─────────────┐
                    │   Plan P1   │
                    │  (Top-level)│
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
        ┌─────▼─────┐ ┌───▼───┐ ┌─────▼─────┐
        │ Subtask   │ │ Sub   │ │ Subtask   │
        │ T1.1      │ │ T1.2  │ │ T1.3      │
        │ (execute) │ │(defer)│ │ (defer)   │
        └─────┬─────┘ └───────┘ └───────────┘
              │
         ┌────┼────┐
         │         │
    ┌────▼───┐ ┌───▼────┐
    │ T1.1.1 │ │ T1.1.2 │
    │(execute)│ │(defer) │
    └────────┘ └────────┘

    After T1.1.1 completes:
    - Re-inject P1 context
    - Refine remaining subtasks [T1.1.2, T1.2, T1.3]
    - Execute T1.1.2
```

#### Results

ReCAP achieves substantial improvements over baselines under the strict pass@1 protocol (single run, no retry):

| Benchmark              | ReCAP  | Best Baseline | Improvement |
|------------------------|--------|---------------|-------------|
| Robotouille (sync)     | 87.5%  | 55.5% (ReAct) | +32%        |
| Robotouille (async)    | 62.5%  | 33.5% (ReAct) | +29%        |
| ALFWorld               | 91.0%  | 84.0% (ReAct) | +7%         |
| SWE-bench Verified     | 44.8%  | 39.6% (ReAct) | +5%         |
| FEVER                  | 63.5%  | 58.5% (ADaPT) | +5%         |

The gains are largest on long-horizon tasks (Robotouille requires 10-80 steps) where context drift and goal loss are most severe.

#### Ablation: Recursive Depth Matters

| Max Depth | Success Rate | Note                              |
|-----------|-------------|-----------------------------------|
| 5         | 87.5%       | Full recursive decomposition      |
| 4         | 60%         | Slightly shallower → small drop   |
| 3         | 10%         | Too shallow → fails to decompose  |
| 2         | 0%          | No recursive decomposition        |

This demonstrates that the recursive structure is not optional — it is the mechanism that enables long-horizon performance. Shallow decomposition is insufficient.

### 6.6 Berkeley PLAN-AND-ACT: Separating Planning from Execution

**PLAN-AND-ACT** (Erdogan et al., UC Berkeley, ICML 2025) formalizes a principle that production harnesses implement implicitly: *planning and execution should be handled by separate, specialized components*.

```
┌──────────────────────────────────────────────────────────────┐
│                   PLAN-AND-ACT Architecture                   │
│                                                               │
│  ┌────────────┐     Plan      ┌────────────────────────────┐ │
│  │            │──────────────>│         EXECUTOR            │ │
│  │  PLANNER   │               │                            │ │
│  │            │  Observation  │  Step 1: Navigate to page  │ │
│  │ (Strategic │<──────────────│  Step 2: Click element     │ │
│  │  reasoning)│               │  Step 3: Fill form         │ │
│  │            │  Replan       │  Step 4: Verify result     │ │
│  │            │──────────────>│                            │ │
│  └────────────┘               └────────────┬───────────────┘ │
│                                             │                 │
│                                    ┌────────▼──────┐         │
│                                    │  Environment  │         │
│                                    │  (Web browser,│         │
│                                    │   terminal,   │         │
│                                    │   etc.)       │         │
│                                    └───────────────┘         │
│                                                               │
│  Key insight: Off-the-shelf LLMs achieve only 9.85% on      │
│  long-horizon web navigation. Separating planning from       │
│  execution + synthetic training data → 57.58% (SOTA)         │
└──────────────────────────────────────────────────────────────┘
```

#### Architecture Details

The **Planner** receives a user query and generates a structured, high-level plan:

```
User: "Follow the top contributor of this repository"

Planner output:
1. Navigate to the repository's contributors section
2. Identify the top contributor by commit count
3. Click on the top contributor's profile
4. Click the "Follow" button on their profile page
```

The **Executor** translates each plan step into environment-specific actions (clicks, keystrokes, API calls). Critically, the executor processes HTML input, extracting relevant information before generating actions — it does not receive the full DOM.

**Dynamic Replanning**: When the executor encounters unexpected state (a page that doesn't match the plan, an error, a changed UI), it signals the planner. The planner generates a revised plan based on the current observation.

#### Training via Synthetic Data

A key contribution: PLAN-AND-ACT introduces a synthetic data generation pipeline to train the planner. Given ground-truth action trajectories (human demonstrations), the pipeline:

1. Extracts the sequence of actions
2. Generates plausible high-level plans that would produce those actions
3. Augments with diverse rephrasings and variations

This produces training data for the planner without requiring expensive human-written plans. The result: fine-tuned 70B parameter models that achieve state-of-the-art 57.58% on WebArena-Lite and 81.36% on WebVoyager (text-only).

#### Implications for Harness Design

PLAN-AND-ACT validates a principle that Anthropic's three-agent architecture implements in practice: **when the coding agent tries to plan and build simultaneously, it overcommits and runs out of context mid-feature**. Separating the planning step lets each generation session focus on execution.

### 6.7 ALAS: Transactional Multi-Agent Planning with Validator Isolation

**ALAS** (Adaptive LLM Agent System), from Geng and Chang at Stanford (November 2025), addresses the most insidious failure mode in multi-agent planning: **circular self-validation**.

The problem: when the same model (or an interleaved context) both plans and validates, approval is circular. The model that made a mistake is asked to verify its own work — and it approves, because the reasoning that led to the mistake is still in context.

#### Three Design Principles

1. **Validator Isolation**: The validator operates independently of the planning LLM with fresh, bounded context. It never sees the planner's reasoning — only the versioned execution log. This prevents self-check loops and mid-context attrition.

2. **Versioned Execution Log**: Every state change is recorded in a versioned log that provides grounded context for validation and restore points for recovery.

3. **Localized Cascading Repair Protocol (LCRP)**: When the validator detects a fault, repair edits only the minimal affected region. Unlike global recomputation (which discards all work and starts over), LCRP preserves work in progress.

```
┌────────────────────────────────────────────────────────────────┐
│                    ALAS Five-Layer Architecture                  │
│                                                                  │
│  Layer 1: Workflow Blueprinting                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Roles, edges, constraints, repairable edges, log schema  │  │
│  └──────────────────────────────────────────────────────────┘  │
│                              │                                   │
│  Layer 2: Agent Factory                                         │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Spawn specialized agents per role with tools + policies  │  │
│  └──────────────────────────────────────────────────────────┘  │
│                              │                                   │
│  Layer 3: Execution Engine                                      │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Run agents, record versioned execution log               │  │
│  └──────────────────────────────────────────────────────────┘  │
│                              │                                   │
│  Layer 4: Validator (ISOLATED)                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Fresh context │ Reads only execution log │ No planner    │  │
│  │               │ state in context         │               │  │
│  │ Checks: structural faults, constraint violations,        │  │
│  │         temporal ordering, resource conflicts            │  │
│  └──────────────────────────────────────────────────────────┘  │
│                              │                                   │
│  Layer 5: Repair Protocol (LCRP)                                │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Policies: retry, catch, timeout, backoff, idempotency    │  │
│  │           keys, compensation, loop guards                │  │
│  │ Edit only minimal affected region                        │  │
│  │ Preserve work in progress                                │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
```

#### Repair Policies

ALAS defines explicit fault-handling policies in a canonical workflow IR (Intermediate Representation) that maps to production workflow engines like Amazon States Language and Argo Workflows:

```python
# ALAS repair policy specification
repair_policies = {
    "retry": {
        "max_attempts": 3,
        "backoff": "exponential",
        "base_delay_seconds": 2
    },
    "catch": {
        "error_types": ["ValidationError", "TimeoutError"],
        "handler": "compensate_and_retry"
    },
    "timeout": {
        "seconds": 300,
        "fallback": "skip_with_warning"
    },
    "idempotency_key": {
        "source": "task_id + attempt_number",
        "dedup_window_seconds": 3600
    },
    "compensation": {
        "on_failure": "rollback_to_last_checkpoint",
        "preserve_completed_subtasks": True
    },
    "loop_guard": {
        "max_iterations": 10,
        "stall_detection_turns": 3
    }
}
```

#### Results

On job-shop scheduling benchmarks (DMU, TA) across five classical benchmarks:

| Metric          | ALAS   | Best Baseline | Improvement |
|----------------|--------|---------------|-------------|
| Success Rate   | 83.7%  | Various       | Exceeds all |
| Token Usage    | -60%   | Baseline      | Reduction   |
| Speed          | 1.82×  | Baseline      | Faster      |
| Fault Detection| 99.0%  | N/A           | High        |

The combination of validator isolation + versioned execution logs + localized repair provides measurable gains in efficiency, feasibility, and scalability.

### 6.8 Synthesis: The Long-Horizon Harness Playbook

Drawing from Anthropic's production systems, Stanford's ReCAP, Berkeley's PLAN-AND-ACT, and Stanford's ALAS, a consistent set of principles emerges for designing long-horizon agent harnesses:

```
┌────────────────────────────────────────────────────────────────┐
│              The Long-Horizon Harness Playbook                  │
│                                                                  │
│  1. DECOMPOSE before you build                                  │
│     ├── Planner agent expands prompt into spec                  │
│     ├── Feature list provides testable units                    │
│     └── Sprint-based execution prevents overcommit              │
│                                                                  │
│  2. PERSIST state across context boundaries                     │
│     ├── Progress files (claude-progress.txt)                    │
│     ├── Feature status (feature_list.json)                      │
│     ├── Git history (structured commits)                        │
│     └── Versioned execution logs (ALAS)                         │
│                                                                  │
│  3. VERIFY before you extend                                    │
│     ├── Run init.sh before implementing                         │
│     ├── Fix bugs before adding features                         │
│     ├── Test against feature list criteria                      │
│     └── Separate evaluator from generator                       │
│                                                                  │
│  4. ISOLATE concerns                                            │
│     ├── Planning ≠ Execution (PLAN-AND-ACT)                     │
│     ├── Generation ≠ Evaluation (Anthropic)                     │
│     ├── Validation ≠ Planning (ALAS)                            │
│     └── Recursive context ≠ flat context (ReCAP)                │
│                                                                  │
│  5. REPAIR locally, not globally                                │
│     ├── LCRP edits minimal affected region                      │
│     ├── Context resets beat compaction for long sessions         │
│     ├── Compensation preserves completed work                   │
│     └── Loop guards prevent infinite retry cycles               │
│                                                                  │
│  6. CALIBRATE the evaluator                                     │
│     ├── Few-shot examples with detailed scoring                 │
│     ├── Concrete criteria, not vague quality measures            │
│     ├── Independent context (no generator state)                │
│     └── Live interaction, not code review                       │
└────────────────────────────────────────────────────────────────┘
```

#### The Evolution of Harness Design

The field is moving rapidly. The trajectory from 2024 to 2026 shows clear progression:

```
2024: Single agent, single context window
      "Here's a task. Do it in one shot."
      Success rate: ~20% on complex tasks

2025 H1: Initializer + Coding agent (Anthropic)
         Structured handoffs, feature lists, init.sh
         Success rate: ~50% on multi-feature projects

2025 H2: Academic frameworks (ReCAP, PLAN-AND-ACT, ALAS)
         Recursive decomposition, validator isolation
         Success rate: 44-87% on benchmarks

2026: Three-agent architecture (Anthropic)
      Planner-Generator-Evaluator, GAN-inspired loops
      Multi-hour autonomous sessions, production-quality output
```

Each generation builds on the previous one. The initializer pattern introduced structured state transfer. ReCAP formalized recursive decomposition. PLAN-AND-ACT proved that separating planning from execution improves outcomes. ALAS demonstrated that validator isolation prevents circular self-approval. The three-agent architecture synthesizes all of these insights into a production-ready system.

The harness is not a fixed design — it is a living system that must evolve with the models it supports. As Anthropic's Prithvi Rajasekaran writes: *"Every component of a harness encodes an assumption about what the model can and cannot do. As models improve, those assumptions must be revisited."*

---

*End of Part II*
