# AGENTS.md

## Cursor Cloud specific instructions

This is a **mdBook** project. The only build dependency is `mdbook`.

### Structure
- `book.toml` — mdBook configuration
- `src/SUMMARY.md` — Table of contents (defines chapter order)
- `src/*.md` — Chapter files (12 chapters across 4 parts)
- `_book/` — Build output (gitignored)

### Build & Preview
- Build: `mdbook build` (output to `_book/`)
- Live preview: `mdbook serve` (serves at `http://localhost:3000`)
- `book.toml` has `create-missing = false` — every file referenced in `SUMMARY.md` must exist or the build fails. Create stub files for missing chapters if needed.

### Writing style
- Follow the style of the AgentMemoryBook (https://github.com/A7um/AgentMemoryBook): production-focused, evidence from real systems, direct quotes, ASCII diagrams, tables.
- Target 400-700 lines per chapter.
