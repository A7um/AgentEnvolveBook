# The Self-Evolving Agent

**How top-tier production agents actually get better through use.**

> **[Read the book online →](https://a7um.github.io/AgentEnvolveBook/)** | **[阅读中文版 →](https://a7um.github.io/AgentEnvolveBook/zh/)**

Extracted from shipped products, leaked source code, open repos, and the ClawHub skill ecosystem — not academic papers.

## How to Read This Book

**[Introduction](chapters/introduction.md)** — Scope, audience, and how evidence is sourced

### Part I: How Production Agents Evolve

1. **[The Self-Evolution Landscape](chapters/01_landscape.md)** — Product map, five shared mechanisms, maturity spectrum
2. **[Claude Code](chapters/02_claude_code.md)** — Memory, skills, and leaked internals
3. **[Cursor](chapters/03_cursor.md)** — Merkle trees, embeddings, and rules
4. **[Hermes Agent](chapters/04_hermes.md)** — Closed-loop skill creation

### Part II: The Skills Ecosystem

5. **[OpenClaw / ClawHub](chapters/05_openclaw.md)** — The self-improving-agent skill and marketplace signals
6. **[SkillHub](chapters/06_skillhub.md)** — The Chinese ecosystem
7. **[Skill Design Patterns](chapters/07_skill_patterns.md)** — Patterns that enable evolution

### Part III: Deep Dives

8. **[Manus](chapters/08_manus.md)** — Context engineering as evolution
9. **[Codex](chapters/09_codex.md)** — Subagents and compaction
10. **[Devin](chapters/10_devin.md)** — Self-verification and context anxiety

### Part IV: Synthesis

11. **[The Production Self-Evolution Playbook](chapters/11_playbook.md)**
12. **[Open Problems and What's Next](chapters/12_future.md)**

## Products Covered

| Product | Self-Evolution Mechanism | Evidence Source |
|---------|------------------------|----------------|
| Claude Code | CLAUDE.md + auto memory + skills | Leaked 512K-line source (March 2026) |
| Cursor | Continual-learning plugin + Bugbot learned rules (52% → 78%) | Official blog + open-source plugin |
| Hermes Agent | Autonomous SKILL.md creation + Honcho user modeling | Open source (99K+ stars) |
| OpenClaw | proactive-agent (145K downloads) + capability-evolver + self-improving-agent | ClawHub marketplace data |
| Codex | AGENTS.md + memory preview + compaction | Official docs + open-source CLI |
| Gemini CLI | GEMINI.md + experimental memory manager subagent | Open source + PRs |
| Windsurf | Auto-generated memories + rules system | Official docs |
| Copilot | Agentic memory with code citations | GitHub Docs |
| Devin | Self-verification + auto-fix (2.2) + DeepWiki | Official blog |
| Manus | Context engineering iteration ("Stochastic Graduate Descent") | Published blog posts |

## Multi-Language Support

The book is available in **English** and **Chinese (简体中文)**. A language switcher in the top-right corner of each page allows one-click toggling between languages.

| Language | Source Chapters | Source TOC | Config |
|----------|----------------|-----------|--------|
| English | `chapters/` | `src/SUMMARY.md` | `book.toml` |
| 简体中文 | `chapters-zh/` | `src-zh/SUMMARY.md` | `book-zh.toml` |

## Build locally

This is an [mdBook](https://rust-lang.github.io/mdBook/). Chapter source lives under [`chapters/`](chapters/introduction.md); [`src/SUMMARY.md`](src/SUMMARY.md) is the table of contents.

```bash
cargo install mdbook mdbook-mermaid

# Build English
mdbook serve

# Build Chinese
mdbook serve book-zh.toml --dest-dir book/zh
```

To build both for deployment:

```bash
mdbook build
mdbook build book-zh.toml --dest-dir book/zh
```

See **[UPDATE_GUIDE.md](UPDATE_GUIDE.md)** for layout details and how to add chapters.
