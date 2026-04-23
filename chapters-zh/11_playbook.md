# 生产环境自我进化实战手册

本章将前面十章中的所有模式综合为一份可操作的指南。从"今天就能做"到"极其谨慎地推进"，共五个级别。每个级别都引用了做得最好的生产系统及其具体实现细节。

---

## 级别 1：文件系统记忆（第 1 天）

**投入：** 30 分钟。**影响：** 立竿见影。

每个 Agent 都应该具备这个。这是 Agent 自我进化中投资回报率最高的单一干预措施：一个在会话启动时加载到系统提示词中的纯文本文件。

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

来自 Claude Code、Codex 和 Cursor 的生产数据：

| 指标 | 建议值 | 原因 |
|--------|------------|-----|
| 总长度 | 50-200 行 | 更长会浪费上下文（参见上下文焦虑，第 10 章） |
| Token 数 | 1K-4K token | Claude Code 每文件上限 4K 是有原因的 |
| 章节数 | 3-6 | 超过 6 个会分散模型的注意力 |
| 每条长度 | 1-2 行 | 简洁的条目更容易被可靠遵循 |

### 使用哪个文件名

| 系统 | 文件 | 自动加载 |
|--------|------|------------|
| Claude Code | `CLAUDE.md` | 是（通过从当前工作目录向上遍历发现） |
| Codex | `AGENTS.md` | 是（仓库根目录固定路径） |
| Gemini | `GEMINI.md` | 是（仓库根目录） |
| Cursor | `.cursor/rules/*.mdc` | 是（glob 匹配或始终应用） |
| 所有 Agent | `README.md` | 通常默认包含在上下文中 |

如果你的团队使用多种 AI 工具，可以维护并行文件或使用单个 `AGENTS.md`（最通用的名称）。

### /init 模式

Claude Code 和 Codex 都提供（或提议）一个 `/init` 命令，通过扫描项目自动生成初始记忆文件：

```
/init scans:
  - package.json / pyproject.toml / Cargo.toml → build commands
  - .github/workflows/ → CI configuration
  - Directory structure → architecture overview
  - .eslintrc / ruff.toml / rustfmt.toml → coding conventions
  - README.md → project description
```

如果你的工具没有 `/init`，手动创建文件。你花费的 30 分钟将在每次未来的会话中得到回报。

---

## 级别 2：自动学习（第 1 周）

**投入：** 1-4 小时设置。**影响：** 随周数复合增长。

手动记忆文件是一个起点。但真正的价值在于 Agent *自动*从交互中提取经验并在无需人类干预的情况下更新记忆。

### Cursor 方案：持续学习插件

Cursor 的持续学习系统通过钩子工作：

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

关键设计决策：更新发生在会话结束时，而非会话进行中。这避免了中途观察可能不重要的噪声。

### Claude Code 方案：自动记忆

Claude Code 将自动生成的记忆存储在 `~/.claude/projects/[project]/memory/`：

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
- 每个记忆文件最多 **200 行**
- 所有项目记忆文件总计 **25KB**
- 超出限制时自动裁剪（删除最旧的条目）
- 用户可以查看和编辑存储的记忆

上限是刻意设定的——它防止了上下文焦虑问题（第 10 章），即累积的记忆消耗过多的上下文窗口。

### Windsurf 方案：自动生成的记忆

Windsurf 从用户交互中自动生成记忆。观察到的特征：

- **索引延迟：** 记忆大约需要 48 小时才能完全处理并可用
- **准确率：** 提取的事实准确率约 78%（通过用户纠正测量）
- **无显式上限：** 记忆在没有硬性限制的情况下持续累积
- **不透明：** 用户无法轻松查看或编辑存储的记忆

78% 的准确率是关键权衡：自动学习引入了必须被纠正的错误。与 Cursor 仅人类编写的规则（构造上 100% 准确）和 Claude Code 有上限的自动记忆（200 行限制约束了错误的影响范围）相比。

### Copilot 方案：带代码引用的 Agentic 记忆

GitHub Copilot 的记忆系统（2026）增加了一个新颖的功能：记忆包含对生成它们的代码的**引用**：

```
Memory entry:
  "This project uses zod for request validation"
  Citation: src/api/middleware/validate.ts:12-35

Memory entry:
  "API tests use supertest with in-memory SQLite"
  Citation: tests/api/setup.ts:1-20, tests/api/users.test.ts:5-15
```

引用服务于两个目的：
1. **验证：** Agent（或人类）可以通过阅读被引用的代码来检查记忆是否仍然准确
2. **过时检测：** 如果被引用的代码发生了变化，记忆会被标记为需要审查

Copilot 还实现了 **28 天验证**：28 天内未被新证据确认的记忆会被降级或删除。这防止了过时记忆的累积。

### 对比

| 系统 | 自动学习 | 准确率 | 限制 | 用户可编辑 | 过时处理 |
|--------|------------|---------|-------|--------------|-------------------|
| Cursor | 会话结束时提取 | ~95%（基于钩子） | 无显式限制 | 是（.mdc 文件） | 手动 |
| Claude Code | 会话进行中 | ~90% | 200 行 / 25KB | 是 | 自动裁剪最旧条目 |
| Windsurf | 后台处理 | ~78% | 无 | 有限 | 无 |
| Copilot | 带引用 | ~92% | 未公布 | 是 | 28 天验证 |

---

## 级别 3：技能积累（第 1 个月）

**投入：** 数天完成良好设置。**影响：** 重复任务减少 68% 的工具调用（Hermes 数据）。

对于执行重复性复杂任务的 Agent——部署、项目初始化、调试会话——技能积累是下一个层级。

### Hermes 方案：自主 SKILL.md 创建

当自我评估检查点（每 15 次工具调用）检测到可复用流程时，Hermes 会自动创建技能：

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

结果：在类似任务上经过一个月的常规使用后，工具调用减少了 68%（在 Python 项目初始化的 Hermes 部署中测量）。

### Claude Code 方案：.claude/skills/*.md

Claude Code 对技能加载使用渐进式披露：

```
Level 0: skills_list() — name + description (~100 tokens/skill)
  Always in context for matching

Level 1: skill_view("skill-name") — full content (~500-1500 tokens)
  Loaded when the agent matches a skill to the current task

Level 2: skill_view("skill-name", "section") — specific section
  Loaded for follow-up detail
```

渐进式披露架构（第 7 章）是关键使能因素。没有它，100 个以上的技能将消耗 80K 以上的 token——使 Agent 更慢且更不准确。

### OpenClaw 方案：ClawHub 市场 + 社区技能

OpenClaw 将技能视为共享资源。ClawHub 托管了 13,000 多个社区贡献的技能：

```
Popular skills by downloads:
  1. web-scraping          (142K downloads)
  2. data-analysis-pandas  (128K downloads)
  3. docker-management     (97K downloads)
  4. git-workflow           (89K downloads)
  5. api-integration        (76K downloads)
```

市场模式意味着 Agent 不需要从零开始学习一切。一个新的 Hermes 实例可以为常见任务安装社区技能，只需为项目特定的工作流创建自定义技能。

### agentskills.io 标准

为了实现跨系统的技能互操作性，`agentskills.io` 标准定义了一个通用格式：

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

以此格式编写的技能可在 Hermes、OpenClaw 以及任何实现了 `agentskills.io` 加载器的系统上运行。

---

## 级别 4：学习型规则（第 3 个月以上）

**投入：** 大量基础设施。**影响：** 解决率从 52% 提升至 78%（Cursor Bugbot）。

这是黄金标准——而且只有一个生产系统在大规模实施：Cursor 的 Bugbot。

### Bugbot 的独特之处

大多数 Agent 从二元信号中学习：任务成功或失败。Bugbot 从**三种丰富的反馈信号**中学习：

| 信号 | 来源 | 揭示了什么 |
|--------|--------|----------------|
| 表情反应 | 开发者对 Bugbot PR 评论的 emoji 反应 | 对具体建议的同意/不同意 |
| 回复 | 开发者对 Bugbot PR 评论的文字回复 | 建议为什么是错的或如何改进 |
| 人类评审评论 | 同一 PR 上的代码评审评论 | 人类评审者发现了什么 Bugbot 遗漏的 |

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

### 三种信号的详细说明

**信号 1：表情反应。** 当 Bugbot 在 PR 上评论（"这个函数应该处理 null 情况"），开发者可以点赞/点踩。跨多个 PR 的点赞 → 底层规则获得信心。

**信号 2：回复。** 当开发者回复纠正（"不，这是故意的，因为……"），Bugbot 将纠正提取为该规则的负面信号，并可能生成一条反向规则。

**信号 3：人类评审评论。** 当人类评审者在同一 PR 上发现了 Bugbot 遗漏的问题时，Bugbot 学习它本应捕获的内容。这是最有价值的信号——它教会 Bugbot 认识自己的盲点。

### 成果

```
Before learned rules:  52% resolution rate
After learned rules:   78% resolution rate
Improvement:           +26 percentage points (50% relative improvement)
```

### 为什么大多数 Agent 做不到这一点

学习型规则需要：

1. **真实的反馈信号** —— 不只是成功/失败，而是*为什么*某件事是对的或错的
2. **高量级** —— 每条规则足够多的数据点来建立统计显著性
3. **结构化反馈** —— 表情反应和回复，而非自由格式文本
4. **长时间跨度** —— 规则需要数周的数据来验证

大多数 Agent 不具备这些条件。个人编码助手获得的反馈稀疏且非结构化。ChatGPT 风格的 Agent 完全没有反馈（用户直接走了）。Bugbot 能成功是因为它运作在代码评审领域——一个自然具有结构化反馈的工作流程中。

### 复制这种模式

如果你希望为你的 Agent 实现学习型规则：

1. **确定你的反馈信号。** 用户在哪里自然地表示质量？（表情反应、纠正、评分、重复使用）
2. **结构化信号。** 让用户容易给出具体反馈。（不是"这有帮助吗？"而是"这个具体建议正确吗？"）
3. **积累后再提升。** 一条规则需要 10 个以上的正面信号才能激活。一个正面信号只是噪声。
4. **负面即降级。** 持续的负面反馈 → 禁用规则。不要等到压倒性的证据。
5. **范围要窄。** "总是添加 null 检查"这样的规则太宽泛。"在这个项目的认证中间件中，总是验证 token 过期时间"才是可操作的。

---

## 级别 5：自我修改（实验性）

**投入：** 研究级别。**影响：** 未知。**风险：** 高。

没有任何生产系统在大规模实现安全的自我修改。本节所有内容都是实验性的。

### OpenClaw 的基因组进化协议

`capability-evolver` 技能（第 7 章）实现了一个结构化的自我修改系统：

```
genes.json    — Reusable patterns with parent IDs (evolution tree)
capsules.json — Proven fixes for specific failure modes
events.jsonl  — Append-only audit trail
```

Agent 可以变异自己的基因（修改可复用的代码模式）并创建新的胶囊（修复方案）。父级 ID 创建了一个可追溯的进化树。

### 必要的安全措施

| 措施 | 目的 | 实现方式 |
|---------|---------|---------------|
| 沙箱化 | 防止自我修改访问生产系统 | 在隔离容器中执行基因代码 |
| Git 跟踪 | 每次变异都可审计 | 每次基因/胶囊变更都带描述性消息提交 |
| 人类审批门控 | 高影响变更需要审查 | 超过复杂度阈值的变更需要人类合并 |
| 速率限制 | 防止失控的变异循环 | 每次会话最多 N 次基因变异 |
| 回滚能力 | 回退不良变异 | Git 历史使得可以即时回滚到任何先前状态 |

### 实践中的安全缺口

`capability-evolver` 技能已展现出真实的安全问题：

- **硬编码的 API 凭证：** 早期版本直接在基因代码中存储 API 密钥
- **不受限制的文件访问：** 基因可以读写工作区中的任何文件
- **无执行沙箱：** 基因代码以与 Agent 相同的权限运行

这些不是理论风险——它们在实际部署中被观察到。没有纵深防御的自我修改是危险的。

### 诚实的评估

自我修改是 Agent 进化中最强大也最危险的层级。潜力在于：Agent 发现更好的模式，在实践中证明它们，并永久整合。风险在于：Agent 将自己修改为损坏或不安全的状态。

没有任何生产系统解决了这个权衡。安全路径：先做好级别 1-4，再尝试级别 5。大多数团队从级别 2（自动学习）和级别 3（技能积累）获得的价值，会比自我修改更大。

---

## 决策矩阵

| 你的情况 | 从这里开始 | 然后添加 | 时间线 |
|---------------|-----------|---------|----------|
| 独立开发者，单项目 | CLAUDE.md + 自动记忆（级别 1-2） | 定期使用 1 个月后加入技能 | 第 1 天 → 第 1 个月 |
| 团队，共享仓库 | AGENTS.md + Cursor 持续学习（级别 1-2） | 如果量级支持则加入 Bugbot 风格的学习型规则 | 第 1 天 → 第 3 个月以上 |
| 个人助手 Agent | Hermes MEMORY.md + SKILL.md（级别 1-3） | Honcho 用户建模实现深度个性化 | 第 1 周 → 第 3 个月 |
| 自定义 Agent 产品 | 文件系统记忆 + 自动提取（级别 1-2） | 技能库 + 反馈驱动的规则 | 第 1 天 → 第 6 个月 |
| 研究/实验性 | 以上所有级别 | 具备完整安全措施的自我修改（级别 5） | 第 6 个月以上 |

### 常见错误

最常见的错误：跳过级别 1 直接跳到级别 3 或 4。团队在编写基本记忆文件之前就构建了复杂的技能系统。结果是：Agent 能创建技能，但不知道项目的构建命令。

从级别 1 开始。只需 30 分钟，每个 token 提供的价值超过任何其他干预措施。

### 各级别的成本效益

| 级别 | 设置成本 | 持续成本 | 失败模式 | 恢复方式 |
|-------|-----------|-------------|-------------|----------|
| 1：文件系统记忆 | 30 分钟 | 约为零（人类编辑） | 过时的条目 | 编辑文件 |
| 2：自动学习 | 1-4 小时 | 提取消耗的 token | 噪声/错误条目 | 裁剪 + 设上限 |
| 3：技能积累 | 数天 | 创建 + 存储消耗的 token | 技能与现实脱节 | 编辑/删除技能 |
| 4：学习型规则 | 数周 | 基础设施 + 监控 | 降低质量的规则 | 降级机制 |
| 5：自我修改 | 数月 | 安全基础设施 | 不安全的变异 | Git 回滚 |

每个级别都更强大，但也更昂贵、风险更高。适合的级别取决于你的量级、反馈信号和风险承受能力。
