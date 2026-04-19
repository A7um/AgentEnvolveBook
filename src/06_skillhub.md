# SkillHub and the Chinese Ecosystem

The agentskills.io standard created an interoperable skill format. ClawHub hosts 13K+ skills for the global market. But in China, a parallel ecosystem has formed around the same format — with its own distribution, its own curation, and its own top skills.

---

## SkillHub.cn / SkillHub.mobi

Tencent's localized skills platform for Chinese OpenClaw users. Not a fork — a mirror with infrastructure and curation optimized for the Chinese market.

**What it is:**
- Mirrors 13K+ ClawHub skills with Tencent Cloud CDN acceleration
- Full Chinese interface (skill descriptions, documentation, installation instructions)
- 8 categories: Social Media, Development, Productivity, Research, Privacy, Office, Entertainment, System
- Curated Top 50 list — each skill manually safety-audited by Tencent's review team
- Free. One-click installation via the OpenClaw client

**What it isn't:**
- Not a separate skill format. Same SKILL.md standard, same installation mechanism
- Not a walled garden. Skills installed from SkillHub.cn work identically to ClawHub-sourced skills
- Not required. Chinese users can still install directly from ClawHub

The value proposition is speed (Tencent Cloud vs. GitHub/npm CDN from China) and trust (safety audit for the Top 50).

---

## Top Downloads (Q1 2026)

| Rank | Skill | Downloads | Category |
|------|-------|-----------|----------|
| 1 | Xiaohongshu Automation | 59K | Social Media |
| 2 | GitHub Collaboration | 48K | Development |
| 3 | Summarize | 44K | Productivity |
| 4 | Tavily Web Search | 39K | Research |
| 5 | HaS Anonymizer | 31K | Privacy |
| 6 | Tencent Docs | 27K | Office |

The top skill is a Xiaohongshu (Little Red Book) automation skill — content scheduling, engagement tracking, cross-posting. This tells you something about the user base: Chinese OpenClaw adoption is driven heavily by content creators and social media professionals, not just developers.

GitHub Collaboration at #2 confirms the developer base exists but coexists with a broader non-technical audience. The Summarize and Tavily Web Search skills are the same global skills, just localized and CDN-accelerated.

HaS Anonymizer at #5 (privacy category, 31K downloads) reflects a specific Chinese market need — anonymizing content before sharing across platforms with different moderation policies.

Tencent Docs integration at #6 is the Tencent-specific play: deep integration with Tencent's productivity suite, equivalent to what a Google Docs skill would be for Western users.

---

## The Skills Ecosystem Structure

### The agentskills.io Standard

The same SKILL.md format used by Hermes, OpenClaw, and Claude Code. One skill, three platforms:

```
SKILL.md (agentskills.io format)
     │
     ├── Hermes Agent: ~/.hermes/skills/
     ├── OpenClaw: installed via ClawHub / SkillHub
     └── Claude Code: referenced in CLAUDE.md or .claude/skills/
```

### Installation

Two package registries, same skills:

```bash
# From ClawHub (global)
npx skillhub install [skill-name]

# Alternative registry
npx agent-skills-hub install [skill-name]

# From SkillHub.cn (Tencent-accelerated)
# Same command — the OpenClaw client resolves the source
# based on user's configured registry
```

### Cross-Platform Compatibility

Skills are agent-agnostic by design. A skill installed via SkillHub.cn for OpenClaw can be manually copied into a Hermes `~/.hermes/skills/` directory or referenced from a Claude Code `CLAUDE.md`. The YAML frontmatter may include agent-specific metadata blocks (`metadata.hermes`, `metadata.openclaw`), but the core sections (When to Use, Procedure, Pitfalls, Verification) are universal.

---

## iflytek/SkillHub (Enterprise)

iFlytek (科大讯飞), the Chinese AI and speech technology company, ships a self-hosted skills platform for enterprise deployments. Different product, same name pattern.

### What It Is

- Self-hosted platform deployed via Docker or Kubernetes
- Designed for organizations that need private skill registries
- Built in Java (backend) + TypeScript (frontend)
- Current version: v0.2.3 (April 2026)

### Enterprise Features

| Feature | Implementation |
|---------|---------------|
| **RBAC** | Role-based access control — admin, editor, viewer roles per namespace |
| **Namespaces** | Organize skills by team, project, or department |
| **Versioning** | Semantic versioning with rollback support |
| **Audit logging** | Every install, update, and deletion logged with user identity and timestamp |
| **Private registry** | Skills never leave the organization's infrastructure |

### Deployment

```yaml
# Docker Compose (minimal)
services:
  skillhub-api:
    image: iflytek/skillhub-api:0.2.3
    ports: ["8080:8080"]
    environment:
      - DB_URL=jdbc:postgresql://db:5432/skillhub
      - AUTH_PROVIDER=ldap

  skillhub-web:
    image: iflytek/skillhub-web:0.2.3
    ports: ["3000:3000"]

  db:
    image: postgres:16
```

### Enterprise vs. Community

| | ClawHub / SkillHub.cn | iflytek/SkillHub |
|---|---|---|
| **Hosting** | Cloud (GitHub/npm / Tencent Cloud) | Self-hosted (Docker/K8s) |
| **Access control** | Public | RBAC with namespaces |
| **Skill source** | Community-contributed | Organization-internal + curated imports |
| **Audit** | Download counts only | Full audit trail |
| **Cost** | Free | Open-source, self-hosted infra costs |
| **Use case** | Individual users, open-source projects | Enterprises with compliance requirements |

The enterprise version exists because large Chinese companies need private skill registries with access control and audit trails. The agentskills.io format is the same — iflytek/SkillHub just wraps it in enterprise infrastructure.

---

## Ecosystem Map

```
agentskills.io (format standard)
     │
     ├── ClawHub (global marketplace, 13K+ skills, 1.5M+ downloads)
     │     └── SkillHub.cn (Tencent mirror, CDN-accelerated, safety-audited Top 50)
     │
     ├── Hermes Agent (built-in skill creation + external skill import)
     │
     ├── Claude Code (CLAUDE.md + .claude/skills/ integration)
     │
     └── iflytek/SkillHub (enterprise self-hosted registry)
```

The convergence on a single skill format across Hermes, OpenClaw, Claude Code, and enterprise platforms is the structural story. Skills are portable. The ecosystem competes on distribution, curation, and trust — not on format.
