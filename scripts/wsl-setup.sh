#!/usr/bin/env bash
# WSL helper for the C:\ checkout: extract the LINUX native binaries next to
# the Windows ones so ONE node_modules works from both Windows and WSL.
# Each library picks its platform's binding at runtime; extras are harmless.
# A Windows `npm ci` wipes these — re-run this script (or the `bidwatch`
# alias, which runs it automatically) after any dependency change.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! grep -qi microsoft /proc/version 2>/dev/null; then
  echo "this script is for WSL (run it from the WSL tab)"; exit 1
fi
command -v node >/dev/null || { echo "node not on PATH (need the v24 symlinks in ~/.local/bin)"; exit 1; }

PAIRS=(
  "@esbuild/win32-x64 @esbuild/linux-x64"
  "@rolldown/binding-win32-x64-msvc @rolldown/binding-linux-x64-gnu"
  "@duckdb/node-bindings-win32-x64 @duckdb/node-bindings-linux-x64"
)

for pair in "${PAIRS[@]}"; do
  win="${pair%% *}"; lin="${pair##* }"
  if [ -d "node_modules/$lin" ]; then
    echo "ok:  $lin already present"
    continue
  fi
  if [ ! -d "node_modules/$win" ]; then
    echo "skip: $win not installed (run npm ci on the Windows side first)"; continue
  fi
  ver=$(node -e "console.log(require('./node_modules/$win/package.json').version)")
  echo "add:  $lin@$ver"
  mkdir -p "node_modules/$lin"
  curl -fsSL "https://registry.npmjs.org/$lin/-/${lin##*/}-$ver.tgz" \
    | tar -xz -C "node_modules/$lin" --strip-components=1
done

node -e "require('esbuild'); require('@duckdb/node-api'); require('rolldown')" \
  && echo "linux binaries ready — npm/npx now work here from WSL" \
  || { echo "verification failed"; exit 1; }
