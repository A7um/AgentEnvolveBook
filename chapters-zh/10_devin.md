# Devin — 自验证与上下文焦虑

Devin 由 Cognition 构建，是第一个自称"AI 软件工程师"的产品。它于 2025 年初发布，率先提出了一个理念：编码 Agent 应该在展示给人类之前验证自己的工作——运行测试、检查输出、反复迭代直到结果正确。

Devin 的进化方式与 Claude Code 或 Hermes 有着本质区别。它不创建持久化技能，不编写记忆文件。相反，Devin 专注于**会话内改进**——通过系统性的自验证使每次会话的输出尽可能优秀。而在 Devin 2.2（2026 年 2 月）中，自验证循环成为了核心产品差异化特性。

本章还涵盖了 DeepWiki——Devin 的公共代码理解工具，以及在 Devin 的 Sonnet 4.5 重构过程中发现的上下文焦虑问题——这个问题对每一个积累记忆或技能的 Agent 都有影响。

---

## 自验证（Devin 2.2，2026 年 2 月）

### 完整循环

Devin 2.2 在提交任何 PR 之前引入了强制性的自验证步骤。这不是可选的——Agent 在完成验证周期之前无法提交工作：

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

Devin 运行在一个完整的 Linux 沙箱中——不是仅有 CLI 工具的受限容器，而是一个完整的桌面环境：

| 能力 | 详情 |
|-----------|---------|
| 终端 | 完整的 bash、zsh、fish |
| 浏览器 | 具有完整渲染能力的 Chromium |
| 文件系统 | 对工作区的读写权限 |
| 包管理器 | npm、pip、cargo、apt 等 |
| Docker | 可以构建和运行容器 |
| 桌面 | 可以打开 GUI 应用程序、截屏 |
| 网络 | 用于测试的 HTTP/HTTPS 访问 |

这种桌面访问能力实现了其他编码 Agent 无法匹配的视觉验证：

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

Devin 在 PR 中附带屏幕录制。这服务于三个目的：

1. **强制验证：** Agent 必须亲眼看到输出正常工作才能创建录制。它无法伪造一个损坏功能的录制。

2. **人类评审效率：** 评审者可以观看 30 秒的视频，而不是阅读 diff 并在脑中模拟行为。

3. **回归基线：** 录制记录了变更正常工作时的样子。如果未来的变更破坏了它，录制展示了预期的行为。

### 自审查质量

自审查步骤与运行测试是不同的。测试根据预定义的断言检查正确性。自审查检查的是变更的*整体质量*：

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

DeepWiki（`deepwiki.com`）是 Devin 面向公众的代码理解工具。它自动索引公共 GitHub 仓库并生成：

- **架构图：** 模块如何连接的可视化地图
- **模块文档：** 为每个主要组件自动生成的文档
- **依赖图：** 哪些模块依赖哪些模块
- **代码搜索：** 跨索引代码库的语义搜索

### 如何与 Devin 集成

当 Devin 收到一个仓库上的任务时，它可以查询 DeepWiki 获取上下文：

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

这是一种上下文工程：DeepWiki 将代码库预处理为可搜索的知识库，这样 Agent 就不需要阅读数百个文件来理解架构。

### 配置：.devin/wiki.json

团队可以自定义 DeepWiki 索引：

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

`focus_areas` 告诉 DeepWiki 代码库中哪些部分最重要——确保它们获得更高质量的索引并出现在相关搜索结果中。

### Ask Devin 集成

DeepWiki 为 "Ask Devin" 功能提供支持——一个用于询问任何公共仓库问题的对话式界面：

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

在 Devin 基于 Anthropic 的 Sonnet 4.5 模型进行重构时，团队发现了一种被称为**上下文焦虑**的行为模式：模型意识到其上下文窗口正在填满，并据此改变自己的行为。

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

模型并非被显式编程为如此行为。这源于模型的训练数据——较长的对话往往在收尾阶段，模型学会了匹配这种模式。

### 为什么并行会加剧问题

Devin 对某些子任务使用并行执行。每个并行线程独立消耗上下文：

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

并行并不节省上下文——它将上下文前置集中了。合并步骤需要所有并行输出同时在上下文中，这可能比顺序执行更快地将窗口推过焦虑阈值。

### 对自我进化的影响

上下文焦虑对 Agent 进化有一个直接且被低估的影响：

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

高度进化的 Agent 在对话开始之前就已经消耗了 28K token 的上下文。在 200K 上下文窗口上，这意味着仅记忆就占用了 14%。在 128K 窗口上则是 22%。Agent 的思考空间更少，探索不够深入，更早触及焦虑阈值。

### 根本张力

这在 Agent 自我进化中制造了一种根本性的张力：

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

最优点并非"最大化记忆"——而是多加一条记忆条目的边际收益等于其消耗上下文的边际成本的那个点。目前没有任何生产系统将这种权衡形式化。

### 缓解策略

在各生产系统中观察到的策略：

| 策略 | 使用者 | 机制 |
|----------|---------|-----------|
| Token 预算 | Claude Code（每文件 4K，总计 12K） | 对记忆上下文的硬性上限 |
| 渐进式披露 | Hermes、Claude Code | 仅加载技能名称；按需获取完整内容 |
| 基于优先级的裁剪 | Cursor (Priompt) | 当预算超出时丢弃低优先级上下文 |
| 上下文隔离 | Manus（多 Agent） | 每个 Agent 获得全新上下文，无记忆累积 |
| 激进摘要 | Codex（压缩） | 压缩历史以释放空间 |

这些方案都没有完全解决问题。Token 预算是任意的（为什么是 12K 而不是 8K 或 20K？）。渐进式披露对技能有帮助，但对记忆无效。压缩会丢失信息。上下文焦虑问题仍然是开放性问题。

---

## Devin 关于进化的启示

### 自验证就是会话内进化

Devin 的自验证循环是一个压缩的进化周期：

```
Generation 1: Initial implementation
  ↓ Fitness check: self-review + tests
Generation 2: Fixed implementation
  ↓ Fitness check: self-review + tests
Generation N: Final implementation
  ↓ Submission: PR with screen recording
```

每次迭代都改进输出。Agent 在会话内进化其解决方案。这很强大——Devin 的自检错误率展示了真正的价值。

### 但 Devin 缺乏跨会话学习

关键差距：Devin 不会随着累积经验而变得更好。每次会话都是从零开始：

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

与 Hermes 对比：

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

理想的系统应结合两者：

1. **自验证**（Devin）：在提交前捕获错误
2. **跨会话学习**（Hermes）：在未来的会话中防止同样的错误

没有任何生产系统同时深度实现了这两者。Devin 拥有最好的自验证但没有跨会话学习。Hermes 拥有最好的跨会话学习但自验证不够精细（每 15 次工具调用的检查点比 Devin 的完整审查-测试-修复循环要轻量）。

### 上下文焦虑作为设计约束

上下文焦虑的发现应该改变每个 Agent 开发者对记忆设计的思考方式：

1. **记忆不是免费的。** 每一个加载的记忆 token 都减少了可用的思考空间。
2. **多不一定好。** 一个 50 行的 AGENTS.md 可能比 500 行的表现更好，如果额外的行数将 Agent 推过了焦虑阈值。
3. **预算控制是必要的。** Claude Code 的每文件 4K、总计 12K 预算是一个经过深思熟虑的设计选择，而非任意的限制。
4. **衡量这个权衡。** 跟踪任务完成质量与记忆大小的关系。找到你系统的最优点。

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

Devin 对自我进化领域的贡献有两方面。第一，它证明了自验证——Agent 审查和修复自己的工作——是一种可行且有价值的会话内进化机制。第二，它揭示了上下文焦虑问题——累积知识与可用思考空间之间的根本张力，这是每个进化中的 Agent 都必须应对的问题。
