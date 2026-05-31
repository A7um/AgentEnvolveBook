# Devin — 自验证与上下文焦虑

Cognition 打造的 Devin 是第一个自称"AI 软件工程师"的产品，2025 年初上线。它率先践行了一条核心理念：编码 Agent 在把结果展示给人类之前，应该先验证自己的工作——跑测试、查输出、反复迭代，直到结果正确。

Devin 的进化路径和 Claude Code、Hermes 截然不同。它不创建持久化技能，也不写记忆文件，而是全力押注**会话内改进**——通过系统化的自验证把每次会话的产出质量拉到最高。到 Devin 2.2（2026 年 2 月），自验证循环已经成为最核心的产品差异点。随后在 2026 年，Devin 加入了持久记忆、Auto Triage 和对 Windsurf 的收购——补上了跨会话学习的短板，并从编码 Agent 扩展为工程团队成员。

本章还会介绍 DeepWiki（Devin 的公开代码理解工具），以及 Devin 在迁移到 Sonnet 4.5 时发现的上下文焦虑现象——凡是会积累记忆或技能的 Agent，都绕不开这个问题。

---

## 自验证（Devin 2.2，2026 年 2 月）

### 完整循环

Devin 2.2 在提交 PR 前加入了强制自验证环节。没有例外——验证流程走完之前，Agent 无法提交任何工作：

```
┌─────────────────┐
│  1. Receive task  │  From Slack, web UI, or GitHub issue
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  2. Plan          │  Break task into subtasks
│                   │  Identify files to modify
│                   │  Identify tests to run
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  3. Implement     │  Write code in full Linux sandbox
│                   │  Has: terminal, browser, file system,
│                   │  package managers, Docker
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  4. Self-review   │  Re-read own diff
│                   │  Check: logic errors, missing edge cases,
│                   │  style consistency, security issues
└────────┬────────┘
         │
    Issues found?
    ┌────┴────┐
    Yes       No
    │         │
    ▼         ▼
┌────────┐  ┌─────────────────┐
│  Fix   │  │  5. Run tests    │  Use project's existing test suite
└───┬────┘  └────────┬────────┘
    │                │
    └──── loop ──────┤
                     │
                Tests pass?
                ┌────┴────┐
                No        Yes
                │         │
                ▼         ▼
           ┌────────┐  ┌─────────────────┐
           │ Debug  │  │  6. Visual test   │  Open browser,
           │ + Fix  │  │                   │  check UI changes,
           └───┬────┘  │                   │  screenshot results
               │       └────────┬──────────┘
               └─── loop ──────┤
                               │
                               ▼
                        ┌─────────────────┐
                        │  7. Record demo   │  Screen recording
                        │     + submit PR   │  attached to PR
                        └─────────────────┘
```

### 完整的 Linux 桌面访问

Devin 跑在一个完整的 Linux 沙箱里——不是只能敲命令行的精简容器，而是带桌面的完整环境：

| 能力 | 详情 |
|-----------|---------|
| 终端 | 完整的 bash、zsh、fish |
| 浏览器 | 具有完整渲染能力的 Chromium |
| 文件系统 | 对工作区的读写权限 |
| 包管理器 | npm、pip、cargo、apt 等 |
| Docker | 可以构建和运行容器 |
| 桌面 | 可以打开 GUI 应用、截屏 |
| 网络 | 用于测试的 HTTP/HTTPS 访问 |

有了桌面环境，Devin 就能做到其他编码 Agent 做不到的视觉验证：

```
Frontend change verification:
  1. Write the CSS/React/Vue code
  2. Start the dev server (npm run dev)
  3. Open Chromium to localhost:3000
  4. Navigate to the affected page
  5. Screenshot the result
  6. Compare: does this match the user's request?
  7. If not: identify the visual issue, fix it, re-screenshot
  8. Record a screen recording of the working feature
```

### 屏幕录制作为证据

Devin 会在 PR 里附上屏幕录制，一举三得：

1. **强制验证：** 要录屏，Agent 就必须亲眼看到功能正常运行。坏掉的功能录不出合格的演示。

2. **评审提效：** 评审者看 30 秒视频就能了解变更效果，不用对着 diff 在脑子里模拟运行结果。

3. **回归基线：** 录制留下了"变更正常工作时长什么样"的记录。将来出了回归问题，可以直接对照。

### 自审查质量

自审查和跑测试是两回事。测试按预定义的断言检验正确性，自审查看的是变更的*整体质量*：

```
What self-review catches that tests don't:

1. Code style inconsistencies
   - New code uses different patterns than surrounding code
   - Agent mixed tabs and spaces, or used different quote styles
   - Variable naming doesn't match project conventions

2. Missing error handling
   - Happy path works (tests pass) but errors are unhandled
   - Network failures, file not found, invalid input

3. Incomplete implementation
   - Added the endpoint but forgot to register the route
   - Implemented the feature but forgot to update the docs

4. Security issues
   - Tests pass but user input isn't sanitized
   - Credentials logged in debug output

5. Performance concerns
   - Code works but creates N+1 queries
   - Unbounded list operations on large datasets
```

---

## Auto Triage — 从编码 Agent 到工程团队成员

### 角色转变

Devin 2.2 的自验证循环是被动响应式的：人类分配任务，Devin 高质量地执行。Auto Triage（2026 年）颠覆了这个模型。Devin 实时监控 bug、日志和告警——无需人工分配任务——并自主采取行动。

这从根本上改变了"编码 Agent"的含义。Agent 不是在帮工程师干活，而是*自己就是工程师*——针对那些此前需要人类关注但不需要人类创造力的工作类别。

### 自动化工作流

| 工作流 | 触发条件 | 产出 |
|----------|---------|--------|
| 事故复盘 | PagerDuty 事故结束 | 自动生成时间线、根因分析和行动项 |
| 每日 Sentry 修复 | 夜间错误累积 | 拉取新 Sentry 错误，早晨前提交修复 PR |
| 每周依赖更新 | 定时扫描 | 识别过期包、运行测试、提交升级 PR |
| CI 构建修复 | CI 构建失败 | 定位根因、提交修复 |
| 健康摘要 | 每日定时 | 汇总 DataDog 指标，发布到 Slack |

### 对进化的意义

Auto Triage 代表了一条与自验证不同的进化轴线。自验证提升单个任务的*质量*，Auto Triage 扩大 Agent 处理的*范围*——它接手那些原本会在队列中等到有人来分拣的工作。

```
Before Auto Triage:
  6:00 AM  Sentry error fires → sits in dashboard
  9:00 AM  Engineer arrives → reviews errors → picks one
  9:30 AM  Engineer assigns to Devin (or fixes manually)
  10:00 AM Fix merged

After Auto Triage:
  6:00 AM  Sentry error fires → Devin detects it
  6:05 AM  Devin opens fix PR → runs tests → self-reviews
  9:00 AM  Engineer arrives → reviews Devin's PR → merges
```

工程师的角色从"分拣然后修复"变成了"审查然后合并"。对于常规问题，Agent 承接了从发现到诊断到修复的完整闭环。

---

## DeepWiki

### 是什么

DeepWiki（`deepwiki.com`）是 Devin 推出的公开代码理解工具，能自动索引公共 GitHub 仓库并生成：

- **架构图：** 展示模块间连接关系的可视化地图
- **模块文档：** 自动为每个主要组件生成说明文档
- **依赖图：** 模块间的依赖关系一目了然
- **代码搜索：** 基于索引的跨代码库语义搜索

### 如何与 Devin 集成

Devin 接到某个仓库的任务后，可以先向 DeepWiki 查询上下文：

```
User: "Fix the authentication bug in the /api/login endpoint"

Devin's process:
  1. Query DeepWiki: "How does authentication work in this repo?"
  2. DeepWiki returns:
     - Architecture diagram showing auth flow
     - Relevant files: src/auth/login.ts, src/middleware/auth.ts
     - Dependencies: passport, express-session
  3. Devin reads those specific files (informed by DeepWiki context)
  4. Devin understands the system before making changes
```

这就是上下文工程的典型做法：DeepWiki 把代码库预处理成可搜索的知识库，Agent 不必逐个翻阅几百个文件就能理解整体架构。

### 配置：.devin/wiki.json

团队可以自定义 DeepWiki 的索引方式：

```json
{
  "include": ["src/**/*.ts", "src/**/*.tsx", "lib/**/*.ts"],
  "exclude": ["**/*.test.ts", "**/node_modules/**", "dist/**"],
  "focus_areas": [
    {
      "name": "Authentication",
      "paths": ["src/auth/**", "src/middleware/auth*"],
      "description": "OAuth2 + JWT authentication system"
    },
    {
      "name": "API Layer",
      "paths": ["src/api/**"],
      "description": "Express routes with zod validation"
    }
  ],
  "custom_docs": [
    "docs/architecture.md",
    "docs/api-conventions.md"
  ]
}
```

`focus_areas` 告诉 DeepWiki 哪些代码最关键——这些区域会得到更精细的索引，也更容易出现在相关搜索结果中。

### Ask Devin 集成

DeepWiki 驱动了 "Ask Devin" 功能——一个对话式界面，可以就任意公共仓库提问：

```
User: "How does this project handle database migrations?"

Ask Devin:
  1. Searches DeepWiki index for migration-related code
  2. Finds: src/db/migrations/, knexfile.ts, package.json scripts
  3. Reads relevant files
  4. Responds: "This project uses Knex.js for migrations.
     Migration files are in src/db/migrations/ with timestamps.
     Run with: npm run db:migrate (wraps knex migrate:latest).
     Rollback with: npm run db:rollback."
```

---

## 上下文焦虑

### 问题描述

Devin 团队在迁移到 Anthropic Sonnet 4.5 的过程中，发现了一种行为模式——**上下文焦虑**：模型感知到上下文窗口快被填满时，会主动改变自身行为。

具体表现：

```
Context window: 200K tokens
Tokens used: 40K (20% full)
  → Agent behavior: thorough, explores options, reads multiple files

Tokens used: 120K (60% full)
  → Agent behavior: starts taking shortcuts
  → Reads fewer files before making decisions
  → Generates shorter code with less error handling
  → Skips verification steps it would normally perform

Tokens used: 170K (85% full)
  → Agent behavior: rushes to finish
  → Makes assumptions instead of checking
  → Produces lower-quality output
  → May not run tests before submitting
```

没有人刻意编程让模型这样做。这是训练数据带来的副作用——训练语料中较长的对话往往已接近尾声，模型于是学会了"长对话 = 该收尾了"的行为模式。

### 为什么并行会加剧问题

Devin 会并行处理某些子任务，每条并行线程各自消耗上下文：

```
Sequential execution:
  Task A (10K tokens) → Task B (10K tokens) → Task C (10K tokens)
  Total context at Task C: 30K tokens

Parallel execution:
  Task A (10K) ─┐
  Task B (10K) ─┤──► Merge results (all 30K tokens in context at once)
  Task C (10K) ─┘

  But the merge step also generates tokens, so:
  Merge context: 30K (inputs) + 5K (merge reasoning) = 35K tokens
```

并行不省上下文——只是把消耗集中到了前面。合并步骤需要所有并行输出同时在场，可能比顺序执行更快地把窗口推过焦虑阈值。

### 对自我进化的影响

上下文焦虑对 Agent 进化有一个直接但常被忽视的冲击：

```
The evolution paradox:
  More evolution = more accumulated knowledge
  More accumulated knowledge = more context loaded at session start
  More context loaded = less room for the actual task
  Less room = context anxiety kicks in earlier
  Earlier anxiety = lower quality output

In numbers:
  Base system prompt:     4K tokens
  AGENTS.md:              2K tokens
  Loaded skills (3):      3K tokens
  Memory file:            1K tokens
  Conversation so far:    0K tokens
  ─────────────────────
  Before user says anything: 10K tokens used

  A highly evolved agent with rich memory + many skills:
  Base system prompt:     4K tokens
  AGENTS.md:              4K tokens (extensive)
  CLAUDE.md (all scopes): 10K tokens
  Loaded skills (5):      5K tokens
  Memory files:           3K tokens
  Loaded rules:           2K tokens
  ─────────────────────
  Before user says anything: 28K tokens used
```

一个高度进化的 Agent 还没开始对话就已经占掉 28K token。200K 窗口下，光记忆就吃掉 14%；128K 窗口下更是占到 22%。留给思考的空间变小，探索深度打折，焦虑阈值也更早触发。

### 根本张力

这形成了 Agent 自我进化中的根本矛盾：

```
                    ┌────────────────┐
                    │   More memory  │
                    │   More skills  │
                    │   More rules   │
                    └───────┬────────┘
                            │
                   Benefits ▼          Costs
              ┌──────────────────┐  ┌──────────────────┐
              │ Better decisions │  │ Less room to     │
              │ Fewer mistakes   │  │ think            │
              │ Consistent style │  │ Earlier anxiety  │
              │ Known gotchas    │  │ Token cost       │
              └──────────────────┘  └──────────────────┘
```

最优解不是"记忆越多越好"，而是找到临界点：多加一条记忆的边际收益恰好等于它占用上下文带来的边际成本。目前没有任何生产系统把这个权衡量化成可操作的机制。

### 缓解策略

各生产系统采用的缓解策略：

| 策略 | 使用者 | 机制 |
|----------|---------|-----------|
| Token 预算 | Claude Code（每文件 4K，总计 12K） | 对记忆上下文的硬性上限 |
| 渐进式披露 | Hermes、Claude Code | 仅加载技能名称；按需获取完整内容 |
| 基于优先级的裁剪 | Cursor (Priompt) | 当预算超出时丢弃低优先级上下文 |
| 上下文隔离 | Manus（多 Agent） | 每个 Agent 获得全新上下文，无记忆累积 |
| 激进摘要 | Codex（压缩） | 压缩历史以释放空间 |

这些方案都不是彻底的解决办法。Token 预算的数字多少有些拍脑袋（为什么是 12K 而不是 8K 或 20K？）。渐进式披露对技能管用，但帮不了记忆。压缩必然丢信息。上下文焦虑至今仍是开放问题。

---

## 持久记忆（2026 年 5 月）

### 补上短板

本章前面指出了 Devin 缺乏跨会话学习这一关键短板——"CORS 问题调试两次各花 15 分钟"的问题。2026 年，Devin 上线了跨会话的持久记忆。

Agent 现在能从历史会话中学习，并持续优化内部操作手册。遇到解决过的问题时，它会调用先前经验而非从头摸索：

```
Before persistent memory (the original gap):
  Session 1: Debug CORS issue → 15 min → fix
  Session 2: Debug CORS issue → 15 min → fix (identical process)

After persistent memory:
  Session 1: Debug CORS issue → 15 min → fix → stores resolution
  Session 2: Recalls CORS resolution → applies fix → 2 min
```

短板补上了。Devin 现在同时具备自验证（会话内改进）和持久记忆（跨会话改进）。

### 与上下文焦虑的交互

持久记忆重新引入了上下文焦虑那一节描述的张力：每一条在会话启动时加载的记忆都会消耗 token。Devin 的上下文窗口分级——128K（Starter）、2M（Pro）、10M+（Enterprise）——提供了缓冲空间，但根本权衡不变。更多记忆意味着更明智的决策，代价是思考空间缩小。10M+ 的 Enterprise 级别暗示了 Cognition 的判断：只要窗口足够大，焦虑阈值就能被推到足够远，使记忆积累对大多数任务来说收益大于成本。

### 动态重规划

与持久记忆同时上线的还有动态重规划：Agent 在任务执行中遇到障碍时，无需等待人类干预就能调整策略。这比表面看起来更微妙。早期版本的 Devin 会死板地跟着初始计划走，反复重试失败的方案。动态重规划意味着 Agent 能识别出"这条路走不通"并转向——这是让持久记忆真正有用的前提。没有重规划能力，记住的策略会变成僵化的操作手册；有了重规划，记忆变成 Agent 根据当下情况灵活调整的起点。

---

## Windsurf 收购

### 事件

2025 年年中，Cognition 收购了 Windsurf（前身为 Codeium）——一个成熟的 IDE 扩展产品，在结对编程细分市场拥有稳定的用户基础。

### 产品策略

这次收购让 Cognition 获得了双层产品覆盖：

| 产品 | 模式 | 适用场景 |
|---------|------|----------|
| Devin | 自主模式 | 完整任务：工单、bug、部署——Agent 独立完成 |
| Windsurf | 协作模式 | IDE 结对编程——Agent 与开发者实时协同 |

两者共享基础设施：代码理解、搜索和索引。开发者可以白天用 Windsurf 获取实时编码辅助，晚上把任务交给 Devin 的 Auto Triage。

### 平台成熟

整合后的平台已经大幅成熟：

| 能力 | 详情 |
|-----------|--------|
| v3 API | RBAC、服务用户认证、会话编排 |
| 自动化构建器 | GitHub push 事件触发的文件变更触发器 |
| MCP server | 在 MCP 市场上可用，支持工具集成 |
| 平台选择 | 新会话默认使用 Linux 或 Windows |
| 上下文窗口 | 128K（Starter）→ 2M（Pro）→ 10M+（Enterprise） |

---

## Devin 关于进化的启示

### 自验证就是会话内进化

Devin 的自验证循环本质上是一个浓缩版的进化过程：

```
Generation 1: Initial implementation
  ↓ Fitness check: self-review + tests
Generation 2: Fixed implementation
  ↓ Fitness check: self-review + tests
Generation N: Final implementation
  ↓ Submission: PR with screen recording
```

每一轮迭代都在改进产出，Agent 在一次会话之内就完成了方案的进化。效果很显著——Devin 的自检捕获率证明了这套机制的价值。

### 跨会话学习：短板已补

本章最初撰写时，我们指出 Devin 缺乏跨会话学习是最关键的短板。和 Hermes 的对比非常鲜明：

```
Devin (before persistent memory):
  Session 1: Debug CORS issue → 15 min → fix
  Session 2: Debug same CORS issue → 15 min → fix (no memory)

Hermes:
  Session 1: Debug CORS → fix → create SKILL.md
  Session 2: Load skill → apply fix → 2 min
```

有了持久记忆（2026 年 5 月），Devin 补上了这个短板。Agent 现在能跨会话保留知识并优化内部操作手册——不是通过像 Hermes 那样的显式技能文件，而是通过持久记忆存储来指导未来会话。

### 自验证 + 学习的结合

理想的系统应当兼具两者：

1. **自验证**（Devin 的长项）：提交前捕获错误
2. **跨会话学习**（Hermes 的长项）：防止同样的错误在未来重现

Devin 现在是第一个同时在两方面做到深度实现的生产系统。自验证确保每次会话的产出质量，持久记忆确保 Agent 跨会话持续进步。Hermes 的技能创建仍然更精细（显式的结构化 SKILL.md 文件 vs. Devin 的隐式记忆），但 Devin 将严格的自审查、持久记忆和 Auto Triage 三者结合，构成了目前生产环境中最完整的会话内 + 跨会话进化闭环。

### 上下文焦虑作为设计约束

上下文焦虑的发现，应当改变每个 Agent 开发者思考记忆设计的方式：

1. **记忆不是免费的。** 每多加载一个 token 的记忆，可用的思考空间就少一分。
2. **多不一定好。** 50 行的 AGENTS.md 可能比 500 行的效果更好——如果多出来的内容刚好把 Agent 推过了焦虑阈值。
3. **预算控制不可或缺。** Claude Code 设定每文件 4K、总计 12K 的上限，是深思熟虑的设计选择，不是随便定的数字。
4. **量化这个权衡。** 追踪任务完成质量和记忆规模之间的关系，找到你系统的最优点。

---

## 总结：Devin 的进化技术栈

```
┌──────────────────────────────────────────────┐
│                    Devin                       │
├──────────────────────────────────────────────┤
│                                              │
│  Self-Verification Layer                     │
│  ├── Plan → code → self-review → test → fix │
│  ├── Full Linux desktop (visual verification)│
│  ├── Screen recordings as evidence           │
│  └── Mandatory before PR submission          │
│                                              │
│  Auto Triage Layer                           │
│  ├── Real-time monitoring (logs, alerts)     │
│  ├── Autonomous fix PRs (Sentry, CI, deps)   │
│  ├── Incident postmortems (PagerDuty)        │
│  └── No human assignment required            │
│                                              │
│  Memory Layer                                │
│  ├── Persistent memory (cross-session)       │
│  ├── Internal playbook refinement            │
│  └── Dynamic re-planning on roadblocks       │
│                                              │
│  Knowledge Layer                             │
│  ├── DeepWiki (auto-indexed repo knowledge)  │
│  ├── .devin/wiki.json (configuration)        │
│  └── Ask Devin (conversational code search)  │
│                                              │
│  Platform                                    │
│  ├── Devin (autonomous) + Windsurf (IDE)     │
│  ├── v3 API with RBAC, session orchestration │
│  ├── MCP server in marketplace               │
│  └── Context: 128K / 2M / 10M+ tiers        │
│                                              │
│  Discovery                                   │
│  └── Context anxiety (Sonnet 4.5 rebuild)    │
│      - Model quality degrades as context fills│
│      - Parallelism accelerates the problem   │
│      - Memory/skills consume thinking space  │
│                                              │
│  Remaining Gap                               │
│  └── No structured skill creation (cf. Hermes│
│      SKILL.md — Devin's memory is implicit)  │
│                                              │
└──────────────────────────────────────────────┘
```

Devin 对自我进化领域的贡献现在是三重的。第一，证明了自验证——Agent 审查并修复自己的工作——是切实可行的会话内进化手段。第二，揭示了上下文焦虑这一根本矛盾：积累的知识越多，留给思考的空间就越少。第三，通过持久记忆和 Auto Triage，证明了编码 Agent 不仅能跨会话进化，还能自主扩大职责范围——不只是把分配的工作做得更好，而是自主发现并完成从未被显式分配的工作。
