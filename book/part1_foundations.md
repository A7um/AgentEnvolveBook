# Part I: Foundations of Agent Intelligence

---

# Chapter 1: The Agent Paradigm Shift

## 1.1 From Chatbots to Autonomous Agents: The Fundamental Architectural Shift

The history of software is a history of expanding loops. Batch processing gave way to interactive terminals. Interactive terminals gave way to event-driven GUIs. Event-driven GUIs gave way to request-response web services. Each transition increased the surface area of what software could perceive and act upon within a single execution cycle.

The transition from chatbots to autonomous agents is the latest — and arguably most consequential — expansion of that loop. It is not a marketing distinction. It is a fundamental change in the execution model of AI-powered software.

A **chatbot** operates in a single-turn or multi-turn conversational mode. It receives a user message, produces a response, and waits. The user is always in the loop. The user decides what to do with the response. The user initiates every action. The architecture looks like this:

```
┌─────────────────────────────────────────────┐
│                  CHATBOT                     │
│                                              │
│   User ──message──► LLM ──response──► User   │
│                                              │
│   User ──message──► LLM ──response──► User   │
│                                              │
│   (Human always initiates, always receives)  │
└─────────────────────────────────────────────┘
```

An **agent** operates in a fundamentally different mode. It receives a goal, then enters an autonomous loop where it reasons about the current state, selects and executes tools, observes the results, and decides whether to continue or terminate. The user is *outside* the loop. The agent decides what to do with tool results. The agent initiates actions. The agent determines when the goal has been achieved.

```
┌───────────────────────────────────────────────────────────┐
│                       AGENT                                │
│                                                            │
│   User ──goal──►┌──────────────────────────────────┐       │
│                  │  ┌─────────┐                     │       │
│                  │  │ Observe │◄──── Tool Results    │       │
│                  │  └────┬────┘                     │       │
│                  │       │                          │       │
│                  │  ┌────▼────┐                     │       │
│                  │  │  Think  │  (LLM Inference)    │       │
│                  │  └────┬────┘                     │       │
│                  │       │                          │       │
│                  │  ┌────▼────┐                     │       │
│                  │  │   Act   │──── Tool Calls       │       │
│                  │  └────┬────┘                     │       │
│                  │       │                          │       │
│                  │       ▼                          │       │
│                  │   Done? ──no──► (loop back)       │       │
│                  │     │                            │       │
│                  │    yes                           │       │
│                  └─────┼────────────────────────────┘       │
│                        ▼                                    │
│                     Result ──► User                         │
└───────────────────────────────────────────────────────────┘
```

This distinction matters because it changes *who controls the execution flow*. In a chatbot, the human is the scheduler. In an agent, the LLM is the scheduler. This single architectural inversion has cascading consequences for reliability, safety, cost, observability, and system design.

Consider a concrete example. A user wants to fix a bug in a web application where a form submission silently fails when a field contains Unicode characters.

**Chatbot interaction** (multiple turns, human-driven):

```
Human: "The form fails with Unicode input. What could cause this?"
LLM:   "Possible causes include encoding issues in the backend parser,
        database column charset settings, or client-side validation
        regex that doesn't handle Unicode..."
Human: "How do I check the backend parser?"
LLM:   "Look at the request handler for the form endpoint. Check if
        the body parser is configured for UTF-8..."
Human: [manually searches code, finds issue, asks follow-up]
...
[15 turns later, bug is fixed]
```

**Agent interaction** (single goal, agent-driven):

```
Human: "Fix the bug where form submission fails with Unicode input"
Agent: [Searches codebase for form submission handler]
Agent: [Reads the relevant route handler and body parser config]
Agent: [Identifies that the validation regex uses \w which doesn't
        match Unicode word characters]
Agent: [Writes a fix using Unicode-aware regex]
Agent: [Runs the test suite to verify]
Agent: [Finds tests pass but adds a new test for Unicode edge cases]
Agent: [Commits the fix with a descriptive message]
Agent: "Fixed. The issue was a non-Unicode-aware regex in the
        validation layer. I've updated it to use Unicode property
        escapes and added test coverage."
```

The chatbot required 15 human-driven turns. The agent required one human turn and 6+ autonomous tool-use cycles. The architectural difference is not that the agent is "smarter" — it uses the same underlying LLM. The difference is that the agent has **tools** and a **loop**, and the authority to use them without waiting for human approval at each step.

### The Three Pillars of the Shift

The chatbot-to-agent transition rests on three architectural pillars:

**1. Tool Integration.** Agents can invoke external tools — file systems, APIs, databases, web browsers, code interpreters, shell commands. Without tools, an LLM can only produce text. With tools, it can *change the state of the world*. This is the difference between an advisor and an actor.

**2. The Autonomous Loop.** Agents run in a loop that continues until a termination condition is met. This loop is the mechanism by which single-step reasoning becomes multi-step problem-solving. It transforms a function (input → output) into a process (goal → [steps] → outcome).

**3. State and Memory.** Agents maintain state across loop iterations — the conversation history, tool results, intermediate reasoning, and working memory. This state accumulates context that informs subsequent decisions, enabling planning, error recovery, and adaptive behavior.

These three pillars combine to produce a qualitative shift in capability. An LLM alone can answer questions about code. An LLM with tools in a loop can write, test, debug, and deploy code. The difference is not incremental. It is the difference between a textbook and an engineer.

### What Changed: The Capability Threshold

Why did this shift happen in 2024-2026 and not earlier? The answer is that agents require a minimum threshold of model capability to function reliably. Specifically:

- **Instruction following**: The model must reliably follow complex, multi-constraint system prompts that specify tool schemas, behavioral rules, and output formats.
- **Tool use**: The model must generate syntactically valid tool calls with correct parameter types, and interpret tool results correctly.
- **Multi-step reasoning**: The model must maintain coherent plans across many reasoning steps, adapting when intermediate steps fail.
- **Self-correction**: The model must recognize when its actions have failed and formulate alternative approaches.

GPT-3.5 (2022) could do none of these reliably. GPT-4 (2023) could do all of them passably. Claude 3.5 Sonnet and GPT-4o (2024) could do all of them well. Claude 3.5 Sonnet "new" and the o-series reasoning models (late 2024-2025) could do all of them with the consistency required for production deployment. The models crossed a threshold where the autonomous loop became *viable* — where the expected value of letting the model take another action exceeded the expected cost of that action failing.

---

## 1.2 The Observe-Think-Act Loop (ReAct Pattern) as the Universal Primitive

In October 2022, Yao et al. published "ReAct: Synergizing Reasoning and Acting in Language Models," a paper that would quietly become the foundational design pattern for nearly every production agent system built in the following years. The core idea was deceptively simple: interleave chain-of-thought reasoning with action execution.

Before ReAct, the field had two separate threads:

1. **Chain-of-Thought (CoT)** prompting showed that LLMs reason better when they show their work — writing intermediate steps before producing a final answer.
2. **Action-based agents** (like early LangChain tools) showed that LLMs can invoke external tools, but often did so without explicit reasoning about *why* they were choosing a particular tool.

ReAct unified these threads into a single pattern:

```
Thought: I need to find the current population of Tokyo to answer
         this question. Let me search for recent data.
Action:  search("Tokyo population 2025")
Observation: Tokyo's population as of 2025 is approximately
             13.96 million in the city proper...
Thought: I have the city proper population. The question asks about
         the metropolitan area. Let me search for that specifically.
Action:  search("Tokyo metropolitan area population 2025")
Observation: The Greater Tokyo Area has a population of approximately
             37.4 million...
Thought: Now I have both numbers. The question asks about the
         metropolitan area, so the answer is 37.4 million.
Answer:  The Tokyo metropolitan area has a population of approximately
         37.4 million as of 2025.
```

The pattern is **Observe → Think → Act**, repeated until a termination condition is reached. This is the universal primitive of agent execution.

### Why ReAct Works: The Grounding Effect

The key insight behind ReAct's effectiveness is **grounding**. When an LLM reasons in isolation (pure CoT), it can only manipulate information already in its parameters or context. This makes it susceptible to hallucination — generating plausible-sounding but incorrect reasoning chains. When an LLM acts without reasoning (pure tool use), it often invokes tools haphazardly, wasting actions on irrelevant queries.

ReAct creates a feedback loop between reasoning and the external world. Each action brings new *real* information into the context, which grounds subsequent reasoning in observed facts rather than parametric recall. Each reasoning step *justifies* the next action, ensuring that tool invocations are purposeful.

This grounding effect is why the ReAct pattern is universal across agent implementations, even when they don't explicitly use the "Thought/Action/Observation" formatting. Every major agent system — OpenAI's Codex, Anthropic's Claude Code, Cursor, Devin, Manus — implements some variation of this loop:

```
┌────────────────────────────────────────────────────────────┐
│               THE UNIVERSAL AGENT PRIMITIVE                 │
│                                                             │
│   ┌──────────┐    ┌──────────┐    ┌──────────┐             │
│   │ OBSERVE  │───►│  THINK   │───►│   ACT    │             │
│   │          │    │          │    │          │             │
│   │ • Tool   │    │ • Plan   │    │ • Tool   │             │
│   │   results│    │ • Reason │    │   calls  │             │
│   │ • Errors │    │ • Decide │    │ • File   │             │
│   │ • State  │    │ • Update │    │   edits  │             │
│   │   changes│    │   beliefs│    │ • Commands│             │
│   └──────────┘    └──────────┘    └──────────┘             │
│        ▲                               │                    │
│        │          ┌──────────┐         │                    │
│        └──────────│ENVIRONMENT│◄────────┘                    │
│                   └──────────┘                              │
└────────────────────────────────────────────────────────────┘
```

### Variations of the Loop in Practice

While the ReAct pattern is universal, implementations vary in how they structure the loop:

**Explicit ReAct (academic style):**
```python
# Explicit thought-action-observation formatting
messages = [{"role": "system", "content": REACT_PROMPT}]

while True:
    response = llm.generate(messages)
    thought, action = parse_react_response(response)

    if action.type == "finish":
        return action.result

    observation = execute_tool(action)
    messages.append({"role": "assistant", "content": f"Thought: {thought}\nAction: {action}"})
    messages.append({"role": "user", "content": f"Observation: {observation}"})
```

**Implicit ReAct (production style, as used by Claude Code and OpenAI):**
```python
# Tool-use API handles the loop structure natively
messages = [{"role": "user", "content": user_goal}]

while True:
    response = llm.chat(messages, tools=TOOL_SCHEMAS)

    if response.stop_reason == "end_turn":
        return response.content

    # Model's reasoning is embedded in its content;
    # actions are structured tool_use blocks
    for tool_call in response.tool_calls:
        result = execute_tool(tool_call)
        messages.append(tool_call_message(tool_call))
        messages.append(tool_result_message(result))
```

The second form is how modern agent systems actually work. The LLM's native tool-use capability has absorbed the ReAct pattern — the model natively interleaves reasoning (in its text output) with actions (in its tool-call output) without requiring explicit "Thought:" and "Action:" formatting. The *pattern* is the same; the *surface syntax* has been subsumed by the API.

---

## 1.3 Levels of Agent Autonomy (L1-L5): From Copilots to Fully Autonomous Agents

Drawing an analogy from the SAE's levels of driving automation (which provide a useful conceptual framework, even though the domains differ significantly), we can define five levels of agent autonomy:

### Level 1: Copilot — Human Initiates, Agent Assists

At L1, the agent responds to explicit human requests within a single turn. It provides suggestions, completions, or answers, but takes no autonomous action. The human controls all execution.

**Examples:** GitHub Copilot inline suggestions, ChatGPT in standard chat mode, Claude in conversation mode.

**Architecture:**
```
Human ──request──► LLM ──suggestion──► Human ──decides──► Action
```

**Characteristics:**
- No tool use
- No autonomous loops
- Human is always the executor
- Agent's output is advisory

### Level 2: Tool-Assisted Agent — Human Approves, Agent Executes

At L2, the agent can invoke tools, but requires human approval for each action or batch of actions. The human remains in the loop as an approval gate.

**Examples:** ChatGPT with Code Interpreter (user sees code before execution), early Cursor with manual approval for each edit.

**Architecture:**
```
Human ──goal──► LLM ──proposed action──► Human ──approve──► Tool ──result──► LLM
```

**Characteristics:**
- Tool use with human approval gates
- Human reviews each action before execution
- Low risk, but high human overhead
- Suitable for high-stakes, low-volume tasks

### Level 3: Supervised Autonomous Agent — Agent Executes, Human Monitors

At L3, the agent operates autonomously within a defined scope, executing tool calls without per-action approval. The human monitors progress and can intervene, but does not need to approve each step. There are guardrails that prevent certain high-risk actions without approval.

**Examples:** Claude Code in normal mode (auto-executes safe commands, asks for approval on risky ones), Cursor in agent mode, ChatGPT with "auto-run" code execution enabled.

**Architecture:**
```
Human ──goal──► Agent Loop ──────────────────────────────► Result
                    │                                        ▲
                    ├── safe action ──► Tool ──► result ─────┤
                    │                                        │
                    └── risky action ──► Human approval ─────┘
```

**Characteristics:**
- Autonomous execution within safety boundaries
- Risk-tiered permission model
- Human intervenes on exceptions, not routine actions
- Most production coding agents operate here today

### Level 4: Fully Autonomous Agent — Agent Executes End-to-End

At L4, the agent executes complete tasks end-to-end without human intervention. It handles errors, adapts plans, and determines when the task is complete. The human provides the goal and receives the outcome.

**Examples:** Cursor Cloud Agent (background execution, no human-in-the-loop), OpenAI Codex (autonomous cloud agent), Devin (autonomous software engineer running in sandbox).

**Architecture:**
```
Human ──goal──► Agent Loop ──────────────────────────────► Result
                    │
                    ├── action ──► Tool ──► result
                    ├── error ──► self-correction ──► retry
                    ├── blocked ──► alternative approach
                    └── complete ──► verification ──► deliver
```

**Characteristics:**
- End-to-end autonomous execution
- Self-correction and error recovery
- No human involvement during execution
- Asynchronous: human can disconnect and return later
- Sandboxed execution environments for safety

### Level 5: Self-Directed Agent — Agent Identifies and Pursues Goals

L5 is largely theoretical today. At this level, the agent not only executes tasks but identifies what tasks *should* be done. It monitors systems, detects issues, prioritizes work, and executes solutions proactively.

**Examples:** No production systems fully operate at L5 today, though prototypes exist — AI systems that monitor production infrastructure, detect anomalies, and autonomously deploy fixes.

**Architecture:**
```
World State ──perception──► Agent ──goal formation──► Agent Loop ──► Action
                                                          │
                                                          ▼
                                                    World State Changes
                                                          │
                                                          ▼
                                                     (cycle repeats)
```

**Characteristics:**
- Autonomous goal identification
- Continuous operation
- Self-prioritization of work
- Requires robust safety frameworks
- Current frontier of research

### The Autonomy Gradient in Practice

In practice, most production agents operate on a **gradient** between L3 and L4, with configurable permission models. Claude Code, for instance, allows users to configure an "allowlist" of tools that can execute without approval, while requiring confirmation for others. This creates a sliding scale:

```
L3 (everything needs approval) ◄─────────────────► L4 (nothing needs approval)
         │                                                       │
         │    Typical Claude Code config:                         │
         │    ├── file_read: auto-approve                        │
         │    ├── file_write: auto-approve                       │
         │    ├── bash (safe): auto-approve                      │
         │    ├── bash (network): ask                            │
         │    └── bash (destructive): ask                        │
         │                                                       │
         │    Cursor Cloud Agent:                                 │
         │    └── (all actions auto-approved in sandbox)          │
```

The trend from 2024 to 2026 is unmistakably toward higher autonomy. The progression has been:

1. **2023:** L1/L2 — Copilots and tool-assisted chat (ChatGPT + plugins, early Copilot)
2. **2024:** L2/L3 — Supervised autonomous agents (Claude Code, Cursor agent mode, Aider)
3. **2025:** L3/L4 — Fully autonomous background agents (Codex, Cursor Cloud, Claude Code with `--dangerously-skip-permissions`)
4. **2026:** L4 becoming standard — Autonomous agents as the default interaction mode

---

## 1.4 Why 2025-2026 Is the Inflection Point

Several converging developments in 2025-2026 have created a phase transition in agent capability:

### Convergence 1: Model Capability

The models released in late 2024 and 2025 crossed critical capability thresholds:

| Capability | Before (2023) | After (2025) | Impact on Agents |
|---|---|---|---|
| Tool-call accuracy | ~70-80% | ~95%+ | Agents can chain 10+ tool calls reliably |
| Instruction following | Inconsistent | Near-perfect | Complex system prompts work as designed |
| Long-context reasoning | Degrades past 8K | Stable to 128K-200K | Agents can hold entire codebases in context |
| Self-correction | Rare | Frequent | Agents recover from errors without human help |
| Code generation | Plausible but buggy | Compiles and passes tests | Agents can write production code |
| Extended thinking | Not available | Chain-of-thought at inference | Complex multi-step reasoning becomes reliable |

The introduction of extended thinking / reasoning models (o1, o3, Claude 3.5 with extended thinking, Claude Sonnet 4) was particularly significant for agents. These models can spend additional computation on hard reasoning steps, which is precisely what agents need when they encounter unexpected tool results and must formulate new plans.

### Convergence 2: Tooling and SDKs

The tooling ecosystem for building agents matured rapidly:

- **OpenAI Agents SDK** (March 2025): Evolved from the experimental Swarm framework into a production-ready SDK with a minimalist four-primitive design — Agents, Handoffs, Tools, and Guardrails. This crystallized the conceptual model for multi-agent systems.

- **Anthropic's tool-use API**: Native tool-use support in the Messages API with structured JSON schemas, automatic handling of the tool-use loop, and caching of tool schemas.

- **Model Context Protocol (MCP)** (late 2024-2025): Anthropic's open standard for connecting LLMs to external data sources and tools, creating a universal "USB-C for AI" that decoupled tool implementations from agent frameworks.

- **Vercel AI SDK, LangGraph, CrewAI**: Higher-level frameworks that abstracted common agent patterns.

### Convergence 3: Infrastructure

The infrastructure for running agents at scale emerged:

- **Sandboxed execution environments**: E2B, Fly.io Machines, Firecracker VMs, Docker-in-VM — providing isolated environments where agents can safely execute arbitrary code.

- **Cloud agent platforms**: Cursor Cloud Agent, OpenAI Codex, Devin — running agents in persistent cloud environments with full development toolchains.

- **Git-native workflows**: Agents that understand git, create branches, make commits, and interact with CI/CD pipelines as first-class citizens.

- **Observability and tracing**: OpenTelemetry integrations, LangSmith, Braintrust — tools for monitoring and debugging agent execution traces.

### The Inflection: Autonomous Coding Agents

The clearest signal of the inflection point is the emergence of **autonomous coding agents** as production tools used daily by professional engineers:

```
Timeline of Autonomous Coding Agents
─────────────────────────────────────

2023 Q1  │  ChatGPT + Code Interpreter (L1-L2)
         │  └── Can execute Python in sandbox, human-driven
         │
2023 Q3  │  GitHub Copilot Chat (L1)
         │  └── Conversational code assistance, no tool use
         │
2024 Q1  │  Devin announcement (L4 prototype)
         │  └── First "AI software engineer" demo
         │
2024 Q3  │  Cursor 0.40+ (L2-L3)
         │  └── Agent mode with multi-file editing
         │
2024 Q4  │  Claude Code launch (L3)
         │  └── Terminal-based autonomous coding agent
         │
2025 Q1  │  OpenAI Codex / Claude Code GA (L3-L4)
         │  └── Cloud agents running in background
         │
2025 Q2  │  Cursor Cloud Agent (L4)
         │  └── Fully autonomous background agent in cloud VMs
         │
2025 H2  │  Multi-agent coding workflows (L4)
  -2026  │  └── Orchestrated teams of specialized agents
         │
```

By early 2026, the autonomous coding agent has become a standard tool in the professional developer's workflow. The question is no longer "will agents work?" but "how do I build reliable ones?"

---

## 1.5 The Key Insight: Agents Are LLMs Autonomously Using Tools in a Loop

Strip away the marketing, the framework abstractions, and the hype, and the core insight is disarmingly simple:

> **An agent is an LLM that autonomously calls tools in a loop until a task is complete.**

This is not a simplification — it is the actual architecture. Every production agent system, regardless of complexity, reduces to this primitive. Let us examine the minimal implementation:

```python
import anthropic

def agent(goal: str, tools: list[dict], max_turns: int = 50) -> str:
    """A complete agent in 30 lines."""
    client = anthropic.Anthropic()
    messages = [{"role": "user", "content": goal}]

    for turn in range(max_turns):
        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=8096,
            system="You are an autonomous agent. Use the provided tools to accomplish the user's goal.",
            tools=tools,
            messages=messages,
        )

        # Append the assistant's response
        messages.append({"role": "assistant", "content": response.content})

        # If the model didn't use any tools, it's done
        if response.stop_reason == "end_turn":
            return extract_text(response.content)

        # Execute each tool call and collect results
        tool_results = []
        for block in response.content:
            if block.type == "tool_use":
                result = execute_tool(block.name, block.input)
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": str(result),
                })

        messages.append({"role": "user", "content": tool_results})

    return "Max turns reached without completion."
```

This is not a toy. This is the actual structure of production agents. Claude Code's core loop is, as Anthropic engineers have described it, essentially a `while(tool_use)` loop. The sophistication of production systems comes not from changing this fundamental structure, but from everything built *around* it:

- **Context management**: What goes into the `messages` array and how it's pruned
- **Tool design**: What tools are available and how their schemas are defined
- **Error handling**: What happens when tools fail
- **Permission management**: Which tools require human approval
- **Planning**: How the agent decomposes complex tasks
- **Verification**: How the agent confirms its work is correct

The key insight — that agents are LLMs using tools in a loop — has a crucial corollary: **the quality of an agent is determined by the quality of its context and tools, not by the cleverness of its orchestration framework.** This is why OpenAI's Agents SDK adopted a deliberately minimalist design with only four primitives (Agents, Handoffs, Tools, Guardrails), and why Claude Code's architecture is famously simple. The orchestration is not where the value is. The value is in the context engineering, the tool design, and the model capability.

Harrison Chase, the creator of LangChain, recognized this publicly when he wrote that most agent frameworks over-abstract the wrong things. The loop is simple. Getting the *inputs* to each loop iteration right — that is the hard problem. It is the problem of context engineering, which we will explore in depth in Chapter 3.

---

# Chapter 2: The Agent Loop — Anatomy of Autonomy

## 2.1 The Core Agent Loop

Every agent, from a weekend hackathon prototype to a production system handling thousands of concurrent sessions, implements the same fundamental loop:

```
┌─────────────────────────────────────────────────────────────────┐
│                    THE CORE AGENT LOOP                           │
│                                                                  │
│  ┌──────────┐                                                    │
│  │  User    │                                                    │
│  │  Input   │                                                    │
│  └────┬─────┘                                                    │
│       │                                                          │
│       ▼                                                          │
│  ┌──────────────────────────────────────────────────────┐        │
│  │                                                       │        │
│  │   ┌─────────────────┐                                │        │
│  │   │  Construct      │  System prompt + tools +        │        │
│  │   │  Context        │  history + observations         │        │
│  │   └────────┬────────┘                                │        │
│  │            │                                          │        │
│  │            ▼                                          │        │
│  │   ┌─────────────────┐                                │        │
│  │   │  Model          │  LLM generates text            │        │
│  │   │  Inference      │  and/or tool calls             │        │
│  │   └────────┬────────┘                                │        │
│  │            │                                          │        │
│  │            ▼                                          │        │
│  │   ┌─────────────────┐    ┌──────────────────┐        │        │
│  │   │  Parse          │───►│  Execute Tools    │        │        │
│  │   │  Response       │    │  (if tool calls)  │        │        │
│  │   └────────┬────────┘    └────────┬─────────┘        │        │
│  │            │                      │                   │        │
│  │            │◄─── observations ────┘                   │        │
│  │            │                                          │        │
│  │            ▼                                          │        │
│  │   ┌─────────────────┐                                │        │
│  │   │  Termination    │  stop_reason == "end_turn"?    │        │
│  │   │  Check          │  max_turns reached?             │        │
│  │   └────────┬────────┘  error threshold exceeded?      │        │
│  │            │                                          │        │
│  │       no   │   yes                                    │        │
│  │    ┌───────┴──────┐                                   │        │
│  │    ▼              ▼                                   │        │
│  │  (loop)      ┌─────────┐                              │        │
│  │              │ Output  │                              │        │
│  │              │ Result  │                              │        │
│  │              └─────────┘                              │        │
│  │                                                       │        │
│  └───────────────────────────────────────────────────────┘        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

The loop has four phases that execute in sequence on every iteration:

**Phase 1: Context Construction.** Assemble the full input to the model. This includes the system prompt, tool schemas, conversation history, tool results from the previous iteration, and any injected context (RAG results, file contents, etc.). This phase is where context engineering (Chapter 3) happens.

**Phase 2: Model Inference.** Send the constructed context to the LLM and receive a response. The response may contain text (reasoning, responses to the user), tool calls (actions to execute), or both.

**Phase 3: Tool Execution.** Parse any tool calls from the model's response and execute them against the external environment. Collect the results (observations) to feed back into the next iteration.

**Phase 4: Termination Check.** Determine whether the loop should continue or stop. Common termination conditions:
- The model's stop reason indicates it has finished (no more tool calls)
- A maximum turn count has been reached
- A critical error has occurred
- The user has interrupted execution
- A timeout has been exceeded

Let us now examine how three production systems implement this loop.

---

## 2.2 How OpenAI Codex Implements the Loop

OpenAI Codex (the agent platform, not the original code model) launched in early-to-mid 2025 as a fully autonomous cloud-based coding agent. It is built on top of the **Responses API**, which represents a significant evolution from the Chat Completions API.

### The Responses API Architecture

The Responses API introduced first-class support for agent loops. Unlike the Chat Completions API (which requires the caller to manage the message array and implement the loop), the Responses API can manage stateful, multi-turn interactions server-side:

```python
from openai import OpenAI

client = OpenAI()

# The Responses API natively supports multi-turn tool use
response = client.responses.create(
    model="o3-mini",
    instructions="You are a coding agent. Fix bugs methodically.",
    input="Fix the failing test in test_auth.py",
    tools=[
        {"type": "code_interpreter"},
        {"type": "file_search", "vector_store_ids": ["vs_abc123"]},
        {
            "type": "function",
            "function": {
                "name": "run_tests",
                "description": "Run the project's test suite",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "test_path": {"type": "string"},
                        "verbose": {"type": "boolean"}
                    }
                }
            }
        }
    ],
)
```

### Codex's Execution Environment

Codex runs each task in a **sandboxed cloud environment** — a Firecracker microVM or container with a complete development environment:

```
┌──────────────────────────────────────────────────────────┐
│                    CODEX TASK EXECUTION                    │
│                                                           │
│  ┌─────────┐    ┌───────────────────────────────────┐     │
│  │  User   │    │       Sandboxed Environment        │     │
│  │  Task   │───►│                                    │     │
│  └─────────┘    │  ┌──────────────────────────────┐  │     │
│                 │  │        Agent Loop             │  │     │
│                 │  │                               │  │     │
│                 │  │  Responses API ◄─► Model      │  │     │
│                 │  │       │                       │  │     │
│                 │  │       ▼                       │  │     │
│                 │  │  Tool Execution               │  │     │
│                 │  │  ├── Shell commands           │  │     │
│                 │  │  ├── File read/write          │  │     │
│                 │  │  ├── Code interpreter         │  │     │
│                 │  │  └── Web browsing             │  │     │
│                 │  │                               │  │     │
│                 │  └──────────────────────────────┘  │     │
│                 │                                    │     │
│                 │  ┌──────────────────────────────┐  │     │
│                 │  │  Full Dev Environment         │  │     │
│                 │  │  ├── Git repo (cloned)        │  │     │
│                 │  │  ├── Language runtimes        │  │     │
│                 │  │  ├── Package managers         │  │     │
│                 │  │  └── Test frameworks          │  │     │
│                 │  └──────────────────────────────┘  │     │
│                 │                                    │     │
│                 └───────────────────────────────────┘     │
│                              │                            │
│                              ▼                            │
│                 ┌───────────────────────┐                  │
│                 │  PR / Diff Output     │                  │
│                 └───────────────────────┘                  │
└──────────────────────────────────────────────────────────┘
```

### Context Management: Compaction

Codex sessions can run for many turns, generating large amounts of context from tool outputs (file contents, test output, command results). To manage this, Codex implements **context compaction** — a strategy for summarizing or truncating older context to stay within the model's context window:

```python
# Pseudocode for Codex-style compaction
def manage_context(messages: list, max_tokens: int) -> list:
    """Compact context when it exceeds the token budget."""
    current_tokens = count_tokens(messages)

    if current_tokens <= max_tokens:
        return messages

    # Strategy 1: Truncate old tool outputs
    for i, msg in enumerate(messages):
        if msg["role"] == "tool" and is_old(i, len(messages)):
            msg["content"] = summarize(msg["content"], max_length=200)

    # Strategy 2: Summarize early conversation turns
    if count_tokens(messages) > max_tokens:
        early_turns = messages[1:len(messages)//3]
        summary = llm_summarize(early_turns)
        messages = [messages[0], summary_message(summary)] + messages[len(messages)//3:]

    # Strategy 3: Drop least relevant context
    if count_tokens(messages) > max_tokens:
        messages = prioritized_truncation(messages, max_tokens)

    return messages
```

The compaction strategy balances retaining important context (the original task, recent actions, error messages) with staying within token limits. This is a critical concern for long-running agent sessions that may execute 50+ tool calls.

### The Agents SDK: Four Primitives

OpenAI's Agents SDK, which underlies Codex's architecture, is built on four primitives:

1. **Agent**: An LLM configured with instructions, tools, and optional model parameters. Multiple agents can exist in a system.

2. **Handoff**: A mechanism for one agent to transfer control to another, enabling multi-agent workflows. For instance, a "Triage Agent" might hand off to a "Bug Fix Agent" or a "Feature Agent" based on the task.

3. **Tool**: A function callable by the agent, defined with a JSON schema. Tools are the agent's interface to the external world.

4. **Guardrail**: A validation function that runs on agent inputs or outputs, implementing safety checks and policy enforcement.

```python
from openai_agents import Agent, Tool, Guardrail, handoff

# Define tools
read_file = Tool(
    name="read_file",
    description="Read the contents of a file",
    parameters={"path": {"type": "string"}},
    handler=lambda path: open(path).read()
)

write_file = Tool(
    name="write_file",
    description="Write content to a file",
    parameters={
        "path": {"type": "string"},
        "content": {"type": "string"}
    },
    handler=lambda path, content: open(path, 'w').write(content)
)

run_tests = Tool(
    name="run_tests",
    description="Execute the test suite",
    parameters={"path": {"type": "string"}},
    handler=lambda path: subprocess.run(["pytest", path], capture_output=True).stdout
)

# Define guardrails
no_secrets_in_output = Guardrail(
    name="no_secrets",
    validator=lambda output: not contains_secrets(output)
)

# Define agents
coding_agent = Agent(
    name="CodingAgent",
    instructions="You are a senior engineer. Fix bugs methodically: read code, understand the issue, write a fix, run tests.",
    tools=[read_file, write_file, run_tests],
    guardrails=[no_secrets_in_output],
    model="o3-mini",
)

triage_agent = Agent(
    name="TriageAgent",
    instructions="Analyze the user's request and route to the appropriate agent.",
    handoffs=[handoff(coding_agent, "For code changes and bug fixes")],
    model="gpt-4.1-mini",
)

# Run
result = triage_agent.run("Fix the auth test failure in test_auth.py")
```

The deliberate minimalism of this design is significant. The SDK does not include built-in RAG, memory systems, planning frameworks, or complex orchestration. It provides the essential primitives and trusts developers to compose them. This philosophy — that the agent loop itself is simple and the value is in what you put *into* the loop — is shared across all major production agent systems.

---

## 2.3 How Claude Code Implements the Loop

Claude Code, launched by Anthropic, is a terminal-based autonomous coding agent that runs locally on the developer's machine. Its architecture is notable for its simplicity — Anthropic engineers have publicly stated that the system is "not much more than a while loop over Claude API calls."

### The Core Loop

Claude Code's execution model follows a disciplined four-phase pattern: **Gather Context → Take Action → Verify → Repeat.**

```python
# Simplified representation of Claude Code's architecture
class ClaudeCodeAgent:
    def __init__(self):
        self.tools = self._register_tools()  # ~14-20 tools
        self.messages = []
        self.system_prompt = self._build_system_prompt()

    def run(self, user_input: str):
        self.messages.append({"role": "user", "content": user_input})

        while True:
            # Model inference with tool use
            response = anthropic.messages.create(
                model="claude-sonnet-4-20250514",
                system=self.system_prompt,
                messages=self.messages,
                tools=self.tools,
                max_tokens=16000,
            )

            self.messages.append({
                "role": "assistant",
                "content": response.content
            })

            # Check termination: if no tool use, we're done
            if response.stop_reason == "end_turn":
                return self._extract_final_response(response)

            # Execute tool calls
            tool_results = []
            for block in response.content:
                if block.type == "tool_use":
                    result = self._execute_tool(block)
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": result
                    })

            self.messages.append({
                "role": "user",
                "content": tool_results
            })

    def _register_tools(self):
        """Claude Code's ~14-20 tools."""
        return [
            # File operations
            {"name": "Read", "description": "Read file contents"},
            {"name": "Write", "description": "Write/create a file"},
            {"name": "Edit", "description": "Edit a file with search/replace"},
            {"name": "MultiEdit", "description": "Multiple edits to a file"},

            # Search and navigation
            {"name": "Glob", "description": "Find files by pattern"},
            {"name": "Grep", "description": "Search file contents"},
            {"name": "LS", "description": "List directory contents"},

            # Execution
            {"name": "Bash", "description": "Execute shell commands"},

            # Agent management
            {"name": "TodoWrite", "description": "Track task progress"},
            {"name": "Task", "description": "Spawn sub-agents"},

            # Web
            {"name": "WebFetch", "description": "Fetch URL contents"},
            {"name": "WebSearch", "description": "Search the web"},

            # ... additional tools
        ]
```

### The Tool Set: ~14-20 Tools

Claude Code's tool set is deliberately constrained. Rather than providing hundreds of specialized tools, it provides a small set of general-purpose tools that compose to handle any coding task:

```
┌──────────────────────────────────────────────────────────────┐
│              CLAUDE CODE TOOL CATEGORIES                      │
│                                                               │
│  FILE OPERATIONS        SEARCH/NAV         EXECUTION          │
│  ┌──────────────┐      ┌──────────┐      ┌──────────────┐    │
│  │ Read         │      │ Glob     │      │ Bash         │    │
│  │ Write        │      │ Grep     │      │ (shell cmds) │    │
│  │ Edit         │      │ LS       │      └──────────────┘    │
│  │ MultiEdit    │      └──────────┘                          │
│  └──────────────┘                        PLANNING            │
│                        WEB               ┌──────────────┐    │
│  AGENT MGMT            ┌──────────┐      │ TodoWrite    │    │
│  ┌──────────────┐      │ WebFetch │      │ (task lists) │    │
│  │ Task         │      │ WebSearch│      └──────────────┘    │
│  │ (sub-agents) │      └──────────┘                          │
│  └──────────────┘                                            │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

The design philosophy is that **Bash is the universal escape hatch**. Any tool that Claude Code doesn't have as a dedicated tool can be accomplished via shell commands. Need to run tests? `Bash("pytest")`. Need to check git status? `Bash("git status")`. Need to install a dependency? `Bash("npm install lodash")`. This keeps the tool set small while maintaining unlimited capability.

### Planning with TODO Lists

For complex tasks, Claude Code uses the `TodoWrite` tool to create and manage task lists. This serves as the agent's planning mechanism — an externalized form of working memory:

```
Claude Code's planning flow for a complex task:

1. Receive task: "Refactor the authentication module to use JWT"

2. Create TODO list:
   ┌────────────────────────────────────────────────┐
   │  TODO: Refactor auth to JWT                     │
   │                                                 │
   │  [in_progress] Audit current auth implementation│
   │  [pending]     Design JWT token structure        │
   │  [pending]     Implement JWT signing/verification│
   │  [pending]     Update middleware                 │
   │  [pending]     Update tests                     │
   │  [pending]     Run test suite                   │
   └────────────────────────────────────────────────┘

3. Work through items sequentially, updating status:
   ┌────────────────────────────────────────────────┐
   │  [completed]   Audit current auth implementation│
   │  [completed]   Design JWT token structure        │
   │  [in_progress] Implement JWT signing/verification│
   │  [pending]     Update middleware                 │
   │  [pending]     Update tests                     │
   │  [pending]     Run test suite                   │
   └────────────────────────────────────────────────┘
```

This planning pattern is significant because it provides:
- **Transparency**: The user can see what the agent is planning to do
- **Progress tracking**: The user can see what's done and what remains
- **Self-guidance**: The model can refer back to the plan to stay on track
- **Recovery**: If context is compacted, the TODO list preserves the plan

### Sub-Agents for Parallelism

Claude Code uses the `Task` tool to spawn sub-agents — independent Claude instances that work on isolated subtasks. This enables parallelism and prevents a single complex subtask from consuming the main agent's context:

```
┌───────────────────────────────────────────────────────┐
│                  MAIN AGENT                            │
│                                                        │
│  Goal: "Add dark mode support to the application"      │
│                                                        │
│  Plan:                                                 │
│  1. Analyze current theme system                       │
│  2. Create dark theme variables (delegate to sub-agent)│
│  3. Update components (delegate to sub-agent)          │
│  4. Add toggle mechanism                               │
│  5. Verify all components render correctly             │
│                                                        │
│  ┌──────────────┐            ┌──────────────┐          │
│  │  Sub-Agent 1 │            │  Sub-Agent 2 │          │
│  │              │            │              │          │
│  │  Create dark │            │  Update all  │          │
│  │  theme CSS   │            │  components  │          │
│  │  variables   │            │  to use theme│          │
│  │              │            │  variables   │          │
│  │  (isolated   │            │  (isolated   │          │
│  │   context)   │            │   context)   │          │
│  └──────┬───────┘            └──────┬───────┘          │
│         │                           │                  │
│         └─────── results ───────────┘                  │
│                     │                                  │
│                     ▼                                  │
│         Main agent continues with                      │
│         sub-agent results in context                   │
└───────────────────────────────────────────────────────┘
```

Sub-agents are particularly valuable for:
- **Context isolation**: Each sub-agent has its own context window, preventing context overflow
- **Parallel execution**: Multiple sub-agents can potentially run concurrently
- **Failure containment**: If a sub-agent fails, it doesn't corrupt the main agent's state
- **Specialization**: Sub-agents can be given focused instructions for specific subtasks

---

## 2.4 How Cursor Implements the Loop

Cursor represents a different architectural philosophy from Claude Code and Codex. While those systems are primarily terminal/CLI-based, Cursor is an IDE — a fork of VS Code — that integrates agent capabilities directly into the editor.

### Layered ReAct Architecture

Cursor implements what can be described as a **layered ReAct architecture**, where different layers of the system contribute to the agent's observe-think-act loop:

```
┌────────────────────────────────────────────────────────────┐
│                 CURSOR ARCHITECTURE                         │
│                                                             │
│  ┌────────────────────────────────────────────────────┐     │
│  │                   IDE LAYER                         │     │
│  │  ├── VS Code Extension Host                        │     │
│  │  ├── Language Server Protocol (LSP)                 │     │
│  │  ├── Abstract Syntax Tree (AST) services            │     │
│  │  ├── Git integration                               │     │
│  │  └── Terminal emulator                              │     │
│  └──────────────────────┬─────────────────────────────┘     │
│                         │                                    │
│  ┌──────────────────────▼─────────────────────────────┐     │
│  │              CONTEXT ENGINE                         │     │
│  │  ├── Codebase indexing (embeddings)                 │     │
│  │  ├── AST-grounded context selection                 │     │
│  │  ├── Recently edited files tracking                 │     │
│  │  ├── Linter/compiler error feeds                    │     │
│  │  └── @-mention resolution                           │     │
│  └──────────────────────┬─────────────────────────────┘     │
│                         │                                    │
│  ┌──────────────────────▼─────────────────────────────┐     │
│  │                AGENT CORE                           │     │
│  │  ├── Composer model (fast, ~250 tok/s)              │     │
│  │  ├── ReAct loop with tool calls                     │     │
│  │  ├── Speculative edits and apply model              │     │
│  │  └── Multi-file coordination                        │     │
│  └──────────────────────┬─────────────────────────────┘     │
│                         │                                    │
│  ┌──────────────────────▼─────────────────────────────┐     │
│  │             EXECUTION LAYER                         │     │
│  │  ├── File system operations                         │     │
│  │  ├── Terminal command execution                      │     │
│  │  ├── Worktrees for isolation (Cloud Agent)          │     │
│  │  └── Git operations                                 │     │
│  └────────────────────────────────────────────────────┘     │
│                                                             │
└────────────────────────────────────────────────────────────┘
```

### AST-Grounded Context

One of Cursor's distinguishing features is **AST-grounded context** — using the Abstract Syntax Tree of the codebase to provide structurally relevant context to the model:

```
Traditional context selection:
  "Here are the 10 most recently edited files"     ← May include irrelevant files
  "Here are files matching your search query"       ← May miss structural dependencies

AST-grounded context selection:
  "Here is the function you're editing,
   its callers, its callees,
   the types it references,
   and the tests that cover it"                     ← Structurally precise
```

When a user asks Cursor to modify a function, the context engine doesn't just include the file — it traverses the AST to find:
- The function's signature and body
- All call sites (where the function is called from)
- Type definitions referenced by the function
- Import statements and module dependencies
- Related test files

This produces context that is both more relevant and more compact than keyword-based or embedding-based retrieval alone.

### Speculative Edits and the Apply Model

Cursor uses a technique called **speculative edits** to achieve high-speed code modifications. The Composer model (a fast model generating ~250 tokens/second) produces edit instructions, and a separate "apply model" translates these instructions into precise file modifications:

```
┌─────────────────────────────────────────────────────────┐
│              SPECULATIVE EDIT PIPELINE                    │
│                                                          │
│  User request: "Add input validation to the signup form" │
│                                                          │
│  Step 1: Composer Model (fast, ~250 tok/s)               │
│  ┌──────────────────────────────────────────┐            │
│  │  "In signup.tsx, add validation to the   │            │
│  │   email field using zod schema. Add      │            │
│  │   error display below each field..."     │            │
│  └──────────────────┬───────────────────────┘            │
│                     │                                    │
│  Step 2: Apply Model (specialized for diffs)             │
│  ┌──────────────────▼───────────────────────┐            │
│  │  --- a/src/signup.tsx                     │            │
│  │  +++ b/src/signup.tsx                     │            │
│  │  @@ -15,6 +15,12 @@                      │            │
│  │  +import { z } from 'zod';               │            │
│  │  +const signupSchema = z.object({        │            │
│  │  +  email: z.string().email(),           │            │
│  │  +  password: z.string().min(8),         │            │
│  │  +});                                    │            │
│  │   ...                                    │            │
│  └──────────────────────────────────────────┘            │
│                                                          │
│  Step 3: Apply diff to file, show inline preview         │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### Worktrees for Isolation (Cloud Agent)

Cursor Cloud Agent uses **git worktrees** to provide isolated execution environments for background agent tasks:

```
Main working tree (user's active work):
  /workspace/
  ├── src/
  ├── package.json
  └── .git/

Agent worktree (isolated branch):
  /workspace/.worktrees/agent-task-abc123/
  ├── src/          (separate working copy)
  ├── package.json
  └── (linked to same .git)

Benefits:
  ✓ Agent changes don't interfere with user's work
  ✓ Agent can commit, branch, and push independently
  ✓ Multiple agents can work on different tasks simultaneously
  ✓ User can review agent's changes via PR
```

This worktree-based isolation enables the L4 autonomy that defines Cursor Cloud Agent — the agent runs completely in the background, making changes on a separate branch that the user can review and merge through the normal PR workflow.

---

## 2.5 Comparing Single-Turn vs Multi-Turn vs Long-Horizon Agent Loops

Agent loops vary dramatically in their complexity and the challenges they face, depending on the horizon of the task:

### Single-Turn (1-5 tool calls)

```
User: "What's in config.yaml?"
Agent: [reads file] → [returns contents]

Characteristics:
  - 1-5 tool calls
  - Fits entirely in one context window
  - No planning needed
  - No state management concerns
  - Failure mode: tool call errors (easy to handle)
```

### Multi-Turn (5-30 tool calls)

```
User: "Fix the bug where users can't log in after password reset"
Agent: [search codebase] → [read auth handler] → [read password reset flow]
     → [identify bug] → [edit file] → [run tests] → [fix test] → [run tests]
     → [commit]

Characteristics:
  - 5-30 tool calls
  - May approach context window limits
  - Simple planning (implicit or via TODO list)
  - Some state management needed (tracking what's been tried)
  - Failure mode: losing track of approach, context overflow
```

### Long-Horizon (30-200+ tool calls)

```
User: "Migrate the authentication system from session-based to JWT"
Agent: [extensive codebase analysis over 50+ files]
     → [create migration plan with 12 TODO items]
     → [implement JWT utilities] → [test] → [debug]
     → [update middleware] → [test] → [fix integration issues]
     → [update all route handlers] → [test] → [fix regressions]
     → [update client-side auth] → [test]
     → [update database schema] → [run migrations]
     → [comprehensive integration testing]
     → [fix edge cases found in testing]
     → [update documentation]
     → [final test suite run]
     → [commit and push]

Characteristics:
  - 30-200+ tool calls
  - Guaranteed to exceed context window (compaction required)
  - Explicit planning essential (TODO lists, sub-agents)
  - Complex state management (what's done, what's pending, what failed)
  - Failure modes: plan drift, context rot, cascading errors,
    lost progress after compaction, incorrect assumptions persisting
```

The challenges scale non-linearly with horizon length:

```
Challenge Severity vs. Task Horizon

Severity
  ▲
  │                                          ╱ Context rot
  │                                        ╱
  │                                      ╱
  │                               ╱────╱ Plan drift
  │                         ╱───╱
  │                   ╱───╱
  │             ╱───╱              ╱──── Error cascading
  │        ╱──╱              ╱──╱
  │   ╱──╱             ╱──╱
  │ ╱            ╱───╱
  │╱       ╱───╱
  ├──────╱─────────────────────────────────► Horizon (tool calls)
  0     5      15      30      50     100    200+
      single   multi-turn     long-horizon
```

---

## 2.6 Session Management and Conversation State

Managing state across agent sessions is a critical engineering challenge. There are three fundamental approaches:

### Approach 1: Ephemeral State (Stateless Sessions)

Each session starts fresh. All necessary context is reconstructed from the environment (file system, git history, documentation).

```python
class EphemeralAgent:
    """Each session is independent. No persistent memory."""

    def start_session(self, user_input: str):
        # Context comes entirely from the environment
        context = self.gather_context_from_environment()
        messages = [
            {"role": "system", "content": self.system_prompt},
            {"role": "user", "content": user_input},
        ]
        return self.run_loop(messages)

    def gather_context_from_environment(self):
        """Read files, check git status, scan project structure."""
        return {
            "project_structure": scan_directory_tree(),
            "recent_changes": git_log(n=10),
            "open_issues": get_open_issues(),
            "readme": read_file("README.md"),
        }
```

**Pros:** Simple, no state corruption, every session is fresh.
**Cons:** No memory of past sessions, must re-discover context every time.
**Used by:** Claude Code (each session is independent), Cursor (each agent request starts fresh).

### Approach 2: Persistent Conversation State

The full conversation history is stored and loaded in subsequent sessions.

```python
class PersistentAgent:
    """Conversation state persists across sessions."""

    def __init__(self, session_id: str):
        self.session_id = session_id
        self.messages = self.load_state(session_id) or []

    def continue_session(self, user_input: str):
        self.messages.append({"role": "user", "content": user_input})
        result = self.run_loop(self.messages)
        self.save_state(self.session_id, self.messages)
        return result

    def save_state(self, session_id, messages):
        storage.put(f"sessions/{session_id}", json.dumps(messages))

    def load_state(self, session_id):
        data = storage.get(f"sessions/{session_id}")
        return json.loads(data) if data else None
```

**Pros:** Continuity across sessions, can resume complex tasks.
**Cons:** Context grows unboundedly, stale context accumulates, requires compaction.
**Used by:** ChatGPT (persistent conversations), some Codex workflows.

### Approach 3: Hybrid — Ephemeral Sessions with Persistent Memory

Each session is ephemeral, but key information is persisted in a structured memory layer that can be queried in future sessions.

```python
class HybridAgent:
    """Fresh sessions with persistent memory layer."""

    def __init__(self):
        self.memory = MemoryStore()  # Persistent key-value or vector store

    def start_session(self, user_input: str):
        # Retrieve relevant memories
        relevant_memories = self.memory.query(user_input, top_k=10)

        messages = [
            {"role": "system", "content": self.system_prompt},
            {"role": "system", "content": format_memories(relevant_memories)},
            {"role": "user", "content": user_input},
        ]

        result = self.run_loop(messages)

        # Store important learnings from this session
        self.memory.store(
            extract_key_learnings(self.messages),
            metadata={"timestamp": now(), "task": user_input}
        )

        return result
```

**Pros:** Fresh context per session, but learns over time.
**Cons:** Complexity of memory management, risk of storing incorrect information.
**Used by:** Claude Code with CLAUDE.md files (project memory), Cursor with AGENTS.md (agent instructions), various custom agent implementations.

The CLAUDE.md and AGENTS.md patterns are a particularly elegant form of persistent memory — they store memories as human-readable markdown files *in the repository itself*, making them version-controlled, reviewable, and accessible to both humans and agents:

```
# CLAUDE.md (persistent agent memory in the repository)

## Project Context
- This is a Next.js 14 app with App Router
- We use Prisma for ORM, PostgreSQL for the database
- Authentication is handled by NextAuth.js v5

## Coding Conventions
- Use server components by default, client components only when needed
- All API routes should validate input with zod
- Tests use Vitest, not Jest

## Known Issues
- The WebSocket connection sometimes drops on Vercel deployment
- Don't modify the legacy billing module without checking with the team
```

---

## 2.7 When to Stop: Termination Conditions and Convergence Detection

Knowing when to stop is one of the hardest problems in agent design. An agent that stops too early leaves tasks incomplete. An agent that stops too late wastes tokens, accumulates errors, and may even undo its own good work through over-iteration.

### Termination Signals

Production agents typically use a combination of these signals:

**1. Model-initiated termination (primary signal):**
The model generates a response without any tool calls, indicating it believes the task is complete. This is the `stop_reason == "end_turn"` check.

```python
# Primary termination: model decides it's done
if response.stop_reason == "end_turn":
    return response.content  # Task complete
```

**2. Hard limits (safety net):**
Maximum turn counts, token budgets, or wall-clock timeouts that prevent runaway execution.

```python
MAX_TURNS = 200
MAX_TOKENS_SPENT = 1_000_000
MAX_WALL_TIME = timedelta(minutes=30)

for turn in range(MAX_TURNS):
    if total_tokens_spent > MAX_TOKENS_SPENT:
        return "Token budget exceeded. Partial results: ..."
    if datetime.now() - start_time > MAX_WALL_TIME:
        return "Time limit exceeded. Partial results: ..."
    # ... run loop iteration
```

**3. Convergence detection:**
Detecting that the agent is making no meaningful progress — repeating the same actions, oscillating between states, or producing diminishing returns.

```python
class ConvergenceDetector:
    def __init__(self, window_size: int = 5):
        self.recent_actions = deque(maxlen=window_size)

    def is_converged(self, action: str) -> bool:
        self.recent_actions.append(action)

        # Detect exact repetition
        if len(self.recent_actions) >= 3:
            if len(set(list(self.recent_actions)[-3:])) == 1:
                return True  # Same action 3 times in a row

        # Detect oscillation (A → B → A → B)
        if len(self.recent_actions) >= 4:
            actions = list(self.recent_actions)
            if actions[-1] == actions[-3] and actions[-2] == actions[-4]:
                return True  # Oscillating between two actions

        return False
```

**4. Verification-based termination:**
The agent actively verifies that its work is complete before stopping. This is distinct from the model simply deciding to stop — it involves running tests, checking outputs, or reviewing changes.

```python
# Verification loop before final termination
def verify_and_terminate(self):
    # Run the test suite
    test_result = self.execute_tool("bash", {"command": "npm test"})
    if "FAIL" in test_result:
        return False  # Not done, tests are failing

    # Check for linting errors
    lint_result = self.execute_tool("bash", {"command": "npm run lint"})
    if "error" in lint_result.lower():
        return False  # Not done, lint errors remain

    # Review the diff
    diff = self.execute_tool("bash", {"command": "git diff"})
    # Let the model review its own changes
    review = self.ask_model(
        f"Review this diff. Does it correctly address the original task?\n{diff}"
    )
    if "no" in review.lower() or "issue" in review.lower():
        return False  # Model's self-review found issues

    return True  # All checks pass
```

### The Verification Pattern

Production agents almost universally implement a **verify-before-terminate** pattern. Claude Code's documented workflow is explicitly: Gather Context → Take Action → **Verify** → Repeat. The verification step is what separates robust agents from brittle ones.

```
┌────────────────────────────────────────────────────────┐
│           VERIFICATION-BASED TERMINATION                │
│                                                         │
│    Task: "Fix the broken API endpoint"                  │
│                                                         │
│    [... agent works through the fix ...]                │
│                                                         │
│    Before stopping:                                     │
│    ┌─────────────────────────────────────────┐          │
│    │  ✓ Run affected test suite              │          │
│    │  ✓ Run linter on modified files         │          │
│    │  ✓ Manually test the endpoint (curl)    │          │
│    │  ✓ Review diff for unintended changes   │          │
│    │  ✓ Check for TODO items left incomplete │          │
│    └─────────────────────────────────────────┘          │
│                                                         │
│    All pass? → Terminate and report                     │
│    Any fail? → Continue loop                            │
│                                                         │
└────────────────────────────────────────────────────────┘
```

### Anti-Patterns in Termination

Several common anti-patterns cause agents to terminate incorrectly:

**Premature termination (stopping too early):**
- Agent declares success without running tests
- Agent claims it can't do something when it hasn't tried all approaches
- Agent stops after writing code without verifying it compiles

**Runaway execution (stopping too late):**
- Agent enters an infinite debug loop, trying the same fix repeatedly
- Agent gold-plates a solution, adding unnecessary features beyond the task
- Agent oscillates between two approaches without committing to either

**False convergence:**
- Tests pass but the code change doesn't actually address the original issue
- Agent fixates on a secondary issue and loses track of the primary task
- Lint passes on modified files but agent introduced issues in files it didn't check

The best production agents mitigate these through a combination of hard limits, self-verification, and explicit planning (TODO lists) that make it clear when all planned work is complete.

---

# Chapter 3: The Rise of Context Engineering

## 3.1 From Prompt Engineering to Context Engineering

In 2024, Andrej Karpathy articulated a shift that many practitioners had been feeling but hadn't named. In a widely-discussed post, he observed that the practice of getting good results from LLMs had evolved beyond "prompt engineering" into something broader: **context engineering**.

> "I've been thinking about the evolution of prompt engineering. It started with crafting clever prompts, but what we actually do now is much more — we curate the entire information environment that the model operates in. I'd call it context engineering."

The distinction matters because it changes what you optimize for. Prompt engineering focuses on the *phrasing* of instructions — word choice, format specifications, chain-of-thought triggers. Context engineering focuses on the *entire input* to the model — what information is present, how it's structured, what's omitted, and how it changes over time.

For agents, this distinction is critical. A chatbot's context is relatively static: a system prompt plus the conversation so far. An agent's context is dynamic, heterogeneous, and constantly changing:

```
┌────────────────────────────────────────────────────────────┐
│              CHATBOT CONTEXT (mostly static)                 │
│                                                             │
│  ┌──────────────────────────────────────────────────┐       │
│  │  System Prompt: "You are a helpful assistant..."  │       │
│  ├──────────────────────────────────────────────────┤       │
│  │  User: "How do I sort a list in Python?"         │       │
│  ├──────────────────────────────────────────────────┤       │
│  │  Assistant: "You can use sorted()..."            │       │
│  ├──────────────────────────────────────────────────┤       │
│  │  User: "What about in reverse order?"            │       │
│  └──────────────────────────────────────────────────┘       │
│                                                             │
│  Total: ~500 tokens, mostly conversation text               │
└────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────┐
│              AGENT CONTEXT (dynamic, heterogeneous)          │
│                                                             │
│  ┌──────────────────────────────────────────────────┐       │
│  │  System Instructions (behavioral rules, persona)  │       │
│  ├──────────────────────────────────────────────────┤       │
│  │  Tool Schemas (14-20 tool definitions w/ params)  │       │
│  ├──────────────────────────────────────────────────┤       │
│  │  Project Memory (AGENTS.md, CLAUDE.md)            │       │
│  ├──────────────────────────────────────────────────┤       │
│  │  Retrieved Context (RAG results, file contents)   │       │
│  ├──────────────────────────────────────────────────┤       │
│  │  Conversation History                             │       │
│  │  ├── User goal                                   │       │
│  │  ├── Assistant reasoning + tool calls (turn 1)   │       │
│  │  ├── Tool results (file contents, 2KB)           │       │
│  │  ├── Assistant reasoning + tool calls (turn 2)   │       │
│  │  ├── Tool results (test output, 5KB)             │       │
│  │  ├── Assistant reasoning + tool calls (turn 3)   │       │
│  │  ├── Tool results (error logs, 3KB)              │       │
│  │  ├── ... (20+ more turns)                        │       │
│  │  └── Assistant reasoning + tool calls (turn 25)  │       │
│  ├──────────────────────────────────────────────────┤       │
│  │  Current Working State                            │       │
│  │  ├── TODO list                                   │       │
│  │  ├── Current file being edited                   │       │
│  │  └── Recent errors/warnings                      │       │
│  └──────────────────────────────────────────────────┘       │
│                                                             │
│  Total: 50,000-200,000 tokens, constantly changing          │
└────────────────────────────────────────────────────────────┘
```

Context engineering for agents is the discipline of managing this dynamic, heterogeneous context so that the model has the right information at the right time. It is the single most important factor in agent performance.

---

## 3.2 The Context Stack

The context presented to an agent model at each inference step can be modeled as a **stack** of layers, each serving a different function:

```
┌────────────────────────────────────────────────────┐
│                  THE CONTEXT STACK                   │
│                                                     │
│  ┌──────────────────────────────────────────────┐   │
│  │  Layer 6: CURRENT TASK                        │   │
│  │  The immediate instruction or tool result     │   │
│  │  that the model must respond to               │   │ Most
│  ├──────────────────────────────────────────────┤   │ Volatile
│  │  Layer 5: CONVERSATION HISTORY                │   │
│  │  The sequence of user messages, assistant     │   │   │
│  │  responses, tool calls, and tool results      │   │   │
│  ├──────────────────────────────────────────────┤   │   │
│  │  Layer 4: RETRIEVED CONTEXT (RAG)             │   │   │
│  │  Dynamically retrieved documents, code        │   │   │
│  │  snippets, documentation, search results      │   │   │
│  ├──────────────────────────────────────────────┤   │   │
│  │  Layer 3: TOOL SCHEMAS                        │   │   ▼
│  │  JSON schemas defining available tools,       │   │
│  │  their parameters, and descriptions           │   │ Least
│  ├──────────────────────────────────────────────┤   │ Volatile
│  │  Layer 2: MEMORY                              │   │
│  │  Project memory (AGENTS.md), user prefs,      │   │
│  │  learned patterns, past session summaries     │   │
│  ├──────────────────────────────────────────────┤   │
│  │  Layer 1: SYSTEM INSTRUCTIONS                 │   │
│  │  Behavioral rules, persona, safety            │   │
│  │  constraints, output format specifications    │   │
│  └──────────────────────────────────────────────┘   │
│                                                     │
└────────────────────────────────────────────────────┘
```

Each layer has different characteristics:

| Layer | Volatility | Size | Cache-Friendly | Source |
|---|---|---|---|---|
| System Instructions | Very low (changes across deploys) | 1-5K tokens | Yes (almost always cached) | Developer-authored |
| Memory | Low (changes across sessions) | 0.5-5K tokens | Yes (stable prefix) | Agent-maintained + human-edited |
| Tool Schemas | Very low (changes across deploys) | 2-10K tokens | Yes (stable prefix) | Developer-authored |
| Retrieved Context | Medium (changes per query) | 1-20K tokens | Partially | RAG pipeline |
| Conversation History | High (grows each turn) | 5-100K+ tokens | Partially (prefix cacheable) | Accumulated during session |
| Current Task | Very high (changes each turn) | 0.1-10K tokens | No | Tool results, user input |

The art of context engineering is arranging these layers optimally. The general principle is: **stable content first, volatile content last**. This maximizes cache hit rates (a critical optimization we'll discuss in Section 3.4) and ensures the model's attention is focused on the most relevant, recent information.

### Layer 1: System Instructions

System instructions define the agent's behavior, capabilities, and constraints. They are the most stable layer and should be designed for longevity:

```python
SYSTEM_INSTRUCTIONS = """
You are an autonomous coding agent. You have access to tools for
reading files, writing files, executing shell commands, and searching
the codebase.

## Behavioral Rules
1. Always read a file before editing it.
2. Run tests after making changes.
3. Never modify files outside the project directory.
4. If you're unsure about a change, explain your uncertainty.

## Output Format
- Use markdown for structured responses.
- Include file paths when referencing code.
- Summarize changes at the end of each task.

## Safety Constraints
- Do not execute commands that modify system configuration.
- Do not access network resources unless explicitly needed.
- Do not delete files unless explicitly asked.
"""
```

### Layer 2: Memory

Memory provides cross-session continuity. The CLAUDE.md / AGENTS.md pattern is the most common implementation:

```python
def load_memory(project_root: str) -> str:
    """Load project memory from conventional file locations."""
    memory_sources = [
        os.path.join(project_root, "AGENTS.md"),
        os.path.join(project_root, "CLAUDE.md"),
        os.path.join(project_root, ".cursor", "rules"),
    ]

    memory = []
    for source in memory_sources:
        if os.path.exists(source):
            content = open(source).read()
            memory.append(f"## Memory from {os.path.basename(source)}\n{content}")

    return "\n\n".join(memory) if memory else ""
```

### Layer 3: Tool Schemas

Tool schemas define the agent's action space. They must be precise enough for the model to use correctly, but concise enough to not waste context:

```python
TOOL_SCHEMAS = [
    {
        "name": "read_file",
        "description": "Read the contents of a file at the given path. Returns the file content as a string with line numbers.",
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Absolute or relative path to the file"
                },
                "offset": {
                    "type": "integer",
                    "description": "Line number to start reading from (1-indexed). Optional."
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximum number of lines to read. Optional."
                }
            },
            "required": ["path"]
        }
    },
    # ... additional tool schemas
]
```

### Layer 4: Retrieved Context (RAG)

For agents operating on large codebases, retrieved context bridges the gap between the model's parametric knowledge and the specific codebase:

```python
def retrieve_context(query: str, codebase_index) -> str:
    """Retrieve relevant code snippets and documentation."""
    # Embedding-based retrieval
    results = codebase_index.search(query, top_k=10)

    # Re-rank by relevance
    reranked = reranker.rerank(query, results)

    # Format for inclusion in context
    context_parts = []
    for result in reranked[:5]:
        context_parts.append(
            f"## {result.file_path}\n```\n{result.content}\n```"
        )

    return "\n\n".join(context_parts)
```

### Layers 5 and 6: Conversation History and Current Task

These are the most volatile layers and the source of most context engineering challenges. As the conversation grows, these layers dominate the context window and require active management (compaction, pruning, summarization).

---

## 3.3 Context Rot: Why Performance Degrades with Context Length

**Context rot** is the phenomenon where agent performance degrades as the conversation history grows, even when the context window isn't technically full. It manifests as:

- The agent "forgets" earlier instructions or constraints
- The agent repeats actions it already took
- The agent contradicts its earlier reasoning
- The agent becomes less accurate in tool use
- The agent loses track of the overall plan

Context rot occurs for several interconnected reasons:

### Reason 1: Attention Dilution

Transformer attention is a finite resource. As context length increases, the model must distribute attention across more tokens. Important information from early in the context receives proportionally less attention:

```
Attention distribution with short context (2K tokens):
┌────────────────────────────────────────────────────┐
│████████████████████████████████████████████████████ │  System instructions
│████████████████████████████████████████████████████ │  User goal
│████████████████████████████████████████████████████ │  Recent context
└────────────────────────────────────────────────────┘
  (All parts receive strong attention)

Attention distribution with long context (100K tokens):
┌────────────────────────────────────────────────────┐
│███░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │  System instructions
│██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │  User goal (turn 1)
│░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │  Early tool results
│░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │  Middle context
│█████████████████████████████████████████████████░░░ │  Recent tool results
│████████████████████████████████████████████████████ │  Most recent context
└────────────────────────────────────────────────────┘
  (Early and middle sections get much less attention)
```

While modern models with long context windows (128K-200K tokens) can technically process large contexts, there is a well-documented "lost in the middle" effect where information in the middle of long contexts is retrieved less reliably than information at the beginning or end.

### Reason 2: Noise Accumulation

Every tool call adds tokens to the context. Many of these tokens are noise — verbose command outputs, irrelevant file contents, error messages from failed attempts. Over time, the signal-to-noise ratio degrades:

```
Turn  1: Signal/Noise = 95%  (user goal + system prompt)
Turn  5: Signal/Noise = 80%  (some tool outputs are verbose)
Turn 15: Signal/Noise = 50%  (many tool results, some obsolete)
Turn 30: Signal/Noise = 25%  (context full of old results, failed attempts)
Turn 50: Signal/Noise = 10%  (mostly accumulated noise)
```

### Reason 3: Stale Information

In a coding agent, the agent modifies files during execution. If an early context turn contains the original version of a file, and the agent has since modified that file three times, the original version is stale information that can confuse the model. But it still occupies tokens and can still influence the model's reasoning.

### Reason 4: Conflicting Signals

As an agent tries different approaches — especially when debugging — the context accumulates conflicting signals. The model may have reasoned "the bug is in the auth middleware" in turn 5, then "actually the bug is in the database layer" in turn 12, then "wait, it might be in the auth middleware after all" in turn 20. All three of these reasoning traces remain in context, creating ambiguity about what the model currently believes.

### Mitigating Context Rot

Production agents use several strategies to combat context rot:

```
┌───────────────────────────────────────────────────────────┐
│            CONTEXT ROT MITIGATION STRATEGIES               │
│                                                            │
│  Strategy              When Applied         Effect          │
│  ─────────────────────────────────────────────────────────  │
│  Tool output           On each tool result  Prevents noise  │
│  truncation                                 accumulation    │
│                                                            │
│  History               When context exceeds Reduces stale   │
│  compaction            threshold            information     │
│                                                            │
│  Explicit              After each sub-task  Maintains plan  │
│  plan anchoring                             coherence       │
│  (TODO lists)                                              │
│                                                            │
│  Sub-agent             For independent      Prevents cross- │
│  isolation             subtasks             contamination   │
│                                                            │
│  Context               On each turn         Ensures key     │
│  rewriting                                  info is fresh   │
│                                                            │
│  System prompt         Every turn           Anchors         │
│  repetition                                 behavior        │
│                                                            │
└───────────────────────────────────────────────────────────┘
```

---

## 3.4 Manus AI's "Stochastic Graduate Descent" and KV-Cache Optimization

In early 2025, Manus AI — the Chinese AI startup that built one of the most widely-used general-purpose agent platforms — shared insights about their context engineering approach that sent ripples through the agent-building community. Their key revelation: **KV-cache hit rate is the single most important metric for production agent performance and cost.**

### Understanding the KV-Cache

The KV-cache (Key-Value cache) is a fundamental optimization in transformer inference. When a model processes a sequence of tokens, it computes attention keys and values for each token. If the same prefix of tokens appears in subsequent requests, these keys and values can be cached and reused, avoiding redundant computation:

```
Request 1: [System prompt | User message | Tool schemas]
            └──────── computed from scratch ──────────┘

Request 2: [System prompt | User message | Tool schemas | Assistant turn 1 | Tool result 1]
            └──────── cached (KV-cache hit) ──────────┘  └── computed ──────────────────┘

Request 3: [System prompt | User message | Tool schemas | Assistant turn 1 | Tool result 1 | Assistant turn 2 | Tool result 2]
            └──────── cached (KV-cache hit) ──────────────────────────────────────────────┘  └── computed ──────────────────┘
```

Each successive turn in an agent loop only needs to compute attention for the *new* tokens. The prefix is cached. This means that **if you don't modify the prefix, each agent loop iteration only costs proportional to the new tokens, not the full context.**

### Manus's Insight: Append-Only Contexts

Manus structured their agent contexts to be **append-only** — new information is always appended to the end, and earlier parts of the context are never modified. This maximizes KV-cache hit rates:

```
┌────────────────────────────────────────────────────────────┐
│              APPEND-ONLY CONTEXT STRATEGY                    │
│                                                             │
│  WRONG: Modify context on each turn (cache invalidation)    │
│  ┌──────────────────────────────────────────────┐           │
│  │  [System] [User] [History - MODIFIED] [New]  │           │
│  │                    ▲                          │           │
│  │                    │ Rewriting history         │           │
│  │                    │ invalidates cache         │           │
│  └──────────────────────────────────────────────┘           │
│                                                             │
│  RIGHT: Only append new content (cache preserved)           │
│  ┌──────────────────────────────────────────────┐           │
│  │  [System] [User] [History - UNCHANGED] [New] │           │
│  │  └─────── cached (KV-cache hit) ──────┘      │           │
│  └──────────────────────────────────────────────┘           │
│                                                             │
└────────────────────────────────────────────────────────────┘
```

This has profound implications for agent architecture:

1. **Never rewrite conversation history.** Older messages should never be modified in place. If information needs to be corrected, append a correction rather than editing the original.

2. **System prompts must be a stable prefix.** The system prompt should not change between turns. Any dynamic information should be appended after the static system prompt, or placed in later context layers.

3. **Tool schemas should be stable.** Don't dynamically change the tool list between turns unless absolutely necessary, as this invalidates the cache.

### The 100:1 Input/Output Ratio

Manus revealed that their agent sessions have approximately a **100:1 ratio of input tokens to output tokens**. This means that for every token the model generates, it processes 100 tokens of context. This ratio makes cache optimization extraordinarily impactful:

```
Without cache optimization:
  Average turn: 50,000 input tokens × $3/M = $0.15 per turn
  50 turns per session = $7.50 per session

With cache optimization (90% cache hit rate):
  Average turn: 5,000 new tokens × $3/M + 45,000 cached tokens × $0.30/M
              = $0.015 + $0.0135 = $0.0285 per turn
  50 turns per session = $1.43 per session

  Savings: ~80% cost reduction
```

(Note: Pricing is illustrative. Actual rates vary by provider and model. Anthropic, for example, offers cached input tokens at a 90% discount compared to uncached tokens.)

### "Stochastic Graduate Descent"

Manus coined the whimsical term "Stochastic Graduate Descent" (a play on Stochastic Gradient Descent) to describe their approach to iteratively refining agent behavior through context engineering. The analogy: just as SGD iteratively adjusts model weights to minimize loss, their team iteratively adjusts context structure to maximize cache hits and minimize token waste.

The principles they articulated:

1. **Treat KV-cache hit rate as your loss function.** Measure it. Optimize for it. Every context design decision should be evaluated against its impact on cache hit rate.

2. **Stable prefixes are your foundation.** System prompts, tool schemas, and project memory should form a stable prefix that is cached across all turns.

3. **Append, don't rewrite.** New information goes at the end. Old information stays where it is.

4. **Compress when necessary, but at natural boundaries.** When compaction is needed, do it at turn boundaries (removing complete turns) rather than within turns (modifying messages), to keep the remaining prefix intact.

5. **Design tools to produce compact output.** A tool that returns 10KB of output when 200 bytes would suffice is wasting cache-invalidating tokens on every subsequent turn.

### Practical Implementation

```python
class CacheOptimizedAgent:
    """Agent designed for maximum KV-cache hit rate."""

    def __init__(self):
        # Layer 1: Stable prefix (cached across all turns)
        self.system_prompt = STATIC_SYSTEM_PROMPT  # Never changes
        self.tool_schemas = STATIC_TOOL_SCHEMAS    # Never changes
        self.project_memory = load_memory()         # Changes rarely

        # Layer 2: Conversation history (append-only)
        self.messages = []

    def run_turn(self, new_input):
        self.messages.append({"role": "user", "content": new_input})

        response = self.client.messages.create(
            model="claude-sonnet-4-20250514",
            system=self.system_prompt,       # Stable prefix
            tools=self.tool_schemas,          # Stable prefix
            messages=self.messages,           # Append-only growth
        )

        # Append response (never modify earlier messages)
        self.messages.append({
            "role": "assistant",
            "content": response.content
        })

        return response

    def compact_if_needed(self, max_tokens: int):
        """Compact by removing complete early turns, preserving prefix."""
        if self.count_tokens() <= max_tokens:
            return

        # Remove oldest complete turns (preserving first user message)
        first_message = self.messages[0]
        remaining = self.messages[1:]

        # Remove turns in pairs (assistant + next user) from the start
        while self.count_tokens() > max_tokens and len(remaining) > 4:
            # Create a summary of what's being removed
            removed_turn = remaining[:2]
            summary = self.summarize_turn(removed_turn)

            # Replace with compact summary
            remaining = [{"role": "user", "content": f"[Earlier: {summary}]"}] + remaining[2:]

        self.messages = [first_message] + remaining
```

---

## 3.5 Anthropic's Four Operations of Context Engineering

In their 2025 blog post on context engineering, Anthropic's team articulated a framework for thinking about context management as four fundamental operations: **Write, Select, Compress, and Isolate.**

### Operation 1: Write

**Writing** is the operation of adding new information to the context. Every tool result, every user message, every system instruction is a write operation. The key insight is that writes should be deliberate — not everything observed should be written into context.

```python
# Naive write: dump everything into context
def naive_tool_execution(tool_call):
    result = execute(tool_call)
    return str(result)  # Could be 50KB of raw output

# Deliberate write: curate what enters context
def curated_tool_execution(tool_call):
    result = execute(tool_call)

    # Truncate oversized outputs
    if len(str(result)) > MAX_TOOL_OUTPUT:
        result = truncate_with_summary(result, MAX_TOOL_OUTPUT)

    # Extract relevant sections from structured output
    if tool_call.name == "bash":
        result = extract_relevant_output(result, tool_call.input["command"])

    # Add metadata that helps the model interpret the result
    return format_tool_result(result, tool_call)
```

Anthropic's guidance emphasizes that the write operation is where you set the quality ceiling for the entire agent. If irrelevant or noisy information enters the context, no amount of downstream processing can fully recover. The principle: **write the smallest representation of information that preserves the model's ability to reason correctly.**

### Operation 2: Select

**Selection** is choosing which existing information to include in the model's current context. In RAG systems, this is the retrieval step. In agent systems, it also includes decisions about which parts of the conversation history to include.

```python
def select_context(current_task, full_history, codebase_index):
    """Select the most relevant context for the current inference step."""

    selected = []

    # Always include: system instructions, tool schemas (stable prefix)
    # (These are handled at the API level, not in message selection)

    # Select relevant code context via RAG
    relevant_code = codebase_index.search(
        current_task,
        top_k=5,
        filters={"modified_recently": True}  # Prefer recently edited files
    )
    selected.extend(relevant_code)

    # Select relevant history turns
    # Keep: first turn (original goal), last N turns (recent context)
    # Selectively include: middle turns with important decisions/errors
    important_middle_turns = identify_important_turns(full_history)
    selected_history = (
        [full_history[0]] +          # Original goal
        important_middle_turns +       # Key decisions
        full_history[-6:]              # Recent context
    )

    return selected_history, relevant_code
```

Anthropic describes the goal as "finding the smallest set of relevant context for your agent." This is a search problem — finding the minimal context that preserves the model's ability to complete the task. Too little context and the model lacks necessary information. Too much context and the model's attention is diluted (context rot).

### Operation 3: Compress

**Compression** reduces the token count of context without losing critical information. This includes summarization, truncation, and structural compression.

```python
class ContextCompressor:
    """Strategies for compressing agent context."""

    def summarize_turns(self, turns: list[dict]) -> str:
        """Use the LLM itself to summarize older conversation turns."""
        summary_prompt = f"""Summarize the following agent interaction turns.
        Preserve:
        - Key decisions made
        - Important findings
        - Errors encountered and how they were resolved
        - Current state of the task

        Turns to summarize:
        {json.dumps(turns, indent=2)}
        """
        return self.llm.generate(summary_prompt)

    def truncate_tool_output(self, output: str, max_chars: int = 2000) -> str:
        """Truncate tool output, preserving beginning and end."""
        if len(output) <= max_chars:
            return output

        half = max_chars // 2
        return (
            output[:half] +
            f"\n\n[... {len(output) - max_chars} characters truncated ...]\n\n" +
            output[-half:]
        )

    def structural_compression(self, code: str) -> str:
        """Compress code by showing only signatures and key logic."""
        tree = ast.parse(code)
        compressed = []
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.ClassDef)):
                compressed.append(f"{'class' if isinstance(node, ast.ClassDef) else 'def'} {node.name}(...):")
                docstring = ast.get_docstring(node)
                if docstring:
                    compressed.append(f'    """{docstring}"""')
                compressed.append(f"    # ... ({len(node.body)} statements)")
        return "\n".join(compressed)
```

### Operation 4: Isolate

**Isolation** is the operation of running parts of the agent's work in separate context windows. This is implemented through sub-agents, and it's perhaps the most powerful operation for combating context rot.

```python
class IsolatedExecution:
    """Run subtasks in isolated contexts to prevent cross-contamination."""

    def delegate_to_subagent(self, subtask: str, relevant_context: str) -> str:
        """Spawn a sub-agent with a focused context for a specific subtask."""
        subagent_messages = [
            {
                "role": "user",
                "content": f"""You are a sub-agent working on a specific subtask.

Context:
{relevant_context}

Your task:
{subtask}

Complete this task and return a summary of what you did and any results."""
            }
        ]

        # Sub-agent runs in its own context window
        response = self.client.messages.create(
            model="claude-sonnet-4-20250514",
            system="You are a focused sub-agent. Complete the given task efficiently.",
            messages=subagent_messages,
            tools=self.tools,
            max_tokens=16000,
        )

        # Only the summary returns to the main agent's context
        return extract_summary(response)
```

The four operations map to the lifecycle of information in an agent's context:

```
┌────────────────────────────────────────────────────────────────┐
│        INFORMATION LIFECYCLE IN AGENT CONTEXT                   │
│                                                                 │
│   External World                                                │
│       │                                                         │
│       ▼                                                         │
│   ┌────────┐    ┌────────┐    ┌──────────┐    ┌──────────┐     │
│   │ WRITE  │───►│ SELECT │───►│ COMPRESS │───►│ ISOLATE  │     │
│   │        │    │        │    │          │    │          │     │
│   │ Add to │    │ Choose │    │ Reduce   │    │ Separate │     │
│   │ context│    │ what to│    │ token    │    │ into sub-│     │
│   │        │    │ include│    │ count    │    │ contexts │     │
│   └────────┘    └────────┘    └──────────┘    └──────────┘     │
│                                                                 │
│   Full tool  →  Relevant   →  Summarized  →  Sub-agent         │
│   output        excerpts      excerpts       gets focused      │
│   (10KB)        (2KB)         (500 bytes)    context only      │
│                                                                 │
└────────────────────────────────────────────────────────────────┘
```

---

## 3.6 Token Budgeting for Production Agents

Token budgeting is the practice of allocating portions of the context window to different context layers, ensuring that no single layer can crowd out the others. It is analogous to memory management in operating systems.

### The Budget Framework

```
┌────────────────────────────────────────────────────────────┐
│          TOKEN BUDGET ALLOCATION (200K context window)       │
│                                                             │
│  ┌──────────────────────────────────────────────────┐       │
│  │  System Instructions:          5,000 tokens (2.5%)│       │
│  │  ├── Behavioral rules          2,000              │       │
│  │  ├── Output format specs       1,000              │       │
│  │  └── Safety constraints        2,000              │       │
│  ├──────────────────────────────────────────────────┤       │
│  │  Tool Schemas:                 8,000 tokens (4%)  │       │
│  │  ├── 15 tools × ~500 tokens each                 │       │
│  │  └── (+ examples if needed)                       │       │
│  ├──────────────────────────────────────────────────┤       │
│  │  Project Memory:               3,000 tokens (1.5%)│       │
│  │  ├── AGENTS.md / CLAUDE.md     2,000              │       │
│  │  └── Session memory            1,000              │       │
│  ├──────────────────────────────────────────────────┤       │
│  │  Retrieved Context (RAG):     20,000 tokens (10%) │       │
│  │  ├── Relevant code snippets   15,000              │       │
│  │  └── Documentation excerpts    5,000              │       │
│  ├──────────────────────────────────────────────────┤       │
│  │  Conversation History:       140,000 tokens (70%) │       │
│  │  ├── Preserved turns                              │       │
│  │  ├── Summarized old turns                         │       │
│  │  └── Active working context                       │       │
│  ├──────────────────────────────────────────────────┤       │
│  │  Model Output Budget:         16,000 tokens (8%)  │       │
│  │  ├── Reasoning                                    │       │
│  │  ├── Tool calls                                   │       │
│  │  └── Response text                                │       │
│  ├──────────────────────────────────────────────────┤       │
│  │  Safety Margin:                8,000 tokens (4%)  │       │
│  │  └── Buffer for unexpected large tool results     │       │
│  └──────────────────────────────────────────────────┘       │
│                                                             │
│  Total: 200,000 tokens                                      │
│                                                             │
└────────────────────────────────────────────────────────────┘
```

### Dynamic Budget Adjustment

In practice, budgets must be dynamic. A task that involves reading many files needs more RAG budget. A long debugging session needs more conversation history budget. A simple one-shot task needs very little of either.

```python
class TokenBudgetManager:
    """Dynamically manage token budgets across context layers."""

    def __init__(self, total_budget: int = 200_000):
        self.total_budget = total_budget
        self.output_reserve = 16_000
        self.safety_margin = 8_000
        self.available = total_budget - self.output_reserve - self.safety_margin

        # Fixed allocations
        self.system_budget = 5_000
        self.tools_budget = 8_000
        self.memory_budget = 3_000

        # Dynamic allocations (share remaining budget)
        self.remaining = self.available - self.system_budget - self.tools_budget - self.memory_budget

    def allocate(self, task_type: str, turn_count: int) -> dict:
        """Allocate budgets based on task characteristics."""

        if task_type == "simple_query":
            return {
                "rag": int(self.remaining * 0.3),
                "history": int(self.remaining * 0.7),
            }
        elif task_type == "code_exploration":
            return {
                "rag": int(self.remaining * 0.6),
                "history": int(self.remaining * 0.4),
            }
        elif task_type == "long_debugging":
            # As turns increase, allocate more to history, less to RAG
            history_ratio = min(0.85, 0.5 + turn_count * 0.01)
            return {
                "rag": int(self.remaining * (1 - history_ratio)),
                "history": int(self.remaining * history_ratio),
            }
        else:
            return {
                "rag": int(self.remaining * 0.3),
                "history": int(self.remaining * 0.7),
            }

    def enforce_budget(self, layer: str, content: str, budget: int) -> str:
        """Enforce a token budget on a context layer."""
        tokens = count_tokens(content)
        if tokens <= budget:
            return content

        # Strategy depends on the layer
        if layer == "rag":
            return self.truncate_rag_results(content, budget)
        elif layer == "history":
            return self.compact_history(content, budget)
        else:
            return truncate_to_tokens(content, budget)
```

### Cost Implications

Token budgeting has direct cost implications. At 2025-2026 pricing, a single long agent session can consume millions of tokens:

```
Typical long-horizon agent session:
  50 turns × 100K average input tokens = 5,000,000 input tokens
  50 turns × 1K average output tokens  =    50,000 output tokens

Cost without caching (illustrative):
  Input:  5,000,000 × $3.00/M = $15.00
  Output:    50,000 × $15.00/M = $0.75
  Total: $15.75

Cost with 85% cache hit rate:
  Cached input:  4,250,000 × $0.30/M = $1.28
  New input:       750,000 × $3.00/M = $2.25
  Output:           50,000 × $15.00/M = $0.75
  Total: $4.28

Savings: 73%
```

This is why Manus treats KV-cache hit rate as their primary optimization metric. For a company running millions of agent sessions, the difference between 50% and 90% cache hit rates can be tens of millions of dollars annually.

---

## 3.7 Dynamic Context Pruning and Compaction Strategies

As agent sessions grow, the conversation history inevitably exceeds the available token budget. This necessitates **compaction** — reducing the context while preserving the information needed for the agent to continue operating effectively.

### Strategy 1: Sliding Window with Summary

The simplest compaction strategy: keep the most recent N turns in full, and summarize everything before them.

```python
def sliding_window_compaction(messages, window_size=10, max_tokens=100000):
    """Keep recent turns, summarize older ones."""
    if count_tokens(messages) <= max_tokens:
        return messages

    # Split into old and recent
    system_msg = messages[0]
    first_user_msg = messages[1]
    old_turns = messages[2:-window_size*2]  # Pairs of assistant+user messages
    recent_turns = messages[-window_size*2:]

    # Summarize old turns
    summary = llm_summarize(
        old_turns,
        instruction="Summarize these agent interaction turns. "
                    "Preserve key decisions, findings, errors, and current state."
    )

    return [
        system_msg,
        first_user_msg,
        {"role": "user", "content": f"[Summary of earlier work]\n{summary}"},
        *recent_turns
    ]
```

**Pros:** Simple, preserves recent context perfectly.
**Cons:** Summarization loses detail, hard boundary between summarized and full context.

### Strategy 2: Importance-Weighted Pruning

Keep turns that are most important to the current task, regardless of recency.

```python
def importance_weighted_pruning(messages, max_tokens):
    """Keep the most important turns, not just the most recent."""

    scored_turns = []
    for i, msg in enumerate(messages):
        score = compute_importance(msg, i, len(messages))
        scored_turns.append((score, i, msg))

    # Sort by importance (descending)
    scored_turns.sort(key=lambda x: -x[0])

    # Keep turns until budget is exhausted
    kept_turns = []
    token_count = 0
    for score, idx, msg in scored_turns:
        msg_tokens = count_tokens(msg)
        if token_count + msg_tokens <= max_tokens:
            kept_turns.append((idx, msg))
            token_count += msg_tokens

    # Restore original order
    kept_turns.sort(key=lambda x: x[0])
    return [msg for idx, msg in kept_turns]


def compute_importance(msg, position, total_length):
    """Score a message's importance for retention."""
    score = 0.0

    # Recency bias (exponential decay)
    recency = position / total_length
    score += recency * 3.0

    # System messages are always important
    if msg["role"] == "system":
        score += 10.0

    # First user message (original goal) is critical
    if msg["role"] == "user" and position <= 1:
        score += 8.0

    # Error messages are important (inform future decisions)
    if "error" in str(msg.get("content", "")).lower():
        score += 2.0

    # TODO list updates are important (preserve plan state)
    if "todo" in str(msg.get("content", "")).lower():
        score += 3.0

    # Tool results with file contents are less important
    # (files can be re-read)
    if msg["role"] == "tool" and len(str(msg["content"])) > 5000:
        score -= 2.0

    return score
```

### Strategy 3: Hierarchical Compaction

Apply different levels of compression based on age:

```
┌──────────────────────────────────────────────────────────┐
│           HIERARCHICAL COMPACTION                         │
│                                                           │
│   Age            Compression Level     Token Cost          │
│   ─────────────────────────────────────────────────────    │
│   Last 5 turns   Full fidelity        ~15K tokens         │
│   Turns 6-15     Tool output trimmed  ~8K tokens          │
│   Turns 16-30    Summarized per turn  ~3K tokens          │
│   Turns 30+      Batch summarized     ~1K tokens          │
│                                                           │
│   Visualization:                                          │
│                                                           │
│   Turn: 1    5    10   15   20   25   30   35   40        │
│         │    │    │    │    │    │    │    │    │          │
│   ░░░░░░░░░░░░░░░▒▒▒▒▒▒▒▒▒▒▒▒▒▓▓▓▓▓▓▓▓████████          │
│   │              │             │          │               │
│   Batch summary  Per-turn      Trimmed    Full fidelity   │
│   (~1K tokens)   summaries     outputs    (original)      │
│                  (~3K)         (~8K)      (~15K)          │
│                                                           │
│   Total: ~27K tokens for 40 turns of context              │
│   (vs. ~200K+ tokens uncompacted)                         │
│                                                           │
└──────────────────────────────────────────────────────────┘
```

```python
class HierarchicalCompactor:
    """Apply different compression levels based on turn age."""

    def compact(self, messages, current_turn):
        compacted = []

        for i, msg in enumerate(messages):
            age = current_turn - i

            if age <= 10:
                # Recent: keep full fidelity
                compacted.append(msg)

            elif age <= 20:
                # Medium age: trim tool outputs
                if msg["role"] == "tool":
                    compacted.append(self.trim_tool_output(msg, max_chars=1000))
                else:
                    compacted.append(msg)

            elif age <= 40:
                # Old: per-turn summary
                if i % 2 == 0:  # Summarize pairs of turns
                    pair = messages[i:i+2]
                    summary = self.summarize_turn_pair(pair)
                    compacted.append({
                        "role": "user",
                        "content": f"[Turn {i//2} summary: {summary}]"
                    })

            else:
                # Ancient: batch into a single summary
                # (handled separately as a batch operation)
                pass

        # Prepend batch summary of ancient turns
        if current_turn > 40:
            ancient_turns = messages[:max(0, len(messages)-40)]
            batch_summary = self.batch_summarize(ancient_turns)
            compacted = [
                messages[0],  # System prompt
                {"role": "user", "content": f"[Earlier context summary]\n{batch_summary}"},
                *compacted
            ]

        return compacted
```

### Strategy 4: Cache-Aware Compaction (Manus-Inspired)

Compact in a way that preserves the KV-cache prefix:

```python
def cache_aware_compaction(messages, max_tokens):
    """Compact while preserving the cacheable prefix."""

    # Find the longest prefix that fits in budget
    prefix_end = 0
    token_count = 0
    for i, msg in enumerate(messages):
        msg_tokens = count_tokens(msg)
        if token_count + msg_tokens > max_tokens * 0.6:
            break
        token_count += msg_tokens
        prefix_end = i

    # Keep the prefix intact (this is what's cached)
    prefix = messages[:prefix_end]

    # Summarize the gap between prefix and recent turns
    gap = messages[prefix_end:-10]
    if gap:
        gap_summary = llm_summarize(gap)
        gap_msg = {"role": "user", "content": f"[Summary of turns {prefix_end}-{len(messages)-10}]\n{gap_summary}"}
    else:
        gap_msg = None

    # Keep recent turns in full
    recent = messages[-10:]

    # Assemble: prefix (cached) + gap summary + recent
    result = prefix
    if gap_msg:
        result = result + [gap_msg]
    result = result + recent

    return result
```

### Choosing a Strategy

The right compaction strategy depends on the agent's use case:

| Strategy | Best For | Cache Impact | Information Loss |
|---|---|---|---|
| Sliding Window | General purpose | Moderate (invalidates prefix on compaction) | High for old context |
| Importance-Weighted | Tasks where old context may be critical | Poor (reorders messages) | Low for important info |
| Hierarchical | Long-running sessions | Good (prefix preserved) | Gradual, controlled |
| Cache-Aware | Cost-sensitive production | Excellent (designed for cache) | Moderate, concentrated in gap |

### The Meta-Challenge: When to Compact

Compaction itself has a cost — the LLM call to generate summaries costs tokens and latency. Compacting too frequently wastes resources on summarization. Compacting too infrequently lets context rot set in before the compaction can help.

A practical heuristic: **compact when the context exceeds 70% of the budget.** This provides a safety margin while avoiding premature compaction.

```python
COMPACTION_THRESHOLD = 0.70  # Compact at 70% of budget

def maybe_compact(messages, budget):
    current_usage = count_tokens(messages) / budget
    if current_usage > COMPACTION_THRESHOLD:
        return compact(messages, target_tokens=int(budget * 0.50))
    return messages
```

After compaction, the context should be at approximately 50% of the budget, providing room for growth before the next compaction cycle.

---

## Summary: The Foundations

Part I has established the conceptual and architectural foundations for understanding modern AI agents:

1. **Agents are fundamentally different from chatbots.** The difference is architectural: agents have tools and an autonomous loop, making the LLM the scheduler rather than the human.

2. **The ReAct pattern (Observe-Think-Act) is universal.** Every production agent implements this pattern, whether explicitly or implicitly through native tool-use APIs.

3. **Agent autonomy exists on a spectrum (L1-L5).** The industry is rapidly moving from L2-L3 (supervised) to L4 (fully autonomous), driven by improvements in model capability and tooling.

4. **2025-2026 is the inflection point** where model capability, tooling maturity, and infrastructure converge to make autonomous agents production-viable.

5. **The agent loop is simple; context engineering is hard.** The core loop (LLM → tool calls → observations → repeat) is straightforward. The challenge is managing what goes into the model's context at each step.

6. **Context engineering is the defining discipline of agent development.** It encompasses writing, selecting, compressing, and isolating context — managing the full information environment that shapes model behavior. It demands attention to KV-cache optimization, token budgeting, and dynamic compaction.

These foundations set the stage for Part II, where we will explore the practical engineering of agent systems — tool design, multi-agent architectures, memory systems, and the infrastructure required to run agents at scale.
