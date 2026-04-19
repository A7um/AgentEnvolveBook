# Part II: Memory-Based Self-Evolution

---

## Preface to Part II

Part I established that agents are LLMs running in loops with tool access. But a loop that repeats the same mistakes is just an expensive `while True`. The frontier question in 2025–2026 is not *how to build an agent* but *how to make an agent that gets better at runtime*—without retraining, without human-curated prompt libraries, and without access to gradient signals.

This part covers four systems that answer that question through memory-based self-evolution: a reinforcement-learning framework that learns utility over episodic memory (MemRL), a dual-feedback agent that combines exploration-aware retrieval with intrinsic reward (RetroAgent), a formal theory grounding all such approaches in augmented MDPs (Memento-II), and a production dialectical user-modeling system that evolves its representation of the human across sessions (Honcho/Hermes Agent).

The unifying thesis: **decouple stable reasoning (the frozen LLM) from plastic adaptation (external memory with learned scores)**. The LLM does not change. The memory does. Together they converge.

Each chapter goes deep: full algorithms with pseudocode, mathematical formulations with convergence analysis, complete benchmark tables with ablation studies, and worked numerical examples showing how the systems behave over time. This is intentional. The details matter because runtime self-evolution is where most agent systems fail—not from lack of ambition but from lack of rigor in the memory architecture. The four systems in this part represent the state of the art as of early 2026, and understanding their machinery is prerequisite to building the next generation.

---

## Chapter 3: Utility-Learned Memory — MemRL

**Paper:** Xiang Zhang, Zheyuan Zhang, Zhongxin Guo, Bingsheng Yao, Dakuo Wang, and Jiaxin Zhang. "Self-Evolving Agents with Reflective and Memory-Augmented Abilities." *arXiv preprint arXiv:2601.03192*, January 2026.

**Core contribution:** A runtime reinforcement-learning framework that augments a frozen LLM with an episodic memory buffer whose entries carry *learned utility scores*. The LLM's reasoning is stable (no fine-tuning); the memory is plastic (utility scores evolve via Monte Carlo Q-value updates). The system provably converges to optimal memory retrieval under standard RL assumptions, and empirically outperforms both vanilla LLMs and RAG-augmented baselines across four diverse benchmarks.

---

### 3.1 The Stability-Plasticity Dilemma

Every self-improving agent faces a fundamental tension that the neuroscience literature calls the **stability-plasticity dilemma** (Grossberg, 1987; French, 1999):

1. **Too much plasticity → catastrophic forgetting.** Fine-tuning an LLM on new task experience overwrites previously learned capabilities. Kirkpatrick et al. (2017) documented this in neural networks; in modern LLMs the problem is acute because the parameter space is enormous and task-specific gradients can distort broadly useful representations. A GPT-4-class model fine-tuned on 500 ALFWorld trajectories may improve at household navigation while degrading at code generation, mathematical reasoning, and instruction following—capabilities the base model had before fine-tuning.

2. **Too little plasticity → inability to learn.** Frozen LLMs with static prompts cannot incorporate feedback. If a particular chain-of-thought strategy fails on a class of problems, the LLM will repeat the same failure mode. This is the default state of most deployed agent systems in 2025: they are as good on their 1000th invocation as on their 1st.

3. **RAG occupies a middle ground but has a critical flaw.** Retrieval-Augmented Generation (Lewis et al., 2020; Gao et al., 2023) attaches an external knowledge base to the LLM. The agent can store experiences and retrieve them by semantic similarity. This provides some plasticity—the knowledge base grows over time—without modifying the LLM's weights. However, **similarity is not utility**. Consider an agent that encounters a hard mathematics problem and stores two experiences:

   - Experience A: A plausible-looking but incorrect proof approach (cosine similarity to the new query: 0.92)
   - Experience B: A correct but non-obvious technique (cosine similarity to the new query: 0.87)

   Standard RAG retrieves Experience A. The agent follows a wrong approach. It may even fail *more reliably* than an agent with no memory at all, because the retrieved context steers the LLM toward a known-bad path with high confidence.

   This failure mode is not hypothetical. Zhang et al. (2026) demonstrate it empirically on the HLE benchmark: RAG-augmented GPT-4o achieves lower accuracy (22.7%) than vanilla GPT-4o with chain-of-thought (23.1%) on several problem categories, precisely because high-similarity but low-utility memories contaminate the context.

**MemRL's resolution:** Separate the concerns completely.

| Component | Plasticity | Stability |
|-----------|-----------|-----------|
| LLM (frozen) | None—weights never change | Full—all pre-trained capabilities preserved |
| Memory buffer | Full—entries added, scores updated | Structure stable (triplet schema fixed) |
| Retrieval policy | Adapts via Q-values | Semantic filter provides consistent recall |

The LLM provides *reasoning*. The memory provides *experience*. A learned retrieval policy provides *judgment about which experiences are worth reasoning over*. No component is asked to do all three.

---

### 3.2 The Intent-Experience-Utility (IEU) Triplet

MemRL's memory buffer `M` consists of **IEU triplets**:

```
M = {(z_i, e_i, Q_i)}  for i = 1, ..., |M|
```

Each component serves a distinct function:

#### 3.2.1 Intent (`z_i`)

The **intent** is a dense vector embedding of the task or query that generated this memory entry:

```
z_i = Embed(q_i) ∈ ℝ^d
```

where `q_i` is the natural-language task description and `Embed(·)` is a pre-trained embedding model (MemRL uses `text-embedding-3-large` with `d = 3072` in the reference implementation, though the framework is embedding-model-agnostic).

The intent serves as the *retrieval key*. When a new task with query `q` arrives, its embedding `z = Embed(q)` is compared against all stored intents to identify semantically relevant memories.

**Design choice: embedding the query, not the solution.** MemRL embeds the *task description*, not the *experience*. This is deliberate. Two tasks may have very different solutions but very similar problem statements ("Prove that √2 is irrational" and "Prove that √3 is irrational"). Embedding the query clusters memories by *problem type*, which is the correct retrieval axis for an agent that must generalize.

#### 3.2.2 Experience (`e_i`)

The **experience** is the natural-language record of the agent's solution attempt:

```
e_i = (reasoning_i, actions_i, outcome_i)
```

In practice this is a structured text string that captures:

- **Reasoning trace:** The chain-of-thought, intermediate conclusions, and strategy the agent employed.
- **Action sequence:** The concrete steps taken (tool calls, code execution, sub-agent invocations).
- **Outcome:** Whether the task succeeded or failed, and any error messages or partial results.

The experience is what gets injected into the LLM's context when this memory is retrieved. It functions as a *worked example* or *case study* that the LLM can learn from in-context.

**Storage format.** MemRL stores experiences as plain text with lightweight markdown structure. The reference implementation uses the following template:

```
## Task
{task_description}

## Approach
{reasoning_trace}

## Actions Taken
{action_sequence}

## Result
{outcome_description}

## Lessons
{self_reflection}
```

The `Lessons` field is generated by prompting the LLM to reflect on the outcome after task completion. This reflection step costs one additional LLM call but significantly improves the informational density of the stored experience.

#### 3.2.3 Utility (`Q_i`)

The **utility** is a scalar Q-value that quantifies how helpful this memory has been when retrieved in the past:

```
Q_i ∈ [0, 1]
```

This is the critical innovation. Unlike RAG, where retrieval is purely similarity-based, MemRL's retrieval is *utility-weighted*. A memory with high semantic similarity but consistently poor outcomes (Q → 0) will be deprioritized in favor of a less-similar but more-useful memory (Q → 1).

**Initialization.** New memories are initialized with `Q_i = 0.5` (maximum uncertainty). This ensures they are neither favored nor penalized before any evidence is collected.

**Update mechanism.** After each task, Q-values of all retrieved memories are updated via Monte Carlo reinforcement learning (detailed in §3.4).

#### 3.2.4 Memory Buffer Size and Management

The buffer `M` grows monotonically during the agent's lifetime. MemRL does not delete memories; instead, low-utility memories are naturally deprioritized by the retrieval policy. In the reference implementation:

- **Maximum buffer size:** 10,000 entries (configurable).
- **Entry creation policy:** One entry per completed task, regardless of outcome. Failed tasks produce valuable negative examples.
- **Deduplication:** Before adding a new entry, check if any existing entry has `cos(z_new, z_i) > 0.98`. If so, update the existing entry's experience rather than creating a duplicate.

The buffer can be serialized as a JSON file for persistence across agent sessions. The embedding vectors are stored alongside the text to avoid recomputation:

```json
{
  "memory_buffer": [
    {
      "id": "mem_0001",
      "intent_text": "Prove that the sum of two odd numbers is even",
      "intent_embedding": [0.0234, -0.0891, ...],
      "experience": "## Task\nProve that the sum of two odd...",
      "q_value": 0.73,
      "retrieval_count": 12,
      "last_retrieved": "2026-01-15T08:30:00Z",
      "created": "2026-01-02T14:22:00Z"
    }
  ]
}
```

---

### 3.3 Two-Phase Retrieval — Full Algorithm

MemRL's retrieval operates in two sequential phases. This design is not arbitrary—it directly addresses the computational and statistical limitations of each retrieval signal.

#### 3.3.1 Phase 1: Semantic Filter

Given a new task with query `q`:

```
z = Embed(q)

C_1 = { (z_i, e_i, Q_i) ∈ M : cos(z, z_i) ≥ θ_sim }
```

**Parameters:**
- `θ_sim = 0.7` (default in reference implementation)
- Cosine similarity: `cos(z, z_i) = (z · z_i) / (‖z‖ · ‖z_i‖)`

**Purpose:** Phase 1 is a *recall-oriented* filter. Its job is to ensure that all potentially relevant memories are included in the candidate set. The threshold `θ_sim = 0.7` is deliberately permissive—it admits memories that are topically related even if not exact matches.

**Computational complexity:** For a buffer of size `|M|`, Phase 1 requires `|M|` cosine similarity computations. With `d = 3072` and `|M| = 10,000`, this takes approximately 2ms on modern hardware. For larger buffers, approximate nearest-neighbor indices (FAISS, Annoy) can reduce this to sub-linear time.

**Typical candidate set size:** On the benchmarks tested, Phase 1 typically returns `|C_1| ∈ [5, 50]` candidates. If `|C_1| = 0` (no relevant memories), the agent proceeds without memory augmentation—it falls back to its base LLM capabilities.

#### 3.3.2 Phase 2: Q-Value Selection

From the candidate set `C_1`, select the top-k memories by utility:

```
C_2 = top_k( C_1, key = Q_i, k = K )
```

**Parameters:**
- `K = 3` (default; configurable based on context window budget)

**Purpose:** Phase 2 is a *precision-oriented* selector. From the set of semantically relevant memories, it picks those with the highest demonstrated utility. This is where MemRL departs from RAG: instead of selecting by similarity rank, it selects by learned quality.

#### 3.3.3 Full Retrieval Algorithm (Pseudocode)

```
Algorithm 1: MemRL Two-Phase Retrieval
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Input: query q, memory buffer M, similarity threshold θ_sim,
       retrieval count K, embedding model Embed
Output: retrieved memories R

1:  z ← Embed(q)
2:  C ← ∅                                    // candidate set
3:  for each (z_i, e_i, Q_i) in M do
4:      sim ← cos(z, z_i)
5:      if sim ≥ θ_sim then
6:          C ← C ∪ {(z_i, e_i, Q_i, sim)}
7:      end if
8:  end for
9:  if |C| = 0 then
10:     return ∅                              // no relevant memories
11: end if
12: Sort C by Q_i in descending order        // Phase 2: utility ranking
13: R ← first K elements of C
14: return R
```

#### 3.3.4 Why Two Phases Beat One: A Concrete Example

Consider an agent that has accumulated 200 memories from math competition problems. A new problem arrives: "Find all integer solutions to x³ + y³ = z³ for z ≤ 100."

**Pure similarity retrieval (standard RAG):** The top-3 most similar memories might be:
1. A memory about x³ + y³ = z³ + w³ (Ramanujan's taxi-cab numbers) — `sim = 0.94, Q = 0.2` (misleading; different problem structure)
2. A memory about integer solutions to x² + y² = z² — `sim = 0.91, Q = 0.9` (useful Pythagorean-triple techniques, adaptable)
3. A memory about cubic Diophantine equations with no solutions — `sim = 0.89, Q = 0.1` (mentions Fermat's Last Theorem but with an incorrect proof sketch)

RAG retrieves memories 1, 2, 3 in that order. The agent receives two misleading memories and one useful one.

**MemRL two-phase retrieval:**
- Phase 1 (θ_sim = 0.7) returns all three memories plus 8 others with lower similarity.
- Phase 2 ranks by Q-value:
  1. Memory 2: `Q = 0.9` (proven useful in past number-theory problems)
  2. A memory about modular arithmetic techniques: `sim = 0.76, Q = 0.85`
  3. A memory about Fermat's Last Theorem (correct version): `sim = 0.73, Q = 0.82`

MemRL retrieves memories 2, the modular arithmetic memory, and the correct FLT memory. The agent receives three high-utility memories, including one (the modular arithmetic memory) that RAG would never have surfaced because its similarity score was too low.

**Measured impact:** On HLE (Humanity's Last Exam), this two-phase design produces a 4.3 percentage-point improvement over RAG-style single-phase retrieval (Table 3 in the paper), with the gap widening on problems where misleading similar memories exist in the buffer.

#### 3.3.5 Context Injection

Retrieved memories are injected into the LLM prompt using a structured template:

```
You are solving a new task. Here are relevant past experiences
that may help you. Each experience includes the approach used
and whether it succeeded or failed. Use these as reference but
think critically about whether the same approach applies here.

[EXPERIENCE 1 — Utility: HIGH]
{experience_text_1}

[EXPERIENCE 2 — Utility: HIGH]
{experience_text_2}

[EXPERIENCE 3 — Utility: MODERATE]
{experience_text_3}

---
Now solve the following task:
{current_task_description}
```

The utility label (HIGH / MODERATE / LOW) is derived from the Q-value: HIGH if `Q ≥ 0.7`, MODERATE if `0.4 ≤ Q < 0.7`, LOW if `Q < 0.4`. This label helps the LLM calibrate its confidence in the retrieved experience.

---

### 3.4 Q-Value Update — Monte Carlo Reinforcement Learning

After each task completes, MemRL updates the Q-values of all memories that were retrieved for that task.

#### 3.4.1 Update Rule

```
After task with binary outcome r ∈ {0, 1}:
  For each retrieved memory (z_i, e_i, Q_i):
    Q_i ← (1 - α) · Q_i + α · r
```

**Parameters:**
- `α = 0.1` (learning rate; default in reference implementation)
- `r = 1` if the task succeeded, `r = 0` if it failed

This is a **first-visit Monte Carlo update** (Sutton & Barto, 2018, Chapter 5). Each task constitutes one episode. The retrieved memories are the "states visited" during that episode. The outcome `r` is the return.

#### 3.4.2 Why Monte Carlo, Not TD or Policy Gradient?

Several alternative RL update schemes were considered and rejected:

1. **Temporal Difference (TD) learning** requires a bootstrapped value estimate of the next state. In MemRL's formulation, there is no meaningful "next state"—each task is an independent episode. TD would degenerate to Monte Carlo anyway.

2. **Policy gradient methods** (REINFORCE, PPO) optimize a parameterized policy. MemRL's retrieval policy is non-parametric (it directly uses Q-values for ranking), so policy gradients are inapplicable without introducing unnecessary architecture.

3. **Multi-armed bandit formulations** (UCB, Thompson Sampling) treat each memory as an arm. This is closer to MemRL's setup but ignores the semantic structure of the memory space. MemRL's two-phase design already captures the "bandit-like" tradeoff in Phase 2 while leveraging semantic structure in Phase 1.

Monte Carlo is the natural choice: it is simple, unbiased, and well-suited to episodic settings with binary rewards.

#### 3.4.3 Convergence Behavior

Under standard stochastic approximation assumptions (Robbins-Monro conditions), the Q-value converges to the true expected utility of a memory:

```
Q_i → E[r | memory i is retrieved and used]  as  n_i → ∞
```

where `n_i` is the number of times memory `i` has been retrieved.

**Convergence rate:** With `α = 0.1`, the Q-value reaches within 5% of its true value after approximately 30 retrievals (assuming stationary task distribution). This is fast enough for practical use: an active agent encounters similar tasks frequently.

**Non-stationarity:** In practice, the task distribution is not perfectly stationary—the agent encounters progressively harder problems, or the problem domain shifts. The constant learning rate `α = 0.1` provides exponential recency weighting:

```
Effective weight of observation t steps ago: α(1-α)^t

t = 0:   0.100  (most recent)
t = 5:   0.059
t = 10:  0.035
t = 20:  0.012
t = 50:  0.001
```

This means MemRL naturally adapts to distributional shift: old evidence decays exponentially, and Q-values track the most recent performance of each memory.

#### 3.4.4 Worked Example: Q-Value Trajectory

Consider a memory `m_42` that stores a solution strategy for matrix decomposition problems, initialized at `Q_42 = 0.5`:

```
Retrieval 1:  Task succeeds   → Q = 0.9·0.50 + 0.1·1.0 = 0.55
Retrieval 2:  Task fails      → Q = 0.9·0.55 + 0.1·0.0 = 0.495
Retrieval 3:  Task succeeds   → Q = 0.9·0.495 + 0.1·1.0 = 0.546
Retrieval 4:  Task succeeds   → Q = 0.9·0.546 + 0.1·1.0 = 0.591
Retrieval 5:  Task succeeds   → Q = 0.9·0.591 + 0.1·1.0 = 0.632
Retrieval 6:  Task fails      → Q = 0.9·0.632 + 0.1·0.0 = 0.569
Retrieval 7:  Task succeeds   → Q = 0.9·0.569 + 0.1·1.0 = 0.612
Retrieval 8:  Task succeeds   → Q = 0.9·0.612 + 0.1·1.0 = 0.651
...
Retrieval 30: (after ~24 successes, ~6 failures) → Q ≈ 0.79
```

If the memory's true helpfulness rate is 80% (it leads to success 4 out of 5 times when retrieved for appropriate tasks), the Q-value converges to approximately 0.8.

Now consider a superficially similar but misleading memory `m_43`, which has a 20% success rate:

```
Retrieval 1:  Task fails      → Q = 0.9·0.50 + 0.1·0.0 = 0.450
Retrieval 2:  Task fails      → Q = 0.9·0.45 + 0.1·0.0 = 0.405
Retrieval 3:  Task succeeds   → Q = 0.9·0.405 + 0.1·1.0 = 0.465
Retrieval 4:  Task fails      → Q = 0.9·0.465 + 0.1·0.0 = 0.418
Retrieval 5:  Task fails      → Q = 0.9·0.418 + 0.1·0.0 = 0.377
...
Retrieval 30: → Q ≈ 0.21
```

After 30 retrievals each, `Q_42 ≈ 0.79` and `Q_43 ≈ 0.21`. Phase 2 will consistently prefer `m_42` over `m_43`, even if `m_43` has higher cosine similarity to the query. **The Q-value has learned to discriminate helpful from unhelpful memories.**

#### 3.4.5 Credit Assignment

A subtle issue: when multiple memories are retrieved for a single task, the binary outcome `r` is attributed equally to all of them. This is a form of *uniform credit assignment* and is known to be noisy—a task might succeed because of memory A despite memory B being useless (or even harmful).

MemRL accepts this noise as a pragmatic tradeoff. Alternatives were considered:

- **Attention-based credit:** Use the LLM's attention weights to determine which memory contributed most. Rejected because attention weights are unreliable indicators of causal contribution (Jain & Wallace, 2019).
- **Leave-one-out credit:** Re-run the task K times, each time omitting one memory, to isolate individual contributions. Rejected because it requires K additional LLM calls per task, which is prohibitively expensive.
- **Self-reported credit:** Ask the LLM which memory was most helpful. Rejected because LLMs are poor self-reporters of internal reasoning processes (Turpin et al., 2024).

In practice, uniform credit assignment works because of the **law of large numbers**: over many tasks, a consistently useful memory will co-occur with success more often than a useless one, and the Q-values will separate accordingly. The worked example in §3.4.4 demonstrates this separation.

---

### 3.5 Results and Ablations

#### 3.5.1 Benchmark Suite

MemRL is evaluated on four benchmarks chosen to test different aspects of agent capability:

| Benchmark | Domain | Metric | Tasks | What It Tests |
|-----------|--------|--------|-------|---------------|
| **HLE** (Humanity's Last Exam) | Expert-level STEM | Accuracy (%) | 3,000 | Hardest reasoning; requires graduate-level domain knowledge |
| **BigCodeBench** | Code generation | Pass@1 (%) | 1,140 | Complex multi-library coding with precise API usage |
| **ALFWorld** | Embodied tasks | Success rate (%) | 134 | Multi-step household tasks; requires planning over long horizons |
| **Lifelong Agent Bench** | Mixed sequential | Cumulative accuracy (%) | 400+ | Tests continual adaptation across shifting task distributions |

#### 3.5.2 Main Results

**Table 1: MemRL Performance vs. Baselines (GPT-4o backbone)**

| Method | HLE (%) | BigCodeBench (%) | ALFWorld (%) | Lifelong Agent (%) |
|--------|---------|-------------------|--------------|---------------------|
| GPT-4o (vanilla) | 21.4 | 61.2 | 67.2 | 45.8 |
| GPT-4o + CoT | 23.1 | 63.5 | 71.6 | 48.3 |
| GPT-4o + RAG | 22.7 | 64.8 | 74.5 | 51.2 |
| GPT-4o + Reflexion | 24.6 | 65.1 | 78.4 | 53.7 |
| GPT-4o + MemRL | **28.9** | **69.7** | **85.1** | **61.4** |

**Key observations:**

1. **MemRL outperforms all baselines on every benchmark.** The margins are substantial: +4.3pp over RAG on HLE, +4.9pp on BigCodeBench, +6.7pp on ALFWorld, +7.7pp on Lifelong Agent Bench.

2. **RAG underperforms CoT on HLE.** This confirms the misleading-memory problem described in §3.1: on the hardest reasoning tasks, retrieved memories that are similar but wrong are worse than no memory at all.

3. **The gap widens on sequential benchmarks.** On Lifelong Agent Bench, which presents tasks in sequence and rewards continual improvement, MemRL's advantage over RAG grows to 10.2pp. This is because Q-values accumulate information over the sequence—later tasks benefit from the learned utility of earlier experiences.

4. **MemRL on ALFWorld approaches oracle performance.** The best possible single-agent ALFWorld score with GPT-4o is approximately 88% (limited by the LLM's spatial reasoning failures). MemRL reaches 85.1%, suggesting that almost all recoverable failures are being addressed by memory-augmented learning.

#### 3.5.3 Ablation Studies

**Table 2: Ablation Results (GPT-4o backbone, averaged across benchmarks)**

| Configuration | HLE | BigCodeBench | ALFWorld | Lifelong Agent | Δ avg |
|--------------|-----|-------------|----------|----------------|-------|
| Full MemRL | 28.9 | 69.7 | 85.1 | 61.4 | — |
| Remove Phase 2 (Q-value selection) | 23.2 | 65.0 | 75.2 | 52.1 | −7.4 |
| Remove Phase 1 (semantic filter) | 25.1 | 66.3 | 79.8 | 55.6 | −4.6 |
| Remove both phases (random retrieval) | 20.8 | 60.4 | 65.3 | 44.1 | −13.2 |
| Replace Q-update with popularity count | 24.8 | 66.1 | 77.9 | 54.2 | −5.5 |
| Set α = 0.5 (high learning rate) | 27.3 | 68.2 | 82.5 | 58.9 | −1.9 |
| Set α = 0.01 (low learning rate) | 25.4 | 66.8 | 79.1 | 55.3 | −4.5 |
| K = 1 (retrieve single memory) | 26.1 | 67.4 | 81.3 | 57.8 | −2.8 |
| K = 5 (retrieve five memories) | 28.2 | 69.1 | 84.6 | 60.7 | −0.6 |

**Ablation analysis:**

1. **Removing Phase 2 is catastrophic (−7.4pp average).** Without Q-value selection, the system degenerates to standard RAG. This is the single most important ablation: it confirms that *learned utility, not similarity, drives MemRL's advantage.*

2. **Removing Phase 1 is also damaging (−4.6pp average).** Without semantic filtering, the Q-value selector operates over the entire memory buffer including semantically irrelevant entries. High-Q but irrelevant memories contaminate the context. Phase 1 is necessary to keep Phase 2 focused.

3. **Random retrieval is worse than no retrieval.** The "Remove both phases" configuration (random selection from the buffer) scores below vanilla GPT-4o on BigCodeBench and ALFWorld. Random memories are actively harmful.

4. **Popularity-based ranking underperforms Q-values (−5.5pp average).** Replacing Q-values with simple retrieval counts tests whether utility learning is necessary or whether frequently-retrieved memories are already the best ones. The answer is clearly no: popular memories may be popular because they are general, not because they are helpful.

5. **Learning rate sensitivity is moderate.** The default `α = 0.1` outperforms both `α = 0.5` (too noisy, Q-values oscillate) and `α = 0.01` (too slow, Q-values don't differentiate within the benchmark horizon). The system is robust within the range `α ∈ [0.05, 0.2]`.

6. **K = 3 is near-optimal.** Retrieving fewer memories (`K = 1`) loses useful context; retrieving more (`K = 5`) introduces marginal noise. The system is not very sensitive to K in the range [2, 5].

#### 3.5.4 Cross-Model Generalization

A critical question: does MemRL's advantage transfer across LLM backbones, or is it specific to GPT-4o? The paper reports results with three backbone models:

**Table 3: MemRL Across LLM Backbones (ALFWorld benchmark)**

| Backbone | Vanilla | + CoT | + RAG | + MemRL | Δ (MemRL − RAG) |
|----------|---------|-------|-------|---------|------------------|
| GPT-4o | 67.2 | 71.6 | 74.5 | 85.1 | +10.6 |
| Claude 3.5 Sonnet | 65.8 | 70.3 | 73.1 | 83.7 | +10.6 |
| Llama 3.1 70B | 52.4 | 57.1 | 61.8 | 72.3 | +10.5 |
| GPT-3.5 Turbo | 41.3 | 45.9 | 50.2 | 59.8 | +9.6 |

**Key finding:** The MemRL advantage over RAG is remarkably consistent across models (~10pp). This is predicted by Memento-II's theory (Chapter 5): the convergence guarantee depends on the M-MDP structure, not on the specific LLM. Weaker models benefit slightly less (GPT-3.5 Turbo gains +9.6pp vs. +10.6pp for GPT-4o), likely because their in-context learning from retrieved memories is less effective (weaker satisfaction of Memento-II's condition 5).

**Practical implication:** MemRL can meaningfully elevate a weaker (cheaper) model. GPT-3.5 Turbo + MemRL (59.8%) outperforms vanilla GPT-4o (67.2%)—no, but it approaches GPT-4o + RAG (74.5%) at a fraction of the inference cost. For cost-constrained deployments, MemRL on a smaller model is a viable strategy.

#### 3.5.5 Scaling Behavior

Zhang et al. (2026) also report how MemRL's performance changes as the memory buffer grows:

```
Buffer size:     0      50     100    200    500    1000   5000
HLE accuracy:   21.4   24.1   25.8   27.2   28.5   28.9   29.1
ALFWorld:        67.2   74.3   78.6   81.9   84.2   85.1   85.4
```

Performance improves logarithmically with buffer size. Most of the gain is captured in the first 200–500 entries. Beyond 1000 entries, improvements are marginal. This has a practical implication: **MemRL reaches near-peak performance after a few hundred tasks**, making it viable for deployment in production systems with moderate task volumes.

#### 3.5.7 Learning Curves: Evolution Over Time

The paper includes a critical analysis of how MemRL's performance evolves as the agent accumulates experience, measured at fixed intervals during sequential task execution:

**Table 5: MemRL Performance by Experience Level (ALFWorld, GPT-4o)**

| Tasks Completed | Vanilla (%) | RAG (%) | MemRL (%) | MemRL − RAG |
|----------------|------------|---------|-----------|-------------|
| 0 (cold start) | 67.2 | 67.2 | 67.2 | 0.0 |
| 10 | 67.2 | 68.1 | 69.4 | +1.3 |
| 25 | 67.2 | 69.5 | 73.8 | +4.3 |
| 50 | 67.2 | 71.2 | 78.1 | +6.9 |
| 100 | 67.2 | 73.8 | 82.4 | +8.6 |
| 200 | 67.2 | 74.3 | 84.3 | +10.0 |
| 500 | 67.2 | 74.5 | 85.0 | +10.5 |
| 1000 | 67.2 | 74.5 | 85.1 | +10.6 |

**Observations:**

1. **MemRL starts slow, then accelerates.** At 10 tasks, MemRL has only a 1.3pp advantage over RAG—the Q-values haven't differentiated yet. By 50 tasks, the gap has grown to 6.9pp. By 200 tasks, it's 10pp. The Q-value learning curve is roughly logarithmic.

2. **RAG plateaus early.** RAG's performance stops improving around 100 tasks. Adding more memories to a similarity-only retrieval system provides diminishing returns because the retrieval quality doesn't improve—it just retrieves more (and potentially more misleading) similar memories.

3. **MemRL continues to improve.** Even between 200 and 1000 tasks, MemRL ekes out another 0.8pp. The Q-values continue to refine, finding subtle distinctions between good and bad strategies for edge cases.

4. **Vanilla never improves.** The frozen LLM without any memory is a flat line. This starkly illustrates the stability-plasticity point: without external memory, there is no learning.

The crossover point—where MemRL overtakes RAG—occurs at approximately 25 tasks. This is the "warm-up cost" of MemRL: the first 25 tasks are necessary to build a buffer with differentiated Q-values. Before this point, RAG is marginally better because it at least retrieves relevant examples even without quality filtering.

#### 3.5.8 Limitations

1. **Binary reward signal.** MemRL uses `r ∈ {0, 1}`, which discards the degree of success or failure. A task that produces a 99%-correct answer and one that produces gibberish are treated identically. Extending to continuous rewards is straightforward mathematically but requires a task-specific reward function.

2. **Uniform credit assignment.** As discussed in §3.4.5, all retrieved memories receive the same reward update. This is noisy but converges; however, convergence is slower than it would be with accurate credit assignment.

3. **No memory revision.** MemRL adds new memories but never revises old ones. A memory from an early, low-quality experience persists forever (though its Q-value will decay). Explicit memory editing or consolidation could improve buffer quality over time.

4. **Embedding model dependency.** The quality of Phase 1 filtering depends entirely on the embedding model's ability to capture task-relevant similarity. If the embedding model is weak in a particular domain, Phase 1 may miss relevant memories or admit irrelevant ones.

5. **Cold start.** With an empty buffer, MemRL provides no benefit. The system requires a "warm-up" period of approximately 50–100 tasks before meaningful Q-value separation emerges. Potential mitigations include seeding the buffer with synthetic experiences generated from the LLM's own reasoning (bootstrap sampling), or transferring memories from a related agent that has already accumulated experience on similar tasks.

6. **Single-agent scope.** MemRL is designed for a single agent operating on a single memory buffer. In multi-agent settings, the question of whether to share memories, partition them, or maintain separate buffers per agent remains unexplored within the MemRL framework. Memento-II's M-MDP formalism could be extended to multi-agent M-MDPs, but this is an open theoretical question.

7. **Evaluation bootstrapping.** The initial Q-value of 0.5 is arbitrary. Better initialization (e.g., using the embedding model's confidence in the task-experience match as a prior) could reduce the warm-up period, though the paper does not explore this direction.

---

## Chapter 4: RetroAgent's SimUtil-UCB Memory

**Paper:** Bingqian Zhang, Wei Li, Qihang Xie, Yuze Zhao, Zixiang Wang, Yida Lu, Ce Zheng, and Lei Bai. "RetroAgent: From Solving to Evolving via Retrospective Dual Intrinsic Feedback." *arXiv preprint arXiv:2603.08561*, March 2026.

**Core contribution:** RetroAgent introduces a memory system that extends MemRL's utility-learned retrieval in two critical ways: (1) an exploration bonus via Upper Confidence Bound (UCB) ensures that rarely-used memories are periodically re-evaluated, preventing premature convergence to a suboptimal memory subset; and (2) exponential moving average (EMA) utility updates adapt faster to non-stationary task distributions than MemRL's fixed-rate Monte Carlo.

**Scope note:** RetroAgent has two components: a *training-time* GRPO (Group Relative Policy Optimization) mechanism for improving the base LLM, and a *runtime* memory system for continual adaptation. This chapter covers **only the runtime memory component**, which operates on a frozen LLM and is directly comparable to MemRL. The GRPO training component (which fine-tunes the LLM using intrinsic rewards derived from self-reflection) is covered in Part III, Chapter 8. The division is deliberate: the runtime memory component is what makes RetroAgent a *self-evolving* agent; the GRPO component makes it a *self-improving* one. These are related but distinct capabilities, and the runtime component alone provides substantial benefits.

---

### 4.1 Memory Buffer Structure

RetroAgent's memory buffer stores entries with richer metadata than MemRL's IEU triplets:

```
M = {m_1, m_2, ..., m_|M|}

Each entry:
m_i = (x_i, l_i, τ_i, u_i, n_i, d_i)
```

| Field | Type | Description |
|-------|------|-------------|
| `x_i` | `ℝ^d` | Task instruction embedding. Analogous to MemRL's intent `z_i`. Computed via `text-embedding-3-large`. |
| `l_i` | `string` | Natural language **lesson** extracted from the experience. Unlike MemRL's full experience record, RetroAgent distills the experience into a concise, actionable lesson. |
| `τ_i` | `string` | The original task description (stored for deduplication and debugging). |
| `u_i` | `float ∈ [0, 1]` | Utility score. Analogous to MemRL's Q-value but updated via EMA (§4.3). |
| `n_i` | `int` | Retrieval count. Tracks how many times this memory has been retrieved. Used in the UCB exploration bonus. |
| `d_i` | `{0, 1}` | Outcome of the most recent task where this memory was retrieved. Binary success/failure indicator. |

**Key difference from MemRL: lessons vs. experiences.** MemRL stores the full reasoning trace, action sequence, and outcome. RetroAgent stores a distilled *lesson*—typically 2–5 sentences summarizing what the agent should do or avoid in similar situations. This design choice trades information richness for context efficiency: a lesson consumes fewer tokens in the LLM's context window, allowing more memories to be retrieved without exceeding context limits.

**Lesson extraction prompt:**

```
Given the following task and your solution attempt:

Task: {task_description}
Solution: {solution_trace}
Outcome: {"Success" | "Failure"}

Extract a concise lesson (2-5 sentences) that would help you
or another agent solve similar tasks in the future. Focus on:
- What strategy worked or didn't work
- What pitfalls to avoid
- What key insight was necessary for success

Lesson:
```

**Example lessons:**

- *Success case:* "When navigating ALFWorld kitchens, always check cabinet 1 and countertop 2 first—they contain target objects in >70% of tasks. Use 'examine' before 'take' to verify object identity."

- *Failure case:* "Do NOT attempt recursive approaches for WebShop product search. The API returns paginated results; use iterative page traversal with explicit page number tracking instead."

#### 4.1.1 Buffer Management

RetroAgent implements an **active buffer management policy** that MemRL lacks:

- **Maximum buffer size:** 5,000 entries.
- **Eviction policy:** When the buffer is full, the entry with the lowest `u_i · log(n_i + 1)` score is evicted. This favors keeping memories that are both high-utility and have been retrieved enough times to have reliable utility estimates.
- **Lesson update:** When a memory is retrieved and the task outcome differs from the stored outcome `d_i`, the lesson is regenerated. This allows lessons to evolve: a lesson initially based on a failure case may be overwritten with a success-case lesson if the agent later succeeds on a similar task.

---

### 4.2 SimUtil-UCB Retrieval — Full Mathematical Formulation

RetroAgent's retrieval scoring function combines three signals into a single score:

#### 4.2.1 The SimUtil-UCB Score

```
S(m_i | x, M) = α · s_rel(x, x_i) + (1 - α) · u_util_UCB(i)
```

where:

- `S(m_i | x, M)` is the total score of memory `m_i` given the current task embedding `x` and the memory buffer `M`.
- `α ∈ [0, 1]` is the **relevance-utility tradeoff** parameter.
- `s_rel(x, x_i)` is the **relevance score** (semantic similarity).
- `u_util_UCB(i)` is the **utility score with UCB exploration bonus**.

#### 4.2.2 Relevance Score

```
s_rel(x, x_i) = cos(x, x_i) = (x · x_i) / (‖x‖ · ‖x_i‖)
```

Only memories with `s_rel ≥ 0.4` are considered. This threshold is notably lower than MemRL's `θ_sim = 0.7`, reflecting a design philosophy that the utility component should have more influence over the final ranking.

**Pre-filter step:**

```
C_pre = { m_i ∈ M : s_rel(x, x_i) ≥ 0.4 }
```

#### 4.2.3 Utility Score with UCB Exploration Bonus

```
u_util_UCB(i) = u_i + κ · √(ln(N) / n_i)
```

where:

- `u_i` is the current utility estimate for memory `m_i` (updated via EMA; see §4.3).
- `κ = 1.0` is the **exploration constant** (controls the exploration-exploitation tradeoff).
- `N = Σ_j n_j` is the **total number of retrievals** across all memories in the buffer.
- `n_i` is the **retrieval count** of memory `m_i`.

The term `κ · √(ln(N) / n_i)` is the classic **UCB1 exploration bonus** (Auer et al., 2002). It has several important properties:

1. **Diminishes with retrieval count.** As `n_i → ∞`, the bonus → 0, and the score converges to the true utility `u_i`. Well-tested memories are ranked purely by observed quality.

2. **Grows with total retrievals.** As `N` increases (the agent gains more experience overall), the bonus for under-tested memories grows logarithmically. This ensures that even in a mature buffer, rarely-retrieved memories periodically get re-evaluated.

3. **Balances exploration and exploitation.** With `κ = 1.0`:
   - A memory with `u_i = 0.3` and `n_i = 2` (poorly rated, rarely used) gets a bonus of `1.0 · √(ln(1000)/2) ≈ 1.86` → total utility ≈ 2.16.
   - A memory with `u_i = 0.8` and `n_i = 100` (well rated, well used) gets a bonus of `1.0 · √(ln(1000)/100) ≈ 0.26` → total utility ≈ 1.06.

   The rarely-used memory gets a chance to be retrieved and re-evaluated, even though its current utility estimate is much lower. If it turns out to be genuinely unhelpful, its utility will remain low after re-evaluation, and the exploration bonus will diminish as `n_i` increases.

#### 4.2.4 Full SimUtil-UCB Algorithm (Pseudocode)

```
Algorithm 2: RetroAgent SimUtil-UCB Retrieval
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Input: task embedding x, memory buffer M, parameters α, κ, K,
       similarity threshold θ_rel = 0.4
Output: retrieved memories R

1:  N ← Σ_{m_i ∈ M} n_i                     // total retrieval count
2:  C ← ∅                                     // candidate set
3:  for each m_i = (x_i, l_i, τ_i, u_i, n_i, d_i) in M do
4:      sim ← cos(x, x_i)
5:      if sim ≥ θ_rel then
6:          if n_i = 0 then
7:              ucb ← +∞                      // force exploration of unseen memories
8:          else
9:              ucb ← u_i + κ · √(ln(N) / n_i)
10:         end if
11:         score ← α · sim + (1 - α) · ucb
12:         C ← C ∪ {(m_i, score)}
13:     end if
14: end for
15: Sort C by score in descending order
16: R ← first K elements of C
17: for each m_i in R do
18:     n_i ← n_i + 1                         // update retrieval count
19: end for
20: return R
```

**Line 6–7:** Memories that have never been retrieved (`n_i = 0`) receive an infinite score, guaranteeing they are retrieved at least once. This is the standard UCB1 initialization: every arm must be pulled at least once before the algorithm can make informed decisions.

#### 4.2.5 Parameter Sensitivity

The paper reports sensitivity analysis for the two key parameters:

**Tradeoff parameter α:**

| α | ALFWorld Success (%) | WebShop Score (%) | Interpretation |
|---|---------------------|-------------------|---------------|
| 0.0 | 72.4 | 45.1 | Pure utility (ignores relevance entirely) |
| 0.3 | 79.8 | 52.6 | Utility-heavy |
| 0.5 | 82.1 | 54.3 | Balanced (default) |
| 0.7 | 80.5 | 53.8 | Relevance-heavy |
| 1.0 | 75.2 | 49.7 | Pure similarity (standard RAG) |

The optimal `α` is near 0.5, confirming that **both relevance and utility are necessary**. Pure utility (`α = 0`) fails because it retrieves useful-in-general but irrelevant-to-this-task memories. Pure similarity (`α = 1`) fails for the same reason RAG fails: similarity ≠ utility.

**Exploration constant κ:**

| κ | ALFWorld Success (%) | WebShop Score (%) |
|---|---------------------|-------------------|
| 0.0 | 78.9 | 51.8 |
| 0.5 | 80.7 | 53.1 |
| 1.0 | 82.1 | 54.3 |
| 2.0 | 81.5 | 53.9 |
| 5.0 | 77.3 | 50.2 |

`κ = 1.0` is optimal. Too low (`κ = 0`) means no exploration—the system converges prematurely to a fixed set of "favorite" memories and never re-evaluates. Too high (`κ = 5`) means excessive exploration—the system wastes retrievals on clearly unhelpful memories.

#### 4.2.6 Comparison: MemRL vs. SimUtil-UCB

| Aspect | MemRL | SimUtil-UCB |
|--------|-------|-------------|
| Retrieval phases | Two sequential (filter → rank) | One combined (weighted score) |
| Relevance signal | Cosine similarity (binary threshold) | Cosine similarity (continuous, weighted) |
| Utility signal | Raw Q-value | EMA utility + UCB exploration bonus |
| Exploration | None (exploitation only) | UCB1 exploration bonus |
| Similarity threshold | 0.7 (strict) | 0.4 (permissive) |
| Context cost per memory | High (full experience) | Low (distilled lesson) |
| Theoretical grounding | Monte Carlo Q-learning | Multi-armed bandit (UCB1) |

The key architectural distinction is **exploration**. MemRL's Q-values converge monotonically—once a memory's Q-value drops low enough, it is effectively dead (never retrieved, never re-evaluated, never recovered). SimUtil-UCB's exploration bonus prevents this: even a low-utility memory will eventually accumulate enough exploration bonus to be retrieved again, giving it a chance at rehabilitation if the task distribution has shifted.

---

### 4.3 Utility Update (Exponential Moving Average)

After each task, RetroAgent updates the utility scores of retrieved memories using an exponential moving average (EMA):

```
u_i ← (1 - β_util) · u_i + β_util · û_t
```

where:

- `β_util = 0.2` is the EMA smoothing factor (default).
- `û_t` is the outcome signal for the current task.

#### 4.3.1 Outcome Signal

Unlike MemRL's binary `r ∈ {0, 1}`, RetroAgent uses a **graded outcome signal**:

```
û_t = (1 - λ) · d_t + λ · s_self(t)
```

where:

- `d_t ∈ {0, 1}` is the binary task outcome (success/failure).
- `s_self(t) ∈ [0, 1]` is a **self-assessed quality score** generated by prompting the LLM to rate its own solution on a scale of 0 to 1.
- `λ = 0.3` balances the objective outcome with the subjective self-assessment.

The self-assessment component captures partial successes that binary feedback misses. For example, a WebShop task might fail (wrong product purchased) but the agent's search strategy was sound and the lesson from that memory was genuinely helpful for narrowing the product space.

**Self-assessment prompt:**

```
You just completed a task. Rate the quality of your solution
on a scale of 0 to 1, where:
  0 = completely wrong, no useful progress
  0.5 = partial progress, some useful steps but ultimately failed
  1 = perfect solution, achieved the goal completely

Task: {task}
Your solution: {solution}
Outcome: {"Success" | "Failure"}

Quality score (0-1):
```

#### 4.3.2 EMA vs. Monte Carlo: Convergence Properties

| Property | MemRL (Monte Carlo, α=0.1) | RetroAgent (EMA, β_util=0.2) |
|----------|---------------------------|------------------------------|
| Update rate | Constant `α` | Constant `β_util` (faster) |
| Recent-experience weighting | Effective half-life ≈ 7 retrievals | Effective half-life ≈ 3.5 retrievals |
| Adaptation to distribution shift | Moderate | Fast |
| Stability | High (slow convergence) | Moderate (more oscillation) |
| Bias | Unbiased (Monte Carlo property) | Biased toward recent outcomes |

The higher `β_util = 0.2` (vs. MemRL's `α = 0.1`) reflects RetroAgent's design philosophy of **fast adaptation over stable convergence**. In deployment scenarios where the task distribution shifts frequently (e.g., a coding agent that switches between Python and Rust projects), faster adaptation is more valuable than stability.

#### 4.3.3 Worked Example: EMA Utility Trajectory

Memory `m_7` stores a lesson about WebShop navigation, initialized at `u_7 = 0.5`:

```
Retrieval 1:  û = 0.8 (success + high self-score)
  u = 0.8·0.50 + 0.2·0.8 = 0.560

Retrieval 2:  û = 0.0 (failure + low self-score)
  u = 0.8·0.56 + 0.2·0.0 = 0.448

Retrieval 3:  û = 0.9
  u = 0.8·0.448 + 0.2·0.9 = 0.538

Retrieval 4:  û = 0.7
  u = 0.8·0.538 + 0.2·0.7 = 0.571

Retrieval 5:  û = 0.85
  u = 0.8·0.571 + 0.2·0.85 = 0.627

Retrieval 6:  û = 0.3 (partial failure)
  u = 0.8·0.627 + 0.2·0.3 = 0.562

Retrieval 7:  û = 0.9
  u = 0.8·0.562 + 0.2·0.9 = 0.630
```

The utility oscillates more than MemRL's Q-values (which is expected with `β_util > α`) but tracks the underlying success rate with a 3–4 retrieval lag.

---

### 4.4 Why UCB Matters for Evolution

The UCB exploration bonus is not merely a theoretical nicety—it addresses a critical failure mode of pure exploitation-based memory systems.

#### 4.4.1 The Memory Ossification Problem

Consider an agent that has been running for 1,000 tasks. Its memory buffer contains 800 entries. Without exploration:

1. The top-20 highest-utility memories are retrieved repeatedly (they are "safe bets").
2. The remaining 780 memories are never retrieved again.
3. New memories start with moderate utility but cannot compete with the entrenched top-20.
4. The agent's behavior ossifies: it applies the same 20 strategies to every problem, even when better strategies exist in the untested 780.

This is the multi-armed bandit's **exploration-exploitation dilemma** applied to memory retrieval. Pure exploitation (MemRL's approach) converges quickly but may converge to a **suboptimal** memory policy if early Q-value estimates were unlucky or if the task distribution has shifted since the initial estimates were formed.

#### 4.4.2 UCB as Anti-Ossification

The UCB exploration bonus ensures that every memory is periodically re-evaluated:

```
For a memory with n_i = 50, N = 10000:
  Bonus = 1.0 · √(ln(10000) / 50) = 1.0 · √(9.21 / 50) = 0.429

For a memory with n_i = 2, N = 10000:
  Bonus = 1.0 · √(ln(10000) / 2) = 1.0 · √(9.21 / 2) = 2.146
```

The rarely-used memory receives a bonus 5× larger than the well-tested one. This bonus is large enough to overcome a significant utility gap, forcing the system to re-evaluate the neglected memory.

**Over time, the buffer self-organizes:**

1. **Phase 1 (Exploration, tasks 1–100):** Most memories have low `n_i`, so exploration bonuses dominate. Retrieval is nearly random within the semantically relevant set. Utility estimates are noisy.

2. **Phase 2 (Calibration, tasks 100–500):** Utility estimates stabilize for frequently-retrieved memories. A core set of high-utility memories emerges. Rarely-retrieved memories retain high exploration bonuses.

3. **Phase 3 (Mature, tasks 500+):** The system primarily exploits high-utility memories but periodically explores neglected ones. If a neglected memory turns out to be useful (perhaps because the task distribution has shifted), its utility increases and it joins the core set. If not, its low utility is confirmed and the exploration bonus diminishes.

#### 4.4.3 Empirical Evidence

The paper provides direct evidence of UCB's impact through an ablation on the exploration constant `κ`:

```
κ = 0.0 (no exploration):
  ALFWorld at task 100:  75.2%
  ALFWorld at task 500:  78.9%
  ALFWorld at task 1000: 78.9%  ← plateaued

κ = 1.0 (default UCB):
  ALFWorld at task 100:  73.1%  ← slightly worse early (exploration cost)
  ALFWorld at task 500:  80.4%
  ALFWorld at task 1000: 82.1%  ← still improving
```

Without exploration, performance plateaus after ~500 tasks. With UCB, the agent continues to improve because it periodically discovers valuable memories that pure exploitation had overlooked.

---

### 4.5 Ablation Results

#### 4.5.1 Full Component Ablation

**Table 3: RetroAgent Runtime Memory Ablation (frozen LLM, no GRPO training)**

| Configuration | ALFWorld (%) | WebShop (%) | HotPotQA (%) | SciWorld (%) |
|--------------|-------------|-------------|-------------|-------------|
| Full RetroAgent (runtime only) | 82.1 | 54.3 | 49.8 | 41.2 |
| − Memory buffer | 69.7 (−12.4) | 45.6 (−8.7) | 42.1 (−7.7) | 35.4 (−5.8) |
| − UCB exploration | 78.9 (−3.2) | 51.8 (−2.5) | 47.2 (−2.6) | 39.1 (−2.1) |
| − EMA (use MC instead) | 80.3 (−1.8) | 52.9 (−1.4) | 48.6 (−1.2) | 40.1 (−1.1) |
| − Self-assessment (use binary) | 80.8 (−1.3) | 53.1 (−1.2) | 48.9 (−0.9) | 40.5 (−0.7) |
| − Lesson distillation (use full trace) | 79.5 (−2.6) | 51.4 (−2.9) | 47.8 (−2.0) | 39.7 (−1.5) |

**Key findings:**

1. **Removing the memory buffer entirely is the most damaging ablation.** The drops (−12.4% on ALFWorld, −8.7% on WebShop) confirm that runtime memory is the primary driver of RetroAgent's performance, not the base LLM capability or prompt engineering.

2. **UCB exploration contributes consistently (−2.1% to −3.2%).** The benefit is larger on longer-horizon benchmarks (ALFWorld, SciWorld) where the task distribution is more varied and the risk of memory ossification is higher.

3. **EMA outperforms Monte Carlo updates (−1.1% to −1.8% when reverted).** The difference is modest but consistent, suggesting that faster adaptation is generally beneficial.

4. **Self-assessment provides marginal benefit (−0.7% to −1.3%).** The graded outcome signal helps most on tasks with meaningful partial success (WebShop, HotPotQA) and least on binary-outcome tasks (SciWorld).

5. **Lesson distillation is important (−1.5% to −2.9%).** Storing full traces instead of distilled lessons wastes context tokens on redundant detail, leaving less room for additional memories and the current task description. The effect is largest on WebShop, which has long solution traces.

#### 4.5.2 Memory Evolution Visualization

The paper includes a visualization of how the memory buffer self-organizes over time on ALFWorld. At three checkpoints:

**After 50 tasks (Early):**
```
Buffer size: 48 entries
High utility (u > 0.7): 8 entries (17%)
Medium utility (0.3 ≤ u ≤ 0.7): 31 entries (65%)
Low utility (u < 0.3): 9 entries (19%)
Average retrieval count: 2.1
Max retrieval count: 7
```

**After 200 tasks (Calibrated):**
```
Buffer size: 187 entries
High utility (u > 0.7): 34 entries (18%)
Medium utility (0.3 ≤ u ≤ 0.7): 98 entries (52%)
Low utility (u < 0.3): 55 entries (29%)
Average retrieval count: 5.3
Max retrieval count: 24
```

**After 1000 tasks (Mature):**
```
Buffer size: 843 entries
High utility (u > 0.7): 89 entries (11%)
Medium utility (0.3 ≤ u ≤ 0.7): 412 entries (49%)
Low utility (u < 0.3): 342 entries (41%)
Average retrieval count: 8.7
Max retrieval count: 67
```

The distribution shifts toward bimodal: a small core of high-utility memories and a growing tail of low-utility ones. The UCB exploration bonus prevents the low-utility tail from being completely ignored, occasionally re-testing entries that may have been misjudged early.

**Critically, the high-utility cluster is not static.** Between task 200 and task 1000, 12 entries that were in the high-utility cluster dropped below 0.7 (their strategies stopped working on newer tasks), and 18 new entries rose into the cluster (discovered through UCB exploration). This buffer churn is the signature of healthy exploration-exploitation balance.

#### 4.5.3 Comparison with MemRL on Shared Benchmarks

Since both MemRL and RetroAgent report results on ALFWorld, we can directly compare (using GPT-4o backbone, runtime-only for RetroAgent):

| System | ALFWorld (%) | Method |
|--------|-------------|--------|
| MemRL | 85.1 | Two-phase + MC Q-values |
| RetroAgent (runtime only) | 82.1 | SimUtil-UCB + EMA |
| RetroAgent (full, with GRPO) | 87.3 | SimUtil-UCB + EMA + trained LLM |

RetroAgent's runtime-only component scores 3pp below MemRL on ALFWorld. This is not necessarily a reflection of architectural inferiority—the two systems make different tradeoffs:

- MemRL stores full experience traces (more information per memory, higher context cost).
- RetroAgent stores distilled lessons (less information per memory, lower context cost, room for more memories).
- MemRL uses a stricter similarity threshold (0.7 vs. 0.4), which may be better suited to ALFWorld's relatively narrow task distribution.
- RetroAgent's UCB exploration has an exploration cost: some retrievals are spent on low-utility memories that don't help the current task.

When GRPO training is included (which is outside the scope of this chapter but worth noting), RetroAgent surpasses MemRL, suggesting that the combination of runtime memory and training-time policy improvement is strictly more powerful than either alone.

#### 4.5.4 Scaling with Buffer Size

```
Buffer size:    0     25     50    100    200    500   1000
ALFWorld:      69.7  74.2   76.8  79.1   80.9   81.8  82.1
WebShop:       45.6  48.1   49.8  51.5   53.0   53.9  54.3
```

Like MemRL, RetroAgent shows logarithmic improvement with buffer size. The critical mass is approximately 100–200 entries, after which returns diminish. This is slightly fewer than MemRL's 200–500, likely because distilled lessons have higher information density per entry.

---

## Chapter 5: Memento-II — Formal Theory of Memory-Based Learning

**Paper:** Yifan Guo, Yifan Zhu, Derrick Goh Xin Deik, Zifei Shan, Zhili Feng, and Kai Zhang. "Memento-II: Learning by Stateful Reflective Memory." *arXiv preprint arXiv:2512.22716*, December 2025.

**Core contribution:** While MemRL and RetroAgent are engineering systems with empirical validation, Memento-II provides the **formal theoretical foundation** for runtime self-evolution via memory. It introduces the Memory-Augmented MDP (M-MDP) framework, which formalizes the agent's interaction with an external memory buffer as a Markov Decision Process over an augmented state-memory space. Within this framework, the paper proves that memory-based learning converges to optimal policy execution, providing the first rigorous justification for why systems like MemRL and RetroAgent work.

---

### 5.1 Memory-Augmented MDP (M-MDP)

#### 5.1.1 Standard MDP Recap

A standard MDP is a tuple `(S, A, T, R, γ)`:

- `S` — state space
- `A` — action space
- `T: S × A → Δ(S)` — transition function (distribution over next states)
- `R: S × A → ℝ` — reward function
- `γ ∈ [0, 1)` — discount factor

An agent with policy `π: S → Δ(A)` interacts with the MDP and seeks to maximize the expected discounted return:

```
V^π(s) = E_π [ Σ_{t=0}^∞ γ^t · R(s_t, a_t) | s_0 = s ]
```

For an LLM-based agent, the "state" includes the current task, the conversation history, and any environment observations. The "action" is the LLM's output (a tool call, a response, a reasoning step). The reward is the task outcome.

#### 5.1.2 The M-MDP Extension

Memento-II extends the standard MDP by introducing a **memory state** `μ` that persists across episodes:

```
M-MDP = (S, A, T, R, γ, Μ, ρ, ω)
```

The new components are:

- `Μ` — **memory space.** The set of all possible memory buffer configurations. A memory configuration `μ ∈ Μ` specifies the contents and metadata of the memory buffer at a given point in time.

- `ρ: Μ × S × A × ℝ → Μ` — **write function.** After each transition `(s, a, r, s')`, the write function updates the memory:
  ```
  μ' = ρ(μ, s, a, r)
  ```
  In MemRL, `ρ` corresponds to creating a new IEU triplet and updating Q-values. In RetroAgent, `ρ` corresponds to lesson extraction and EMA utility update.

- `ω: Μ × S → 2^Μ` — **read function.** Given the current memory and state, the read function selects which memory entries to include in the agent's context:
  ```
  μ_context = ω(μ, s)
  ```
  In MemRL, `ω` is the two-phase retrieval (Phase 1: semantic filter, Phase 2: Q-value selection). In RetroAgent, `ω` is SimUtil-UCB retrieval.

#### 5.1.3 Augmented State Space

The key insight is that the agent's effective state is not just `s` but the pair `(s, μ)`:

```
S̃ = S × Μ
```

The agent's policy now operates on the augmented state:

```
π̃: S̃ → Δ(A)
i.e., π̃(s, μ) gives the action distribution
```

The augmented MDP has transitions:

```
(s, μ) --a--> (s', μ')
where s' ~ T(s, a)  and  μ' = ρ(μ, s, a, R(s, a))
```

This formalization captures a crucial fact: **the agent with memory is a different agent than the agent without memory.** Two instances of the same LLM, facing the same task `s`, will produce different outputs if they have different memory states `μ`. The memory is not an add-on; it is part of the state.

#### 5.1.4 Properties of M-MDP

**Proposition 1 (M-MDP is a valid MDP).** The augmented tuple `(S̃, A, T̃, R, γ)` with `S̃ = S × Μ` and `T̃((s, μ), a) = (T(s, a), ρ(μ, s, a, R(s, a)))` satisfies the Markov property: the distribution over next augmented states depends only on the current augmented state and action, not on the history.

*Proof sketch:* The memory write function `ρ` is deterministic given `(μ, s, a, r)`. The transition `T` is Markovian by assumption. The composition of a Markovian transition with a deterministic memory update preserves the Markov property. □

**Proposition 2 (Monotone memory expansion).** If the write function `ρ` only adds entries (never deletes), then `|μ'| ≥ |μ|` for all transitions. The memory space is monotonically non-decreasing.

This is a technical condition that MemRL satisfies (it never deletes entries) but RetroAgent does not (it evicts low-value entries). Proposition 2's convergence results (§5.3) apply strictly only to non-deleting memory systems, though practical violations (like RetroAgent's eviction) are typically benign.

---

### 5.2 Read-Write Learning Paradigm

Memento-II's central theoretical contribution is showing that the read and write operations over memory correspond exactly to the two components of classical policy iteration in reinforcement learning.

#### 5.2.1 Writing as Policy Evaluation

When the agent writes to memory after a task, it records the outcome of its current policy:

```
Writing: (s, a, r) → μ' = ρ(μ, s, a, r)
```

This is analogous to **policy evaluation** in standard RL: observing the outcomes of the current policy to estimate its value. In MemRL, the Q-value update `Q_i ← (1 - α) · Q_i + α · r` is literally a Monte Carlo policy evaluation step. In RetroAgent, the EMA utility update serves the same function.

The memory buffer `μ` accumulates a *statistical portrait* of the current policy's performance: which strategies succeed on which types of tasks. The write function `ρ` is the mechanism by which this portrait is constructed and updated.

#### 5.2.2 Reading as Policy Improvement

When the agent reads from memory before a task, it selects experiences that will improve its behavior:

```
Reading: μ_context = ω(μ, s) → improved action distribution
```

This is analogous to **policy improvement** in standard RL: using value estimates to select better actions. By retrieving high-utility memories, the agent's effective policy changes—it takes different actions than it would without memory.

The read function `ω` acts as a **policy improvement operator**: it transforms the base LLM's policy `π_base` into an augmented policy `π̃` that incorporates learned experience:

```
π̃(a | s) = π_base(a | s, ω(μ, s))
```

The LLM conditions its output on both the current state `s` and the retrieved memory context `ω(μ, s)`. Because the memory context changes as the buffer evolves, the effective policy improves over time without any weight updates.

#### 5.2.3 The Read-Write Cycle as Policy Iteration

Putting the two together:

```
Cycle k:
  1. READ: retrieve memories → π̃_k = π_base(· | s, ω(μ_k, s))     [policy improvement]
  2. ACT: execute π̃_k → observe outcome r
  3. WRITE: update memory → μ_{k+1} = ρ(μ_k, s, a, r)             [policy evaluation]
```

This is exactly the structure of **generalized policy iteration** (Sutton & Barto, 2018, Chapter 4). Each read-write cycle performs one step of policy evaluation (via writing) and one step of policy improvement (via reading). The standard convergence theorems for policy iteration then apply to the M-MDP.

#### 5.2.4 Unification of Existing Approaches

Memento-II shows that several previously distinct approaches to agent learning are special cases of the M-MDP framework:

| Approach | Memory space `Μ` | Write function `ρ` | Read function `ω` |
|----------|-------------------|--------------------|--------------------|
| **MemRL** | IEU triplets with Q-values | Add triplet, MC Q-update | Two-phase retrieval |
| **RAG** | Document chunks with embeddings | Add document (no quality signal) | Top-k cosine similarity |
| **Reflexion** (Shinn et al., 2023) | Natural language self-reflections | Append reflection string | Last-k reflections |
| **Voyager** (Wang et al., 2023) | Skill library (code functions) | Add verified skill | Retrieve by description |
| **ExpeL** (Zhao et al., 2024) | Extracted insights | Add insight, deduplicate | Top-k by relevance |
| **RetroAgent** | Lessons with utility + UCB | Add lesson, EMA update | SimUtil-UCB score |

All of these systems implement some form of `ρ` (write/store) and `ω` (read/retrieve). They differ in what they store, how they update, and how they retrieve. Memento-II's contribution is showing that **all of them are instances of the same formal object** (M-MDP), and that the convergence properties depend on specific structural requirements of `ρ` and `ω`.

---

### 5.3 Convergence Guarantee

#### 5.3.1 Theorem Statement

**Theorem 1 (Convergence of M-MDP Policy Iteration).** Consider an M-MDP `(S, A, T, R, γ, Μ, ρ, ω)` satisfying:

1. **Finite state and action spaces.** `|S|` and `|A|` are finite.
2. **Ergodicity.** Every state is reachable from every other state under the optimal policy.
3. **Monotone memory expansion.** The write function `ρ` only adds entries.
4. **Coverage.** For every state `s ∈ S`, there exists a memory entry `m` in the limit buffer `μ_∞ = lim_{k→∞} μ_k` such that `ω(μ_∞, s)` retrieves a relevant experience for `s`.
5. **Faithful policy improvement.** The LLM's in-context learning, given the retrieved memory `ω(μ, s)`, is at least as good as the action it would take without memory: `V^{π̃}(s) ≥ V^{π_base}(s)` for all `s`.

Then the policy induced by the M-MDP converges to the optimal policy:

```
π̃_k → π* as k → ∞
```

in the sense that the value function converges:

```
V^{π̃_k}(s) → V^*(s) for all s ∈ S
```

#### 5.3.2 Proof Sketch

The proof proceeds in three steps:

**Step 1: Memory expansion ensures coverage.** By condition 3, the memory buffer grows monotonically. By condition 4, in the limit, every state has relevant memory coverage. This is analogous to the exploration condition in standard RL: every state-action pair must be visited infinitely often.

**Step 2: Write updates converge.** The write function `ρ` performs policy evaluation. Under standard stochastic approximation conditions (conditions 1 and 2 ensure sufficient exploration), the utility estimates stored in memory converge to the true utilities of the current policy. For MemRL, this is the convergence of Q-values (§3.4.3). For RetroAgent, this is the convergence of EMA utilities.

**Step 3: Read-write cycle is a contraction.** The read function `ω`, by retrieving high-utility memories, implements policy improvement (condition 5). The composition of policy evaluation (step 2) and policy improvement (step 3) is a contraction mapping on the value function space with modulus `γ < 1` (by the standard policy iteration convergence theorem; Bertsekas & Tsitsiklis, 1996). Therefore, the value function converges to the fixed point `V^*`.

□

#### 5.3.3 Interpretation

Theorem 1 tells us: **If your memory grows to cover the task space, and your LLM can learn from retrieved examples in-context, then your agent will converge to optimal behavior.** This is a powerful result because it separates the question of convergence (which is guaranteed by the M-MDP structure) from the question of convergence rate (which depends on the specific write and read functions).

The practical implications are:

1. **MemRL's Q-value learning is not ad hoc.** It is an instance of policy evaluation within an M-MDP, and its convergence is guaranteed by Theorem 1 (assuming the LLM's in-context learning satisfies condition 5).

2. **RAG can be provably suboptimal.** Standard RAG satisfies conditions 1–4 but may violate condition 5: retrieving high-similarity but low-utility memories can make the policy *worse* than the base policy. MemRL and RetroAgent fix this by adding utility signals to the read function.

3. **The frozen-LLM assumption is theoretically sound.** Convergence does not require weight updates. The LLM is a fixed function; the memory is the learning substrate. This validates the "decouple stability from plasticity" principle (§3.1).

#### 5.3.4 Detailed Proof of the Contraction Property

We expand Step 3 of the proof sketch. Define the Bellman operator on the augmented state space:

```
(T̃^π V)(s, μ) = E_π [ R(s, a) + γ · V(s', μ') ]
```

where `s' ~ T(s, a)` and `μ' = ρ(μ, s, a, R(s, a))`.

**Claim:** `T̃^π` is a `γ`-contraction in the sup-norm.

*Proof:*
```
|T̃^π V₁(s,μ) - T̃^π V₂(s,μ)|
= |E_π[R + γV₁(s',μ')] - E_π[R + γV₂(s',μ')]|
= γ · |E_π[V₁(s',μ') - V₂(s',μ')]|
≤ γ · E_π[|V₁(s',μ') - V₂(s',μ')|]
≤ γ · ‖V₁ - V₂‖_∞
```

Since `γ < 1`, `T̃^π` is a contraction. By the Banach fixed-point theorem, iterating `T̃^π` converges to the unique fixed point `V^π`, the true value function of policy `π` on the augmented state-memory space.

Now consider the policy improvement operator `I` that, given a value function `V`, selects the policy `π'` that is greedy with respect to `V`:

```
I(V)(s, μ) = argmax_a [ R(s, a) + γ · E[V(s', ρ(μ, s, a, R(s,a)))] ]
```

In the M-MDP context, `I` operates through the read function `ω`: the policy `π'` is the LLM's output *given the retrieved memories* `ω(μ, s)` selected based on the current utility estimates. Condition 5 guarantees that this policy improvement step does not decrease value.

The composition of policy evaluation (`T̃^π` converging to `V^π`) and policy improvement (`I` producing a non-worse policy) is the standard generalized policy iteration (GPI) scheme. By Theorem 6.6 of Bertsekas & Tsitsiklis (1996), GPI converges to `V^*` and `π^*` for finite MDPs with discounted rewards.

**The critical insight:** The memory buffer `μ` makes the M-MDP *non-stationary* in a specific way: the augmented state space `S̃ = S × Μ` grows as memory accumulates. However, because the write function `ρ` is deterministic and the memory only grows (condition 3), the sequence of M-MDPs `{M_k}` is nested: `M_{k+1}` has all the states of `M_k` plus new ones corresponding to the expanded memory. The contraction property holds for each `M_k`, and the value functions form a monotonically improving sequence, bounded above by `V^*`. By the monotone convergence theorem, the sequence converges.

#### 5.3.5 Convergence Rate Bounds

Memento-II also provides convergence rate bounds, though these are less tight than the asymptotic guarantee:

**Corollary 1.** Under the conditions of Theorem 1, with a learning rate `α` satisfying `Σ_k α_k = ∞` and `Σ_k α_k^2 < ∞`, the expected suboptimality after `K` episodes is bounded by:

```
E[V^*(s) - V^{π̃_K}(s)] ≤ O(1 / √K)
```

This is the standard `1/√K` rate for Monte Carlo methods. For `K = 1000` tasks, the expected suboptimality is on the order of 3% of the optimal value. This matches the empirical observation (§3.5.4) that MemRL reaches near-peak performance after a few hundred to a thousand tasks.

---

### 5.4 Practical Implications

#### 5.4.1 From Heuristic to Rigorous

Before Memento-II, "reflective memory" was a design pattern—a heuristic that seemed to work well but had no theoretical backing. Systems like Reflexion (Shinn et al., 2023) stored self-reflections after failures and retrieved them in future attempts, achieving impressive empirical results. But the question "why does this work?" had no formal answer. Was it a lucky property of LLMs? Would it break with different models or tasks?

Memento-II answers this question: reflective memory works because it implements policy iteration on an augmented state-memory space. The convergence is not a property of any specific LLM; it is a structural property of the read-write cycle. Any LLM that satisfies condition 5 (in-context learning improves upon base policy) will benefit from reflective memory.

#### 5.4.2 Unifying Case-Based Reasoning, RAG, and Reflexion

Case-based reasoning (CBR; Aamodt & Plaza, 1994) has a 30-year history in AI. RAG (Lewis et al., 2020) is a 5-year-old paradigm in LLM engineering. Reflexion (Shinn et al., 2023) is a 2-year-old technique for LLM self-improvement. Memento-II shows that all three are instances of the same formal framework:

- **CBR** = M-MDP where `Μ` stores problem-solution pairs and `ω` retrieves by structural similarity.
- **RAG** = M-MDP where `Μ` stores document chunks and `ω` retrieves by embedding similarity.
- **Reflexion** = M-MDP where `Μ` stores self-reflection strings and `ω` retrieves the most recent reflections.

The framework reveals what distinguishes effective systems from ineffective ones: **the quality of the write function `ρ` and the read function `ω`**. MemRL's innovation is in `ω` (utility-weighted retrieval). RetroAgent's is in both `ω` (UCB exploration) and `ρ` (lesson distillation with EMA updates). Standard RAG uses a trivial `ω` (cosine similarity) and `ρ` (blind insertion), which is why it underperforms.

#### 5.4.3 Continual Adaptation Without Fine-Tuning is Theoretically Sound

The most important practical implication of Theorem 1 is negative: **you do not need to fine-tune your LLM to achieve convergent self-improvement.** The frozen LLM serves as a fixed computational substrate. The memory buffer serves as the learning substrate. Together, they implement a provably convergent learning algorithm.

This has immediate engineering consequences:

1. **No catastrophic forgetting risk.** Because the LLM's weights are unchanged, its capabilities on tasks outside the current domain are preserved.

2. **No training infrastructure required.** Runtime evolution requires only inference (for task execution and memory writing) and simple arithmetic (for utility updates). No GPUs, no gradient computation, no training data management.

3. **Cheaper than fine-tuning.** A memory buffer with 10,000 entries occupies ~50MB of storage. Fine-tuning a 70B-parameter model requires hundreds of GBs of GPU memory and hours of compute.

4. **Model-agnostic.** The memory buffer can be used with any LLM. When a new model is released, the agent's memory transfers directly—no re-training needed. This is in stark contrast to fine-tuned models, which are locked to a specific architecture and checkpoint.

#### 5.4.4 Connection to Online Learning Theory

Memento-II's M-MDP framework has a deep connection to online learning theory (Cesa-Bianchi & Lugosi, 2006) that the original paper acknowledges but does not fully develop. We sketch the connection here.

In online learning, an agent faces a sequence of tasks `t = 1, 2, ...` and must select a strategy (hypothesis) for each task. After each task, the agent observes the loss and updates its strategy. The goal is to minimize **regret**: the difference between the agent's cumulative loss and the loss of the best fixed strategy in hindsight.

The M-MDP read-write cycle maps directly to this framework:

```
Online Learning             M-MDP
──────────────             ─────
Hypothesis space H    ←→   Memory buffer M (set of available strategies)
Strategy selection    ←→   Read function ω (select memories to use)
Loss observation      ←→   Task outcome r
Strategy update       ←→   Write function ρ (update utility scores)
Regret               ←→   Suboptimality gap V* - V^{π̃_k}
```

**MemRL's retrieval policy is an instance of the Follow-the-Leader algorithm** (FTL; Shalev-Shwartz, 2012): it always selects the memories with the highest current utility estimate (the "leader" in terms of Q-value). FTL has well-known regret bounds for stochastic settings:

```
E[Regret_K] ≤ O(√(K · ln|M|))
```

For a buffer with `|M| = 1000` entries over `K = 1000` tasks, this gives expected regret ≤ O(√(1000 · 6.9)) ≈ O(83). Normalized by K, this is ~8% average per-task suboptimality, consistent with the empirical warm-up period observed in §3.5.7.

**RetroAgent's SimUtil-UCB is an instance of UCB1** (Auer et al., 2002), which has a tighter regret bound:

```
E[Regret_K] ≤ O(√(K · |M| · ln K))
```

The UCB1 bound is optimal in a minimax sense for the multi-armed bandit setting. This provides a stronger theoretical guarantee for RetroAgent's exploration strategy compared to MemRL's exploitation-only approach.

This connection also suggests practical improvements: any advance in online learning algorithms (e.g., Thompson Sampling, EXP3 for adversarial settings, contextual bandits) could be translated into a corresponding memory retrieval strategy within the M-MDP framework.

#### 5.4.5 Limitations of the Theory

1. **Condition 5 is strong.** The assumption that in-context learning always improves upon the base policy is not universally true. LLMs can be confused by retrieved context, especially if the context is contradictory or excessively long (Liu et al., 2024, "Lost in the Middle"). In practice, careful prompt engineering and context window management are needed to approximate condition 5.

2. **Finite state space assumption.** Real agent tasks have continuous, effectively infinite state spaces. The convergence guarantee applies formally only to finite state spaces, though standard function approximation arguments (e.g., using embeddings as a finite representation of the state) provide informal extensions.

3. **Convergence rate is slow.** The `O(1/√K)` bound is loose for practical purposes. With `K = 100` tasks, the bound permits ~10% suboptimality, which is too much for many applications. The theory says convergence is guaranteed but says little about how fast.

4. **No guidance on memory architecture.** Theorem 1 says convergence holds for *any* write and read functions satisfying the conditions. It does not say which specific functions are best. The engineering contributions of MemRL and RetroAgent (specific retrieval algorithms, specific update rules) are not derivable from the theory alone.

---

## Chapter 6: Honcho — Dialectical User Modeling

**System:** Honcho, developed by Plastic Labs (2025–2026). Integrated as the memory/personalization layer of the **Hermes Agent** project (Nous Research, 2026).

**Papers and references:**
- Plastic Labs. "Honcho: Dialectical User Modeling for Personalized AI." Documentation and technical blog, 2025–2026.
- Nous Research. "Hermes Agent: Self-Improving Agent with Atropos RL and Honcho Memory." Open-source release, 2026.
- Hegel, G. W. F. *Phenomenology of Spirit*, 1807. (The philosophical foundation of the dialectical method.)

**Core contribution:** Honcho represents a different axis of runtime self-evolution. While MemRL, RetroAgent, and Memento-II evolve the agent's *task-solving capabilities* through episodic memory, Honcho evolves the agent's *model of the user* through dialectical reasoning. The system maintains a 12-layer identity representation of the user that deepens over time, enabling increasingly personalized agent behavior without fine-tuning.

**Why include Honcho in a book about self-evolving agents?** Because user modeling is a form of self-evolution. An agent that learns your preferences, expertise, and communication style *changes its behavior* over time—not by modifying its weights, and not by storing task solutions, but by building an increasingly accurate internal model of the entity it serves. This is evolution along the personalization axis, and it obeys the same stability-plasticity constraints as task memory: the LLM is frozen (stable), while the user model is plastic (evolves at runtime).

---

### 6.1 The User Modeling Problem

The three preceding chapters addressed one dimension of runtime self-evolution: how an agent improves at *solving tasks*. But tasks don't exist in a vacuum—they are given by *users*, and the same task can require radically different agent behavior depending on who the user is. A terse response that delights a senior engineer will frustrate a student learning to code. A detailed architectural explanation that educates one user will bore another who just needs a one-line command.

Most agent systems treat the user as a static entity: a set of preferences specified in a system prompt or configuration file. This is adequate for single-session interactions but fails for **long-running agent relationships** where the agent should learn the user's:

- Communication style preferences (terse vs. verbose, formal vs. casual)
- Domain expertise level (novice vs. expert in each relevant field)
- Decision-making patterns (risk-averse vs. risk-tolerant, consensus-seeking vs. decisive)
- Implicit goals (what the user is *trying to achieve*, not just what they *said to do*)
- Evolving context (projects change, priorities shift, knowledge grows)

The challenge is that users rarely state these properties explicitly. They are **latent variables** that must be inferred from interaction patterns over time.

**Existing approaches and their limitations:**

| Approach | Mechanism | Limitation |
|----------|-----------|------------|
| Static system prompt | Manually written user preferences | Doesn't adapt; becomes stale |
| Conversation history | Full chat logs in context | Token cost scales linearly; LLM attention degrades with length |
| Session summaries | Compressed session notes | Loses nuance; summary quality varies |
| User profile database | Structured key-value attributes | Rigid schema; can't capture complex identity facets |
| Collaborative filtering | "Users like you also..." | Requires large user population; privacy concerns |

Honcho takes a fundamentally different approach: **dialectical reasoning about the user's identity.**

---

### 6.2 The 12-Layer Identity Model

Honcho represents each user through a **12-layer identity hierarchy**, inspired by Robert Dilts' Neurological Levels model (1990) and extended with insights from clinical psychology, personality theory, and organizational behavior:

| Layer | Name | Description | Example |
|-------|------|-------------|---------|
| 1 | **Environment** | Physical and digital context | "Works remotely; uses macOS; prefers dark mode" |
| 2 | **Behavior** | Observable interaction patterns | "Sends long messages; asks follow-up questions; iterates quickly" |
| 3 | **Capabilities** | Skills and knowledge areas | "Expert in Python; intermediate in Rust; learning Kubernetes" |
| 4 | **Beliefs** | Held opinions and assumptions | "Believes in test-driven development; skeptical of microservices" |
| 5 | **Values** | Priority hierarchy | "Values code readability over performance; prioritizes user experience" |
| 6 | **Identity** | Self-concept and roles | "Senior engineer; team lead; open-source contributor" |
| 7 | **Purpose** | Higher-order goals | "Building a platform to democratize AI access" |
| 8 | **Emotional patterns** | Affective tendencies | "Gets frustrated with boilerplate; energized by novel problems" |
| 9 | **Cognitive style** | Thinking and learning patterns | "Visual learner; prefers examples over abstractions; thinks in systems" |
| 10 | **Relational dynamics** | How the user relates to the agent | "Treats agent as junior colleague; expects proactive suggestions" |
| 11 | **Growth trajectory** | How the user is changing | "Transitioning from IC to management; learning distributed systems" |
| 12 | **Meta-cognition** | Self-awareness patterns | "Aware of tendency to over-engineer; actively working on scope discipline" |

Each layer is represented as a **natural language paragraph** (not a structured schema), allowing the model to capture nuance and uncertainty:

```
Layer 3 (Capabilities) — as of 2026-03-15:
"Deep expertise in Python (10+ years), particularly in the scientific
computing stack (NumPy, Pandas, SciPy). Strong but not expert-level
Rust skills — comfortable with ownership and lifetimes but still
learning async patterns. Recently started exploring Kubernetes; has
deployed simple services but struggles with custom operators and
network policies. Prefers to see working code examples rather than
reading documentation."
```

#### 6.2.1 Layer Initialization

On first interaction, all 12 layers are initialized to **default priors**:

```
Layer k initial state:
  "No information available yet for this user's {layer_name}.
   Default assumptions: average {domain} user with typical
   preferences. Update as evidence accumulates."
```

The agent operates on these defaults until enough interaction data accumulates to update the layers. This is the "cold prompt" state described in §6.5.

#### 6.2.2 Layer Update Mechanism

Layers are updated through **dialectical reasoning** (§6.3), not through simple extraction. The system does not just append new facts; it *synthesizes* new understanding by confronting existing beliefs about the user with new evidence.

---

### 6.3 Two-Layer Context Injection Architecture

Honcho injects user-model information into the agent's context through a **two-layer architecture**:

#### 6.3.1 Base Layer

The base layer provides **factual grounding** and is injected into every agent call:

```
Base Context = SessionSummary(current_session) + UserRepresentation(user_model)
```

**SessionSummary:** A compressed summary of the current conversation session. Generated by an LLM call that takes the full conversation history and produces a 200–500 token summary preserving key decisions, open questions, and the user's current focus.

**UserRepresentation:** A flattened version of the 12-layer identity model, typically 300–800 tokens. Not all layers are included in every call; the system selects the most relevant layers based on the current task context:

```
Relevance scoring for layer k:
  rel(k) = cos(Embed(layer_k_text), Embed(current_task))
  Include layer k if rel(k) ≥ 0.5 or k ∈ {1, 2, 3}  // always include basic layers
```

**Injection format:**

```
[USER CONTEXT]
Session: {session_summary}
User Profile:
- Environment: {layer_1_text}
- Behavior Patterns: {layer_2_text}
- Capabilities: {layer_3_text}
- Values: {layer_5_text}  // included because rel(5) ≥ 0.5 for this task
[END USER CONTEXT]
```

#### 6.3.2 Dialectic Layer

The dialectic layer provides **reasoned interpretation** and is injected periodically (not every call):

```
Dialectic Context = LLM_Reasoning(base_context, interaction_history, current_task)
```

This is a separate LLM call (the "dialectic pass") that takes the base context and produces a **reasoned analysis** of how the user model should influence the current interaction:

```
Dialectic Pass Prompt:
Given the following user model and current interaction context,
reason about:
1. What does the user likely NEED (not just what they asked for)?
2. How should the response be ADAPTED to this user's style?
3. What ASSUMPTIONS should be challenged or validated?
4. What GROWTH OPPORTUNITIES exist in this interaction?

User Model: {base_context}
Current Task: {current_task}
Recent Messages: {last_3_messages}

Dialectic Analysis:
```

The dialectic pass is computationally expensive (one additional LLM call) but produces significantly higher-quality personalization. The system controls when it runs via configuration parameters (§6.4).

---

### 6.4 Configuration Parameters

Honcho exposes three primary configuration parameters that control the frequency and depth of dialectical reasoning:

#### 6.4.1 contextCadence

**Type:** Integer (number of messages between base context updates)
**Default:** 5
**Range:** 1–20

Controls how often the base layer context is refreshed. A session summary is regenerated every `contextCadence` messages:

```
if message_count % contextCadence == 0:
    session_summary = LLM_summarize(conversation_history)
    base_context = session_summary + user_representation
```

**Tradeoffs:**
- `contextCadence = 1`: Maximum freshness, maximum cost (one summary call per message).
- `contextCadence = 5` (default): Good balance; context may be slightly stale but cost is 80% lower.
- `contextCadence = 20`: Minimal cost but context can become significantly stale in fast-moving conversations.

#### 6.4.2 dialecticCadence

**Type:** Integer (number of messages between dialectic passes)
**Default:** 10
**Range:** 1–50

Controls how often the dialectic layer runs. A full dialectic analysis is generated every `dialecticCadence` messages:

```
if message_count % dialecticCadence == 0:
    dialectic_analysis = LLM_dialectic(base_context, history, task)
```

The dialectic pass is more expensive than the base context update, so its cadence is typically 2–5× the context cadence.

**Tradeoffs:**
- `dialecticCadence = 1`: Maximum personalization depth, very high cost.
- `dialecticCadence = 10` (default): Dialectic reasoning runs every ~10 messages, which is sufficient for most conversational dynamics.
- `dialecticCadence = 50`: Minimal dialectical reasoning; suitable for high-volume, low-personalization use cases.

#### 6.4.3 dialecticDepth

**Type:** Integer (number of dialectic passes per invocation)
**Default:** 2
**Range:** 1–3

Controls the **depth** of dialectical reasoning when it does run. Multiple passes implement the Hegelian dialectic:

```
depth = 1 (Thesis):
  Initial analysis of user model + current context
  → "The user appears to be a senior engineer who prefers concise responses."

depth = 2 (Thesis + Antithesis):
  Challenge the initial analysis
  → "However, on this topic (distributed systems), the user has asked
     several clarifying questions suggesting less expertise. The user
     may prefer more detailed explanations for this specific domain."

depth = 3 (Thesis + Antithesis + Synthesis):
  Synthesize the contradiction
  → "The user is a senior engineer who generally prefers conciseness
     but is actively learning distributed systems and benefits from
     detailed explanations in that domain. Adapt response verbosity
     based on topic expertise level."
```

**Computational cost:** Each depth level requires one additional LLM call. At `dialecticDepth = 3`, the dialectic pass costs 3× a single LLM inference.

**Quality impact (from Honcho's internal evaluations):**

| Depth | User satisfaction (1-5 scale) | Personalization accuracy (%) | Cost multiplier |
|-------|------------------------------|------------------------------|-----------------|
| 1 | 3.4 | 62 | 1.0× |
| 2 | 4.1 | 78 | 2.0× |
| 3 | 4.3 | 83 | 3.0× |

Depth 2 provides the best cost/quality tradeoff. Depth 3 provides marginal improvement at 50% additional cost.

---

### 6.5 User Model Evolution Over Time

The user model evolves through three distinct phases:

#### 6.5.1 Phase 1: Cold Prompt (Sessions 1–3)

**State:** All 12 layers are at default priors. The agent has no user-specific information.

**Behavior:** The agent relies on generic interaction patterns. Responses are competent but not personalized. The dialectic layer (if enabled) produces generic analyses like "This appears to be a technical user; provide detailed responses."

**Data collection:** Every user message is analyzed for signals that can update the identity layers:

```
Signal Extraction Prompt:
Analyze the following user message for identity signals.
For each signal, specify which identity layer it informs
and the evidence strength (weak/moderate/strong).

Message: {user_message}
Context: {conversation_context}

Signals:
```

**Example extraction from a single message:**

```
User: "Can you refactor this to use async/await instead of callbacks?
       I've been meaning to modernize this codebase but keep putting
       it off. Also, skip the explanation — I know how promises work."

Extracted signals:
- Layer 3 (Capabilities): Knows async/await and promises (STRONG)
- Layer 2 (Behavior): Prefers action over explanation (MODERATE)
- Layer 4 (Beliefs): Values modern code patterns (MODERATE)
- Layer 12 (Meta-cognition): Aware of procrastination on tech debt (WEAK)
```

#### 6.5.2 Phase 2: Warm Prompt (Sessions 4–15)

**State:** Layers 1–5 have been partially populated from interaction data. Deeper layers (6–12) remain sparse.

**Behavior:** The agent begins to personalize. It adjusts verbosity based on the user's inferred expertise level, uses the user's preferred terminology, and anticipates common follow-up questions.

**Dialectic reasoning becomes productive:** With a partial user model, the dialectic passes can identify contradictions and refine understanding:

```
Thesis: "User is an expert Python developer."
Antithesis: "But user's last three sessions involved basic syntax
            questions about list comprehensions."
Synthesis: "User is expert in Python data science (NumPy, Pandas)
           but less fluent in idiomatic Python patterns outside
           their domain. Provide explanations for general Python
           idioms while assuming data science competence."
```

#### 6.5.3 Phase 3: Deep Model (Sessions 15+)

**State:** All 12 layers have been populated with at least moderate confidence. The model captures nuanced user identity aspects.

**Behavior:** The agent operates with deep personalization:

- Proactively suggests approaches aligned with the user's values (Layer 5).
- Adapts explanations to the user's cognitive style (Layer 9).
- Recognizes and supports the user's growth trajectory (Layer 11).
- Manages the relational dynamics appropriately (Layer 10).

**Model maintenance:** At this phase, the primary challenge is keeping the model current. The dialectic layer detects drift:

```
Dialectic drift detection:
"The user model indicates the user 'prefers manual testing over
automated tests' (Layer 4, updated 6 weeks ago). However, the
last 5 sessions have involved extensive pytest usage and CI/CD
pipeline configuration. UPDATING Layer 4: User has shifted toward
automated testing, possibly influenced by a team process change."
```

#### 6.5.4 Layer Update Protocol

When the dialectic system detects new evidence that warrants a layer update, it follows a structured protocol:

```
Layer Update Protocol:
1. IDENTIFY: Which layer is affected?
2. CURRENT: What does the layer currently say?
3. EVIDENCE: What new evidence contradicts or extends it?
4. CONFIDENCE: How strong is the evidence? (weak/moderate/strong)
5. UPDATE: Generate new layer text incorporating both old and new information
6. TIMESTAMP: Record when the update occurred

Minimum evidence threshold: Two independent signals of at least
MODERATE confidence, or one signal of STRONG confidence.
```

**Update frequency by layer (empirical averages from Hermes Agent deployment):**

| Layer | Avg. updates per 100 sessions | Stability |
|-------|-------------------------------|-----------|
| 1 (Environment) | 3.2 | Very stable |
| 2 (Behavior) | 12.7 | Moderate |
| 3 (Capabilities) | 8.4 | Moderate |
| 4 (Beliefs) | 4.1 | Stable |
| 5 (Values) | 2.3 | Very stable |
| 6 (Identity) | 1.8 | Very stable |
| 7 (Purpose) | 1.1 | Extremely stable |
| 8 (Emotional) | 7.6 | Moderate |
| 9 (Cognitive style) | 3.9 | Stable |
| 10 (Relational) | 5.2 | Moderate |
| 11 (Growth) | 6.8 | Moderate |
| 12 (Meta-cognition) | 2.9 | Stable |

Deeper layers (purpose, identity, values) change rarely—they represent core aspects of the user that are slow-moving. Surface layers (behavior, emotional patterns) update more frequently as they reflect session-to-session variation.

---

### 6.6 Integration with Hermes Agent

Honcho is integrated into the Hermes Agent architecture as the **personalization and long-term memory layer**. The integration points are:

#### 6.6.1 Architecture

```
┌──────────────────────────────────────────────────────┐
│                    Hermes Agent                       │
│                                                       │
│  ┌─────────────┐   ┌──────────────┐   ┌───────────┐ │
│  │  Task Loop   │──▶│  Tool Router  │──▶│  Tools    │ │
│  └──────┬──────┘   └──────────────┘   └───────────┘ │
│         │                                             │
│         ▼                                             │
│  ┌─────────────────┐                                  │
│  │  Context Engine  │◀── Base Layer (every call)      │
│  │                  │◀── Dialectic Layer (periodic)   │
│  └────────┬────────┘                                  │
│           │                                           │
│           ▼                                           │
│  ┌─────────────────┐                                  │
│  │     Honcho       │                                 │
│  │  ┌───────────┐  │                                  │
│  │  │ 12-Layer  │  │                                  │
│  │  │  User     │  │                                  │
│  │  │  Model    │  │                                  │
│  │  ┌───────────┐  │                                  │
│  │  │ Session   │  │                                  │
│  │  │ Store     │  │                                  │
│  │  └───────────┘  │                                  │
│  └─────────────────┘                                  │
└──────────────────────────────────────────────────────┘
```

#### 6.6.2 API Surface

Honcho exposes a REST API for integration:

```
POST /users/{user_id}/sessions
  → Creates a new session, returns session_id

POST /users/{user_id}/sessions/{session_id}/messages
  → Adds a message to the session history
  → Triggers signal extraction (async)

GET /users/{user_id}/representation
  → Returns the current 12-layer user model

POST /users/{user_id}/sessions/{session_id}/dialectic
  → Triggers a dialectic pass, returns analysis

GET /users/{user_id}/sessions/{session_id}/context
  → Returns the base layer context for the current session
```

#### 6.6.3 Hermes Agent Configuration

In the Hermes Agent configuration file:

```yaml
honcho:
  enabled: true
  api_url: "http://localhost:8000"
  context_cadence: 5
  dialectic_cadence: 10
  dialectic_depth: 2
  min_confidence_for_update: "moderate"
  layers_always_included: [1, 2, 3]
  max_context_tokens: 800
```

---

### 6.7 Honcho as Runtime Evolution

Honcho implements runtime self-evolution along the *user modeling* dimension. The parallels to MemRL and RetroAgent are direct:

| Concept | MemRL/RetroAgent | Honcho |
|---------|-----------------|--------|
| What evolves | Task-solving memory | User model |
| Memory representation | IEU triplets / lessons | 12-layer identity hierarchy |
| Write mechanism | Store experience + update utility | Extract identity signals + update layers |
| Read mechanism | Two-phase / SimUtil-UCB retrieval | Relevance-filtered layer injection |
| Update signal | Task outcome (binary/graded) | Dialectic reasoning (multi-pass) |
| Convergence | Q-values → true utility | User model → true user identity |
| Exploration | UCB bonus (RetroAgent) | Dialectic antithesis (challenges current model) |

The dialectic antithesis step (§6.5.2) is functionally equivalent to UCB exploration: it forces the system to re-examine and potentially revise aspects of the user model that might be wrong, preventing the model from ossifying around early (possibly incorrect) impressions.

---

### 6.8 Dialectical Reasoning: The Hegelian Engine

The dialectical process is the philosophical core of Honcho. It deserves detailed treatment because it is the mechanism by which the user model avoids the same ossification problem that MemRL and RetroAgent face in task memory.

#### 6.8.1 The Hegelian Triad Applied to User Modeling

Georg Wilhelm Friedrich Hegel's dialectical method (1807) proceeds through three moments:

1. **Thesis:** An initial proposition or understanding.
2. **Antithesis:** A contradiction or challenge to the thesis.
3. **Synthesis:** A higher-order understanding that resolves the contradiction by incorporating insights from both thesis and antithesis.

In Honcho's implementation:

```
Thesis generation prompt:
"Based on the user model and recent interactions, state
your current best understanding of this user's {aspect}."

Antithesis generation prompt:
"Now challenge that understanding. What evidence from
recent interactions CONTRADICTS or COMPLICATES the thesis?
What alternative interpretations exist?"

Synthesis generation prompt:
"Synthesize the thesis and antithesis into a more nuanced
understanding. What is the higher-order truth that
accommodates both the original understanding and the
contradictory evidence?"
```

#### 6.8.2 Concrete Dialectic Trace

Here is a real dialectic trace from the Hermes Agent deployment (anonymized):

```
Context: User has been working on a web application for 12 sessions.

THESIS (Layer 9 — Cognitive Style):
"The user is a systematic, top-down thinker who prefers to
understand architecture before implementation details. They
typically ask for the big picture first, then drill down.
They prefer diagrams and structured documentation."

ANTITHESIS:
"However, in the last 3 sessions focused on debugging a
WebSocket race condition, the user adopted a bottom-up
approach: examining raw packet traces, adding console.log
statements, and reasoning inductively from specific failures.
The user also explicitly said 'just show me the code, skip
the explanation' twice. This contradicts the 'top-down,
explanation-first' characterization."

SYNTHESIS:
"The user has a PRIMARY cognitive style that is top-down and
systematic, which dominates during design and planning phases.
However, they switch to a SECONDARY bottom-up, empirical style
during debugging and troubleshooting. The switch is triggered
by problem type (debugging vs. building) rather than fatigue
or frustration. Adapt: provide architectural overviews during
design discussions, but switch to code-first, minimal-explanation
mode when the user is debugging."
```

This synthesis is richer and more actionable than either the thesis or antithesis alone. It captures a *conditional* pattern (behavior depends on context) that a simple accumulation of observations would miss.

#### 6.8.3 Multi-Turn Dialectic (dialecticDepth = 3)

At depth 3, the synthesis from the first triad becomes the thesis for a second round:

```
Round 1:
  Thesis: "User prefers top-down thinking"
  Antithesis: "User uses bottom-up during debugging"
  Synthesis₁: "User switches styles based on task type"

Round 2:
  Thesis₂ = Synthesis₁: "User switches styles based on task type"
  Antithesis₂: "But even during debugging, the user's FIRST action
    is often to re-read the architecture docs before diving into
    traces. And during design, they sometimes jump to a prototype
    before finishing the spec. The task-type trigger is too binary."
  Synthesis₂: "The user's cognitive style is fundamentally
    integrative: they move fluidly between abstraction levels,
    using top-down framing to orient and bottom-up evidence to
    validate. The apparent style switching is actually a
    sophisticated iteration between levels, with the entry point
    (top-down vs. bottom-up) influenced but not determined by
    task type. Adapt: always provide both an architectural frame
    AND specific examples, letting the user choose their entry
    point."
```

This second-order synthesis captures the user's cognitive style at a level of nuance that neither direct observation nor single-pass analysis could achieve.

#### 6.8.4 Dialectic as Exploration

The antithesis step serves the same function as RetroAgent's UCB exploration bonus: it prevents the user model from converging prematurely to a simplistic or incorrect representation. Without the antithesis step, the model would accumulate evidence for its current understanding and never question it—the same ossification that MemRL's fixed Q-values can produce.

The key difference is that Honcho's exploration is *reasoning-based* rather than *stochastic*. UCB adds random exploration via a mathematical bonus. The dialectic generates *directed* exploration by explicitly asking "what evidence contradicts my current belief?" This is more expensive (requires an LLM call) but more efficient (it targets the most informative contradictions rather than exploring randomly).

### 6.9 Evaluation and Empirical Results

#### 6.9.1 Internal A/B Testing

Plastic Labs reports results from internal A/B testing on a multi-session coding assistant deployment (2026):

**Table 6: Honcho A/B Test Results (Internal Deployment)**

| Metric | Control (no Honcho) | Base layer only | Base + Dialectic (depth 1) | Base + Dialectic (depth 2) |
|--------|--------------------|-----------------|-----------------------------|----------------------------|
| User satisfaction (1-5) | 3.2 | 3.7 | 4.0 | 4.2 |
| Task completion rate (%) | 71.4 | 74.8 | 76.2 | 77.1 |
| Avg. messages per task | 8.3 | 7.1 | 6.8 | 6.5 |
| Return session rate (%) | 42.1 | 51.3 | 54.7 | 56.2 |

**Key findings:**

1. **Base layer alone provides significant gains.** Just injecting session summaries and user representations increases satisfaction by 0.5 points and reduces messages per task by 14%. This is low-hanging fruit.

2. **Dialectic reasoning adds on top.** Each depth level adds approximately 0.2–0.3 satisfaction points. The gains are statistically significant (p < 0.01 for depth 2 vs. base-only, two-sample t-test, n = 2,000 sessions per condition).

3. **Messages per task decreases with personalization.** Users need fewer messages to complete tasks when the agent understands their style, expertise, and preferences. This is a direct efficiency gain.

4. **Return rate increases substantially.** Users are 14 percentage points more likely to return for another session with Honcho enabled. This suggests that personalization creates a "stickiness" effect.

#### 6.9.2 Longitudinal User Model Quality

Honcho tracks the quality of its user model over time by measuring **prediction accuracy**: can the model predict what the user will prefer or need before they explicitly state it?

```
Session:       1    3    5   10   15   25   50
Prediction
accuracy (%): 28   37   45  58   64   71   76
```

The model reaches 50% prediction accuracy by session 5 and 70% by session 25. This maps roughly to the warm prompt → deep model transition described in §6.5.

**Prediction examples:**

- Session 3 (Cold): Agent predicts user wants verbose explanation. User actually wanted a one-liner. ✗
- Session 10 (Warm): Agent predicts user will ask about error handling next. User asks about error handling. ✓
- Session 25 (Deep): Agent predicts user will want a systems-level tradeoff analysis rather than a quick answer, because the question touches on a domain where the user's growth trajectory (Layer 11) indicates active learning. User: "Yes, exactly—give me the full tradeoff." ✓

The prediction accuracy metric is measured by a held-out evaluator model that judges whether the agent's preemptive adaptations match what the user actually wanted, based on the user's subsequent message and explicit feedback.

#### 6.9.3 Layer Contribution Analysis

To understand which identity layers contribute most to personalization quality, Honcho runs an ablation where each layer is individually removed:

| Layer Removed | Δ Satisfaction | Most Affected Task Type |
|---------------|---------------|------------------------|
| 1 (Environment) | −0.1 | Environment setup, tool config |
| 2 (Behavior) | −0.3 | All (affects response formatting) |
| 3 (Capabilities) | −0.4 | Technical tasks (calibrates detail level) |
| 4 (Beliefs) | −0.2 | Architecture decisions |
| 5 (Values) | −0.2 | Code review, design tradeoffs |
| 6 (Identity) | −0.1 | Role-specific interactions |
| 7 (Purpose) | −0.1 | Long-term project planning |
| 8 (Emotional) | −0.2 | Debugging, troubleshooting |
| 9 (Cognitive style) | −0.3 | Explanations, tutorials |
| 10 (Relational) | −0.2 | Collaboration tone |
| 11 (Growth) | −0.1 | Learning recommendations |
| 12 (Meta-cognition) | −0.1 | Self-improvement suggestions |

Layers 2 (Behavior), 3 (Capabilities), and 9 (Cognitive style) are the most impactful. This makes intuitive sense: knowing *how* the user communicates, *what* they already know, and *how* they think has the most direct effect on response quality.

### 6.10 Limitations and Open Problems

1. **Computational cost.** At `dialecticDepth = 2` and `dialecticCadence = 10`, the dialectic layer adds ~20% overhead to the total LLM inference cost. For cost-sensitive deployments, the base layer alone may be sufficient.

2. **Privacy.** The 12-layer identity model stores potentially sensitive information about users. Production deployments must implement encryption at rest, user-controlled deletion, and clear data governance policies. The Honcho documentation recommends treating the user model as PII (Personally Identifiable Information).

3. **Evaluation difficulty.** Unlike task-solving memory (where success/failure provides a clear signal), user modeling quality is hard to measure objectively. Honcho relies on user satisfaction surveys and A/B testing, which are noisy and slow.

4. **Cross-user learning.** Honcho models each user independently. There is no mechanism for transferring insights across users ("Users who value readability also tend to prefer functional programming"). Collaborative filtering could address this but introduces significant privacy challenges.

5. **Adversarial robustness.** A user who deliberately provides misleading signals can corrupt their own model. The dialectic layer provides some robustness (the antithesis step can challenge suspicious signals), but systematic adversarial manipulation is not addressed.

6. **Model staleness.** Layers that are updated infrequently (Purpose, Identity, Values) may become stale if the user undergoes significant life changes between sessions. The system has no mechanism for proactive staleness detection; it relies on the dialectic layer to notice contradictions. A potential mitigation is a time-based confidence decay: layers that haven't been validated by recent evidence gradually decrease in confidence, triggering more frequent dialectic re-evaluation.

7. **Cultural and linguistic bias.** The dialectical reasoning and identity layer definitions reflect Western psychological models (Dilts, Hegel). Users from different cultural backgrounds may have identity structures that map poorly onto the 12-layer hierarchy. For example, collectivist cultures may place more weight on relational and group identity dimensions that are under-represented in the current schema. Internationalization of the identity model is an acknowledged open problem.

8. **Scaling to multiple users.** The current architecture maintains a completely separate 12-layer model per user. For platforms with millions of users, this creates storage and computational overhead. A hierarchical approach—shared population-level priors with user-specific deltas—could reduce costs while maintaining personalization quality, but has not been implemented.

---

## Cross-Cutting Analysis: The Architecture of Runtime Self-Evolution

The four systems covered in this part share a common architecture:

```
┌─────────────────────────────────────────────────────┐
│                 FROZEN LLM (Reasoning)               │
│  - Provides in-context learning                      │
│  - Generates actions, reflections, analyses          │
│  - Never modified                                    │
└─────────────┬──────────────────────┬────────────────┘
              │ Read                 │ Write
              ▼                     ▼
┌─────────────────────────────────────────────────────┐
│              EXTERNAL MEMORY (Plasticity)             │
│  - Stores structured experience/knowledge            │
│  - Carries learned quality signals                   │
│  - Grows and evolves at runtime                      │
│  - Retrieval is utility-aware                        │
└─────────────────────────────────────────────────────┘
```

The critical design decisions are:

| Decision | Options (from papers) | Best Practice |
|----------|-----------------------|---------------|
| Memory entry format | Full trace (MemRL) vs. distilled lesson (RetroAgent) vs. identity layer (Honcho) | Match to context budget and use case |
| Quality signal | Q-value (MemRL) vs. EMA utility (RetroAgent) vs. dialectic confidence (Honcho) | EMA for fast adaptation, MC for stability |
| Retrieval strategy | Two-phase (MemRL) vs. combined score (RetroAgent) | Combined score if exploration needed |
| Exploration | None (MemRL) vs. UCB (RetroAgent) vs. dialectic antithesis (Honcho) | UCB for task memory; dialectic for user modeling |
| Credit assignment | Uniform (MemRL, RetroAgent) | Acceptable; converges with enough data |
| Convergence guarantee | Asymptotic (Memento-II) | Exists under standard conditions |

The theoretical foundation (Memento-II) tells us that any system following this architecture—frozen LLM + external memory with read/write functions—will converge to optimal behavior if the memory covers the state space and the LLM can learn from retrieved context. The engineering systems (MemRL, RetroAgent, Honcho) provide specific, empirically validated instantiations of this architecture.

### Design Decision Tree for Practitioners

For engineers implementing runtime self-evolution, the following decision tree captures the key architectural choices:

```
1. Do you need the agent to improve at TASKS or at USER UNDERSTANDING?
   ├── Tasks → Use MemRL / RetroAgent pattern
   │   ├── Is the task distribution stationary?
   │   │   ├── Yes → MemRL (MC updates converge cleanly)
   │   │   └── No → RetroAgent (EMA adapts faster to drift)
   │   ├── Is the task space narrow or broad?
   │   │   ├── Narrow → Higher similarity threshold (MemRL's 0.7)
   │   │   └── Broad → Lower threshold + UCB exploration (RetroAgent's 0.4 + κ=1.0)
   │   ├── Is context window budget tight?
   │   │   ├── Yes → Distilled lessons (RetroAgent pattern)
   │   │   └── No → Full experiences (MemRL pattern)
   │   └── How many tasks before performance matters?
   │       ├── < 50 → MemRL (faster warm-up without exploration cost)
   │       └── > 200 → RetroAgent (exploration prevents ossification at scale)
   └── User understanding → Use Honcho pattern
       ├── Single-session interactions? → Base layer only (contextCadence = 3)
       ├── Multi-session relationship? → Base + Dialectic (depth 2, cadence 10)
       └── Deep personalization needed? → Full 12-layer + Dialectic (depth 3, cadence 5)
```

### Open Research Questions

1. **Combining task memory and user modeling.** No current system combines MemRL/RetroAgent-style task memory with Honcho-style user modeling. An agent that simultaneously learns which strategies work (task memory) and how to present them (user model) could be strictly more effective than either alone.

2. **Multi-agent memory sharing.** When multiple agents collaborate (see Part III), should they share a memory buffer? Shared memory would allow knowledge transfer, but could also propagate errors. The M-MDP framework could be extended to multi-agent settings, but this is unexplored.

3. **Memory compression and consolidation.** As buffers grow, should old memories be compressed, merged, or abstracted? Human episodic memory undergoes consolidation during sleep (Walker, 2017)—is there an analog for agent memory?

4. **Adversarial robustness.** If an adversary can influence the agent's task outcomes (e.g., by manipulating the environment), they can corrupt Q-values/utility scores and degrade the memory buffer. No current system addresses adversarial memory attacks.

5. **Theoretical tight bounds.** Memento-II's `O(1/√K)` convergence rate bound is likely loose. Tighter analysis that accounts for the specific structure of MemRL's two-phase retrieval or RetroAgent's UCB could yield practically useful sample complexity guarantees.

6. **Dynamic learning rates.** Both MemRL (`α = 0.1`) and RetroAgent (`β_util = 0.2`) use fixed learning rates. Adaptive learning rate schedules (e.g., decreasing with retrieval count) could provide both fast initial learning and stable long-term convergence.

7. **Cross-domain transfer.** A memory buffer trained on Python coding tasks: does it transfer to Rust coding? The semantic filtering (Phase 1) would retrieve cross-domain memories with lower similarity scores, but some algorithmic strategies are language-agnostic. Measuring and optimizing cross-domain transfer within the M-MDP framework is an open problem.

8. **Human-in-the-loop memory curation.** All four systems treat memory as fully autonomous. Allowing humans to annotate, correct, or curate memory entries could dramatically accelerate convergence, but raises questions about the division of labor between human curation and autonomous Q-value learning.

**The meta-lesson of Part II:** Runtime self-evolution is not a hack or a heuristic. It is a principled approach to continual agent improvement, grounded in reinforcement learning theory, validated on production benchmarks, and implementable with today's LLMs without any fine-tuning infrastructure. The agent of 2026 does not need gradient descent to get smarter. It needs a good memory and a utility-aware way to read from it.

---

*Next: [Part III: Making Agents Evolve](part3_evolution.md) — From memory-based evolution to full self-improvement through reinforcement learning, evaluation, and benchmarking.*
