# The Self-Evolving Agent

**How top-tier production agents actually get better through use.**

Extracted from shipped products, leaked source code, open repos, and the ClawHub skill ecosystem — not academic papers.

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

## Read the Book

This is an [mdBook](https://rust-lang.github.io/mdBook/). To build locally:

```bash
cargo install mdbook mdbook-mermaid
mdbook serve
```

Chapter markdown lives in [`chapters/`](chapters/introduction.md). The mdBook entry point is [`src/SUMMARY.md`](src/SUMMARY.md); each file under `src/` includes the matching chapter from `chapters/`.
