# 第 8 章：Manus——上下文工程即进化

## 进化最迅速的 Agent

Manus 是通过上下文工程而非模型改进实现 Agent 进化的最清晰案例。该公司成立于 2025 年初，据报道在八个月内达到 1 亿美元 ARR，并被 Meta 以约 20-30 亿美元收购——使其成为 AI 历史上最快的价值创造案例之一。这一轨迹背后的技术引擎不是新颖的模型架构或专有的训练流程。而是上下文工程：塑造模型看到什么、何时看到、以及处理成本多低的学科。

Manus 在自我进化版图中的独特之处在于，*系统本身*在进化——不仅仅是 Agent 的记忆或技能，而是基础架构。团队在不到一年的时间里重建了五次 Agent 框架。每次重建都是由关于如何更好地为底层语言模型塑造上下文的发现所驱动的。

本章主要取材自季逸超（Peak Ji）的公开演讲"Context Engineering for AI Agents"（2025 年在技术会议上发表）、Manus 技术博客以及关于该公司架构的公开报道。

## "随机梯度下降"哲学

### 八个月内五次重写

Manus 团队用一个耐人寻味的比喻来描述他们的开发过程：**"在架构空间上的随机梯度下降。"** 正如 SGD 通过跟随有噪声的梯度迭代调整模型权重，Manus 团队通过跟随来自生产环境使用的有噪声信号迭代调整他们的 Agent 架构。

五次重写中的每一次都解决了在生产环境中发现的特定故障模式：

| 重写 | 主要发现 | 变更内容 |
|---------|-------------------|--------------|
| v1 → v2 | 提示词结构对工具调用准确度的影响大于工具定义 | 重构系统提示词层次结构 |
| v2 → v3 | KV-cache 未命中在规模化时主导成本 | 重新设计整个上下文流水线以实现缓存稳定性 |
| v3 → v4 | 单 Agent 上下文窗口在复杂任务上触及极限 | 引入具有上下文隔离的多 Agent 架构 |
| v4 → v5 | 工具数量激增降低模型选择准确度 | 实现 logit 空间的工具掩码 |

关键洞察在于，这些重写都不涉及更改底层模型。每次改进都来自对上下文如何塑造模型行为的更好理解。正如季逸超所说：这是一个"手动的架构搜索、提示词微调和经验猜测的过程。"

### 为什么上下文工程比模型训练更快

对于以周为单位发布产品的初创公司而言，上下文工程相比模型训练有一个根本性的优势：

```
Model training feedback loop:
  Collect data → Train → Evaluate → Deploy → Observe
  Timeline: weeks to months
  Cost: $100K–$10M per iteration

Context engineering feedback loop:
  Observe failure → Hypothesize context change → Deploy → Observe
  Timeline: hours to days
  Cost: ~$0 per iteration (same API, different prompts)
```

这种速度差异解释了为什么 Manus 比那些投资微调的竞争对手进化得更快。上下文工程是更快的梯度信号。代价是它需要对模型内部机制有深入理解——特别是注意力机制和 KV-cache——才能做好。

### 架构搜索类比

架构搜索的比喻是精确的。在神经架构搜索（NAS）中，研究人员探索可能的网络拓扑空间以找到高性能设计。Manus 做了同样的事情，但针对的是 Agent 架构：

- "搜索空间"是可能的上下文结构、工具配置和多 Agent 拓扑的集合
- "评估函数"是生产环境的任务完成率和成本
- "搜索算法"是人类工程师观察故障模式并假设改进方案

这不是 MemRL 或 ADAS 那种自动化的自我进化。它是*人类驱动的元进化*——但它仍然是进化。系统通过积累经验变得更好，只是由人类工程师而非自动化反馈循环来中介。

## KV-Cache 作为第一优化目标

### 缓存上下文的经济学

Manus 架构中影响最大的技术洞察是 **KV-cache 命中率是 Agent 系统经济性的首要指标**。这不是夸张——这是算术。

生产环境的 Manus Agent 的平均输入与输出 token 比约为 **100:1**。模型每生成一个 token，就要处理约 100 个上下文 token。这意味着成本结构绝大部分由输入处理主导：

| 组件 | Token 数 | 成本（未缓存） | 成本（已缓存） |
|-----------|--------|-----------------|---------------|
| 输入上下文 | 100K | $0.30 | $0.03 |
| 输出生成 | 1K | $0.015 | $0.015 |
| **合计** | 101K | **$0.315** | **$0.045** |

0% 缓存命中率和 90%+ 缓存命中率之间的差异是**每次请求成本降低 7 倍**。在 1 亿美元 ARR 的规模下，这是可行商业模式与财务灾难之间的差别。

```
    Cost per request ($)
    │
0.35├─ ■ No caching ($0.315)
    │
0.30├─
    │
0.25├─
    │
0.20├─
    │
0.15├─
    │
0.10├─
    │
0.05├─ ■ With 90%+ cache hits ($0.045)
    │
0.00└──────────────────────────────────
```

### 缓存友好上下文的三个原则

Manus 总结了每个 Agent 系统都应遵循的三个缓存优化原则：

#### 原则 1：稳定前缀

KV-cache 通过精确匹配 token 前缀来工作。如果前缀中的任何 token 发生变化，所有后续的缓存计算都会失效。这有一个反直觉的含义：**永远不要在提示词开头放置时间戳、随机 ID 或随会话变化的内容。**

```
❌ Bad: timestamp at prefix
┌──────────────────────────────┐
│ Current time: 2026-04-19...  │ ← Changes every request
│ System instructions...       │ ← Cache MISS (prefix changed)
│ Tool definitions...          │ ← Cache MISS (prefix changed)
│ Conversation history...      │ ← Cache MISS (prefix changed)
└──────────────────────────────┘

✅ Good: stable content first
┌──────────────────────────────┐
│ System instructions...       │ ← Cache HIT (stable)
│ Tool definitions...          │ ← Cache HIT (stable)
│ Conversation history...      │ ← Cache HIT (append-only)
│ Current time: 2026-04-19...  │ ← Only this is new
└──────────────────────────────┘
```

这事后看来很显然，但许多 Agent 框架在系统提示词顶部插入时间戳、请求 ID 或动态计算的元数据——悄无声息地破坏了缓存性能。

#### 原则 2：仅追加上下文

一旦某个动作被记录到对话历史中，就永远不能修改。Manus 严格执行仅追加上下文：新的观察、工具结果和 Agent 动作始终追加到历史末尾，永远不会插入或修改先前的条目。

这延伸到序列化。工具调用参数和结果使用**确定性键排序**序列化为 JSON（Python 中的 `sort_keys=True`，或等效方式）。这很关键，因为：

```python
# These are semantically identical but produce different token sequences:
{"action": "click", "target": "#submit"}
{"target": "#submit", "action": "click"}

# Different token sequences → different KV-cache keys → cache MISS
```

**`sort_keys` bug** 是 Agent 系统中最隐蔽的性能问题之一。非确定性 JSON 序列化——键的顺序取决于哈希随机化或插入顺序——会在请求之间悄无声息地破坏 KV-cache。即使语义内容相同，token 对模型来说看起来也不同。Manus 发现这是他们早期缓存未命中的重要原因之一。

确定性序列化检查清单：
- JSON：使用 `sort_keys=True` 或等效方式
- Python 字典：不要依赖插入顺序进行序列化
- 工具定义：对参数使用规范排序
- 环境状态：使用一致的字段排序进行序列化

#### 原则 3：显式缓存断点

现代推理 API（Claude、OpenAI）支持显式缓存断点标记，告诉推理引擎在哪里分割 KV-cache。Manus 策略性地放置这些断点：

```
┌────────────────────────────────────┐
│ System prompt                      │
│ (rarely changes)                   │
├─── CACHE BREAKPOINT ───────────────┤  ← Segment 1: reused across all requests
│ Tool definitions                   │
│ (changes only on deploys)          │
├─── CACHE BREAKPOINT ───────────────┤  ← Segment 2: reused within a session
│ Conversation history turns 1-N    │
│ (append-only)                      │
├─── CACHE BREAKPOINT ───────────────┤  ← Segment 3: reused within a turn
│ Current turn context               │
│ (new each request)                 │
└────────────────────────────────────┘
```

最低建议是在系统提示词末尾放置一个断点。更精细的系统在每个对话轮次末尾放置断点，即使旧轮次最终被清除，也能实现部分缓存复用。

### 缓存感知的上下文流水线

完整的 Manus 上下文流水线按严格的缓存最优顺序组装提示词：

```
┌─────────────────────────────────────────────────────┐
│                  CONTEXT ASSEMBLY                     │
│                                                       │
│  1. System prompt (static per deployment)             │
│     ↓                                                 │
│  2. Tool definitions (static per deployment)          │
│     ↓                                                 │
│  3. Agent persona / role (static per session type)    │
│     ↓                                                 │
│  4. Conversation history (append-only)                │
│     ↓                                                 │
│  5. Retrieved knowledge (varies per turn)             │
│     ↓                                                 │
│  6. Current observation (new each turn)               │
│     ↓                                                 │
│  7. Dynamic metadata (timestamps, token counts)       │
│                                                       │
│  Cache hit probability: HIGH ──────────────── LOW     │
└─────────────────────────────────────────────────────┘
```

所有频繁变化的内容被推到末尾。所有稳定的内容固定在开头。这是核心架构原则。

## 通过 Logit 操作实现工具掩码

### 工具激增问题

随着 Manus 能力的增长，可用工具的数量显著扩大。这产生了一个矛盾：

- **更多工具 = 更强的 Agent**（可以处理更多任务类型）
- **更多工具 = 更差的工具选择**（模型准确度随选项增多而下降）
- **动态工具过滤破坏 KV-cache**（移除工具会改变前缀）

朴素的解决方案——在每次请求中只动态包含相关工具——会破坏缓存性能，因为工具定义部分靠近上下文顶部。那里的任何变化都会使所有后续缓存计算失效。

### Logit 空间的解决方案

Manus 的解决方案很优雅：**在每次请求中保留所有工具定义，但在解码期间通过 logit 空间掩码屏蔽不可用的工具。**

```
┌───────────────────────────────────────────────┐
│              TOOL MASKING ARCHITECTURE          │
│                                                 │
│  Context (stable):                              │
│  ┌─────────────────────────────────────┐       │
│  │ System prompt                        │       │
│  │ ALL tool definitions (always present)│       │  ← Never changes
│  │ Conversation history                 │       │     = Cache stable
│  └─────────────────────────────────────┘       │
│                                                 │
│  Decoding (dynamic):                            │
│  ┌─────────────────────────────────────┐       │
│  │ Model generates token probabilities  │       │
│  │         ↓                            │       │
│  │ Apply logit mask:                    │       │
│  │   browser_click    → allowed (1.0)   │       │
│  │   browser_navigate → allowed (1.0)   │       │
│  │   shell_execute    → MASKED (-∞)     │       │
│  │   shell_write_file → MASKED (-∞)     │       │
│  │         ↓                            │       │
│  │ Sample from masked distribution      │       │
│  └─────────────────────────────────────┘       │
│                                                 │
└───────────────────────────────────────────────┘
```

模型在上下文中"看到"所有工具（保留缓存），但在 token 生成的那一刻，某些工具调用 token 被赋予 -∞ 的概率，使其无法被选择。这实现了与从提示词中移除工具相同的效果，而没有任何缓存成本。

### 一致的工具命名用于分组掩码

为了使 logit 掩码实用化，Manus 使用一致的工具名称前缀来支持基于组的操作：

| 前缀 | 工具组 | 示例工具 |
|--------|-----------|---------------|
| `browser_` | 网页交互 | `browser_click`、`browser_navigate`、`browser_scroll`、`browser_type` |
| `shell_` | 终端操作 | `shell_execute`、`shell_write_file`、`shell_read_file` |
| `file_` | 文件管理 | `file_create`、`file_edit`、`file_delete` |
| `search_` | 信息检索 | `search_web`、`search_docs`、`search_code` |
| `deploy_` | 部署 | `deploy_preview`、`deploy_production` |

当 Agent 处于"仅浏览器"阶段（例如，在编码前进行研究）时，系统掩码所有非 `browser_` 前缀的工具。当转入编码阶段时，解除 `shell_` 和 `file_` 工具的掩码，同时掩码 `deploy_` 工具。

这种前缀约定实现了：
1. 组级别的启用/禁用，无需逐个工具配置
2. 无论哪些工具处于活跃状态，缓存行为保持一致
3. 在现有组内轻松添加新工具

### 工具可用性的状态机

Manus 实现了一个状态机来管理工具可用性转换：

```
                    ┌──────────┐
          ┌────────►│ RESEARCH │────────┐
          │         └──────────┘        │
          │         browser_*: ✓        │
          │         search_*:  ✓        │ user provides
    task   │         shell_*:  ✗        │ requirements
  assigned │         file_*:   ✗        │
          │         deploy_*:  ✗        ▼
    ┌─────┴──┐                    ┌──────────┐
    │ INTAKE  │                   │ PLANNING │
    └────────┘                    └────┬─────┘
                                      │ plan approved
                                      ▼
                                ┌──────────┐
                                │ BUILDING │◄─────┐
                                └────┬─────┘      │
                                browser_*: ✓      │ tests fail
                                shell_*:   ✓      │
                                file_*:    ✓      │
                                deploy_*:  ✗      │
                                     │            │
                                     ▼            │
                                ┌──────────┐      │
                                │ TESTING  │──────┘
                                └────┬─────┘
                                     │ tests pass
                                     ▼
                                ┌──────────┐
                                │ DEPLOY   │
                                └──────────┘
                                browser_*: ✓
                                shell_*:   ✓
                                file_*:    ✓
                                deploy_*:  ✓
```

每次状态转换只改变 logit 掩码，而不改变上下文中的工具定义。缓存在所有阶段转换中保持稳定。

## 多 Agent 架构即进化

### 为什么单 Agent 会遇到天花板

单 Agent 范式——一次模型调用用一个上下文窗口处理整个任务——随着任务复杂度的增长会触及根本性限制：

1. **上下文预算**：复杂任务需要研究上下文、代码上下文、测试结果、部署日志。这些竞争同一 token 预算。
2. **注意力稀释**：随着上下文增长，模型对早期内容的注意力会下降。系统提示词中的关键指令获得的注意力权重减少。
3. **错误传播**：20 步计划中第 3 步的错误会污染所有后续步骤的上下文。
4. **无法专业化**：同一系统提示词必须处理研究、规划、编码、测试和部署——对其中一个优化会损害其他。

### Manus 的多 Agent 拓扑

Manus 通过多 Agent 架构解决这些限制，用户只与一个 Agent 交互——**执行器**——而其他 Agent 在隔离的上下文窗口中运行：

```
┌─────────────────────────────────────────────────────┐
│                    USER                              │
│                      │                               │
│                      ▼                               │
│              ┌───────────────┐                       │
│              │   EXECUTOR    │  ← User-facing        │
│              │  (orchestrator)│    Full conversation  │
│              └───┬───┬───┬──┘    history             │
│                  │   │   │                            │
│        ┌─────────┘   │   └──────────┐                │
│        ▼             ▼              ▼                 │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐          │
│  │ PLANNER  │  │KNOWLEDGE │  │SPECIALIST │          │
│  │          │  │          │  │           │          │
│  │ Isolated │  │ Isolated │  │ Isolated  │          │
│  │ context  │  │ context  │  │ context   │          │
│  └──────────┘  └──────────┘  └───────────┘          │
│                                                       │
│  Each agent has:                                      │
│  - Own system prompt (optimized for its role)         │
│  - Own conversation history (relevant subset)         │
│  - Own tool set (role-appropriate tools only)         │
│  - Own KV-cache (independent cache lifecycle)         │
└─────────────────────────────────────────────────────┘
```

### 上下文隔离作为错误容器

多 Agent 架构最被低估的好处是**错误遏制**。当专家 Agent 犯错——生成有 bug 的代码、检索了不相关的信息或走错了方向——该错误仅存在于专家的上下文窗口中。执行器只接收专家的最终输出，而非失败尝试的完整追踪。

这类似于操作系统中的进程隔离。一个进程的崩溃不会破坏另一个进程的内存空间。在 Manus 中：

```
Specialist agent context:          Executor agent context:
┌────────────────────────┐        ┌────────────────────────┐
│ System: "You are a     │        │ System: "You are an    │
│ coding specialist..."  │        │ orchestrator..."       │
│                        │        │                        │
│ Attempt 1: buggy code  │        │ User: "Build me a     │
│ Error: TypeError...    │        │ landing page"          │
│ Attempt 2: still buggy │        │                        │
│ Debug: found the issue │        │ [Specialist result]:   │
│ Attempt 3: works!      │        │ "Here is the working   │
│                        │        │  landing page code..." │
│ Result: working code   │        │                        │
└────────────────────────┘        └────────────────────────┘

The executor never sees the 3 failed attempts.
Its context stays clean.
```

### 每个 Agent 的独立进化

Manus 拓扑中的每个 Agent 都独立进化其上下文管理：

- **规划器**：优化用于长期推理，最少的工具定义，大量使用结构化输出
- **知识 Agent**：优化用于检索，大量使用 `search_*` 工具，短对话历史
- **专家 Agent**：优化用于特定领域执行，领域特定的系统提示词，任务范围的历史
- **执行器**：优化用于用户交互，完整的对话历史，所有工具组可用

当 Manus 团队为规划器发现更好的系统提示词时，可以在不影响任何其他 Agent 缓存的情况下部署它。当他们为专家添加工具时，执行器的缓存保持稳定。这是**模块化进化**——对一个组件的更改不会级联传播到整个系统。

### Agent 之间的信息流

Agent 之间通过结构化消息传递进行通信，而非共享上下文：

```
Executor                    Planner
   │                           │
   │  "User wants a blog.      │
   │   Tech stack: Next.js.    │
   │   Requirements: ..."      │
   │ ─────────────────────────►│
   │                           │  (Planner works in
   │                           │   isolated context)
   │  {                        │
   │    "steps": [             │
   │      {"phase": "setup",   │
   │       "tools": ["shell"]},│
   │      {"phase": "code",    │
   │       "tools": ["file"]}, │
   │      ...                  │
   │    ]                      │
   │  }                        │
   │ ◄─────────────────────────│
   │                           │
   ▼                           │
```

规划器接收用户请求的压缩摘要，而非完整对话。执行器接收结构化计划，而非规划器的推理追踪。每个 Agent 在其所需的最少信息上运行。

## Manus 关于进化的启示

### 没有 SKILL.md 或 MEMORY.md 的进化

Manus 不像 Claude Code（CLAUDE.md）或 Hermes（SKILL.md、MEMORY.md）那样使用基于文件的记忆。没有积累用户偏好的逐用户学习文件。没有随经验增长的技能库。

相反，Manus 的进化是**系统性的**：

| 进化机制 | 工作方式 | 类比 |
|-------------------|-------------|---------|
| 架构重写 | 当发现更好的上下文模式时重建整个框架 | 物种形成事件 |
| KV-cache 优化 | 为缓存命中率优化提示词结构 | 代谢效率 |
| 工具掩码 | 在 logit 空间控制工具可用性而不改变上下文 | 表型可塑性 |
| 多 Agent 拓扑 | Agent 在隔离上下文中独立进化 | 模块化生物设计 |

这是**元进化**：构建 Agent 的系统在进化，而不仅仅是 Agent 在单个任务上的行为。五次重写中的每一次都代表系统的一代，"适应度函数"是生产环境的任务完成率和成本。

### KV-Cache 优化的复合效应

KV-cache 优化具有复合属性，使其作为进化机制特别强大：

1. **一阶效应**：直接成本节省（输入处理成本降低 10 倍）
2. **二阶效应**：更便宜的请求 → 可以承担更长的上下文 → 更好的任务表现
3. **三阶效应**：更好的表现 → 更多用户 → 更多使用数据 → 更好的架构洞察
4. **四阶效应**：架构洞察 → 下次重写 → 更好的缓存性能

```
┌──────────────┐     ┌───────────────┐     ┌──────────────┐
│ Better cache  │────►│ Lower cost    │────►│ Longer       │
│ hit rates     │     │ per request   │     │ contexts     │
└──────────────┘     └───────────────┘     └──────┬───────┘
       ▲                                          │
       │                                          ▼
┌──────┴───────┐     ┌───────────────┐     ┌──────────────┐
│ Architecture │◄────│ More usage    │◄────│ Better task  │
│ improvements │     │ data          │     │ performance  │
└──────────────┘     └───────────────┘     └──────────────┘
```

### 对比：基于文件的进化 vs. 系统性进化

| 维度 | 基于文件（Claude Code、Hermes） | 系统性（Manus） |
|-----------|----------------------------------|-------------------|
| 什么在进化 | Agent 的知识/技能/记忆 | 系统架构 |
| 谁驱动进化 | Agent + 用户 | 工程团队 |
| 进化速度 | 每次会话（快） | 每次重写（慢） |
| 进化范围 | 单个 Agent 行为 | 全部 Agent 全局范围 |
| 持久性 | 项目目录中的文件 | 已部署的基础设施 |
| 退化风险 | 记忆膨胀、陈旧技能 | 架构死胡同 |
| 可迁移性 | 用户特定 | 所有用户受益 |

两种方法都不是绝对更好的。基于文件的进化支持系统性进化无法实现的逐用户个性化。系统性进化支持基于文件的系统无法实现的架构改进。最强大的 Agent 系统可能会结合两者。

### 五次重写模式作为组织进化

五次重写也代表了一种组织进化。每次重写迫使团队：

1. **放弃沉没成本**：当发现更好的上下文模式时丢弃可工作的代码
2. **重新推导第一性原理**：质疑关于 Agent 应如何组织上下文的假设
3. **衡量真正重要的指标**：将指标从"它能工作吗"转向"缓存命中率是多少"
4. **编码发现**：每次重写将前一次迭代的经验教训固化到架构中

这与自我进化 Agent 的预期工作方式极为相似：观察结果、提取模式、将其固化为可复用的结构。区别在于，在 Manus，进行"进化"的 "Agent" 是工程团队，而非软件本身。

## 对 Agent 构建者的启示

### 围绕缓存设计你的上下文流水线

从 Manus 得到的最具可操作性的收获是：**将 KV-cache 作为首要优化目标来设计你的上下文流水线。** 这意味着：

1. 审计你的提示词组装顺序。将稳定内容放在前面，动态内容放在后面。
2. 永远不要修改历史上下文。只追加。
3. 在所有地方使用确定性序列化。对此进行显式测试。
4. 在分段边界放置显式缓存断点。
5. 在生产环境中衡量缓存命中率。如果你没有在衡量，你就没有在优化。

### 使用 Logit 掩码管理工具

如果你有超过约 10 个工具且需要根据 Agent 状态限制可用性：

1. 在每次请求中定义所有工具（缓存稳定）
2. 对工具组使用一致的命名前缀
3. 实现状态机驱动的 logit 掩码
4. 衡量：工具选择准确度应提高，同时缓存命中率保持高位

### 当上下文压力增大时考虑多 Agent

你需要多 Agent 架构的信号：

- 上下文经常超过模型窗口的 50%
- 你看到对早期指令的注意力退化
- 早期步骤的错误传播正在破坏后续工作
- 你需要为不同的任务阶段使用不同的系统提示词

### 元进化被低估了

大多数 Agent 构建者专注于让他们的 Agent 在任务上做得更好。Manus 专注于让他们*构建 Agent 的系统*变得更好。这是一个根本不同的优化目标，而且它复合增长得更快。

每个 Agent 团队都应该思考的问题：你是否只在进化 Agent，还是也在进化产生 Agent 的系统？

---

**下一章：[第 9 章——Codex](09_codex.md)** ——OpenAI Codex 如何通过上下文压缩和子 Agent 隔离实现进化。
