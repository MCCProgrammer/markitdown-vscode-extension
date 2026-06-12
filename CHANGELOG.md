# Changelog

## [0.1.0] — 2026-06-12

### Initial release

- Converter panel with drag & drop from VS Code Explorer sidebar
- Right-click context menu entry for supported file types in the Explorer
- Batch conversion (drop multiple files at once)
- Token savings stats after every conversion — compares raw file content vs Markdown output
- For binary formats (PDF, DOCX, XLSX, PPTX), extracts plain text in the same Python call to give an honest before/after token comparison
- Auto-detects Python 3.10+ across common install locations (PATH, Homebrew, pyenv)
- Guided setup: offers to install `markitdown[all]` via pip if not present
- Custom output folder option
- Output modes: save next to original, open in editor, or ask
- Draggable result cards — drag `.md` output directly into an AI chat
- Copy Markdown to clipboard button
- Light / Dark / Auto theme for the converter panel
- Results pagination (last 10 shown, "show older" button)
- Cumulative session stats (total tokens saved across all conversions)
- Runs 100% locally — no internet connection, no API keys, no telemetry
