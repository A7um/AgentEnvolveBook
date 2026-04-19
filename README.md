# AgentEnvolveBook

## The Self-Evolving Agent: How AI Agents Get Better Through Use

A deeply technical book (15 chapters, ~8,200 lines) on **runtime self-evolution** — how AI agents improve through use without model retraining. Every chapter covers mechanisms that operate on a frozen LLM backbone: the model never changes, but external memory, skills, heuristics, and knowledge evolve with experience.

### Read the Book

Start here: **[book/README.md](book/README.md)**

### Structure

| Part | Chapters | What Evolves |
|------|----------|-------------|
| **I. Foundations** | 1-2 | Taxonomy of 20+ mechanisms, Reflexion/ExpeL/ERL/AutoGuide |
| **II. Memory** | 3-6 | MemRL Q-values, RetroAgent SimUtil-UCB, Memento-II theory, Honcho user modeling |
| **III. Skills** | 7-11 | Voyager code skills, SkillWeaver APIs, Hermes SKILL.md, AgentFactory subagents, ASG-SI graphs |
| **IV. Crystallization** | 12-15 | OpenClaw self-improving-agent, OPRO/ADAS/HyEvo, LATS planning, open problems |

### Key Papers Covered (with full algorithms)

Reflexion (NeurIPS 2023), ExpeL (AAAI 2024), Voyager (TMLR 2024), CoALA (TMLR 2024), AutoGuide (NeurIPS 2024), LATS (ICML 2024), ASG-SI (arXiv 2025), Memento-II (arXiv 2025), MemRL (arXiv 2026), SkillWeaver (arXiv 2025), ERL (ICLR 2026), RetroAgent (arXiv 2026), AgentFactory (arXiv 2026), ADAS (ICLR 2025), Hermes Agent (2026), RKC (2026)

### Who This Is For

Engineers designing agents for long-running, hard tasks that must get measurably better over time — without ever retraining the model.
