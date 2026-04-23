# 赋能进化的技能设计模式

前面的章节描述了生产环境中的 Agent *构建了什么*——技能、记忆、规则。本章提炼出使这些产出物有效进化的*模式*。每个模式都来自一个真实系统：proactive-agent、self-improving-agent、capability-evolver、Hermes、Claude Code 或 Devin。每个模式都经过了实际用户工作负载的验证。

六个模式。每个解决 Agent 自我改进中的一个特定故障模式。

---

## 模式 1：心跳模式

**来源：** ClawHub 上的 `proactive-agent` 技能（1,200+ 安装量）

**问题：** Agent 是被动的。它们响应用户消息。但记忆和工作区状态可能在交互之间变得陈旧——文件过时、上下文漂移、重要变更被遗漏。

**解决方案：** 定期自检，审查 Agent 的整个工作区，识别缺陷或陈旧信息，并主动触发更新。

### 工作原理

proactive-agent 技能安装一个 `HEARTBEAT.md` 文件，指示 Agent 定期重新读取：

```markdown
<!-- HEARTBEAT.md -->
# Heartbeat Protocol

## Trigger
Every 10 minutes of active session time, OR at session start.

## Procedure
1. Read all workspace files: MEMORY.md, USER.md, TOOLS.md, SOUL.md
2. Read recent conversation history (last 20 messages)
3. Check each file against current reality:
   - Is any information stale? (tools changed, preferences shifted)
   - Is any information missing? (new tool discovered, new pattern observed)
   - Are there contradictions between files?
4. For each gap found:
   - If minor: update the relevant file directly
   - If major: flag for user confirmation before updating
5. Log the heartbeat result to SESSION-STATE.md
```

### 实现细节

心跳不是 cron 任务——没有后台调度器。相反，该技能在 Agent 的系统提示词中注入一个触发条件：

```
After every 10 tool calls, check: have you reviewed HEARTBEAT.md
in this session? If not, do so now. If you have, check whether
10 minutes have elapsed since the last heartbeat. If so, run the
heartbeat protocol.
```

这是一个软触发——如果 Agent 正在处理复杂任务，可能会跳过它。但在实践中，自我评估检查点（Hermes 中的模式 3，每 15 次工具调用）提供了一个运行心跳的自然时间点。

### 心跳能捕获什么

| 陈旧状态 | 如何检测 | 操作 |
|-------------|-------------|--------|
| MEMORY.md 列出了一个已移除的工具 | 对照可用工具进行工具清单检查 | 移除陈旧条目 |
| USER.md 说"偏好 npm"但用户已切换到 pnpm | 最近的对话显示 `pnpm` 命令 | 更新偏好 |
| TOOLS.md 缺少新安装的 CLI 工具 | `which` 或 `command -v` 检查 | 添加工具条目 |
| SOUL.md 的个性特征与最近行为矛盾 | 对话分析显示偏移 | 标记待用户审查 |

### 为什么是类 Cron 而非事件驱动

事件驱动方法（在每次文件更改、每次工具安装时触发）会更精确，但会产生两个问题：

1. **Token 成本：** 每次事件后检查代价高昂。10 分钟心跳将成本分摊到多个事件上。
2. **噪声：** 大多数单个事件不值得进行记忆更新。心跳将它们批量处理，让 Agent 识别*模式*而非对单个变更做出反应。

心跳是 Agent 状态的垃圾回收器——它定期运行，识别失效引用，并清理它们。

---

## 模式 2：WAL（预写日志）模式

**来源：** `proactive-agent` 技能，`SESSION-STATE.md` 协议

**问题：** LLM 上下文压缩是不可预测的。当上下文窗口填满时，系统会总结较早的对话轮次——而总结会丢失细节。如果 Agent 在压缩触发*之前*没有将当前状态外化到磁盘，该状态就会丢失。

**解决方案：** 在生成响应*之前*将关键状态写入文件，而不是之后。该文件充当预写日志——一个在压缩后仍然存在的恢复点。

### 数据库类比

在数据库中，预写日志（WAL）确保持久性：事务在修改实际数据*之前*被写入日志。如果系统在操作中途崩溃，日志可以用于恢复。

对于 Agent，"崩溃"就是上下文压缩。"日志"就是 `SESSION-STATE.md`。

```
Without WAL:
  Agent works on complex task (20 tool calls)
  → Context fills up
  → Compaction fires: summarizes everything into 500 tokens
  → Agent "forgets" intermediate reasoning, partial results, current strategy
  → Agent restarts the task from scratch or makes inconsistent decisions

With WAL:
  Agent works on complex task
  → Every 5 tool calls: writes current state to SESSION-STATE.md
    - What I'm trying to accomplish
    - What I've done so far
    - What I plan to do next
    - Key decisions made and why
  → Context fills up
  → Compaction fires: summarizes conversation
  → Agent reads SESSION-STATE.md: full state recovered
  → Agent continues seamlessly
```

### SESSION-STATE.md 格式

```markdown
<!-- SESSION-STATE.md — written by agent, read at compaction recovery -->
# Session State

## Current Objective
Migrating the API from Express to Fastify. User wants zero downtime.

## Progress
- [x] Audit all Express routes (47 routes found)
- [x] Set up Fastify project structure
- [x] Migrate auth middleware (passport → fastify-passport)
- [ ] Migrate route handlers (12/47 done)
- [ ] Update tests
- [ ] Deploy behind feature flag

## Key Decisions
- Using fastify-express compatibility layer for gradual migration
- NOT rewriting route handlers — wrapping them with fastify-express plugin
- User explicitly said: keep Express error handling patterns

## Blockers
- Route /api/webhooks/stripe uses req.rawBody — need to verify
  Fastify equivalent before migrating

## Last Updated
After migrating routes 1-12 (auth, users, teams).
Next: routes 13-24 (projects, deployments).
```

### 何时写入

关键洞察：在响应*之前*写入，而不是之后。序列如下：

```
1. Agent receives user message or tool result
2. Agent updates SESSION-STATE.md with current state    ← WAL write
3. Agent generates response / executes next tool call
4. If compaction happens during step 3, state is safe
```

在响应之后写入就太晚了——压缩可能在响应生成期间已经触发。

### Codex 的对应方案

OpenAI Codex 的 `POST /responses/compact` 端点返回 `encrypted_content`——对话状态的压缩表示。这是服务端 WAL：状态保存在 API 的存储中而非 Agent 的文件系统上。但它会丢失 86.3% 的信息（参见第 9 章）。文件系统 WAL 保留了 Agent 写入的所有内容。

文件系统方法的优势：Agent 控制*保留什么*。一个 200 行的 `SESSION-STATE.md` 可以从 50,000 token 的对话中捕获 10 个最重要的事实。API 的压缩算法没有这种判断力。

---

## 模式 3：固化流水线

**来源：** ClawHub 上的 `self-improving-agent` 技能（OpenClaw 生态系统）

**问题：** Agent 在会话期间会学到东西——一个有用的命令、关于某个库的注意事项、用户偏好。但并非每个观察都值得永久存储。将每次学习都写入永久记忆会产生噪声、膨胀和矛盾。

**解决方案：** 两阶段流水线。在暂存区（`.learnings/`）中积累观察。仅当证据积累超过阈值时才提升到永久文件。

### 流水线

```
Session observations
        │
        ▼
┌──────────────────┐
│  .learnings/     │  Stage 1: Raw observations
│  ├── 2026-04-15  │  - One file per session
│  ├── 2026-04-16  │  - Everything goes here
│  ├── 2026-04-17  │  - No quality filter
│  └── 2026-04-19  │
└────────┬─────────┘
         │
         │  Threshold check: 3+ related observations
         │
         ▼
┌──────────────────┐
│  Permanent files  │  Stage 2: Proven knowledge
│  ├── AGENTS.md   │  - Build commands, conventions
│  ├── TOOLS.md    │  - Available tools, usage patterns
│  └── SOUL.md     │  - Agent personality, communication style
└──────────────────┘
```

### 阈值逻辑

提升阈值是关键的设计参数。太低 → 噪声。太高 → 有用的知识永远无法被提升。

`self-improving-agent` 使用 **3 次观察阈值**：

```
Observation 1 (April 15):
  "User corrected me: use `pnpm` not `npm` for this project"
  → Written to .learnings/2026-04-15.md
  → NOT promoted yet (could be one-time preference)

Observation 2 (April 16):
  "User's CI pipeline uses pnpm. Lock file is pnpm-lock.yaml."
  → Written to .learnings/2026-04-16.md
  → NOT promoted yet (2 observations, threshold is 3)

Observation 3 (April 17):
  "User asked me to add a dependency and I used npm — user corrected
   me again. This is clearly a project-wide convention."
  → Written to .learnings/2026-04-17.md
  → PROMOTED: Add to AGENTS.md: "Package manager: pnpm (not npm)"
```

### 提升类别

| 目标文件 | 什么会被提升 | 示例 |
|-------------|-------------------|---------|
| `AGENTS.md` | 构建命令、测试命令、项目结构、编码规范 | "Run tests: `pnpm test --coverage`" |
| `TOOLS.md` | 可用工具、使用模式、工具特定的注意事项 | "ffmpeg is installed; use `-c:v libx264` for H.264" |
| `SOUL.md` | 沟通风格、个性特征、响应偏好 | "User prefers terse responses, no emojis" |

### 为什么不立即提升

立即提升有三种失败模式，而固化流水线可以避免：

1. **临时上下文：** 用户在一次对话中说"这个用 npm"，但其他地方都用 pnpm。立即提升会捕获例外而非规则。

2. **矛盾的观察：** 周一用户想要详细解释。周二他们想要简洁回复。如果立即提升，记忆会来回摇摆。通过流水线，Agent 看到两个观察后可以识别模式（学习时详细，日常任务时简洁）。

3. **记忆膨胀：** 200 行的 AGENTS.md 是有用的。2,000 行的 AGENTS.md 浪费上下文 token 并使模型困惑。阈值确保只有反复验证的知识才消耗永久上下文预算。

### 梦境作为批量固化

OpenClaw 的 **Dreaming** 过程（第 5 章）是该流水线的自动化版本。在空闲期间，Dreaming 审查积累的每日笔记并运行提升逻辑：

```
Dreaming process:
  1. Read all .learnings/ files from the past 7 days
  2. Cluster related observations (semantic similarity)
  3. For each cluster with 3+ observations:
     a. Synthesize into a single statement
     b. Check against existing permanent files for contradictions
     c. If contradiction: resolve using most recent evidence
     d. If new: append to appropriate permanent file
  4. Prune .learnings/ files older than 30 days
```

Dreaming 是一次完成的垃圾回收器 + 提升器 + 去重器。

---

## 模式 4：基因组/胶囊模式

**来源：** ClawHub 上的 `capability-evolver` 技能

**问题：** 技能描述的是流程。但 Agent 也会发现可复用的*模式*（代码片段、配置、启发式方法）和*修复*（针对特定 bug 的特定解决方案）。这些不适合 SKILL.md 格式。

**解决方案：** 一个结构化的进化系统，包含三种产出物类型：基因（可复用模式）、胶囊（经过验证的修复）和事件日志（审计追踪）。父 ID 创建可追溯的进化树。

### 三种产出物

```
┌─────────────────────────────────────────────┐
│  genes.json                                  │
│  Reusable patterns that work across contexts │
│                                              │
│  {                                           │
│    "id": "gene_017",                         │
│    "parent_id": "gene_003",                  │
│    "pattern": "retry-with-backoff",          │
│    "code": "async function retry(fn, ...",   │
│    "contexts_used": 14,                      │
│    "success_rate": 0.93                      │
│  }                                           │
├─────────────────────────────────────────────┤
│  capsules.json                               │
│  Proven fixes for specific failure modes     │
│                                              │
│  {                                           │
│    "id": "cap_042",                          │
│    "parent_id": null,                        │
│    "trigger": "ECONNREFUSED on localhost",   │
│    "fix": "Check if service is running...",  │
│    "verified": true,                         │
│    "times_applied": 7                        │
│  }                                           │
├─────────────────────────────────────────────┤
│  events.jsonl                                │
│  Append-only audit trail                     │
│                                              │
│  {"ts":"...", "type":"gene_created", ...}    │
│  {"ts":"...", "type":"capsule_applied", ...} │
│  {"ts":"...", "type":"gene_mutated", ...}    │
└─────────────────────────────────────────────┘
```

### 进化树

`parent_id` 字段创建了可追溯的血统：

```
gene_001: "basic-retry"
  └── gene_003: "retry-with-backoff" (added exponential backoff)
        └── gene_017: "retry-with-backoff-and-jitter" (added jitter)
              └── gene_024: "retry-with-circuit-breaker" (added failure threshold)
```

每次变异都是一个新基因，并链接到其父代。事件日志记录了每次变异发生的*时间*和*原因*：

```jsonl
{"ts":"2026-03-12T14:30:00Z","type":"gene_mutated","gene_id":"gene_017","parent_id":"gene_003","reason":"Added jitter after observing thundering herd in retry storms","session":"sess_abc"}
{"ts":"2026-03-19T09:15:00Z","type":"gene_mutated","gene_id":"gene_024","parent_id":"gene_017","reason":"Added circuit breaker after 3 sessions with cascading retry failures","session":"sess_def"}
```

### 基因 vs. 技能 vs. 胶囊

| 产出物 | 粒度 | 示例 | 生命周期 |
|----------|------------|---------|----------|
| 技能（SKILL.md） | 完整流程（20+ 步骤） | "Deploy to Kubernetes" | 长期（数月） |
| 基因（genes.json） | 可复用模式（1-10 行） | "Retry with backoff" | 长期，通过变异进化 |
| 胶囊（capsules.json） | 特定修复（1-5 行） | "ECONNREFUSED → check port" | 中期（直到根因解决） |

技能是*做什么*。基因是*如何做好*。胶囊是*出问题时怎么办*。

### 安全隐患

`capability-evolver` 技能存在一个重大安全漏洞：在早期版本中，基因可以包含 Agent 执行的任意代码。生产部署应增加：

1. **沙箱：** 在隔离环境中执行基因代码
2. **Git 追踪：** 每次基因变异都是一次提交，可供人类审查
3. **审批关卡：** 超过复杂度阈值的基因需要人工审批
4. **速率限制：** 每个会话最多 N 次基因变异

审计追踪（events.jsonl）提供了取证能力但不能预防。需要纵深防御。

---

## 模式 5：技能加载的渐进式披露

**来源：** Hermes Agent、Claude Code Agent Skills 系统

**问题：** 一个成熟的 Agent 有 50-200+ 个技能。将所有技能加载到上下文中浪费 token 并使模型困惑。模型的注意力在不相关的技能文本上被稀释，它可能从与当前任务无关的技能中产生幻觉工具调用。

**解决方案：** 三级渐进式披露。默认只加载名称和描述。仅当 Agent 判断某技能相关时才获取完整内容。

### 三个层级

```
Level 0 — Catalog (always in context)
┌──────────────────────────────────────────────────┐
│  Available skills:                                │
│  - git-interactive-rebase: Clean up commit        │
│    history with squash, fixup, reword, reorder.   │
│  - kubernetes-pod-debugging: Diagnose pod          │
│    failures — CrashLoopBackOff, OOMKilled, etc.   │
│  - python-project-setup: Initialize Python project │
│    with pyproject.toml, ruff, pytest, CI.          │
│  ... (200 more entries)                            │
│                                                    │
│  ~100 tokens per entry = ~20K tokens for 200 skills│
│  With FTS5 search: ~10 relevant × 100 = 1K tokens │
└──────────────────────────────────────────────────┘

Level 1 — Full skill (loaded on demand)
┌──────────────────────────────────────────────────┐
│  skill_view("kubernetes-pod-debugging")           │
│                                                    │
│  Returns: When to Use, Quick Reference, Procedure, │
│  Pitfalls, Verification                            │
│  ~500-1500 tokens                                  │
└──────────────────────────────────────────────────┘

Level 2 — Section (loaded for follow-up detail)
┌──────────────────────────────────────────────────┐
│  skill_view("kubernetes-pod-debugging", "pitfalls")│
│                                                    │
│  Returns: Only the Pitfalls section                │
│  ~100-300 tokens                                   │
└──────────────────────────────────────────────────┘
```

### 为什么渐进式披露很重要

Token 经济效益是显著的：

```
200 skills × 800 tokens average = 160,000 tokens (naive loading)
200 skills × 100 tokens (Level 0) = 20,000 tokens (catalog only)
FTS5 narrows to 10 → 1,000 tokens + 1 activated = 1,800 tokens

Savings: 98.9% vs. naive loading
```

但更大的问题不是 token——而是**注意力稀释**。当模型看到 160K token 的技能文本时，它对用户实际问题的注意力会下降。模型可能遵循不相关技能的指令，产生不同技能流程中提到的幻觉工具调用，或在技能文本堆积下丢失对话线索。

渐进式披露让模型保持专注：它看到一个简短的目录，决定哪个技能相关，然后只加载该技能的内容。

### 描述问题（再议）

来自 Hermes SkillDesignBook：

> *"如果一个技能没有被触发，问题几乎从来不在于指令——而在于描述。"*

Level 0 目录是技能的全部搜索面。如果描述与用户实际说的不匹配，技能就是不可见的：

```
Bad description:
  "Kubernetes management"
  → Doesn't match: "my pod keeps crashing"

Good description:
  "Diagnose and fix common Kubernetes pod failures including
   CrashLoopBackOff, ImagePullBackOff, OOMKilled, and pending pods"
  → Matches: "my pod keeps crashing" (CrashLoopBackOff)
  → Matches: "can't pull the image" (ImagePullBackOff)
  → Matches: "pod killed for memory" (OOMKilled)
```

描述应该包含：
- 问题的技术术语
- 用户实际说的自然语言短语
- 具体的症状和错误消息
- 2-4 句话，不超过 100 token

### Claude Code 的变体

Claude Code 通过其 Agent Skills 系统实现渐进式披露，架构略有不同：

```
User message arrives
  ↓
Match against skill index (name + description fields only)
  ↓
0 matches → No skills loaded (saves all skill tokens)
1-3 matches → Full skill content loaded into context
4+ matches → Top 3 by relevance score loaded
```

匹配是纯粹的文本匹配，只针对 `name` 和 `description`——技能正文永远不会被用于激活搜索。这强化了描述优先的原则：如果技能的名称和描述与用户意图不匹配，技能的指令就是无关的，因为它们永远不会被看到。

---

## 模式 6：自我验证循环

**来源：** Devin 2.2（2026 年 2 月）

**问题：** Agent 生成看似合理但可能错误的输出。传统 CI/CD 在提交后才捕获错误。但到那时，*为什么*写这段代码的上下文已经消失——Agent 已经继续处理其他任务或会话已结束。

**解决方案：** Agent 在提交前审查自己的输出，捕获问题，修复它们，并验证修复——所有这些都在同一会话内完成，趁上下文仍然新鲜。

### Devin 的循环

Devin 2.2 将系统性的自我验证作为核心工作流步骤引入，而非可选附加功能：

```
┌────────────────┐
│  1. Plan        │  Break task into steps
└───────┬────────┘
        │
        ▼
┌────────────────┐
│  2. Implement   │  Write code in full Linux sandbox
└───────┬────────┘
        │
        ▼
┌────────────────┐
│  3. Self-Review │  Read own diff, check for issues:
│                 │  - Logic errors
│                 │  - Missing edge cases
│                 │  - Style violations
│                 │  - Security issues
└───────┬────────┘
        │
   Issues found?
   ┌────┴────┐
   │ Yes     │ No
   ▼         ▼
┌────────┐  ┌──────────────────┐
│ 4. Fix │  │ 5. Run tests     │
└───┬────┘  └───────┬──────────┘
    │               │
    └───────────────┤
                    │
               Tests pass?
               ┌────┴────┐
               │ Yes     │ No → back to Fix
               ▼         │
        ┌─────────────┐  │
        │ 6. Visual    │  │
        │    verify    │◄─┘
        │    (desktop) │
        └──────┬──────┘
               │
               ▼
        ┌─────────────┐
        │ 7. Send      │  Screen recording of tests
        │    recording │  attached to PR for review
        │    to user   │
        └─────────────┘
```

### 桌面验证

Devin 拥有完整的 Linux 桌面访问权限——它可以打开浏览器、运行 GUI 应用程序和截屏。自我验证循环利用了这一点：

```
For a frontend change:
  1. Write the code
  2. Run the dev server
  3. Open the browser to the affected page
  4. Screenshot the result
  5. Compare against expected behavior
  6. If wrong: fix and re-screenshot
  7. Record a video of the working feature
  8. Attach video to PR
```

屏幕录制具有双重用途：它迫使 Agent 以视觉方式验证其工作（不仅仅是运行测试），并为人类审查者提供变更的演练。

### 自我验证作为会话内进化

自我验证是一种进化形式——但被压缩到单个会话中。Agent：

1. 生成初始方案（第 1 代）
2. 根据标准进行评估（适应度函数）
3. 识别弱点（选择压力）
4. 产生改进版本（第 2 代）
5. 重新评估（下一次适应度检查）

这与跨会话进化用于技能和记忆的优化-评估-改进循环是相同的。区别在于时间尺度：自我验证在几分钟内运作，技能进化在数周内运作。

### 自我验证能捕获什么

来自 Devin 2.2 发布的自我捕获问题指标：

| 问题类型 | 频率 | 示例 |
|-----------|-----------|---------|
| 缺少导入 | 高 | 添加了函数但忘记导入其依赖 |
| 不完整的错误处理 | 高 | 正常路径可用但错误情况抛出未处理的异常 |
| 测试覆盖缺口 | 中 | 测试通过但未覆盖新的代码路径 |
| 风格不一致 | 中 | 新代码使用了与周围代码不同的模式 |
| 逻辑错误 | 中低 | 差一错误、错误的比较运算符 |
| 安全问题 | 低 | SQL 注入、用户输入处理中的路径遍历 |

### 局限性

自我验证能捕获 Agent 通过重新阅读自己输出可以检测到的问题。它无法捕获：

- **微妙的设计错误：** 代码可以工作但方法不适合架构
- **性能问题：** 代码正确但产生了 N+1 查询或 O(n²) 循环
- **跨会话学习：** Devin 不会在跨会话中更好地避免*相同*的错误

这是关键差距：Devin 的自我验证在会话内很强大，但不产生持久的改进。每个新会话都从头开始。与 Hermes 相比，在 Hermes 中，自我评估捕获的错误会创建技能或记忆更新，从而在未来会话中防止同一错误。

---

## 模式总结

| 模式 | 来源 | 解决什么问题 | 持久性 |
|---------|--------|---------------|-------------|
| 心跳 | proactive-agent | 陈旧记忆、遗漏更新 | 跨会话 |
| WAL | proactive-agent | 压缩期间的状态丢失 | 会话内 + 跨会话 |
| 固化 | self-improving-agent | 永久记忆中的噪声 | 跨会话 |
| 基因组/胶囊 | capability-evolver | 细粒度模式复用 + 修复 | 跨会话 |
| 渐进式披露 | Hermes、Claude Code | 上下文浪费、注意力稀释 | 会话内 |
| 自我验证 | Devin 2.2 | 提交前的错误输出 | 会话内 |

### 组合模式

单一模式不够。最有效的 Agent 组合使用多个模式：

```
Hermes:
  Progressive Disclosure + Self-Evaluation (15-call checkpoint)
  + Solidification (SKILL.md creation from observations)

proactive-agent:
  Heartbeat + WAL + Solidification pipeline

capability-evolver:
  Genome/Capsule + audit trail (events.jsonl)

Devin:
  Self-Verification loop (within-session only)
```

目前没有生产系统实现的缺失组合是：**Devin 的自我验证 + Hermes 的跨会话学习**。一个既能捕获自身错误又能创建技能以防止未来会话中出现这些错误的 Agent，将闭合会话内和跨会话进化之间的循环。

### 模式选择指南

| 你的 Agent 的主要故障模式 | 从这里开始 |
|-----------------------------------|-----------|
| 在会话之间遗忘信息 | 心跳 + 固化 |
| 在长任务期间丢失状态 | WAL |
| 记忆变得嘈杂和矛盾 | 固化流水线（3 次观察阈值） |
| 重复相同的调试步骤 | 基因组/胶囊 |
| 加载不相关上下文浪费 token | 渐进式披露 |
| 首次尝试产生错误输出 | 自我验证循环 |
