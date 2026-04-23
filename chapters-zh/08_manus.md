# 第 8 章：Manus——上下文工程即进化

## 进化最迅速的 Agent

Manus 是"通过上下文工程而非模型改进驱动 Agent 进化"这一路径的最佳范例。公司 2025 年初成立，据报道八个月内 ARR 达到 1 亿美元，随后被 Meta 以约 20-30 亿美元收购——堪称 AI 史上最快的价值创造之一。支撑这条增长曲线的技术引擎，既不是新颖的模型架构，也不是私有训练流程，而是上下文工程：决定模型看到什么、何时看到、以多低的成本处理的一门学问。

Manus 在自我进化版图中独树一帜：进化的是*系统本身*——不只是 Agent 的记忆或技能，而是底层架构。团队在不到一年里重建了五次 Agent 框架，每次重建都源自一个新发现：如何更好地为底层语言模型组织上下文。

本章主要取材自季逸超（Peak Ji）的公开演讲"Context Engineering for AI Agents"（2025 年技术会议）、Manus 技术博客，以及关于该公司架构的公开报道。

## "随机梯度下降"哲学

### 八个月内五次重写

Manus 团队用了一个耐人寻味的比喻来描述自己的开发过程：**"在架构空间上做随机梯度下降。"** 正如 SGD 沿着带噪声的梯度迭代调整模型权重，Manus 团队也沿着来自生产环境的带噪声信号，迭代调整 Agent 架构。

五次重写，每一次都针对生产环境中暴露出的具体故障模式：

| 重写 | 主要发现 | 变更内容 |
|---------|-------------------|--------------|
| v1 → v2 | prompt 结构对工具调用准确度的影响大于工具定义本身 | 重构系统 prompt 层次结构 |
| v2 → v3 | KV-cache 未命中在规模化时主导成本 | 重新设计上下文流水线，以缓存稳定性为核心 |
| v3 → v4 | 单 Agent 上下文窗口在复杂任务上触顶 | 引入多 Agent 架构，上下文彼此隔离 |
| v4 → v5 | 工具数量膨胀拉低模型选择准确度 | 在 logit 空间做工具掩码 |

关键洞察：这些重写没有一次涉及更换底层模型。每次改进都来自对"上下文如何塑造模型行为"的更深理解。用季逸超的话说，这是一个"手动架构搜索、prompt 微调与经验猜测交替推进的过程"。

### 为什么上下文工程比模型训练更快

对于以周为节奏发布产品的初创公司，上下文工程相比模型训练有一个根本性优势：

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

这种速度差异解释了 Manus 为何比那些押注微调的竞争对手进化得更快——上下文工程提供了更快的梯度信号。代价是，要做好它需要深入理解模型内部机制，尤其是注意力机制和 KV-cache。

### 架构搜索类比

"架构搜索"这个比喻很精准。在神经架构搜索（NAS）中，研究者遍历可能的网络拓扑空间，寻找高性能设计。Manus 做了同样的事，只不过搜索目标是 Agent 架构：

- **搜索空间**：各种可能的上下文结构、工具配置和多 Agent 拓扑
- **评估函数**：生产环境的任务完成率和成本
- **搜索算法**：工程师观察故障模式，提出改进假设

这不是 MemRL 或 ADAS 那种自动化的自我进化，而是*人类驱动的元进化*——但本质上仍然是进化。系统通过积累经验不断变好，只不过中介者是人类工程师而非自动化反馈循环。

## KV-Cache 作为第一优化目标

### 缓存上下文的经济学

Manus 架构中影响最深远的技术洞察是：**KV-cache 命中率是 Agent 系统经济性的首要指标**。这不是夸张，这是简单的算术。

生产环境中 Manus Agent 的平均输入输出 token 比约为 **100:1**——模型每生成一个 token，就要处理约 100 个上下文 token。成本结构几乎完全由输入处理主导：

| 组件 | Token 数 | 成本（未缓存） | 成本（已缓存） |
|-----------|--------|-----------------|---------------|
| 输入上下文 | 100K | $0.30 | $0.03 |
| 输出生成 | 1K | $0.015 | $0.015 |
| **合计** | 101K | **$0.315** | **$0.045** |

缓存命中率从 0% 提升到 90% 以上，对应的是**单次请求成本降低 7 倍**。在 1 亿美元 ARR 的规模下，这就是可行商业模式与财务灾难的分界线。

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

Manus 总结了三条缓存优化原则，适用于所有 Agent 系统：

#### 原则 1：稳定前缀

KV-cache 靠精确匹配 token 前缀来工作。前缀中任何一个 token 变了，后续所有缓存计算全部失效。由此得出一个反直觉的结论：**永远不要在 prompt 开头放时间戳、随机 ID 或其他随会话变化的内容。**

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

事后看来这显而易见，但很多 Agent 框架偏偏在系统 prompt 顶部插入时间戳、请求 ID 或动态计算的元数据——悄无声息地毁掉了缓存性能。

#### 原则 2：仅追加上下文

动作一旦记入对话历史，就绝不能修改。Manus 严格执行仅追加原则：新的观察、工具结果和 Agent 动作始终追加到历史末尾，绝不插入或修改已有条目。

序列化同样要遵守这一原则。工具调用参数和结果一律使用**确定性键排序**的 JSON（Python 中的 `sort_keys=True` 或等效方式）。原因很简单：

```python
# These are semantically identical but produce different token sequences:
{"action": "click", "target": "#submit"}
{"target": "#submit", "action": "click"}

# Different token sequences → different KV-cache keys → cache MISS
```

**`sort_keys` bug** 是 Agent 系统中最隐蔽的性能杀手之一。非确定性 JSON 序列化——键的顺序取决于哈希随机化或插入顺序——会在请求之间悄无声息地破坏 KV-cache。语义内容完全相同，但 token 序列不同，模型就当成不同的输入。Manus 发现这是早期缓存未命中的重要原因之一。

确定性序列化检查清单：
- JSON：使用 `sort_keys=True` 或等效方式
- Python 字典：不要依赖插入顺序做序列化
- 工具定义：参数使用规范排序
- 环境状态：字段排序保持一致

#### 原则 3：显式缓存断点

现代推理 API（Claude、OpenAI）支持显式缓存断点标记，告诉推理引擎在哪里切分 KV-cache。Manus 有策略地放置这些断点：

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

最基本的做法是在系统 prompt 末尾放一个断点。更精细的方案会在每个对话轮次末尾也放断点，这样即使旧轮次最终被清除，也能部分复用缓存。

### 缓存感知的上下文流水线

完整的 Manus 上下文流水线按严格的缓存最优顺序组装 prompt：

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

所有频繁变化的内容推到末尾，所有稳定的内容锚定在开头。这就是核心架构原则。

## 通过 Logit 操作实现工具掩码

### 工具激增问题

随着 Manus 能力扩展，可用工具数量大幅增长，由此产生了一个三难困境：

- **工具越多，Agent 越强**（能处理更多任务类型）
- **工具越多，选择越差**（模型准确度随选项增多而下降）
- **动态过滤工具会破坏 KV-cache**（移除工具意味着改变前缀）

最朴素的解法——每次请求只放入相关工具——会破坏缓存性能，因为工具定义位于上下文靠前的位置，那里的任何变动都会导致后续缓存全部失效。

### Logit 空间的解法

Manus 的方案很优雅：**每次请求保留全部工具定义，但在解码阶段通过 logit 掩码屏蔽不可用的工具。**

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

模型在上下文中"看到"了所有工具（缓存得以保留），但在生成 token 的那一刻，某些工具调用 token 的概率被设为 -∞，无法被选中。效果等同于从 prompt 中移除这些工具，却没有任何缓存代价。

### 一致的工具命名实现分组掩码

为了让 logit 掩码便于操作，Manus 采用统一的工具名称前缀，支持按组掩码：

| 前缀 | 工具组 | 示例工具 |
|--------|-----------|---------------|
| `browser_` | 网页交互 | `browser_click`、`browser_navigate`、`browser_scroll`、`browser_type` |
| `shell_` | 终端操作 | `shell_execute`、`shell_write_file`、`shell_read_file` |
| `file_` | 文件管理 | `file_create`、`file_edit`、`file_delete` |
| `search_` | 信息检索 | `search_web`、`search_docs`、`search_code` |
| `deploy_` | 部署 | `deploy_preview`、`deploy_production` |

Agent 处于"仅浏览器"阶段（比如编码前的调研）时，系统掩码所有非 `browser_` 前缀的工具。进入编码阶段后，解除 `shell_` 和 `file_` 工具的掩码，同时屏蔽 `deploy_` 工具。

这种前缀约定带来三个好处：
1. 按组启用/禁用，无需逐个配置
2. 无论哪些工具活跃，缓存行为始终一致
3. 在现有组内添加新工具非常方便

### 工具可用性的状态机

Manus 用一个状态机管理工具可用性的切换：

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

每次状态转换只改变 logit 掩码，不动上下文中的工具定义。缓存在所有阶段切换中保持稳定。

## 多 Agent 架构即进化

### 为什么单 Agent 会遇到天花板

单 Agent 范式——用一次模型调用、一个上下文窗口处理整个任务——随着任务复杂度增长，会撞上几道硬墙：

1. **上下文预算**：复杂任务需要研究上下文、代码上下文、测试结果、部署日志，它们都在争夺同一份 token 预算。
2. **注意力稀释**：上下文越长，模型对早期内容的注意力越弱。系统 prompt 中的关键指令分到的注意力权重越来越少。
3. **错误传播**：20 步计划中第 3 步出了错，后续所有步骤的上下文都被污染。
4. **无法专业化**：同一份系统 prompt 要兼顾研究、规划、编码、测试和部署——为其中一个优化，必然牺牲其他。

### Manus 的多 Agent 拓扑

Manus 用多 Agent 架构化解这些限制。用户只与一个 Agent 交互——**执行器**——其他 Agent 各自在隔离的上下文窗口中运行：

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

### 上下文隔离即错误容器

多 Agent 架构最容易被忽视的优势是**错误遏制**。专家 Agent 犯了错——写出有 bug 的代码、检索了无关信息、走了弯路——这些错误只留在该专家的上下文窗口里。执行器只收到专家的最终产出，看不到那些失败尝试的完整过程。

这类似于操作系统中的进程隔离：一个进程崩溃不会破坏另一个进程的内存空间。在 Manus 中：

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

### 各 Agent 独立进化

Manus 拓扑中的每个 Agent 各自独立优化上下文管理策略：

- **规划器**：针对长程推理优化，工具定义尽量少，大量使用结构化输出
- **知识 Agent**：针对检索优化，重度依赖 `search_*` 工具，对话历史保持简短
- **专家 Agent**：针对特定领域执行优化，使用领域专属系统 prompt，只保留任务范围内的历史
- **执行器**：针对用户交互优化，保留完整对话历史，所有工具组可用

团队为规划器找到更好的系统 prompt 后，可以直接部署，不影响其他 Agent 的缓存。为专家添加新工具时，执行器的缓存纹丝不动。这就是**模块化进化**——一个组件的变更不会级联波及整个系统。

### Agent 之间的信息流

Agent 之间通过结构化消息通信，而非共享上下文：

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

规划器收到的是用户请求的压缩摘要，而非完整对话。执行器收到的是结构化计划，而非规划器的推理过程。每个 Agent 只拿到完成自身任务所需的最少信息。

## Manus 关于进化的启示

### 没有 SKILL.md 或 MEMORY.md 的进化

Manus 不像 Claude Code（CLAUDE.md）或 Hermes（SKILL.md、MEMORY.md）那样使用基于文件的记忆。没有逐用户积累偏好的学习文件，也没有随经验增长的技能库。

Manus 的进化发生在**系统层面**：

| 进化机制 | 工作方式 | 类比 |
|-------------------|-------------|---------|
| 架构重写 | 发现更好的上下文模式后重建整个框架 | 物种形成事件 |
| KV-cache 优化 | 为缓存命中率优化 prompt 结构 | 代谢效率 |
| 工具掩码 | 在 logit 空间控制工具可用性，不改变上下文 | 表型可塑性 |
| 多 Agent 拓扑 | 各 Agent 在隔离上下文中独立进化 | 模块化生物设计 |

这是**元进化**：在进化的不是 Agent 在单个任务上的表现，而是构建 Agent 的系统本身。五次重写中的每一次都是系统的一代，"适应度函数"就是生产环境的任务完成率和成本。

### KV-Cache 优化的复合效应

KV-cache 优化之所以作为进化机制格外强大，在于其复合特性：

1. **一阶效应**：直接省钱（输入处理成本降低 10 倍）
2. **二阶效应**：请求更便宜 → 能负担更长的上下文 → 任务表现更好
3. **三阶效应**：表现更好 → 用户更多 → 使用数据更丰富 → 架构洞察更深
4. **四阶效应**：架构洞察 → 下一次重写 → 缓存性能再上一个台阶

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
| 进化范围 | 单个 Agent 行为 | 全部 Agent，全局生效 |
| 持久性 | 项目目录中的文件 | 已部署的基础设施 |
| 退化风险 | 记忆膨胀、技能陈旧 | 架构走入死胡同 |
| 可迁移性 | 用户特定 | 所有用户受益 |

两种路径没有绝对优劣。基于文件的进化能做到逐用户个性化，这是系统性进化做不到的。系统性进化能推动架构级改进，这是基于文件的方案无法企及的。最强大的 Agent 系统很可能两者兼用。

### 五次重写作为组织进化

五次重写同时也是一种组织层面的进化。每次重写都迫使团队：

1. **放弃沉没成本**：发现更好的上下文模式后，果断丢弃还能跑的代码
2. **回到第一性原理**：重新质疑"Agent 应该如何组织上下文"这个基本假设
3. **校准真正的指标**：把关注点从"能不能跑通"转向"缓存命中率是多少"
4. **固化经验教训**：每次重写都把上一轮迭代的收获嵌入架构

这与自我进化 Agent 的理想工作方式惊人地相似：观察结果、提取模式、固化为可复用的结构。区别在于，在 Manus 负责"进化"的那个"Agent"是工程团队，而非软件本身。

## 对 Agent 构建者的启示

### 围绕缓存设计上下文流水线

Manus 给出的最具可操作性的经验是：**把 KV-cache 当作首要优化目标来设计上下文流水线。** 具体而言：

1. 审查 prompt 组装顺序：稳定内容在前，动态内容在后。
2. 绝不修改历史上下文，只做追加。
3. 所有序列化一律确定性，并为此写显式测试。
4. 在分段边界放置显式缓存断点。
5. 在生产环境中监控缓存命中率——不衡量就等于不优化。

### 用 Logit 掩码管理工具

如果你的工具超过约 10 个，且需要根据 Agent 状态限制可用性：

1. 每次请求都带上全部工具定义（保证缓存稳定）
2. 工具命名采用统一前缀，便于分组
3. 用状态机驱动 logit 掩码
4. 持续衡量：工具选择准确度应提升，缓存命中率不应下降

### 当上下文压力增大时考虑多 Agent

以下信号说明你需要多 Agent 架构：

- 上下文经常占满模型窗口的 50% 以上
- 早期指令的注意力明显衰减
- 早期步骤的错误不断传播，破坏后续工作
- 不同任务阶段需要截然不同的系统 prompt

### 元进化被低估了

大多数 Agent 构建者把精力花在让 Agent 在任务上表现更好。Manus 则专注于让*构建 Agent 的系统*变得更好。这是一个根本不同的优化目标，而且复合增长更快。

每个 Agent 团队都该问自己一个问题：你只是在进化 Agent，还是也在进化产生 Agent 的系统？

---

**下一章：[第 9 章——Codex](09_codex.md)** ——OpenAI Codex 如何通过上下文压缩和子 Agent 隔离实现进化。
