# Changelog

## [0.1.0] — 2026-06-13

### Initial release

**Converter panel**
- Drag & drop files from the VS Code Explorer sidebar into the converter panel
- Right-click any supported file in the Explorer to convert it instantly
- Batch conversion — drop multiple files at once
- Choose files via file picker button
- Results show the output `.md` filename (not the original)

**Token stats**
- Token savings shown after every conversion — compares raw source vs Markdown output
- For binary formats (PDF, DOCX, XLSX, PPTX) extracts plain text in the same Python call for an honest before/after comparison
- When Markdown is larger than the source, shows "Markdown helps with AI structure" instead of confusing negative numbers
- All-time cumulative stats card (files converted, total tokens saved)

**Output & files**
- Save next to the original file, open in a new editor tab, or ask every time (`markitdown.outputMode`)
- Custom output folder — send all Markdown files to one place
- Delete button on result cards (two-step confirmation: "Sure?")
- Copy to clipboard button — always visible, one click

**AI chat integration**
- Drag a result card to VS Code editor tabs or AI chat panels
- Dragging auto-copies Markdown to clipboard as fallback — paste with Cmd+V / Ctrl+V
- "Reveal in Explorer ↗" link — highlights the `.md` in the VS Code sidebar so it can be dragged into any VS Code AI chat panel (Copilot Chat, Claude Code, Continue…)
- "Show in folder" link — opens OS Finder/Explorer for native file drag to any app

**Setup**
- Auto-detects Python 3.10+ across common locations in parallel (fast, no hanging)
- Guided install: offers to run `pip install markitdown[all]` if the package is missing
- Setup card collapses automatically once Python + MarkItDown are ready

**Settings**
- `markitdown.pythonPath` — custom Python executable path
- `markitdown.outputMode` — `sameFolder` / `openInEditor` / `ask`
- `markitdown.showTokenStats` — toggle token stats display
- `markitdown.panelColumn` — open panel `beside` the current editor (default) or in the `active` column

**Theme**
- Light / Dark / Auto theme picker in the panel settings section

**Privacy**
- Runs 100% locally — no internet connection, no API keys, no telemetry
- Token counting uses [gpt-tokenizer](https://github.com/niieani/gpt-tokenizer) — local OpenAI-compatible tokenizer
