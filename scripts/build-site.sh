#!/bin/sh
# Copies the extension's export code and icons into site/ so the landing
# page's live demo runs the same code as the extension.
set -eu
cd "$(dirname "$0")/.."
mkdir -p site/lib site/assets
cp src/content/parsers.js src/shared/markdown.js site/lib/
cp icons/icon32.png icons/icon128.png site/assets/
