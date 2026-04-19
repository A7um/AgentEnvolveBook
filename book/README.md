# The Self-Evolving Agent

**How AI Agents Get Better Through Use**

*For practitioners designing agents that improve at runtime — no fine-tuning, no retraining, just frozen models that learn from experience.*

---

## What This Book Covers

One question, explored in paper-level depth across 15 chapters: **how do you build agents that get better every time they run, without ever updating model weights?**

Every mechanism in this book operates on a frozen LLM backbone. The model never changes. What changes is external memory, skill libraries, heuristic pools, filesystem knowledge, and retrieval strategies. The agent evolves; the model doesn't.

## Table of Contents

### Part I: Foundations of Runtime Self-Evolution
- [Chapter 1: The Self-Evolution Problem](part1_foundations.md#chapter-1-the-self-evolution-problem) — Statelessness, CoALA framework, formal taxonomy of 20+ mechanisms, problem formalization
- [Chapter 2: Reflection-Based Self-Evolution](part1_foundations.md#chapter-2-reflection-based-self-evolution) — Reflexion, ExpeL, ERL, AutoGuide with full algorithms and results

### Part II: Memory-Based Self-Evolution
- [Chapter 3: MemRL — Utility-Learned Memory](part2_architecture.md#chapter-3-utility-learned-memory--memrl) — IEU triplets, Two-Phase Retrieval, Q-value Monte Carlo updates
- [Chapter 4: RetroAgent — SimUtil-UCB Memory](part2_architecture.md#chapter-4-retroagents-simutil-ucb-memory) — Full SimUtil-UCB formula, utility EMA, exploration bonus
- [Chapter 5: Memento-II — Formal Theory](part2_architecture.md#chapter-5-memento-ii--formal-theory-of-memory-based-learning) — M-MDP framework, read-write learning, convergence guarantees
- [Chapter 6: Honcho — Dialectical User Modeling](part2_architecture.md#chapter-6-honcho--dialectical-user-modeling) — 12-identity layers, Hegelian dialectic engine, cold→warm→deep evolution

### Part III: Skill-Based Self-Evolution
- [Chapter 7: Voyager — Code Skill Accumulation](part3_evolution.md#chapter-7-code-skill-accumulation--voyager) — JS skill library, automatic curriculum, composable skills
- [Chapter 8: SkillWeaver — Web API Synthesis](part3_evolution.md#chapter-8-skillweaver--web-agent-self-improvement-through-api-synthesis) — Playwright APIs, cross-agent transfer (+54.3%)
- [Chapter 9: Hermes Agent — Autonomous Skill Documents](part3_evolution.md#chapter-9-hermes-agent--autonomous-skill-document-creation) — SKILL.md format, closed-loop learning, agentskills.io
- [Chapter 10: AgentFactory — Executable Subagents](part3_evolution.md#chapter-10-agentfactory--executable-subagent-accumulation) — Python module accumulation, 57% cost reduction
- [Chapter 11: ASG-SI — Audited Skill Graphs](part3_evolution.md#chapter-11-asg-si--audited-skill-graphs) — Verifiable rewards, governance, continual memory control

### Part IV: Knowledge Crystallization and Self-Optimizing Systems
- [Chapter 12: Knowledge Crystallization](part4_5_practice_future.md#chapter-12-knowledge-crystallization--filesystem-based-evolution) — RKC, OpenClaw self-improving-agent, SkillHub/ClawHub, Koda case study
- [Chapter 13: Prompt and Architecture Self-Optimization](part4_5_practice_future.md#chapter-13-prompt-and-architecture-self-optimization) — OPRO, EvoTool, ADAS, HyEvo
- [Chapter 14: LATS — Planning-Time Self-Improvement](part4_5_practice_future.md#chapter-14-lats--planning-time-self-improvement) — MCTS for agents, UCB selection
- [Chapter 15: Open Problems](part4_5_practice_future.md#chapter-15-open-problems-and-the-future-of-self-evolving-agents) — Forgetting, adversarial poisoning, quality metrics, mechanism composition

### Appendices
- [Appendix A: Paper Reference Table](part4_5_practice_future.md#appendix-a-paper-reference-table)
- [Appendix B: Implementation Decision Guide](part4_5_practice_future.md#appendix-b-implementation-decision-guide)

## Papers Covered (with full algorithm detail)

| Paper | Venue | Mechanism | Chapter |
|-------|-------|-----------|---------|
| Reflexion (Shinn et al.) | NeurIPS 2023 | Verbal self-reflection | 2 |
| ExpeL (Zhao et al.) | AAAI 2024 | Cross-task heuristic extraction | 2 |
| Voyager (Wang et al.) | TMLR 2024 | Code skill accumulation | 7 |
| CoALA (Sumers et al.) | TMLR 2024 | Cognitive architecture framework | 1 |
| AutoGuide (Gao et al.) | NeurIPS 2024 | State-aware guidelines | 2 |
| LATS (Zhou et al.) | ICML 2024 | Monte Carlo tree search for agents | 14 |
| OPRO (Yang et al.) | 2023 | Prompt optimization by LLM | 13 |
| ASG-SI (Huang & Huang) | arXiv Dec 2025 | Audited skill graph | 11 |
| Memento-II (Guo et al.) | arXiv Dec 2025 | M-MDP convergence theory | 5 |
| MemRL (Zhang et al.) | arXiv Jan 2026 | Q-value learned memory | 3 |
| ADAS (Hu et al.) | ICLR 2025 | Meta agent architecture search | 13 |
| SkillWeaver (Pan et al.) | arXiv Apr 2025 | Web API skill synthesis | 8 |
| ERL (Allard et al.) | ICLR 2026 | Single-attempt heuristics | 2 |
| RetroAgent (Zhang et al.) | arXiv Mar 2026 | SimUtil-UCB memory | 4 |
| AgentFactory (Zhang et al.) | arXiv Mar 2026 | Executable subagent reuse | 10 |
| Hermes Agent (Nous Research) | 2026 | Autonomous skill documents | 9 |
| RKC (Tanaike) | Feb 2026 | Filesystem knowledge persistence | 12 |
| HyEvo | 2026 | Hybrid workflow evolution | 13 |

## Who This Is For

Engineers and researchers designing agents for long-running, hard tasks that must improve over time without model retraining. If you want to build agents that get measurably better after 20, 50, 100 deployments — with the same frozen model — this book is for you.
