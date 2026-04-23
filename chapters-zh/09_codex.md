# Codex — 记忆、子 Agent 与压缩

OpenAI 的 Codex 是业界文档最完善的 Agent 循环。Responses API 是公开的，CLI 是开源的，压缩机制是显式的——不像 Claude Code 那样隐藏在客户端封装之后。这种透明性使 Codex 成为理解基于 LLM 的进化基本限制的最佳系统。

本章内容来源于 Responses API 文档、开源的 Codex CLI（`openai/codex`）、OpenAI 的开发者博客文章，以及对压缩端点的实测行为。

---

## AGENTS.md — Codex 的记忆文件

### 文件概述

Codex Agent 会读取仓库根目录下的 `AGENTS.md` 文件。这是 Codex 版本的 Claude Code `CLAUDE.md`——随仓库一起携带的持久化项目指引，在会话启动时加载到 Agent 的系统提示词中。

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

这是跨会话进化的最简形式：Agent 本身并不学习，但人类的纠正不断累积在一个持久化文件中，Agent 每次会话都会读取它。文件就是记忆；人类就是学习机制。

### 当 Agent 反复犯同一个错误

驱动 AGENTS.md 增长的模式：

1. Agent 犯了错误 X
2. 人类纠正 Agent
3. 下一次会话：Agent 再次犯错误 X（没有对纠正的记忆）
4. 人类意识到：这需要写进 AGENTS.md
5. 人类将纠正内容添加到 AGENTS.md
6. 所有未来的会话：Agent 读取 AGENTS.md，避免错误 X

反复犯错模式是判断什么应该写入 AGENTS.md 的最强信号。如果你纠正了 Agent 一次且这很重要，就把它写进文件。如果你纠正了两次，那它绝对应该在里面。

### AGENTS.md 与 CLAUDE.md 对比

| 特性 | AGENTS.md (Codex) | CLAUDE.md (Claude Code) |
|---------|-------------------|------------------------|
| 位置 | 仓库根目录 | 仓库根目录、`.claude/`、`~/.claude/` |
| 发现方式 | 固定路径 | 从当前工作目录向上遍历 |
| Token 预算 | 无显式限制 | 每文件 4K，总计 12K |
| 谁来编写 | 仅人类 | 人类 + Agent |
| 作用范围 | 单个仓库 | 用户级 + 项目级 + 目录级 |
| 自动生成 | `/init` 命令（已提议） | `/init` 生成初始文件 |

关键的哲学差异：Claude Code 允许 Agent 编写自己的 CLAUDE.md，从而实现自主学习。Codex 保持 AGENTS.md 仅由人类编写，优先保证精确性而非自主性。Cursor 对 `.cursor/rules/*.mdc` 采用了同样的仅人类编写方式。

---

## Memory Preview（2026 年 4 月）

### 跨会话记忆

2026 年 4 月，OpenAI 为 Codex 发布了 Memory Preview——能够在会话之间保留上下文的能力，类似于 ChatGPT 的记忆功能，但专为编码 Agent 设计。

已公布的功能：

| 功能 | 描述 |
|---------|-------------|
| 会话记忆 | 保留先前会话中的事实、偏好和决策 |
| 定时任务 | 可以安排未来的任务并自动唤醒执行 |
| 项目连续性 | 记住项目状态、待解决问题和进行中的工作 |
| 记忆管理 | 用户可以查看、编辑和删除存储的记忆 |

### 与 AGENTS.md 的区别

AGENTS.md 是静态的——只有人类编辑时才会改变。Memory Preview 是动态的——Agent 根据交互自动存储记忆：

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

两者的结合非常强大：AGENTS.md 用于适用于所有开发者的项目级事实，Memory Preview 用于跟随个人的用户级偏好。

### 自动唤醒与定时任务

Memory Preview 中最新颖的功能：可以安排未来工作的 Agent。

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

这是迈向持久 Agent 身份的一步——Agent 不仅记住过去的会话，还为未来的会话做规划。但实现细节（记忆如何存储、定时如何工作、token 预算是多少）尚未完全公开。

---

## 压缩问题

### Codex 如何进行压缩

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

`encrypted_content` 是一个不透明的加密数据块——Agent 代码无法检查或修改它。它保留了足够的潜在状态，使模型能够继续对话，但具体保留哪些信息由 OpenAI 的压缩算法控制。

### 什么会丢失

通过对 Codex 会话样本的测量，压缩大约保留原始信息的 **13.7%**：

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

问题会随着反复压缩而恶化。在长时间运行的会话中：

```
Compaction 1:  45,000 tokens → 6,200 tokens  (13.7% retained)
Compaction 2:  6,200 + 20,000 new → 3,600 tokens  (~13.7% of 26,200)
Compaction 3:  3,600 + 20,000 new → 3,200 tokens  (~13.5% of 23,600)

After 3 compactions:
  Original information from turns 1-50: almost entirely gone
  The agent has effectively "forgotten" the beginning of the session
```

每次压缩都是有损的，而且损失会复合累积。来自早期轮次的信息在第一次压缩后作为摘要存活，但该摘要本身在第二次压缩中被再次压缩。到第三次压缩时，原始细节已经消失。

### 为什么这限制了进化

压缩是 Codex 会话内进化的根本限制：

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

这就是为什么 WAL 模式（第 7 章）对 Codex Agent 至关重要：如果关键状态没有在压缩之前写入文件，它就会丢失。文件系统是唯一能完整经受压缩的持久记忆。

### Claude Code 的压缩对比

Claude Code 面临同样的问题，但处理方式不同：

| 方面 | Codex | Claude Code |
|--------|-------|------------|
| 触发条件 | 显式 API 调用或自动触发 | 主动（接近上限时）+ 被动（错误恢复） |
| 机制 | 服务端加密数据块 | 客户端摘要生成 |
| 透明度 | 不透明（无法检查） | 可见（摘要在对话中） |
| 错误处理 | 干净（API 管理） | 复杂（hasAttemptedReactiveCompact bug） |
| 信息损失 | 每次压缩约 86% | 相当，但 Agent 控制摘要内容 |

Claude Code 的优势：Agent 参与摘要生成过程，可以优先保留重要内容。Codex 的优势：压缩由服务端管理，不消耗输出 token 来生成摘要。

两者都没有解决根本问题：压缩是有损的，而且损失会复合累积。

---

## 子 Agent（2026 年 3 月正式发布）

### 架构

Codex 子 Agent 使用管理者-工作者模式：

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
| `explorer` | 只读文件系统，无写入权限 | 调查、代码分析、依赖映射 | "理解这个代码库中认证是如何工作的" |
| `worker` | 完整读写权限，终端访问 | 实现、测试、部署 | "实现速率限制中间件" |
| `default` | 可配置 | 通用子任务执行 | 视任务而定 |

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

团队可以定义自定义 Agent 类型：

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

自定义 Agent 继承项目的 AGENTS.md 上下文，但拥有自己的系统提示词和工具权限限制。这实现了基于角色的专业化，无需修改核心 Agent 代码。

### spawn_agents_on_csv 批量操作

用于在多个文件或记录上执行重复任务：

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

CSV 每行提供一个任务。每行生成一个子 Agent，将该行数据替换到提示模板中。最多 6 个同时运行。

这就是批量进化：相同的转换应用于多个目标，每个子 Agent 独立工作。管理者汇总结果并报告失败。

---

## 通过子 Agent 隔离实现进化

### 为什么隔离对进化至关重要

每个子 Agent 拥有自己的上下文窗口。这对进化质量有直接影响：

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

隔离防止了错误传播问题：如果一个探索者走错了方向，只有该探索者的上下文被污染。管理者只接收探索者的最终输出，而不是失败探索的完整轨迹。

### 压缩的交互影响

子 Agent 隔离部分缓解了压缩问题：

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

每个子 Agent 都从全新的上下文窗口开始。复合损失问题在每个子 Agent 边界处被重置。

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

Codex 是对自身局限性最透明的 Agent 系统。压缩端点使信息损失变得显而易见。子 Agent 架构提供了结构性的缓解方案。但根本挑战依然存在：Agent 在会话中学到的大部分内容，在会话结束或压缩时都会丢失。

文件系统——AGENTS.md、进度文件、外部化状态——是唯一能完整经受压缩的进化机制。对于 Codex Agent 来说，写入文件不是可选的；它是唯一持久的记忆。
