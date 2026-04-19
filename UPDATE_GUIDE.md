# Updating this book

## Layout

- **`chapters/`** — Canonical chapter markdown. Edit these files.
- **`src/`** — mdBook glue: `SUMMARY.md` plus thin wrappers that `{{#include}}` each chapter from `chapters/`.
- **`research/`** — Notes that are not part of the built book (changelog, trends).

## Add or rename a chapter

1. Add or move the markdown file under `chapters/`.
2. Add a matching one-line wrapper in `src/` with `{{#include ../chapters/your_file.md}}`.
3. Link it from `src/SUMMARY.md`.

The GitHub "edit" button in the built site opens the thin `src/*.md` wrapper. Replace the body by editing the matching file under `chapters/` instead.

## Build locally

Install [mdBook](https://github.com/rust-lang/mdBook) and [mdbook-mermaid](https://github.com/badboy/mdbook-mermaid) (for example `cargo install mdbook mdbook-mermaid`), then run `mdbook build` or `mdbook serve` from the repository root. Current mdBook releases may require a recent Rust toolchain; pin an older mdBook in `cargo install` if your compiler is behind.
