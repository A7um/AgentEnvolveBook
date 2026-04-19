# Chapter 6: SkillHub and the Chinese Ecosystem

## Overview

The Chinese AI skills ecosystem around OpenClaw is a parallel universe to the English-language ClawHub. It has its own community platforms (SkillHub.cn, SkillHub.mobi), its own infrastructure (Tencent Cloud mirrors), its own top skills (Xiaohongshu automation, Tencent Docs), and its own enterprise registries (iflytek/SkillHub). This chapter maps the ecosystem and analyzes what it tells us about how agent skills — and agent self-evolution — scale across cultures and use cases.

The Chinese ecosystem is not a translation of the English one. It is a distinct community with distinct priorities, driven by different platforms (WeChat instead of Slack, Xiaohongshu instead of Twitter, Tencent Docs instead of Google Docs) and different deployment constraints (China's network environment, regulatory landscape, and enterprise software market).

## SkillHub.mobi — The Official Chinese Community

SkillHub.mobi is the official Chinese-language community portal for OpenClaw skills. It provides a full Chinese interface with localized search, curated collections, and one-click installation — addressing the friction that Chinese-speaking users face when navigating the English-language ClawHub.

### Interface and Search

The platform offers a complete Chinese-language experience:

- Full Chinese interface for browsing and searching skills
- Optimized search that handles Chinese text segmentation (critical for search quality in CJK languages, where word boundaries are implicit)
- Skill descriptions, documentation, and reviews all in Chinese
- Integration with Chinese developer platforms (Gitee, CSDN, Juejin)

### Eight Major Skill Categories

SkillHub.mobi organizes skills into eight top-level categories, reflecting the priorities of its user base:

| Category | Chinese Name | Description | Skill Count |
|----------|-------------|-------------|-------------|
| **Social Media** | 社交媒体 | Xiaohongshu, Weibo, Douyin automation | 1,200+ |
| **Development** | 开发工具 | GitHub, GitLab, code review, CI/CD | 1,800+ |
| **Productivity** | 效率工具 | Summarization, scheduling, task management | 1,100+ |
| **Research** | 学术研究 | Paper search, citation management, literature review | 600+ |
| **Office** | 办公协作 | Tencent Docs, WPS, Feishu integration | 500+ |
| **Privacy** | 隐私安全 | Data anonymization, PII detection, compliance | 300+ |
| **Creative** | 创意设计 | Image generation, copywriting, content creation | 700+ |
| **Meta** | 元技能 | Self-improvement, skill composition, introspection | 150+ |

The "Social Media" category is notably larger on SkillHub.mobi than on the English ClawHub. Xiaohongshu (Little Red Book) automation alone accounts for hundreds of skills — a reflection of the platform's central role in Chinese e-commerce and influencer marketing.

### The Curated Top 50

SkillHub.mobi maintains a "Top 50" list — a curated selection of skills that have passed additional quality and safety review. Unlike the raw download rankings, the Top 50 is manually selected by a review committee:

**Selection criteria:**

1. **Safety audit** — Skills must pass a security review that checks for data exfiltration, unauthorized file access, and excessive permissions
2. **Quality assessment** — Skills must have clear documentation, handle edge cases, and produce consistent results across different models
3. **Professional curation** — A human review committee evaluates skills for relevance, originality, and community impact
4. **Maintenance commitment** — Skills must have an active maintainer who responds to issues within 7 days

The Top 50 is refreshed monthly. Skills that fall below quality standards or lose their maintainer are removed and replaced.

### One-Click Installation

SkillHub.mobi integrates directly with the OpenClaw CLI for frictionless installation:

```bash
# Install from SkillHub.mobi (resolves to Chinese mirror)
openclaw skill install skillhub:xiaohongshu-automation

# Install with specific version
openclaw skill install skillhub:tencent-docs@2.1.0

# Browse Top 50
openclaw skill browse --source skillhub --top50
```

The CLI detects the user's locale and routes to the appropriate mirror automatically. Chinese users get faster downloads via Tencent Cloud CDN nodes, while the skill metadata is identical to what is on ClawHub.

## Tencent's Involvement

Tencent has become the most significant corporate contributor to the Chinese OpenClaw ecosystem, with involvement spanning infrastructure, skill development, and community building.

### Domestic Mirror Acceleration

China's network environment creates significant friction for accessing international services. ClawHub, hosted on GitHub-adjacent infrastructure, suffers from slow and unreliable access within mainland China. Tencent addresses this with a domestic mirror:

**Architecture:**

```
┌───────────────┐          ┌──────────────────────┐
│  ClawHub      │          │  Tencent Cloud CDN   │
│  (GitHub)     │  sync    │                      │
│               │─────────▶│  Shanghai node       │
│  13K+ skills  │  (daily) │  Beijing node        │
│               │          │  Shenzhen node        │
│               │          │  Chengdu node         │
└───────────────┘          │  Guangzhou node       │
                           │                      │
                           │  ~50ms latency       │
                           │  (vs ~2-5s direct)   │
                           └──────────┬───────────┘
                                      │
                                      ▼
                           ┌──────────────────────┐
                           │  Chinese developers   │
                           │  (fast, reliable      │
                           │   skill downloads)    │
                           └──────────────────────┘
```

The mirror syncs daily with ClawHub, pulling new and updated skills. Downloads that previously took 2-5 seconds (when they completed at all) now complete in ~50ms from the nearest Tencent Cloud edge node.

**Impact:**

- Download success rate: from ~70% (direct) to 99.5%+ (mirrored)
- Average download time: from 2-5 seconds to ~50ms
- Eliminated timeout-related installation failures
- Enabled reliable CI/CD pipelines that depend on skill installation

### Tencent Docs Skill: The Showcase Integration

Tencent's most visible contribution is the official Tencent Docs skill — a deep integration between OpenClaw agents and Tencent's collaborative document platform (the Chinese equivalent of Google Docs).

**Capabilities:**

| Feature | Description |
|---------|-------------|
| Document creation | Create new docs from agent conversations |
| Content extraction | Read and parse Tencent Docs content |
| Collaborative editing | Agent writes to shared documents in real-time |
| Template support | Fill in document templates with structured data |
| Permission management | Set sharing permissions programmatically |
| Comment integration | Read and respond to document comments |
| Version history | Access and compare document versions |

The Tencent Docs skill demonstrates a pattern we see throughout the Chinese ecosystem: **platform integration as a first-class skill category**. Where the English ecosystem emphasizes developer tools (GitHub, CI/CD), the Chinese ecosystem emphasizes office productivity (Tencent Docs, Feishu/Lark, WPS Office) and social media (Xiaohongshu, Weibo).

### Tencent's Strategic Position

Tencent's involvement is not philanthropy. By providing infrastructure for the Chinese OpenClaw ecosystem, Tencent:

1. **Drives adoption of Tencent Cloud** — Skills that depend on Tencent infrastructure create lock-in
2. **Promotes Tencent APIs** — The Tencent Docs skill is a showcase for the Tencent Docs API
3. **Builds AI ecosystem gravity** — Developers who build skills on Tencent infrastructure stay in the Tencent ecosystem
4. **Gathers intelligence** — Skill download metrics reveal what users want agents to do, informing product strategy

## Top Downloaded Skills (Q1 2026)

The download rankings reveal what the Chinese developer community actually uses OpenClaw for — and the answer is more pragmatic than the English-language discourse about AGI and self-evolution might suggest.

### Full Rankings Table

| Rank | Skill | Downloads (Q1 2026) | Category | Primary Use Case | Self-Evolution? |
|------|-------|---------------------|----------|-----------------|----------------|
| 1 | Xiaohongshu Automation | 59,000 | Social Media | Product reviews, influencer content | No |
| 2 | GitHub Collaboration | 48,000 | Development | PR reviews, issue triage, code search | No |
| 3 | Summarize | 44,000 | Productivity | Meeting notes, article summaries | No |
| 4 | Tavily Web Search | 39,000 | Research | Real-time web research | No |
| 5 | HaS Anonymizer | 31,000 | Privacy | PII redaction, data anonymization | No |
| 6 | Tencent Docs | 27,000 | Office | Document creation and management | No |
| 7 | Academic Deep Research | 24,000 | Research | Literature review, citation analysis | No |
| 8 | Feishu Integration | 22,000 | Office | Lark/Feishu bot, notifications | No |
| 9 | Douyin Content | 19,000 | Social Media | Short video script generation | No |
| 10 | Code Review Pro | 17,000 | Development | Automated code review | No |
| 11 | Weibo Monitor | 15,000 | Social Media | Brand monitoring, trending analysis | No |
| 12 | WPS Office | 14,000 | Office | Document editing via WPS | No |
| 13 | DingTalk Bot | 12,000 | Office | Enterprise messaging automation | No |
| 14 | Translation Pro | 11,000 | Productivity | Multi-language translation | No |
| 15 | Notion Sync | 10,000 | Productivity | Bidirectional Notion integration | No |
| ... | ... | ... | ... | ... | ... |
| — | **self-improving-agent** | **90,000+** | **Meta** | **Agent self-evolution** | **Yes** |

### Analysis: The Meta Skill Anomaly

The self-improving-agent skill is the most downloaded skill in the entire ecosystem — 90,000+ downloads — yet it does not appear in the standard category rankings. It is categorized separately as a "Meta" skill, because it operates at a different level than task-specific skills.

This creates an interesting phenomenon:

```
Standard ranking (by category):
  #1: Xiaohongshu Automation    (59K)  — does a specific task
  #2: GitHub Collaboration      (48K)  — does a specific task
  #3: Summarize                 (44K)  — does a specific task

Cross-category ranking (absolute):
  #1: self-improving-agent      (90K+) — improves how the agent does ALL tasks
```

The self-improving-agent is the most downloaded because it is the most general. Every other skill targets a specific use case — Xiaohongshu, GitHub, summarization. The self-improving-agent targets *the agent itself*. Its value compounds with every other skill installed, because a better agent uses every skill better.

**Why it is categorized separately:**

1. **Different risk profile** — Meta skills modify agent behavior; task skills do not
2. **Different evaluation criteria** — A Xiaohongshu skill can be tested by checking if it posts correctly; a self-evolution skill can only be tested by observing long-term behavioral improvement
3. **Different trust model** — Users trust a summarization skill with their documents; a meta skill requires trust with the agent's entire behavioral model
4. **Different update cadence** — Task skills update when their target platform changes; meta skills update when agent architectures change

### Download Distribution Analysis

The download numbers reveal a long-tail distribution:

```
Downloads (K)
90K+ │ ████████████████████████████████████████  self-improving-agent (Meta)
     │
59K  │ ██████████████████████████               Xiaohongshu
48K  │ █████████████████████                    GitHub
44K  │ ████████████████████                     Summarize
39K  │ █████████████████                        Tavily Search
31K  │ ██████████████                           Anonymizer
27K  │ ████████████                             Tencent Docs
24K  │ ██████████                               Academic Research
22K  │ █████████                                Feishu
19K  │ ████████                                 Douyin
17K  │ ███████                                  Code Review
15K  │ ██████                                   Weibo
14K  │ ██████                                   WPS
12K  │ █████                                    DingTalk
11K  │ ████                                     Translation
10K  │ ████                                     Notion
     └──────────────────────────────────────────
```

The top 16 skills account for roughly 500K downloads. The remaining 13,000+ skills share a long tail. This is the classic power-law distribution seen in every software ecosystem — npm, PyPI, Chrome extensions — but with one anomaly: the #1 skill by absolute downloads is a meta skill, not a task skill.

## iflytek/SkillHub — The Enterprise Registry

iFlytek (科大讯飞), the Chinese AI company known for its speech recognition technology, has built an enterprise-grade skill registry: `iflytek/SkillHub`. This is not a community marketplace like SkillHub.mobi — it is a self-hosted platform for organizations that need to manage agent skills with enterprise controls.

### Architecture

```
┌──────────────────────────────────────────────────────┐
│              iflytek/SkillHub                          │
│              Enterprise Registry                       │
│                                                      │
│  ┌────────────┐  ┌────────────┐  ┌────────────────┐  │
│  │ Java        │  │ TypeScript │  │ Infrastructure │  │
│  │ Backend     │  │ Frontend   │  │                │  │
│  │ (67.3%)     │  │ (29.8%)    │  │ Docker         │  │
│  │             │  │            │  │ Kubernetes     │  │
│  │ - REST API  │  │ - React    │  │ Helm charts    │  │
│  │ - RBAC      │  │ - Skill    │  │                │  │
│  │ - Audit log │  │   browser  │  │ PostgreSQL     │  │
│  │ - Versioning│  │ - Admin    │  │ Redis          │  │
│  │ - Namespace │  │   console  │  │ MinIO (S3)     │  │
│  └────────────┘  └────────────┘  └────────────────┘  │
│                                                      │
│  Latest release: v0.2.3 (April 2026)                 │
└──────────────────────────────────────────────────────┘
```

### Enterprise Features

| Feature | Description | Why It Matters |
|---------|-------------|---------------|
| **RBAC Permissions** | Role-based access control for skills | Different teams see different skills |
| **Namespace Organization** | Skills organized by team/project/domain | Prevents naming conflicts, enables scoping |
| **Skill Versioning** | Semantic versioning with rollback | Pinned versions for production agents |
| **Audit Logging** | Full history of skill installs, updates, removals | Compliance and incident investigation |
| **Approval Workflows** | Skills require approval before deployment | Prevents unauthorized behavior changes |
| **Dependency Tracking** | Skills can declare dependencies on other skills | Ensures compatible skill combinations |
| **Usage Analytics** | Download counts, activation rates, error rates per skill | Data-driven skill curation |
| **Private Registry** | Skills published internally, never exposed externally | IP protection |

### Technology Stack

The technology choices reflect iFlytek's enterprise DNA:

- **Java (67.3%)** — The backend is Java-based (Spring Boot), reflecting the dominance of Java in Chinese enterprise software
- **TypeScript (29.8%)** — The frontend is a React-based admin console and skill browser
- **Docker + Kubernetes** — Deployment via Docker containers orchestrated by Kubernetes, with Helm charts for configuration
- **PostgreSQL** — Skill metadata, user accounts, audit logs
- **Redis** — Caching, session management, rate limiting
- **MinIO** — S3-compatible object storage for skill assets

### Deployment Model

iflytek/SkillHub is designed for self-hosted deployment:

```bash
# Deploy with Helm (Kubernetes)
helm repo add skillhub https://registry.iflytek.com/charts
helm install skillhub skillhub/skillhub \
  --set postgresql.enabled=true \
  --set redis.enabled=true \
  --set minio.enabled=true \
  --namespace agent-platform

# Or deploy with Docker Compose (simpler)
docker compose -f docker-compose.enterprise.yml up -d
```

The self-hosted model addresses a critical concern for Chinese enterprises: **data sovereignty**. Skills may contain proprietary workflows, trade secrets, and internal processes. Hosting them on a third-party platform (even SkillHub.mobi) is unacceptable for many organizations. Self-hosted iflytek/SkillHub keeps everything within the organization's network boundary.

### Version History

| Version | Date | Key Changes |
|---------|------|-------------|
| v0.1.0 | Jan 2026 | Initial release: basic registry, CLI |
| v0.1.5 | Feb 2026 | Added RBAC, namespace support |
| v0.2.0 | Mar 2026 | Kubernetes deployment, audit logging |
| v0.2.1 | Mar 2026 | Approval workflows, dependency tracking |
| v0.2.2 | Apr 2026 | Usage analytics dashboard |
| v0.2.3 | Apr 2026 | Performance improvements, bug fixes |

The rapid release cadence (6 releases in 4 months) reflects the urgency of the market. Enterprises are adopting agent platforms faster than the tooling can mature.

## The Ecosystem Effect

The Chinese AI skills ecosystem illustrates a powerful dynamic: **collective evolution through shared skills**.

### Skills as Crystallized Experience

A skill is not just code. It is crystallized experience — the result of someone solving a problem, encoding the solution, and sharing it so others do not have to solve the same problem again.

```
One team's experience:
  Problem → Investigation → Solution → Encoding → SKILL.md

Shared across ecosystem:
  SKILL.md → ClawHub/SkillHub → 90,000 downloads
  → 90,000 agents improved → 90,000 teams benefit

This is the npm/PyPI model, but for agent behaviors.
```

The parallel to software package managers is instructive but incomplete:

| Dimension | npm/PyPI | ClawHub/SkillHub |
|-----------|---------|-----------------|
| What is shared | Code libraries | Agent behaviors |
| Installation | `npm install` | `openclaw skill install` |
| Unit of reuse | Functions, classes | Skills (trigger + procedure + pitfalls) |
| Composability | Import and call | Skills compose implicitly via agent reasoning |
| Versioning | Semantic versions | Semantic versions |
| Update mechanism | `npm update` | `openclaw skill update` |
| **Key difference** | Libraries execute deterministically | Skills guide probabilistic reasoning |

The key difference is in the last row. When you `npm install lodash`, you get deterministic functions. When you `openclaw skill install self-improving-agent`, you get instructions that the LLM interprets probabilistically. The same skill may produce different behaviors on different models, in different contexts, with different users.

This is both the power and the challenge of the skills ecosystem.

### The Collective Evolution Loop

The ecosystem creates a collective evolution loop that no single agent could achieve alone:

```
┌──────────────────────────────────────────────────┐
│                                                  │
│   Team A discovers                               │
│   a better deployment ─────▶ Encodes as          │
│   pattern                    SKILL.md            │
│                                  │               │
│                                  ▼               │
│                          Publishes to             │
│                          ClawHub/SkillHub         │
│                                  │               │
│                                  ▼               │
│                          90,000+ agents           │
│                          download and use         │
│                                  │               │
│                                  ▼               │
│   Teams B, C, D...       Discover edge cases,    │
│   find improvements ◀─── report issues,          │
│                          submit PRs              │
│                                  │               │
│                                  ▼               │
│                          Skill evolves           │
│                          (v1.0 → v1.1 → v2.0)   │
│                                  │               │
│                                  ▼               │
│                          All 90,000+ agents      │
│                          benefit from update     │
│                                                  │
└──────────────────────────────────────────────────┘
```

This loop accelerates as the ecosystem grows. More users mean more edge cases discovered, more improvements contributed, and more value for everyone. It is the open-source flywheel applied to agent behavior.

### Cross-Pollination Between Ecosystems

The Chinese and English ecosystems are not fully isolated. Skills flow between them:

1. **English → Chinese:** Popular English skills (Tavily Search, GitHub Collaboration) are translated and adapted for the Chinese market, often with platform-specific modifications (e.g., replacing GitHub API calls with Gitee API calls)
2. **Chinese → English:** Platform-specific Chinese skills (Xiaohongshu, Tencent Docs) occasionally get generalized versions published on ClawHub for global use
3. **Enterprise → Community:** Patterns developed in iflytek/SkillHub's enterprise environment (RBAC, versioning, audit) influence community platform features
4. **Community → Enterprise:** Popular community skills get hardened and adopted into enterprise registries after security review

### The Self-Evolution Amplifier

The self-improving-agent skill, discussed in detail in Chapter 5, acts as an amplifier for the entire ecosystem. An agent running self-improving-agent does not just use skills — it learns how to use them better:

1. **Discover** — The agent identifies a gap in its capabilities
2. **Search** — It finds a relevant skill on ClawHub/SkillHub
3. **Install** — It installs the skill
4. **Use** — It uses the skill to accomplish a task
5. **Evaluate** — It evaluates the outcome
6. **Improve** — It records gotchas and best practices in `.learnings/`
7. **Solidify** — Best practices are promoted to TOOLS.md or AGENTS.md

The result: the self-improving-agent skill generates *local* improvements (in the agent's workspace files) based on *global* shared skills (from the ecosystem). This is a two-level evolutionary process — the ecosystem evolves shared skills, and individual agents evolve their use of those skills.

### Implications

The Chinese AI skills ecosystem, with its parallel community platforms, enterprise registries, and corporate infrastructure, shows us what happens when the agent skills model scales to a large developer population:

1. **Localization matters** — The Chinese ecosystem is not a copy of the English one; it has its own priorities, platforms, and workflows
2. **Enterprise needs are different** — RBAC, audit trails, private registries, and approval workflows are required for enterprise adoption
3. **Infrastructure is a competitive advantage** — Tencent's mirror gives Chinese developers a better experience, which drives ecosystem growth
4. **Meta skills are the most valuable** — The self-improving-agent outperforms every task-specific skill in downloads, because it improves the agent for all tasks
5. **Skills are a new distribution channel** — Skills are how AI capabilities reach end users, similar to how apps are how mobile capabilities reach end users

The ecosystem is young — v0.2.3 of the enterprise registry, 4 months of existence — but it is growing fast enough that these patterns are already visible.

---

**Next: [Chapter 7 — Skill Design Patterns That Enable Evolution](07_skill_patterns.md)** — What makes the difference between a skill that evolves and one that stays static.
