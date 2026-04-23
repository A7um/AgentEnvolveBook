#!/usr/bin/env bash
set -euo pipefail

# Build English book (default)
mdbook build

# Build Chinese book using book-zh.toml as a temporary override
cp book.toml book.toml.bak
cp book-zh.toml book.toml
mdbook build --dest-dir book/zh
mv book.toml.bak book.toml
