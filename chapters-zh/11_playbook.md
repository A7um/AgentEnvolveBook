# 生产环境自我进化实战手册

本章把前面十章的所有模式汇总成一份可操作的指南，从"今天就能做"到"极其谨慎地推进"，分为五个级别。每个级别都会引用做得最好的生产系统及其具体实现细节。

---

## 级别 1：文件系统记忆（第 1 天）

**投入：** 30 分钟。**影响：** 立竿见影。

每个 Agent 都该有这个。在 Agent 自我进化的所有手段里，这是投入产出比最高的单一操作：在项目里放一个纯文本文件，会话启动时自动加载到系统提示词中。

### 创建什么

在项目根目录创建一个文件：

```markdown
# CLAUDE.md / AGENTS.md / GEMINI.md

## Build & Test
- Install: `pnpm install`
- Test: `pnpm test`
- Lint: `pnpm run lint`
- Type check: `tsc --noEmit`

## Architecture
- src/api/ — FastAPI routes (thin controllers)
- src/services/ — Business logic (no I/O)
- src/models/ — SQLAlchemy models
- src/workers/ — Celery task definitions

## Coding Conventions
- Use dataclasses, not dicts, for structured data
- All public functions need docstrings (Google style)
- Tests use pytest with fixtures in conftest.py
- Prefer pathlib over os.path

## Known Gotchas
- The Stripe webhook handler uses raw body — don't add
  middleware that parses the body before it
- Redis connection pool maxes at 20 — don't open more
  in tests or CI will hang
```

### 大小规则

来自 Claude Code、Codex 和 Cursor 的生产经验：

| 指标 | 建议值 | 原因 |
|--------|------------|-----|
| 总长度 | 50-200 行 | 更长会浪费上下文（参见上下文焦虑，第 10 章） |
| Token 数 | 1K-4K token | Claude Code 每文件上限 4K 是有讲究的 |
| 章节数 | 3-6 | 超过 6 个会分散模型注意力 |
| 每条长度 | 1-2 行 | 简洁的条目更容易被稳定遵循 |

### 使用哪个文件名

| 系统 | 文件 | 自动加载 |
|--------|------|------------|
| Claude Code | `CLAUDE.md` | 是（从当前工作目录向上遍历发现） |
| Codex | `AGENTS.md` | 是（仓库根目录固定路径） |
| Gemini CLI | `GEMINI.md` | 是（仓库根目录）；分层：`~/.gemini/GEMINI.md`（全局）+ 项目级 |
| Cursor | `.cursor/rules/*.mdc` | 是（glob 匹配或始终应用） |
| Copilot | `.github/copilot-instructions.md` + 全局 `.agent.md` | 是（仓库级 + 跨工作区） |
| 所有 Agent | `README.md` | 通常默认包含在上下文中 |

如果团队同时用多种 AI 工具，可以维护并行文件，也可以统一用 `AGENTS.md`（通用性最强的名称）。

### /init 模式

Claude Code 和 Codex 都提供（或拟提供）一个 `/init` 命令，通过扫描项目自动生成初始记忆文件：

```
/init scans:
  - package.json / pyproject.toml / Cargo.toml → build commands
  - .github/workflows/ → CI configuration
  - Directory structure → architecture overview
  - .eslintrc / ruff.toml / rustfmt.toml → coding conventions
  - README.md → project description
```

如果你用的工具没有 `/init`，手动创建即可。花 30 分钟写好，之后每次会话都会受益。

---

## 级别 1.5：社区方法论强制执行（第 2 天）

**投入：** 1 小时。**影响：** 从第一次会话起就强制执行结构化工作流。

2025 年初出现、2026 年中成熟的一条新进化路径：Agent 不从经验中学习方法论——而是由社区**直接给定**方法论。Superpowers（截至 2026 年 5 月已有 213K+ 星标、476K+ 安装量）是典型代表，但这种模式不限于特定平台。

### Hook 与技能：两个基本单元

社区编写的方法论强制执行依赖两个互补的基本单元：

| 基本单元 | 类型 | 何时触发 | 示例 |
|-----------|------|---------------|---------|
| Hook | 确定性 | 在生命周期事件（启动、停止、提交前、测试后）触发 | "提交前先跑 linter" |
| 技能 | 概率性 | 模型判断技能与当前任务匹配时触发 | "写 React 组件时遵循这个模式" |

Hook 保证执行——Agent *必须*在指定事件运行它。技能是建议性的——模型自行判断何时相关。二者配合很有力：Hook 强制执行不可跳过的工作流步骤，技能则提供随上下文变化的引导。

### Superpowers 模式

Superpowers 通过 Hook 和技能的组合，强制执行一个七阶段开发工作流：

```
Phase 1: Brainstorming     ← Skill activation
Phase 2: Design            ← Skill activation
Phase 3: Planning          ← Skill activation  
Phase 4: Implementation    ← Subagent-driven development
Phase 5: TDD               ← Hook: tests must pass before proceeding
Phase 6: Code Review       ← Skill activation + hook
Phase 7: Finishing          ← Hook: cleanup checks
```

"1% 规则"是一个关键设计选择：即使模型对技能匹配的置信度低至 1%，也会激活该技能。这迫使 Agent 在本想跳过步骤时仍然进入结构化工作流。代价是偶尔误触发，收益是方法论的严格执行。

### 跨平台兼容

同一套方法论包可以在多个 Agent 平台上使用：

| 平台 | Hook 机制 | 技能机制 |
|----------|---------------|-----------------|
| Claude Code | settings.json 中的 `hooks` | `.claude/skills/*.md` |
| Codex CLI | 任务前/后 Hook | `AGENTS.md` 内联技能 |
| Cursor | `.cursor/rules/*.mdc` 带生命周期触发器 | 规则文件 + glob 匹配 |
| Gemini CLI | `GEMINI.md` 工作流章节 | `/memory` 技能条目 |
| Copilot CLI | `.agent.md` 工作流定义 | 指令文件 |

跨平台支持意味着无论团队成员偏好哪种 Agent，都可以统一执行相同的方法论。

### 何时使用这一级别

级别 1.5 介于文件系统记忆和自动学习之间，因为它不需要任何学习基础设施——安装即强制执行。尤其适用于：

- **初次使用 Agent 的初级开发者团队**
- **跳过测试或评审代价高昂的代码库**
- **需要在多种 Agent 工具间统一开发方法论的组织**

风险：过度约束的 Agent 在任务不需要时也死板地遵循方法论。改一行配置不需要七个阶段。好的方法论包会为简单任务提供跳过机制。

---

## 级别 2：自动学习（第 1 周）

**投入：** 1-4 小时完成配置。**影响：** 随时间复合增长。

手动维护的记忆文件只是起点。真正的价值在于 Agent *自动*从交互中提炼经验，不靠人工干预就能更新记忆。

### Cursor 方案：持续学习插件

Cursor 的持续学习系统通过钩子触发：

```
Session ends (stop hook fires)
  ↓
Transcript mining:
  - Extract corrections: "No, use pnpm not npm"
  - Extract preferences: "I prefer concise responses"
  - Extract facts: "This project uses Postgres 15"
  ↓
AGENTS.md update:
  - Deduplicate against existing entries
  - Add new entries in appropriate sections
  - Remove contradicted entries
```

一个关键设计决策：更新发生在会话结束时，而不是会话进行中。会话中途的观察可能只是噪声，结束时再提炼更可靠。

### Claude Code 方案：自动记忆

Claude Code 把自动生成的记忆存放在 `~/.claude/projects/[project]/memory/`：

```
~/.claude/
  projects/
    my-api/
      memory/
        2026-04-15-auth-patterns.md
        2026-04-16-test-conventions.md
        2026-04-19-deployment-notes.md
```

约束条件：
- 单个记忆文件最多 **200 行**
- 整个项目的记忆文件总计 **25KB**
- 超出限制时自动裁剪，最旧的条目先删
- 用户可以查看和编辑已存储的记忆

上限是刻意设定的——目的是防止上下文焦虑（第 10 章）：如果记忆无限膨胀，会吃掉太多上下文窗口。

### Windsurf 方案：自动生成的记忆

Windsurf 在后台从用户交互中自动生成记忆。已知特点：

- **索引延迟：** 记忆约需 48 小时才能完成处理并可供查询
- **准确率：** 提取的事实准确率约 78%（通过用户纠正测量）
- **无显式上限：** 记忆持续累积，没有硬性限制
- **不透明：** 用户很难查看或编辑已存储的记忆

78% 这个准确率是一个关键权衡：自动学习不可避免地引入错误，需要后续纠正。对比 Cursor 纯人工编写的规则（准确率天然 100%）和 Claude Code 有上限的自动记忆（200 行限制控制了错误的影响面）。

### Copilot 方案：带代码引用的 Agentic 记忆

GitHub Copilot 的记忆系统（2026）加入了一个新颖设计：每条记忆都带有生成它的代码**引用**：

```
Memory entry:
  "This project uses zod for request validation"
  Citation: src/api/middleware/validate.ts:12-35

Memory entry:
  "API tests use supertest with in-memory SQLite"
  Citation: tests/api/setup.ts:1-20, tests/api/users.test.ts:5-15
```

引用有两个作用：
1. **验证：** Agent（或人类）可以查看引用的代码，确认记忆是否仍然准确
2. **过时检测：** 引用的代码一旦发生变更，记忆会被标记为待审查

Copilot 还引入了 **28 天验证**：28 天内没有被新证据确认的记忆会降级或删除，防止过时记忆越积越多。

### Devin 方案：持久记忆 + Auto Triage

Devin 的持久记忆（2026 年 5 月上线）补上了第 10 章指出的关键短板：缺乏跨会话学习。该系统结合了两种机制：

- **Auto Triage：** 根据历史模式对新任务分类，在执行前就路由到合适的工作流
- **持久记忆：** 事实、偏好和项目上下文跨会话保留，为后续任务提供参考

意义在于：Devin 曾是唯一没有跨会话学习的主流生产 Agent。这一功能的加入证实，持久记忆已成为基本配置——每个主要 Agent 都已具备。

### Codex Chronicle：基于屏幕捕获的环境记忆

Codex Chronicle 引入了一种新的被动学习方式：定期截取开发者屏幕，从中提取上下文信息：

```
Screen capture (every N minutes during active development)
  ↓
OCR + visual analysis:
  - IDE state: open files, cursor position, visible errors
  - Terminal output: build results, test failures
  - Browser tabs: documentation being consulted
  ↓
Context extraction:
  - "Developer frequently references the Stripe API docs"
  - "Build failures consistently involve the auth module"
  - "Developer switches between these 3 files for this feature"
```

这是一个全新的学习信号类别——Agent 不仅从自身操作中学习，还从*观察开发者的工作方式*中学习。隐私影响显而易见，Codex Chronicle 要求明确的用户授权才能启用。

### Gemini CLI 方案：从会话记录自动提取记忆

Gemini CLI 在每次交互结束后，从会话记录中提取技能和事实：

```
Session ends
  ↓
Transcript analysis:
  - Extract reusable procedures ("how to deploy to staging")
  - Extract corrections ("actually use yarn, not npm")
  - Extract project facts ("the API rate limit is 100/min")
  ↓
/memory inbox:
  - User reviews extracted memories before they become active
  - Accept, reject, or edit each extracted memory
```

`/memory inbox` 模式在全自动记忆（Windsurf，约 78% 准确率）和纯手动记忆（级别 1）之间找到了折中点。Agent 负责提取，人类负责审批。既保证了高准确率，又不要求人类从头编写记忆。

### 对比

| 系统 | 自动学习 | 准确率 | 限制 | 用户可编辑 | 过时处理 |
|--------|------------|---------|-------|--------------|-------------------|
| Cursor | 会话结束时提取 | ~95%（基于钩子） | 无显式限制 | 是（.mdc 文件） | 手动 |
| Claude Code | 会话进行中 | ~90% | 200 行 / 25KB | 是 | 自动裁剪最旧条目 |
| Windsurf | 后台处理 | ~78% | 无 | 有限 | 无 |
| Copilot | 带引用 | ~92% | 未公布 | 是 | 28 天验证 |
| Devin | Auto Triage + 持久记忆 | ~90% | 未公布 | 是 | 任务驱动刷新 |
| Gemini CLI | 会话后提取 + 收件箱审核 | ~95%（人工把关） | 未公布 | 是（/memory inbox） | 手动审查 |
| Codex Chronicle | 环境屏幕捕获 | ~85% | 未公布 | 是 | 按时间衰减加权 |

---

## 级别 3：技能积累（第 1 个月）

**投入：** 数天完成合理配置。**影响：** 重复任务减少 68% 的工具调用（Hermes 数据）。

如果 Agent 需要反复处理复杂的重复性任务——部署、项目初始化、调试——技能积累就是下一步。

### Hermes 方案：自主创建 SKILL.md

Hermes 的自我评估检查点（每 15 次工具调用触发一次）检测到可复用流程时，会自动创建技能：

```
Trigger conditions:
  - 5+ tool calls for a single repeatable task → Create skill
  - Error then recovery → Create troubleshooting skill
  - Non-obvious workflow → Create workflow skill

Skill format: agentskills.io standard
  - name + description (the search surface)
  - When to Use (activation conditions)
  - Procedure (step-by-step)
  - Pitfalls (common errors)
  - Verification (how to confirm success)
```

实测效果：在 Python 项目初始化场景中，经过一个月的常规使用后，同类任务的工具调用减少了 68%。

### Claude Code 方案：.claude/skills/*.md

Claude Code 对技能加载采用渐进式披露：

```
Level 0: skills_list() — name + description (~100 tokens/skill)
  Always in context for matching

Level 1: skill_view("skill-name") — full content (~500-1500 tokens)
  Loaded when the agent matches a skill to the current task

Level 2: skill_view("skill-name", "section") — specific section
  Loaded for follow-up detail
```

渐进式披露架构（第 7 章）是关键。没有这个机制，100 多个技能会直接消耗 80K 以上的 token——让 Agent 又慢又不准。

### OpenClaw 方案：ClawHub 市场 + 社区技能

OpenClaw 把技能视为共享资源。ClawHub 上托管了 13,000 多个社区贡献的技能：

```
Popular skills by downloads:
  1. web-scraping          (142K downloads)
  2. data-analysis-pandas  (128K downloads)
  3. docker-management     (97K downloads)
  4. git-workflow           (89K downloads)
  5. api-integration        (76K downloads)
```

市场模式意味着 Agent 不必凡事从零开始学。新部署的 Hermes 实例可以直接安装社区技能来应对常见任务，只为项目特有的工作流创建自定义技能即可。

### Gemini CLI 方案：从会话中提取技能

Gemini CLI 内置了一个 `skill-creator` 技能——一个生成新技能的元技能，从会话记录中提炼可复用流程：

```
User completes a multi-step task
  ↓
skill-creator analyzes the transcript:
  - Identifies reusable multi-step procedures
  - Extracts error-recovery patterns
  - Captures tool-call sequences that worked
  ↓
Generates a skill in agentskills.io format
  ↓
Skill appears in /memory inbox for user review
```

这形成了从级别 2（自动学习）到级别 3（技能积累）的闭环：Agent 自动把反复出现的操作流程从记忆条目提升为结构化技能。人工审核环节防止低质量技能堆积。

### Superpowers：大规模社区技能供给

并非所有技能都需要从经验中习得。Superpowers（截至 2026 年 5 月已有 213K+ 星标）和类似框架代表了另一条路径：**以安装包形式提供社区编写的技能**。

| 来源 | 可用技能数 | 增长模式 |
|--------|-----------------|-------------|
| Claude Code 市场 | 2,810+ 技能，425+ 插件 | 官方 + 社区 |
| ClawHub | 13,000+ 技能 | 社区 |
| Superpowers | 内置方法论技能 | 策展框架 |
| Gemini CLI | 通过 skill-creator 生成 | 按用户 + 共享 |

核心洞察：单个 Agent 不应该凡事从零开始学。新实例可以直接安装社区技能来应对常见任务（部署、测试、CI/CD），把自主技能创建留给项目特有的工作流。

与级别 1.5 的区别：级别 1.5 的 Superpowers 强制执行的是*方法论*（如何工作）。级别 3 的技能编码的是*具体流程*（如何完成特定任务）。两者都可以来自社区，但服务于不同目的。

### agentskills.io 标准

为了让技能在不同系统间通用，`agentskills.io` 标准定义了统一格式：

```yaml
---
name: skill-name
description: >
  2-4 sentences covering symptoms, technical terms,
  and natural language phrases users actually say.
version: 1.0.0
author: author-name
license: MIT
platforms: [linux, macos]
metadata:
  hermes:
    tags: [tag1, tag2]
    requires_toolsets: [terminal]
---

## When to Use
[Activation conditions]

## Procedure
[Step-by-step instructions]

## Pitfalls
[Common errors and how to avoid them]

## Verification
[How to confirm the skill worked]
```

按此格式编写的技能可以直接在 Hermes、OpenClaw 以及任何实现了 `agentskills.io` 加载器的系统上运行。

---

## 级别 4：学习型规则（第 3 个月以上）

**投入：** 大量基础设施建设。**影响：** 解决率从 52% 提升至 78%（Cursor Bugbot）。

这是黄金标准——而且目前只有一个生产系统在大规模实践：Cursor Bugbot。

### Bugbot 的独特之处

大多数 Agent 只能从二元信号（任务成功或失败）中学习。Bugbot 则从**三种高质量反馈信号**中学习：

| 信号 | 来源 | 揭示了什么 |
|--------|--------|----------------|
| 表情反应 | 开发者对 Bugbot PR 评论的 emoji 反应 | 对具体建议的认可或否定 |
| 回复 | 开发者对 Bugbot PR 评论的文字回复 | 建议为什么错了、如何改进 |
| 人类评审评论 | 同一 PR 上其他人的代码评审评论 | 人类评审者发现了 Bugbot 遗漏的问题 |

### 规则生命周期

```
┌──────────────────┐
│  Candidate Rule   │  Generated from patterns in feedback
│                   │  "When X happens, do Y instead of Z"
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Trial Period     │  Rule applied to new PRs
│  (accumulate      │  Developer reactions tracked
│   positive signal)│
└────────┬─────────┘
         │
    Threshold met?
    ┌────┴────┐
    Yes       No (consistent negative)
    │         │
    ▼         ▼
┌────────┐  ┌────────┐
│ Active │  │Disabled│
│ Rule   │  │ Rule   │
└────────┘  └────────┘
```

### 三种信号详解

**信号 1：表情反应。** Bugbot 在 PR 上评论（"这个函数应该处理 null 情况"），开发者可以点赞或点踩。多个 PR 上的持续点赞会增强底层规则的置信度。

**信号 2：回复。** 开发者用文字纠正（"不，这是有意为之，因为……"），Bugbot 把纠正内容提取为该规则的负面信号，还可能据此生成一条反向规则。

**信号 3：人类评审评论。** 当人类评审者在同一 PR 上抓到了 Bugbot 没发现的问题，Bugbot 就知道自己应该捕获什么。这是最有价值的信号——教会 Bugbot 认识自己的盲点。

### 成果

```
Before learned rules:  52% resolution rate
After learned rules:   78% resolution rate
Improvement:           +26 percentage points (50% relative improvement)
```

### 为什么大多数 Agent 做不到

学习型规则的前提条件很苛刻：

1. **真实的反馈信号** —— 不能只有成功/失败，还要知道*为什么*对、*为什么*错
2. **充足的数据量** —— 每条规则需要足够多的样本才能建立统计显著性
3. **结构化反馈** —— 表情反应和回复，而不是自由格式的文本
4. **足够长的时间跨度** —— 一条规则往往需要数周的数据来验证

多数 Agent 不具备这些条件。个人编码助手收到的反馈稀疏且零散。ChatGPT 类 Agent 基本没有反馈——用户用完就走了。Bugbot 能成功，是因为它扎根在代码评审场景里——一个天然带有结构化反馈的工作流。

### 如何复制这种模式

如果你想给自己的 Agent 加上学习型规则：

1. **找到你的反馈信号。** 用户在哪些环节会自然地表达质量判断？（表情反应、纠正、评分、重复使用）
2. **结构化信号。** 让用户方便地给出具体反馈。不是问"有帮助吗？"，而是问"这条建议正确吗？"
3. **积累到位再激活。** 一条规则至少要有 10 个以上正面信号才能激活。单个正面信号只是噪声。
4. **负面即降级。** 持续的负面反馈应直接禁用规则，不必等到证据压倒性。
5. **范围要窄。** "总是加 null 检查"太宽泛。"在这个项目的认证中间件中，始终验证 token 过期时间"才够具体、可执行。

---

## 级别 5：自我修改（实验性）

**投入：** 研究级别。**影响：** 未知。**风险：** 高。

没有任何生产系统安全地大规模实现了自我修改。以下所有内容均处于实验阶段。

### OpenClaw 的基因组进化协议

`capability-evolver` 技能（第 7 章）实现了一套结构化的自我修改系统：

```
genes.json    — Reusable patterns with parent IDs (evolution tree)
capsules.json — Proven fixes for specific failure modes
events.jsonl  — Append-only audit trail
```

Agent 可以变异自己的基因（修改可复用的代码模式）并创建新的胶囊（修复方案）。父级 ID 串成一棵可追溯的进化树。

### 必要的安全措施

| 措施 | 目的 | 实现方式 |
|---------|---------|---------------|
| 沙箱化 | 阻止自我修改触及生产系统 | 在隔离容器中运行基因代码 |
| Git 跟踪 | 每次变异都可审计 | 每次基因/胶囊变更附带描述性 commit 消息 |
| 人类审批门控 | 高影响变更必须经过审查 | 超复杂度阈值的变更需人类合并 |
| 速率限制 | 防止失控的变异循环 | 每次会话限制最多 N 次基因变异 |
| 回滚能力 | 撤回不良变异 | Git 历史支持即时回滚到任意先前状态 |

### 实践中的安全缺口

`capability-evolver` 技能已经暴露出真实的安全隐患：

- **基因代码中的硬编码凭证：** 早期版本直接在基因代码里存放 API 密钥
- **文件访问不受限：** 基因可以读写工作区中的任何文件
- **无执行沙箱：** 基因代码与 Agent 共享同一权限

这些不是理论上的风险——都是在实际部署中观察到的。没有纵深防御的自我修改，很危险。

### 诚实的评估

自我修改是 Agent 进化中最强大也最危险的层级。潜力：Agent 自主发现更好的模式，在实践中验证，并永久吸收。风险：Agent 把自己改坏了，甚至改出安全漏洞。

没有任何生产系统攻克了这个难题。稳妥的路径：先把级别 1-4 做扎实，再碰级别 5。对大多数团队来说，级别 2（自动学习）和级别 3（技能积累）带来的价值，远大于冒险搞自我修改。

---

## 需要避免的陷阱：技能安全问题

Agent 技能生态的快速扩张已经超越了安全实践的跟进速度。2026 年 5 月 Snyk 的一项审计发现，**13% 的公开 Agent 技能包存在严重安全漏洞**——依赖项漏洞、硬编码密钥，或能绕过沙箱的代码执行路径。

### 攻击面

| 攻击向量 | 风险 | 示例 |
|--------|------|---------|
| 市场中的恶意技能 | 技能以 Agent 权限执行任意代码 | "docker-cleanup" 技能偷偷外传 `.env` 文件 |
| 通过技能内容的 prompt 注入 | 技能文本暗藏覆盖 Agent 行为的指令 | 技能描述嵌入"忽略之前的指令"载荷 |
| 供应链依赖 | 技能依赖一个已被入侵的 npm/pip 包 | 合法技能拉取了木马化的依赖 |
| 权限过大的 Hook | Hook 在每个生命周期事件触发且拥有完整文件系统访问权 | 提交前 Hook 读取并传输 SSH 密钥 |
| "1% 规则"作为攻击面 | 低激活阈值使恶意技能在几乎无关时也触发 | 方法论技能在无关任务上激活以注入指令 |

### 防御实践

1. **安装前审计。** 阅读技能源码。社区编写的技能就是代码——像对待第三方依赖一样对待它们。
2. **固定版本。** 不要自动更新技能。一个原本无害的技能在维护者账号被攻破后可能变成恶意的。
3. **沙箱执行技能。** 执行命令的技能应在容器或受限 shell 中运行，不能接触凭证。
4. **优先使用官方市场。** Claude Code 官方市场和策展技能集有审核流程。未经审查的社区来源没有。
5. **监控技能行为。** 记录技能激活时的操作。异常的网络请求、项目外的文件读取、凭证访问都是危险信号。

13% 的严重漏洞率是生态系统层面的问题，不是单个 Agent 的问题。随着技能成为分发 Agent 能力的主要机制，技能生态的安全态势将变得与 Agent 本身的安全同等重要。

---

## 决策矩阵

| 你的情况 | 从这里开始 | 然后添加 | 时间线 |
|---------------|-----------|---------|----------|
| 独立开发者，单项目 | CLAUDE.md + 自动记忆（级别 1-2） | 常规使用 1 个月后加入技能 | 第 1 天 → 第 1 个月 |
| 团队，共享仓库 | AGENTS.md + Superpowers 方法论（级别 1-1.5） | 数据量够了就加 Bugbot 式学习型规则 | 第 1 天 → 第 3 个月以上 |
| 多工具团队 | AGENTS.md + 方法论强制执行（级别 1-1.5） | 跨平台技能 + 自动学习 | 第 1 天 → 第 1 个月 |
| 个人助手 Agent | Hermes MEMORY.md + SKILL.md（级别 1-3） | Honcho 用户建模做深度个性化 | 第 1 周 → 第 3 个月 |
| 自定义 Agent 产品 | 文件系统记忆 + 自动提取（级别 1-2） | 技能库 + 反馈驱动规则 | 第 1 天 → 第 6 个月 |
| 研究/实验性 | 以上所有级别 | 安全措施到位后再试自我修改（级别 5） | 第 6 个月以上 |

### 常见错误

最常见的坑：跳过级别 1，直接搞级别 3 或 4。团队连基本的记忆文件都没写好，就开始造复杂的技能系统。结果是：Agent 能创建技能，却连项目的构建命令都不知道。

从级别 1 开始。30 分钟的投入，每个 token 带来的收益比其他任何手段都高。

### 各级别的成本效益

| 级别 | 设置成本 | 持续成本 | 失败模式 | 恢复方式 |
|-------|-----------|-------------|-------------|----------|
| 1：文件系统记忆 | 30 分钟 | 几乎为零（人工编辑） | 过时的条目 | 编辑文件 |
| 1.5：方法论强制执行 | 1 小时 | 几乎为零（社区维护） | 工作流过度约束 | 禁用或调整激活阈值 |
| 2：自动学习 | 1-4 小时 | 提取消耗 token | 噪声/错误条目 | 裁剪 + 设上限 |
| 3：技能积累 | 数天 | 创建 + 存储消耗 token | 技能与现实脱节；**13% 的社区包存在安全漏洞** | 编辑/删除技能；安装前审计 |
| 4：学习型规则 | 数周 | 基础设施 + 监控 | 降低质量的规则 | 降级机制 |
| 5：自我修改 | 数月 | 安全基础设施 | 不安全的变异 | Git 回滚 |

每上一个级别都更强大，也更贵、风险更高。选哪个级别取决于你的数据量、反馈信号和风险承受力。
