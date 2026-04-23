# Hermes Agent — 闭环技能创建

Hermes Agent（Nous Research，2026 年 2 月，99K+ GitHub stars，MIT 许可证）是自主技能创建领域最完整的生产系统。它是唯一一个开源 Agent，你可以阅读学习循环的每一行代码，追踪每一个技能创建触发器，并对照实际源代码验证本章的每一个论述。

仓库：`NousResearch/hermes-agent`

---

## 学习循环

Hermes 运行一个闭环：执行任务 → 在固定间隔进行自我评估 → 生成技能 → 更新记忆 → 更好地执行下一个任务。

```
任务执行
     │
     ▼
自我评估检查点（每 15 次工具调用）
     │
     ├── 检测到可复用模式？ ──→ 生成 SKILL.md
     ├── 学到了重要事实？    ──→ 更新 MEMORY.md
     ├── 观察到用户偏好？    ──→ 更新 USER.md
     └── 现有技能有误？      ──→ skill_manage(EDIT)
     │
     ▼
恢复任务执行（使用更新后的技能 + 记忆）
```

### 触发条件

并非每个检查点都会创建技能。必须满足五个特定条件：

| 触发器 | 检测方式 | 动作 |
|--------|---------|------|
| 单个任务使用了 5 次以上工具调用 | 统计朝同一目标的连续调用次数 | 创建包含过程的技能 |
| 出错后恢复 | 工具调用失败 → 换一种方法成功了 | 添加陷阱或创建故障排除技能 |
| 用户纠正 | Agent 动作后出现改变方向的用户消息 | 更新 MEMORY.md 或 USER.md |
| 非显而易见的工作流 | 非标准的多步骤过程 | 创建工作流技能 |
| 重复模式 | 跨会话观察到相同序列 | 创建或合并技能 |

### 具体成效

```
任务："搭建一个包含 CI 的新 Python 项目"

会话 1（无技能）：
  25 次工具调用
  3 个错误（pytest 配置错误、pyproject.toml 缺少字段、CI 语法错误）
  12 分钟耗时

  → 创建的技能：
    - python-project-setup（pyproject.toml 模板、目录结构）
    - github-actions-python（带缓存的 CI 工作流）
  → 更新 MEMORY.md："用户偏好 ruff 而非 black+isort"

会话 5（有技能）：
  14 次工具调用
  1 个错误（忘记更新 CI 中的 Python 版本）
  7 分钟

  → 更新技能：github-actions-python（添加了 Python 版本矩阵）

会话 12（技能成熟）：
  8 次工具调用
  0 个错误
  4 分钟

  → 无需更新技能——过程已稳定
```

**25 次工具调用 → 经过一个月的常规使用后降至 8-10 次。** 同类任务减少了 68% 的工具调用、100% 的错误率和 67% 的耗时。

---

## SKILL.md — agentskills.io 标准

Hermes、OpenClaw 和 Claude Code 都趋同于相同的技能格式：遵循 agentskills.io 标准的 `SKILL.md` 文件。以下是完整规范。

### 完整格式

```yaml
---
name: kubernetes-pod-debugging
description: >
  Diagnose and fix common Kubernetes pod failures including
  CrashLoopBackOff, ImagePullBackOff, OOMKilled, and
  pending pods. Covers log analysis, resource inspection,
  and common remediation steps.
version: 2.1.0
author: hermes-community
license: MIT
platforms: [linux, macos]
metadata:
  hermes:
    tags: [kubernetes, devops, debugging, containers]
    related_skills:
      - docker-container-debugging
      - kubernetes-deployment-management
    requires_toolsets: [terminal]
    config:
      default_namespace: default
      max_log_lines: 200
---

## When to Use

- Pod is in CrashLoopBackOff, ImagePullBackOff, or Error state
- Pod is stuck in Pending for more than 60 seconds
- Application inside pod is not responding but pod shows Running
- User mentions "pod won't start" or "container keeps restarting"
- After a deployment rollout that introduced failures

## Quick Reference

| Symptom | First Command | Likely Cause |
|---------|--------------|-------------|
| CrashLoopBackOff | `kubectl logs <pod> --previous` | Application error or missing config |
| ImagePullBackOff | `kubectl describe pod <pod>` | Wrong image name or missing credentials |
| OOMKilled | `kubectl describe pod <pod>` | Memory limit too low |
| Pending | `kubectl describe pod <pod>` | Insufficient resources or node selector |
| Running but unresponsive | `kubectl exec -it <pod> -- /bin/sh` | Deadlock or misconfiguration |

## Procedure

1. Identify the failing pod:
   kubectl get pods -n <namespace> | grep -v Running | grep -v Completed

2. Get pod details:
   kubectl describe pod <pod-name> -n <namespace>
   Look for: Events section, Conditions, Container statuses

3. Check logs (current + previous):
   kubectl logs <pod-name> -n <namespace>
   kubectl logs <pod-name> -n <namespace> --previous

4. Diagnose by symptom → apply fix → verify

## Pitfalls

- Don't delete pods to fix CrashLoopBackOff — the ReplicaSet recreates
  them with the same broken config. Fix the deployment spec.
- Check init containers separately — kubectl logs defaults to the main
  container.
- OOMKilled can be misleading — check all containers in the pod.
- Liveness probe failures look like crashes — check probe config.

## Verification

1. kubectl get pods -n <namespace> — all pods Running
2. kubectl rollout status deployment/<name> — rollout complete
3. kubectl exec <pod> -- curl -s localhost:<port>/health
4. Monitor for 5 minutes: kubectl get pods -w — no restarts
```

### 描述问题

来自 Hermes SkillDesignBook：

> *"如果一个技能没有被触发，问题几乎从来不在于指令——而在于描述。"*

描述是技能的搜索面。当用户说"我的 pod 一直在重启"时，Agent 通过匹配描述来搜索技能。如果描述写的是"Kubernetes pod 管理"而不是"诊断和修复常见的 Kubernetes pod 故障，包括 CrashLoopBackOff"，那么该技能不会为这个具体症状而触发。

描述的规则：
- 包含用户可能描述的具体症状
- 同时包含技术术语和用户实际使用的自然语言短语
- 2-4 句话，不超过 100 个 token
- 太模糊（"Kubernetes 相关"）→ 永远不触发。太狭窄（"修复 CrashLoopBackOff"）→ 遗漏相关故障。

### 渐进式披露：三个层级

技能在预算内加载到上下文中。Hermes 使用渐进式披露来控制 token 成本：

| 层级 | 加载内容 | 每个技能的 token 数 | 时机 |
|------|---------|-------------------|------|
| **Level 0** | 仅名称 + 描述 | ~100 | 始终在系统提示中（或通过 FTS5 搜索结果） |
| **Level 1** | 完整技能内容 | ~500-1,500 | 当 Agent 判断某技能相关时 |
| **Level 2** | 特定章节 + 参考 | ~100-300 | 当 Agent 只需要某个章节（如仅需"陷阱"部分）时 |

200 个技能在 128K 上下文窗口下的 token 经济学：

```
未优化：  200 × 800 平均 token = 160,000 token（超出上下文）
FTS5 筛选后：  ~10 个候选 × 100 token = 1,000 token（Level 0）
              + 3 个激活技能 × 800 token = 2,400 token（Level 1）
              = 总计 3,400 token（上下文的 2.7%）

节省：97.9%
```

---

## 三层记忆

### 第一层：工作上下文

标准的上下文窗口。消息、工具调用结果和当前任务。临时性的——会话结束即消失。

### 第二层：技能文档

存储在 `~/.hermes/skills/` 中的持久化技能文件。通过 SQLite FTS5（全文搜索 5）索引，使用 porter 词干处理和 unicode61 分词：

```python
def search_skills(self, query: str, limit: int = 10) -> list[Skill]:
    """Search skills using FTS5 BM25 ranking."""
    results = self.db.execute("""
        SELECT name, rank
        FROM skill_index
        WHERE skill_index MATCH ?
        ORDER BY rank
        LIMIT ?
    """, (query, limit))
    return [self.get_skill(row["name"]) for row in results]
```

porter 分词器意味着"debugging"能匹配到"debug"。BM25 排名按相关性打分。Agent 通过搜索检索匹配的技能，然后根据需要以 Level 1 或 Level 2 加载。

技能还支持 LLM 摘要：当技能库增长到很大时，Agent 可以将相关技能聚类汇总为更高层级的条目，并引用原始技能。

### 第三层：持久化事实（Honcho 集成）

Hermes 与 Honcho（由 Plastic Labs 开发）集成，提供超越文件级 `USER.md` 的深度用户建模。

**辩证式用户建模**——不仅存储事实，Honcho 还对用户历史运行 LLM 推理来生成洞察：

```
基础上下文（已存储事实）：
  "用户偏好 Python，使用 pytest，从事 ML 管道工作"

辩证推理第 1 轮：
  "用户的测试风格表明他们重视可复现性而非速度。
   他们总是要求在随机操作中设置 seed。"

辩证推理第 2 轮：
  "用户的 ML 管道工作涉及频繁的数据格式变更。
   他们将受益于在管道边界处进行 schema 验证。"
```

三个配置旋钮控制用户建模的深度：

| 参数 | 可选值 | 控制内容 |
|------|-------|---------|
| `contextCadence` | `every_message`、`every_n_messages`、`on_topic_change` | 注入用户上下文的频率 |
| `dialecticCadence` | `every_session`、`every_n_messages`、`on_demand` | 运行辩证推理的频率 |
| `dialecticDepth` | 1-3 | 推理轮数 |

进化阶段：

```
会话 1-3（冷启动）：
  仅有基础上下文。无辩证推理。Agent 提出澄清性问题。

会话 4-20（热身期）：
  基础上下文已建立。辩证推理深度 1。
  Agent 能自信地做出符合偏好的选择。

会话 20+（深度期）：
  全面的用户画像。辩证推理深度 2-3。
  Agent 变得主动——在用户提问前就建议模式。
```

---

## skill_manage 工具

Agent 在会话中直接修补自己的技能。无需全量重写——三种变更操作覆盖所有场景：

| 操作 | 使用时机 | 变更内容 |
|------|---------|---------|
| `ADD` | 发现新能力 | 创建新的 SKILL.md 文件 |
| `EDIT` | 过程有误或不完整 | 替换章节内容 |
| `APPEND` | 发现新的陷阱、提示或验证步骤 | 向现有章节追加内容 |

示例：Agent 在调试 Kubernetes pod 时发现 readiness probe 故障会产生类似崩溃的症状：

```python
await self.skill_manage(
    action="APPEND",
    name="kubernetes-pod-debugging",
    section="Pitfalls",
    content="""
- **Readiness probe failures vs. liveness probe failures** — readiness probe
  failures remove the pod from service endpoints but don't restart it.
  Liveness probe failures restart the pod. Check both:
  `kubectl describe pod <pod> | grep -A5 'Readiness\\|Liveness'`
"""
)
```

技能通过使用而进化。一个 Kubernetes 调试技能可能起初有 5 个陷阱，三个月后随着 Agent 遇到新的故障模式增长到 12 个。Agent 永远不需要重新生成整个技能——它进行增量修补。

---

## 部署

### 六种终端后端

| 后端 | 使用场景 | 隔离级别 |
|------|---------|---------|
| `local` | 开发、个人使用 | 无（在宿主机上运行） |
| `docker` | 标准部署 | 容器级别 |
| `ssh` | 远程服务器 | 网络级别 |
| `daytona` | 云开发环境 | 完整 VM |
| `singularity` | HPC 集群 | 容器（无 root） |
| `modal` | 无服务器计算 | 函数级别 |

Agent 的技能库在所有后端上以相同方式工作。一个"使用 Docker Compose 部署"的技能无论 Agent 是在本地执行还是通过 SSH 执行都能正常工作——终端抽象层处理了差异。

### 单一网关，九个平台

```
                    ┌──────────────┐
                    │  Hermes Core  │
                    │  (run_agent)  │
                    └──────┬───────┘
                           │
     ┌──────────┬──────────┼──────────┬──────────┐
     │          │          │          │          │
  Telegram  Discord     Slack     WhatsApp   Signal
     │          │          │          │          │
  Matrix    iMessage    WeChat      CLI
```

每个适配器将消息规范化为统一格式。在 Telegram 上创建的技能在 Discord 上同样可用。通过 Slack 积累的记忆在用户切换到 CLI 时同样适用。进化是平台无关的。

### 200+ 模型

通过 Nous Portal、OpenRouter、OpenAI、Anthropic 和自定义端点（包括本地 Ollama）支持：

```yaml
providers:
  - name: nous_portal
    models: [hermes-3-70b, hermes-3-405b]
  - name: openrouter
    models: [claude-sonnet-4, gpt-4o, deepseek-v3]
  - name: openai
    models: [gpt-4o, gpt-4o-mini, o3]
  - name: anthropic
    models: [claude-sonnet-4, claude-opus-4]
  - name: local
    models: [any-ollama-model]
    api_base: http://localhost:11434/v1
```

技能和记忆与底层模型无关。使用 Hermes-3-70B 运行时创建的技能在用户切换到 Claude Sonnet 4 时同样有效。进化系统不依赖于特定模型。

---

## Atropos RL 管道

**重要注意事项：** Atropos 用于训练研究，而非生产运行时进化。我们收录它是因为它是 Hermes 代码库的一部分，并且一些团队有基础设施来使用它。

管道：

```
生产 Agent 会话
  → 每个会话自动记录到 SQLite（轨迹）
  → 结构化记录：消息、工具调用、技能激活、
    自我评估结果、用户反馈信号
  → 批量导出为 ShareGPT 格式
  → RLHF / DPO / GRPO 训练

下一代 Hermes 模型
  → 更擅长技能创建，更准确的自我评估
  → 创建更高质量的轨迹数据
  → 循环继续
```

Hermes 可以在无头批处理模式下运行——并行 Agent 工作进程执行数千个任务以进行轨迹收集并支持检查点。这是 Nous Research 从生产质量交互中生成训练数据的方式。

对于大多数团队而言，运行时进化系统（技能 + 记忆 + 自我评估）才是核心价值。Atropos 对拥有训练能力的团队值得关注——它打通了运行时经验与模型改进之间的闭环。

---

## Dreaming：后台记忆整合

所有生产 Agent 中最精密的自进化机制。Dreaming 是 Hermes 对后台记忆整合的实现——灵感来源于人类睡眠科学，大脑在睡眠阶段重放并整合记忆。

**需要主动开启，默认关闭。** 在任何 Hermes 会话中通过 `/dreaming on` 启用。启用后，它作为托管 cron 任务运行——默认计划：每天凌晨 3 点。

### 三阶段流程

```mermaid
graph TD
    subgraph "Phase 1: Light Sleep"
        A[Ingest daily memory +<br/>session transcripts] --> B[Deduplicate<br/>Jaccard similarity ≥ 0.9]
        B --> C[Stage candidates]
    end
    subgraph "Phase 2: REM Sleep"
        C --> D[Analyze recurring themes<br/>7-day lookback window]
        D --> E[Identify candidate truths]
    end
    subgraph "Phase 3: Deep Sleep"
        E --> F[Score candidates<br/>6 weighted signals]
        F --> G{All 3 threshold<br/>gates pass?}
        G -->|Yes| H[Promote to MEMORY.md ✅]
        G -->|No| I[Archive to session<br/>history 📁]
    end
```

#### 阶段 1：浅睡眠——摄取与去重

Dreaming 过程从收集当天的所有原始材料开始：

1. **摄取** —— 读取每日记忆文件（`memory/YYYY-MM-DD.md`）以及过去 24 小时内的所有会话记录
2. **去重** —— 使用 Jaccard 相似度将每个候选事实与现有 MEMORY.md 条目及其他候选进行比较。阈值：**0.9**（90% 的 token 重叠 = 重复）。这防止记忆中累积几乎相同的条目，如"用户偏好 ruff"和"用户喜欢 ruff 胜过 black"
3. **暂存** —— 幸存的候选（非重复）被移至暂存区，等待阶段 2 处理

#### 阶段 2：REM 睡眠——主题分析

计算量最大的阶段。Agent 针对 **7 天回溯窗口**的会话历史分析暂存候选：

1. **主题提取** —— 使用 embedding 相似度按主题聚类暂存候选
2. **跨会话模式检测** —— 识别在 7 天窗口内跨多个会话出现的事实、偏好或行为
3. **候选真相识别** —— 在 3 个以上会话中以一致措辞出现的模式成为"候选真相"

7 天窗口是一个设计选择：足够长以捕获每周模式，又足够短以避免提升过时信息。周一提到一次且之后再未出现的偏好不会成为候选真相；周一、周三和周五都提到的偏好则会。

#### 阶段 3：深度睡眠——评分与提升

每个候选真相根据六个加权信号进行评分，然后检查是否通过三个阈值门控。

### 排名信号（加权）

| 信号 | 权重 | 衡量内容 |
|------|------|---------|
| **相关性** | 0.30 | 此事实对用户的主要使用场景有多核心？ |
| **频率** | 0.24 | 此事实在会话中出现的频率？ |
| **查询多样性** | 0.15 | 此事实是否由不同类型的查询/任务触发？ |
| **时效性** | 0.15 | 此事实最近一次被观察到是什么时候？ |
| **整合度** | 0.10 | 此事实是否已从多个来源部分整合？ |
| **概念丰富度** | 0.06 | 此事实是否与多个其他已知事实相关联？ |

最终得分是加权和：`score = 0.30×相关性 + 0.24×频率 + 0.15×多样性 + 0.15×时效性 + 0.10×整合度 + 0.06×丰富度`

### 提升阈值（全部必须通过）

| 门控 | 阈值 | 目的 |
|------|------|------|
| **minScore** | 0.8 | 综合质量门槛——过滤低信号候选 |
| **minRecallCount** | 3 | 事实在会话间被回忆/引用的最少次数 |
| **minUniqueQueries** | 3 | 事实出现的最少不同查询上下文数 |

三个门控必须同时通过。一个得分很高但只有 2 次回忆实例的事实不会被提升。一个被回忆了 10 次但始终在同一查询上下文中的事实也不会被提升。这种三重门控系统是刻意保守的——宁可漏掉一条有效记忆，也不要提升一条噪声记忆。

### 记忆架构（4 层）

Dreaming 运行在 Hermes 的完整四层记忆架构之上：

| 层级 | 内容 | Token 预算 | 持久性 | 访问方式 |
|------|------|-----------|--------|---------|
| **第 1 层：提示记忆** | MEMORY.md（~800 token）+ USER.md（~500 token） | ~1,300 token | 永久 | 始终在系统提示中 |
| **第 2 层：会话归档** | 过去的会话记录和每日日志 | 无限 | 90 天滚动窗口 | 通过 `session_search` 工具搜索 |
| **第 3 层：技能** | 来自复杂任务的过程性记忆（SKILL.md 文件） | 每个技能 ~500-1,500 token | 永久 | FTS5 搜索 + 渐进式披露 |
| **第 4 层：外部提供者** | 8 个可插拔记忆后端 | 因提供者而异 | 因提供者而异 | API 调用 |

#### 第 1 层：提示记忆——始终存在

MEMORY.md 和 USER.md 被注入每个系统提示中。这是 Agent 的"始终开启"记忆——应影响每个回复的事实。Token 预算很紧张（MEMORY.md ~800，USER.md ~500），因为这部分记忆需要与技能和指令竞争上下文窗口空间。

Dreaming 的提升管道是将事实放入 MEMORY.md 的主要机制。手动插入是可能的但不鼓励——Dreaming 过程确保只有经过验证的高价值事实才占用这块宝贵空间。

#### 第 2 层：会话归档——可搜索的历史

所有过去的会话都被归档，并可通过 `session_search` 工具搜索。Agent 可以查询自己的历史：

```python
results = await session_search(
    query="user's preferred testing framework",
    lookback_days=30,
    max_results=5
)
```

会话归档是 Dreaming 处理的原始材料。它在正常操作中也可用——当 Agent 需要回忆 MEMORY.md 中没有的内容时，它会搜索归档。

#### 第 3 层：技能——过程性记忆

技能是 Agent 的"操作方法"记忆。通过前文描述的自我评估检查点系统创建。Dreaming 不直接创建技能，但它可以将关于技能有效性的观察提升到 MEMORY.md（例如，"kubernetes-pod-debugging 技能对 CrashLoopBackOff 效果很好，但会遗漏 init container 问题"）。

#### 第 4 层：外部提供者——8 个可插拔后端

Hermes 支持 8 个外部记忆提供者，可与内置记忆并行启用：

| 提供者 | 类型 | 专长 |
|--------|------|------|
| **Honcho** | 辩证式用户建模 | 多轮推理的深度用户画像 |
| **Mem0** | 托管记忆服务 | 云端托管，跨设备同步 |
| **Hindsight** | 时序记忆 | 带有衰减建模的时间感知回忆 |
| **Supermemory** | 层次化存储 | 多层记忆，自动提升 |
| **RetainDB** | 向量数据库 | 基于 embedding 的语义搜索 |
| **ByteRover** | 对话记忆 | 针对对话优化的存储和检索 |
| **OpenViking** | 开源记忆服务 | 自托管，注重隐私 |
| **Holographic** | 关联记忆 | 基于关联的回忆（记忆网络） |

每个提供者作为额外记忆源接入第 4 层。Agent 可以同时查询所有已启用的提供者并合并结果。Dreaming 可以选择性地将提升的事实同时写入外部提供者和 MEMORY.md。

---

## 40+ 内置技能

Hermes 随附一个包含 40 多个内置技能的库，涵盖 10 个类别。这些代表了每个 Hermes Agent 与生俱来的过程性记忆——无需学习。

| 类别 | 示例技能 | 数量 |
|------|---------|------|
| **软件开发** | 代码审查、调试、重构、依赖管理 | 8 |
| **研究** | 网络搜索、论文摘要、事实核查、文献综述 | 5 |
| **生产力** | 任务管理、日历集成、笔记、会议总结 | 6 |
| **数据科学** | 数据分析、可视化、统计检验、数据集清洗 | 4 |
| **图表** | Mermaid 图、流程图、架构图、时序图 | 3 |
| **邮件** | 撰写、摘要、分类、后续跟踪 | 4 |
| **GitHub** | PR 审查、Issue 分类、仓库分析、CI 调试 | 4 |
| **媒体处理** | 图像分析、音频转录、视频摘要 | 3 |
| **智能家居** | 设备控制、自动化规则、场景管理 | 2 |
| **MLOps** | 模型部署、实验追踪、管道调试 | 3 |

这些内置技能有两个用途：

1. **基线能力** —— Agent 从第一个会话起就很有用，无需学习任何东西
2. **进化模板** —— Agent 自行创建的技能遵循与内置技能相同的格式和质量标准，因为内置技能是 Agent 见过的范例

内置技能也是自我评估系统的起点。当 Agent 遇到不匹配任何内置或学习技能的任务类型时，这是一个强烈的技能创建信号。

---

## 总结

```
┌──────────────────────────────────────────────────────────────┐
│                       Hermes Agent                            │
├──────────────────────────────────────────────────────────────┤
│  记忆：                                                       │
│    第 1 层：提示记忆（MEMORY.md + USER.md，~1300 token）       │
│    第 2 层：会话归档（可搜索，90 天窗口）                       │
│    第 3 层：技能（~/.hermes/skills/，FTS5 索引）               │
│    第 4 层：外部提供者（8 个可插拔后端）                        │
│                                                              │
│  Dreaming（需主动开启，每天凌晨 3 点）：                        │
│    浅睡眠 → REM 睡眠 → 深度睡眠                               │
│    6 个排名信号，3 个提升门控                                   │
│    minScore: 0.8 | minRecallCount: 3 | minUniqueQueries: 3   │
│                                                              │
│  自我评估：15 次调用检查点                                     │
│  5 个触发条件 → 技能创建/更新                                  │
│  skill_manage: ADD / EDIT / APPEND                           │
│                                                              │
│  40+ 内置技能，涵盖 10 个类别                                  │
│  6 种后端 × 9 个平台 × 200+ 模型                              │
│  Atropos：轨迹 → ShareGPT → 微调                             │
└──────────────────────────────────────────────────────────────┘
```

Hermes 是开源领域最完整的自进化系统。与 Claude Code 的关键区别：Hermes 的进化是 Agent 驱动的。Agent 创建自己的技能、编写自己的记忆、评估自己的表现、改进自己的流程。Claude Code 提供进化平台；Hermes 提供自主学习循环。

Dreaming 功能增加了其他生产 Agent 所没有的维度：**离线整合**。当用户休息时，Agent 在审查、去重、评分和提升记忆。这是任何生产系统最接近生物记忆整合的机制。

权衡之处：Agent 驱动的进化功能强大（一个月后工具调用减少 68%），但可能产生漂移、积累噪声或创建微妙错误的技能。15 次调用检查点、结构化评估标准和 Dreaming 的三重门控提升系统缓解了这些问题，但系统的质量最终取决于底层模型的判断力。
