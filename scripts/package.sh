#!/bin/sh
# Builds dist/chatdown-<version>.zip containing a top-level chatdown/ folder,
# ready for chrome://extensions → Load unpacked.
set -eu
cd "$(dirname "$0")/.."
version=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' manifest.json | head -1)
rm -rf dist && mkdir -p dist/chatdown
cp -R manifest.json src icons LICENSE dist/chatdown/
(cd dist && zip -qr "chatdown-$version.zip" chatdown -x '*.DS_Store')
echo "dist/chatdown-$version.zip"
