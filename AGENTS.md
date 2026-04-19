# AgentEnvolveBook

## Cursor Cloud specific instructions

This is an mdBook project. There are no application services or automated tests beyond building the book.

### Structure

- **`README.md`** — Overview and how to build.
- **`chapters/`** — Full chapter markdown (the source of truth for book content).
- **`src/`** — `SUMMARY.md` and small files that include each chapter from `chapters/` for mdBook.
- **`research/`** — Working notes not included in the site output.
- **`book.toml`**, **`book-zoom.css`**, **`book-zoom.js`**, **`mermaid-init.js`**, **`mermaid.min.js`** — mdBook and front-end assets.

### Development

- Build: `mdbook build` (requires `mdbook` and `mdbook-mermaid` on `PATH`).
- Serve: `mdbook serve` (live reload at localhost:3000).
