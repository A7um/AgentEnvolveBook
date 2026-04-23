# Codex — 记忆、子 Agent 与压缩

OpenAI 的 Codex 是业界文档最完善的 Agent 循环。Responses API 公开可用，CLI 开源，压缩机制也是显式的——不像 Claude Code 那样藏在客户端封装背后。这种透明性使 Codex 成为研究基于 LLM 的进化根本局限的最佳样本。

本章内容来源于 Responses API 文档、开源的 Codex CLI（`openai/codex`）、OpenAI 开发者博客，以及对压缩端点的实测观察。

---

## AGENTS.md — Codex 的记忆文件

### 文件概述

Codex Agent 会读取仓库根目录下的 `AGENTS.md`。这是 Codex 版的 Claude Code `CLAUDE.md`——一份随仓库携带的持久化项目指引，在会话启动时加载到 Agent 的系统 prompt 中。

```markdown
# AGENTS.md

## Build & Test
- Install: `npm install`
- Test: `npm test`
- Lint: `npm run lint`
- Build: `npm run build`

## Architecture
- src/api/ — Express routes (thin controllers)
- src/services/ — Business logic
- src/models/ — Sequelize models
- src/middleware/ — Auth, rate limiting, error handling

## Conventions
- Use TypeScript strict mode
- All API responses use { data, meta, error } envelope
- Tests use vitest, not jest
- Prefer zod for runtime validation over manual checks

## Known Issues
- The Stripe webhook handler (src/api/webhooks/stripe.ts)
  uses raw body parsing — do not add bodyParser middleware before it
```

### 实际运作方式

AGENTS.md 的进化循环是人类参与的（human-in-the-loop）：

```
Session 1:
  Agent makes a mistake → uses jest instead of vitest
  Human corrects the agent
  Human adds to AGENTS.md: "Tests use vitest, not jest"

Session 2:
  Agent reads AGENTS.md at start
  Agent uses vitest correctly
  No correction needed

Session 3:
  Agent encounters the Stripe webhook issue
  Human explains the rawBody requirement
  Human adds the "Known Issues" entry

Session 4+:
  Agent avoids the Stripe issue automatically
```

这是跨会话进化的最简形式：Agent 本身并不学习，但人类的纠正持续积累在一个持久化文件中，Agent 每次会话都会读取。文件就是记忆，人类就是学习机制。

### 当 Agent 反复犯同一个错误

驱动 AGENTS.md 增长的模式很典型：

1. Agent 犯了错误 X
2. 人类纠正
3. 下一次会话：Agent 又犯错误 X（对之前的纠正毫无记忆）
4. 人类意识到：这得写进 AGENTS.md
5. 人类把纠正内容加入 AGENTS.md
6. 此后所有会话：Agent 读取 AGENTS.md，不再犯错误 X

"反复犯同一个错"是判断什么该写入 AGENTS.md 的最强信号。纠正过一次且这件事很重要——写进去。纠正过两次——那必须在里面。

### AGENTS.md 与 CLAUDE.md 对比

| 特性 | AGENTS.md (Codex) | CLAUDE.md (Claude Code) |
|---------|-------------------|------------------------|
| 位置 | 仓库根目录 | 仓库根目录、`.claude/`、`~/.claude/` |
| 发现方式 | 固定路径 | 从当前工作目录向上遍历 |
| Token 预算 | 无显式限制 | 每文件 4K，总计 12K |
| 谁来编写 | 仅人类 | 人类 + Agent |
| 作用范围 | 单个仓库 | 用户级 + 项目级 + 目录级 |
| 自动生成 | `/init` 命令（已提议） | `/init` 生成初始文件 |

关键的哲学分歧：Claude Code 允许 Agent 编写自己的 CLAUDE.md，从而实现自主学习；Codex 则坚持 AGENTS.md 仅由人类编写，牺牲自主性换取精确性。Cursor 对 `.cursor/rules/*.mdc` 也采用了同样的"人类专属"策略。

---

## Memory Preview（2026 年 4 月）

### 跨会话记忆

2026 年 4 月，OpenAI 为 Codex 发布了 Memory Preview——跨会话保留上下文的能力，类似 ChatGPT 的记忆功能，但专为编码 Agent 量身定制。

已公布的功能：

| 功能 | 描述 |
|---------|-------------|
| 会话记忆 | 保留先前会话中的事实、偏好和决策 |
| 定时任务 | 可安排未来任务，到时自动唤醒执行 |
| 项目连续性 | 记住项目状态、待解决问题和进行中的工作 |
| 记忆管理 | 用户可查看、编辑和删除已存储的记忆 |

### 与 AGENTS.md 的区别

AGENTS.md 是静态的——只在人类编辑时才变。Memory Preview 是动态的——Agent 根据交互自动存储记忆：

```
AGENTS.md (static):
  Human writes: "Use vitest, not jest"
  Persists until human removes it
  Available to all agents working on this repo

Memory Preview (dynamic):
  Agent infers: "This user prefers concise PR descriptions"
  Stored automatically after the interaction
  Available to this user's future sessions (not repo-wide)
```

两者的组合威力很大：AGENTS.md 承载适用于所有开发者的项目级事实，Memory Preview 记录跟随个人的用户级偏好。

### 自动唤醒与定时任务

Memory Preview 中最新颖的功能是：Agent 可以为自己安排未来的工作。

```
User: "Run the integration test suite every night at 2am
       and open an issue if anything fails."

Agent: [stores scheduled task]
       [auto-wakes at 2:00 AM daily]
       [runs: npm run test:integration]
       [if failures: gh issue create --title "Integration test failure"
                     --body "<failure details>"]
       [goes back to sleep]
```

这朝着持久 Agent 身份迈出了一步——Agent 不仅记得过去的会话，还能为未来的会话做规划。但具体实现细节（记忆如何存储、定时如何触发、token 预算多大）尚未完全公开。

---

## 压缩问题

### Codex 如何压缩

Responses API 提供了一个显式的压缩端点：

```
POST /v1/responses/compact

Request:
{
  "response_id": "resp_abc123",    // The response to compact
  "model": "codex-mini-latest"     // Model for compaction
}

Response:
{
  "encrypted_content": "eyJ0eXAi...",  // Opaque, encrypted state
  "usage": {
    "input_tokens": 45000,              // Original size
    "output_tokens": 6200               // Compacted size
  }
}
```

`encrypted_content` 是一个不透明的加密数据块——Agent 代码无法查看或修改。它保留了足以让模型继续对话的潜在状态，但具体保留哪些信息完全由 OpenAI 的压缩算法决定。

### 什么会丢失

根据对 Codex 会话样本的测量，压缩大约保留原始信息的 **13.7%**：

```
Original conversation:
  - System prompt:     4,000 tokens
  - Tool definitions:  3,200 tokens
  - 50 conversation turns with tool calls:
    - User messages:   8,000 tokens
    - Agent responses: 12,000 tokens
    - Tool outputs:    18,000 tokens
  Total: ~45,000 tokens

After compaction:
  - Encrypted state:   ~6,200 tokens
  - Retention rate:    13.7%

What's preserved (approximately):
  - Current task objective
  - Most recent decisions and their rationale
  - Key variable names and file paths
  - Active error state (if any)

What's lost:
  - Full tool outputs (file contents, command results)
  - Early conversation context
  - Intermediate reasoning steps
  - Exploration paths that were abandoned
  - Specific code snippets from earlier turns
```

### 复合损失

反复压缩会让问题越来越严重。在长时间运行的会话中：

```
Compaction 1:  45,000 tokens → 6,200 tokens  (13.7% retained)
Compaction 2:  6,200 + 20,000 new → 3,600 tokens  (~13.7% of 26,200)
Compaction 3:  3,600 + 20,000 new → 3,200 tokens  (~13.5% of 23,600)

After 3 compactions:
  Original information from turns 1-50: almost entirely gone
  The agent has effectively "forgotten" the beginning of the session
```

每次压缩都有损，而且损失逐级累积。早期轮次的信息在第一次压缩后以摘要形式残存，但这个摘要在第二次压缩中又被再度压缩。三轮之后，原始细节基本消失殆尽。

### 为什么这限制了进化

压缩是 Codex 会话内进化的根本瓶颈：

```
Without compaction limits:
  Agent works for 200 turns
  Builds up rich context: patterns observed, strategies tried, lessons learned
  All context available for decision-making on turn 201

With compaction:
  Agent works for 50 turns → compaction → 86% of context lost
  Agent works for 50 more turns → compaction → early lessons lost again
  By turn 200: agent has detailed context for last ~30 turns only
  Patterns from turns 1-50 are gone unless externalized to files
```

这就是为什么 WAL 模式（第 7 章）对 Codex Agent 至关重要：关键状态如果没有在压缩之前写入文件，就会丢失。文件系统是唯一能完整扛住压缩的持久记忆。

### Claude Code 的压缩对比

Claude Code 面临同样的问题，但处理方式不同：

| 方面 | Codex | Claude Code |
|--------|-------|------------|
| 触发条件 | 显式 API 调用或自动触发 | 主动（接近上限时）+ 被动（错误恢复） |
| 机制 | 服务端加密数据块 | 客户端摘要生成 |
| 透明度 | 不透明（无法查看） | 可见（摘要留在对话中） |
| 错误处理 | 干净（API 托管） | 复杂（hasAttemptedReactiveCompact bug） |
| 信息损失 | 每次约 86% | 大致相当，但 Agent 可控制摘要内容 |

Claude Code 的优势在于 Agent 参与摘要生成，可以优先保留重要内容。Codex 的优势在于压缩由服务端管理，不需要消耗输出 token 来生成摘要。

两者都没有解决根本问题：压缩是有损的，损失会逐级累积。

---

## 子 Agent（2026 年 3 月正式发布）

### 架构

Codex 子 Agent 采用管理者-工作者模式：

```
┌───────────────────────────────────────────┐
│              MANAGER AGENT                 │
│                                           │
│  - Receives user task                     │
│  - Plans subtask decomposition            │
│  - Spawns workers (up to 6 concurrent)    │
│  - Aggregates results                     │
│  - Reports to user                        │
└──────────┬──────────┬──────────┬─────────┘
           │          │          │
     ┌─────▼────┐ ┌───▼───┐ ┌───▼──────┐
     │ EXPLORER │ │WORKER │ │ WORKER   │
     │          │ │       │ │          │
     │ Read-only│ │ Full  │ │ Full     │
     │ access   │ │ access│ │ access   │
     └──────────┘ └───────┘ └──────────┘
```

### 三种 Agent 类型

| 类型 | 权限 | 用途 | 典型用法 |
|------|--------|---------|-------------|
| `explorer` | 只读文件系统，无写入权限 | 调查、代码分析、依赖关系梳理 | "搞清楚这个代码库里认证是怎么实现的" |
| `worker` | 完整读写权限，终端访问 | 实现、测试、部署 | "实现速率限制中间件" |
| `default` | 可配置 | 通用子任务 | 视任务而定 |

### 生成子 Agent

```python
# From the Codex CLI (simplified)
async def spawn_subagent(
    task: str,
    agent_type: str = "default",
    tools: list[str] = None,
    max_turns: int = 50,
) -> SubagentResult:
    """
    Spawn a subagent for a specific subtask.

    The subagent gets:
    - Its own context window (isolated from parent)
    - Its own conversation history
    - Access to the same filesystem (but isolated tool permissions)
    - The parent's AGENTS.md context
    """
    response = await client.responses.create(
        model="codex-mini-latest",
        instructions=build_subagent_prompt(task, agent_type),
        tools=filter_tools(tools, agent_type),
        max_output_tokens=16384,
    )
    return SubagentResult(
        output=response.output,
        tool_calls=response.tool_calls,
        tokens_used=response.usage,
    )
```

### 并发

最多可同时运行 6 个子 Agent：

```
Manager receives: "Refactor the API to use the new auth system"

Manager plans:
  1. Explorer: Map all routes that use old auth       ──┐
  2. Explorer: Analyze new auth system API            ──┤ Parallel
  3. Explorer: Check test coverage for auth routes    ──┘
  4. Worker: Implement auth adapter (after 1-3 done)  ──┐
  5. Worker: Update route handlers (after 4)          ──┤ Sequential
  6. Worker: Update tests (after 5)                   ──┘

Execution:
  t=0:  Spawn explorers 1, 2, 3 (concurrent, read-only)
  t=30s: All explorers complete → spawn worker 4
  t=90s: Worker 4 complete → spawn workers 5, 6 (concurrent)
  t=180s: All workers complete → manager aggregates results
```

### 通过 .codex/agents/*.toml 自定义 Agent

团队可以定义自己的 Agent 类型：

```toml
# .codex/agents/security-reviewer.toml
[agent]
name = "security-reviewer"
type = "explorer"
description = "Reviews code changes for security vulnerabilities"

[agent.instructions]
system = """
You are a security reviewer. Analyze the provided code for:
- Injection vulnerabilities (SQL, XSS, command injection)
- Authentication/authorization bypass
- Sensitive data exposure
- Insecure cryptographic practices

Report findings with severity (critical/high/medium/low) and
specific remediation steps.
"""

[agent.tools]
allowed = ["file_read", "search", "grep"]
denied = ["file_write", "terminal"]
```

自定义 Agent 继承项目的 AGENTS.md 上下文，但拥有独立的系统 prompt 和工具权限约束。这样就能做到基于角色的专业化分工，而无需改动核心 Agent 代码。

### spawn_agents_on_csv 批量操作

用于对多个文件或记录批量执行重复任务：

```python
# Process a CSV of migration tasks
await spawn_agents_on_csv(
    csv_path="migration-tasks.csv",
    agent_type="worker",
    prompt_template="Migrate the file at {filepath} from Express to Fastify. "
                    "Follow the patterns in src/api/example-fastify-route.ts.",
    max_concurrent=6,
)
```

CSV 的每一行就是一个任务。每行生成一个子 Agent，把该行数据填入 prompt 模板，最多 6 个并发运行。

这就是批量进化：同样的变换应用于多个目标，每个子 Agent 独立工作，管理者汇总结果并报告失败。

---

## 通过子 Agent 隔离实现进化

### 为什么隔离对进化至关重要

每个子 Agent 拥有独立的上下文窗口，这直接影响进化质量：

```
Single agent (no subagents):
  Context window: [system prompt + ALL exploration + ALL implementation + ALL testing]
  By the time tests run, exploration context is compacted or lost
  Test failures reference code that the agent barely remembers

Manager + subagents:
  Explorer context: [system prompt + exploration only]
  Worker context: [system prompt + explorer summary + implementation only]
  Test worker: [system prompt + implementation summary + test results only]

  Each agent has FOCUSED context — no dilution from unrelated phases
```

隔离杜绝了错误传播问题：某个探索者走偏了，只有它的上下文被污染。管理者只看到探索者的最终产出，而非失败探索的完整轨迹。

### 压缩的交互影响

子 Agent 隔离在一定程度上缓解了压缩问题：

```
Without subagents:
  50 exploration turns + 50 implementation turns + 20 test turns = 120 turns
  Compaction fires at turn 50: loses exploration detail
  Compaction fires at turn 100: loses early implementation detail
  Test failures reference compacted context → agent struggles to debug

With subagents:
  Explorer: 50 turns → may compact internally, but returns clean summary
  Worker: 50 turns → fresh context, no exploration baggage
  Test worker: 20 turns → fresh context, focused on test results

  No compaction cascading between phases
```

每个子 Agent 都从全新的上下文窗口开始。复合损失在每个子 Agent 边界处被重置。

---

## 总结：Codex 的进化技术栈

```
┌──────────────────────────────────────────────┐
│                    Codex                       │
├──────────────────────────────────────────────┤
│                                              │
│  Memory Layer                                │
│  ├── AGENTS.md (human-written, repo-level)   │
│  ├── Memory Preview (auto-learned, user-level)│
│  └── Scheduled work (auto-wake for future)   │
│                                              │
│  Compaction Layer                            │
│  ├── Responses API compaction (server-side)  │
│  ├── Encrypted state preservation            │
│  └── 86.3% information loss per compaction   │
│                                              │
│  Subagent Layer                              │
│  ├── Manager-worker architecture             │
│  ├── 3 agent types (explorer, worker, default)│
│  ├── Up to 6 concurrent subagents            │
│  ├── Custom agents via .codex/agents/*.toml  │
│  └── Batch operations via CSV                │
│                                              │
│  Limitation                                  │
│  └── No autonomous skill creation            │
│  └── No self-evaluation checkpoints          │
│  └── Compaction losses compound over time    │
│                                              │
└──────────────────────────────────────────────┘
```

Codex 是对自身局限最坦诚的 Agent 系统。压缩端点让信息损失一目了然，子 Agent 架构提供了结构性的缓解方案。但根本挑战不变：Agent 在会话中学到的大部分东西，都会在会话结束或压缩时丢失。

文件系统——AGENTS.md、进度文件、外部化状态——是唯一能完整扛住压缩的进化机制。对 Codex Agent 来说，写文件不是可选项，而是唯一持久的记忆。
