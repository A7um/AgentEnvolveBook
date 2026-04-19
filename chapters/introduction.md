# Introduction

This book investigates one question: **how do top-tier production agents get better through use?**

Not in theory. Not in arxiv papers. In shipped products used by millions.

The agents covered in this book are not research prototypes. They are:

- **Claude Code** — Anthropic's coding agent (annualized $2.5B revenue as of March 2026)
- **Cursor** — The AI-first IDE (400M+ AI requests/day, $1B ARR)
- **OpenAI Codex** — Coding agent with memory, subagents, and plugins
- **Hermes Agent** — Nous Research's self-improving agent (99K+ GitHub stars)
- **OpenClaw** — The open-source personal AI agent (350K+ GitHub stars)
- **GitHub Copilot** — Microsoft's coding assistant with agentic memory
- **Gemini CLI** — Google's terminal agent with memory manager
- **Windsurf** — Codeium's Cascade agent with auto-generated memories
- **Devin** — Cognition's autonomous software engineer with self-verification
- **Manus** — The autonomous agent that hit $100M ARR in 9 months

Every one of these products has built self-evolution mechanisms. They differ in approach — some use filesystem persistence, some use memory databases, some use learned rules, some use skill libraries. But they all solve the same problem: an agent that doesn't learn is an agent that repeats the same mistakes forever.

This book extracts what they do, how they do it, and what you can steal for your own agents.

---

## The Evidence Standard

Every claim in this book traces to one of four sources:

1. **Leaked source code** — The Claude Code npm source map (March 2026) gave us 512K lines of the `SystemPromptBuilder`, memory discovery logic, compaction system, and anti-distillation countermeasures.

2. **Open-source repositories** — Hermes (`NousResearch/hermes-agent`, MIT license) and OpenClaw are fully readable. We cite file paths, function names, and line ranges.

3. **Official documentation and blog posts** — Cursor's engineering blog, Peak Ji's "Context Engineering for AI Agents" talk, OpenAI's Codex API docs, Devin's product updates, Windsurf's architecture posts.

4. **Shipped product behavior** — Observable, reproducible behavior in production systems. When we can't read the source, we say so and describe what we observed.

What we do **not** cite: academic papers that haven't shipped. Taxonomies proposed from first principles. Speculation about what agents *could* do. Conference posters. Survey papers.

We are transparent about access level because it determines confidence level:

| System | Primary Source | Confidence |
|--------|---------------|-----------|
| Claude Code | Full client source (512K lines TS) | Code-level |
| Hermes | Full source (MIT, GitHub) | Code-level |
| OpenClaw / ClawHub | Full source + marketplace | Code-level |
| Cursor | Engineering blog + open-source Priompt | Architecture-level |
| Manus | Blog posts + public talks | Architecture-level |
| Codex | API docs + open-source CLI | API + CLI source |
| Copilot | Product docs + observable behavior | External observation |
| Gemini CLI | Official docs + CLI source | Docs + CLI source |
| Windsurf | Product docs + observable behavior | External observation |
| Devin | Blog posts + product observation | External observation |

---

## What This Book Is Not

- **Not a survey of academic papers.** Papers are cited only when they directly influenced a shipped product.
- **Not a tutorial on building agents from scratch.** You should already know what an agent loop is.
- **Not a framework comparison chart.** We go deep into mechanisms, not feature lists.

---

## How to Read

Each chapter covers one production system in depth. Read the systems that matter to you. Chapter 11 synthesizes patterns across all systems into a playbook you can apply.

**Part I** (Chapters 1–4): The landscape and the three deepest systems — Claude Code, Cursor, Hermes. Start here.

**Part II** (Chapters 5–7): The skills ecosystem — OpenClaw, ClawHub, SkillHub, and the design patterns that make skills work.

**Part III** (Chapters 8–10): Three different philosophies — Manus (context engineering), Codex (compaction), Devin (self-verification).

**Part IV** (Chapters 11–12): A production playbook synthesizing all ten systems, plus open problems.

Each chapter is self-contained. But Chapter 1 provides the comparative framework the rest builds on.

---

## Conventions

- **Code blocks** contain actual source code or configuration extracted from production systems. Not pseudocode unless explicitly labeled.
- `monospace` marks file paths, function names, config keys, and CLI commands.
- **Bold** marks key concepts on first introduction.
- *Italics* mark direct quotes from source code comments or documentation.
- When we quote source code, we cite the file path within the original repository.

---

Let's begin.
