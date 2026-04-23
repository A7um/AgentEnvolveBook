# Devin — 自验证与上下文焦虑

Cognition 打造的 Devin 是第一个自称"AI 软件工程师"的产品，2025 年初上线。它率先践行了一条核心理念：编码 Agent 在把结果展示给人类之前，应该先验证自己的工作——跑测试、查输出、反复迭代，直到结果正确。

Devin 的进化路径和 Claude Code、Hermes 截然不同。它不创建持久化技能，也不写记忆文件，而是全力押注**会话内改进**——通过系统化的自验证把每次会话的产出质量拉到最高。到 Devin 2.2（2026 年 2 月），自验证循环已经成为最核心的产品差异点。

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

### 但 Devin 缺乏跨会话学习

关键短板：Devin 不会随经验积累而进步。每次会话都从零开始：

```
Session 1:
  Agent encounters CORS issue with new endpoint
  Agent debugs for 15 minutes
  Agent finds fix: add cors middleware to route
  Agent submits PR
  ← Knowledge of CORS fix exists only in session 1's context

Session 2 (same project, similar task):
  Agent encounters CORS issue with new endpoint
  Agent debugs for 15 minutes (same process as session 1)
  Agent finds fix: add cors middleware to route
  Agent submits PR
  ← Same debugging, same time, no learning from session 1
```

对比一下 Hermes：

```
Session 1:
  Agent encounters CORS issue
  Agent debugs → finds fix
  Agent creates SKILL.md: "cors-endpoint-setup"
  Agent updates MEMORY.md: "This project requires CORS middleware"

Session 2:
  Agent searches skills → finds "cors-endpoint-setup"
  Agent loads skill → applies procedure
  Fix applied in 2 minutes instead of 15
```

### 自验证 + 学习的结合

理想的系统应当兼具两者：

1. **自验证**（Devin 的长项）：提交前捕获错误
2. **跨会话学习**（Hermes 的长项）：防止同样的错误在未来重现

目前没有任何生产系统把两者都做到位。Devin 的自验证最强，但没有跨会话学习；Hermes 的跨会话学习最强，但自验证粒度较粗——每 15 次工具调用设一个检查点，远不如 Devin 的完整审查-测试-修复循环细致。

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
│  Knowledge Layer                             │
│  ├── DeepWiki (auto-indexed repo knowledge)  │
│  ├── .devin/wiki.json (configuration)        │
│  └── Ask Devin (conversational code search)  │
│                                              │
│  Discovery                                   │
│  └── Context anxiety (Sonnet 4.5 rebuild)    │
│      - Model quality degrades as context fills│
│      - Parallelism accelerates the problem   │
│      - Memory/skills consume thinking space  │
│                                              │
│  Gap                                         │
│  └── No cross-session learning               │
│  └── No skill creation from experience       │
│  └── No persistent memory files              │
│                                              │
└──────────────────────────────────────────────┘
```

Devin 对自我进化领域有两大贡献。第一，证明了自验证——Agent 审查并修复自己的工作——是切实可行且有价值的会话内进化手段。第二，揭示了上下文焦虑这一根本矛盾：积累的知识越多，留给思考的空间就越少。每个不断进化的 Agent 都必须正视这个问题。
