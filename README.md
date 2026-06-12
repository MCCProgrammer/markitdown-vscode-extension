# MarkItDown Converter for VS Code

Convert PDF, DOCX, XLSX, PPTX, HTML, images, audio and more into clean Markdown — right from the file explorer — using Microsoft's [MarkItDown](https://github.com/microsoft/markitdown) Python library. Shows token counts so you know exactly how much context-window space you're spending (or saving) before pasting into an AI.

## Features

- **Right-click → "MarkItDown: Convert to Markdown"** on any supported file in the Explorer
- Command palette support (`MarkItDown: Convert to Markdown`) with a file picker fallback
- Output **next to the original file** (`report.pdf` → `report.md`, never silently overwrites) or **in a new editor tab** — configurable
- **Token stats** after every conversion. For text formats (HTML, XML, CSV, JSON) you get an honest before/after: `12,430 → 3,180 tokens (74% saved)`. For binary formats (PDF, DOCX) you get the markdown's token count.
- **Guided setup**: detects Python, offers to `pip install "markitdown[all]"` for you if it's missing

## Requirements

- **Python 3.10+** on your PATH (or set `markitdown.pythonPath` in settings)
- The `markitdown` package — the extension offers to install it on first use

Run **`MarkItDown: Check Setup`** from the command palette to verify everything.

## Settings

| Setting | Default | Description |
|---|---|---|
| `markitdown.pythonPath` | *(auto-detect)* | Path to your Python executable |
| `markitdown.outputMode` | `sameFolder` | `sameFolder`, `openInEditor`, or `ask` |
| `markitdown.showTokenStats` | `true` | Show token counts after conversion |

## Development

```bash
npm install
npm run compile
# Press F5 in VS Code to launch the Extension Development Host
```

## Publishing to the Marketplace

1. Create a publisher at https://marketplace.visualstudio.com/manage (needs an Azure DevOps Personal Access Token with "Marketplace → Manage" scope)
2. Replace `"publisher": "your-publisher-id"` in `package.json` with your real publisher ID, and add a 128×128 `icon.png` + `"icon": "icon.png"` entry
3. Then:

```bash
npm install -g @vscode/vsce
vsce package          # produces markitdown-converter-0.1.0.vsix — test it via "Install from VSIX"
vsce publish          # publishes to the Marketplace
```

## How it works

The extension spawns `python -m markitdown <file>` in your local Python environment and captures the Markdown from stdout. Your files **never leave your machine**. Token counts are computed locally with [gpt-tokenizer](https://www.npmjs.com/package/gpt-tokenizer).

## Attribution & license

MIT. This extension is an independent wrapper around [microsoft/markitdown](https://github.com/microsoft/markitdown) (MIT licensed, © Microsoft Corporation). Not affiliated with or endorsed by Microsoft.
