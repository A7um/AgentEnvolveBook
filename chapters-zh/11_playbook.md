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
| Gemini | `GEMINI.md` | 是（仓库根目录） |
| Cursor | `.cursor/rules/*.mdc` | 是（glob 匹配或始终应用） |
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

### 对比

| 系统 | 自动学习 | 准确率 | 限制 | 用户可编辑 | 过时处理 |
|--------|------------|---------|-------|--------------|-------------------|
| Cursor | 会话结束时提取 | ~95%（基于钩子） | 无显式限制 | 是（.mdc 文件） | 手动 |
| Claude Code | 会话进行中 | ~90% | 200 行 / 25KB | 是 | 自动裁剪最旧条目 |
| Windsurf | 后台处理 | ~78% | 无 | 有限 | 无 |
| Copilot | 带引用 | ~92% | 未公布 | 是 | 28 天验证 |

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

## 决策矩阵

| 你的情况 | 从这里开始 | 然后添加 | 时间线 |
|---------------|-----------|---------|----------|
| 独立开发者，单项目 | CLAUDE.md + 自动记忆（级别 1-2） | 常规使用 1 个月后加入技能 | 第 1 天 → 第 1 个月 |
| 团队，共享仓库 | AGENTS.md + Cursor 持续学习（级别 1-2） | 数据量够了就加 Bugbot 式学习型规则 | 第 1 天 → 第 3 个月以上 |
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
| 2：自动学习 | 1-4 小时 | 提取消耗 token | 噪声/错误条目 | 裁剪 + 设上限 |
| 3：技能积累 | 数天 | 创建 + 存储消耗 token | 技能与现实脱节 | 编辑/删除技能 |
| 4：学习型规则 | 数周 | 基础设施 + 监控 | 降低质量的规则 | 降级机制 |
| 5：自我修改 | 数月 | 安全基础设施 | 不安全的变异 | Git 回滚 |

每上一个级别都更强大，也更贵、风险更高。选哪个级别取决于你的数据量、反馈信号和风险承受力。
