#!/usr/bin/env bash
# Build the Claude Desktop extension bundle (MCPB) for the Voice MCP.
# Output: build/crixin-voice-<version>.mcpb  (build/ is gitignored)
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./package.json').version")
STAGE=build/mcpb
rm -rf "$STAGE" && mkdir -p "$STAGE"
npm run build >/dev/null
cp -R bin dist LICENSE README.md package.json manifest.json "$STAGE"/
[ -f icon.png ] && cp icon.png "$STAGE"/
( cd "$STAGE" && npm install --omit=dev --ignore-scripts --no-audit --no-fund >/dev/null )
npx -y @anthropic-ai/mcpb validate "$STAGE/manifest.json"
npx -y @anthropic-ai/mcpb pack "$STAGE" "build/crixin-voice-$VERSION.mcpb"
ls -la "build/crixin-voice-$VERSION.mcpb"
