# Bytecode Extraction (bytecode-extract branch)

Extracts deobfuscated source from TrendAura v3.4.0 `.jsc` V8 bytecode files using
Windows x64 Electron 28 via GitHub Actions free runners.

## Process

1. The `.jsc` files (240KB total) are included in this branch
2. GitHub Actions `windows-latest` runner installs Electron 28 + bytenode
3. `ELECTRON_RUN_AS_NODE=1 electron scripts/extract-bytecode.cjs` loads each `.jsc` file
4. Windows x64 native V8 should accept the bytecode (unlike macOS arm64)
5. Each loaded module's exports are called with test candle data
6. Results (function outputs + source previews) are saved as JSON artifacts

## Trigger

- Go to Actions → Extract Deobfuscated Source → Run workflow
- Or push to this branch

## Output

Download the `extracted-bytecode` artifact from the completed workflow run.
