# Markify — Document to AI-Ready Markdown

Convert **PDF, DOCX, XLSX, PPTX, HTML, images, audio, and 20+ formats** to clean Markdown — right inside VS Code. Powered by [Microsoft's MarkItDown](https://github.com/microsoft/markitdown). Runs **100% locally**, no internet connection required.

---

## Why Markify?

Every time you paste a document into an AI chat (ChatGPT, Claude, Copilot…), the AI struggles with raw binary content and wastes precious context tokens on boilerplate. Markify extracts only what matters and gives you clean, structured Markdown that AIs can actually read — often **saving 30–70% of your token budget**.

---

## Features

- **Drag & drop** files from the VS Code Explorer sidebar into the converter panel
- **Right-click** any file in the Explorer to convert it instantly
- **Token savings** shown after every conversion — see exactly how many tokens you saved vs the original
- **Batch conversion** — drop multiple files at once
- **Output options** — save next to the original file, open in a new editor tab, or ask every time
- **Custom output folder** — send all Markdown files to one place
- **Light / Dark / Auto theme** for the converter panel
- **Draggable results** — drag a converted `.md` file directly into an AI chat (Claude, ChatGPT…) — the Markdown text is pasted automatically
- **Copy to clipboard** — one click copies the Markdown content
- **Delete button** — remove the output file with a single click if you no longer need it

### Supported Formats

| Category | Formats |
|---|---|
| Documents | PDF, DOCX, DOC, PPTX, PPT, XLSX, XLS |
| Web | HTML, HTM, XML |
| Data | CSV, TSV, JSON |
| E-books | EPUB |
| Email | MSG |
| Archives | ZIP (converts contents) |
| Images | JPG, JPEG, PNG (via OCR/vision) |
| Audio | MP3, WAV (via transcription) |
| Text | TXT, MD |

---

## Requirements

- **Python 3.10 or newer** — [Download from python.org](https://www.python.org/downloads/)
- **Microsoft MarkItDown** — installed automatically the first time you open the panel

> **Tip:** On macOS, if the system Python is too old (Xcode ships Python 3.9), install Python via [Homebrew](https://brew.sh): `brew install python`

---

## Getting Started

1. **Open the panel** — press `Cmd+Shift+P` (Mac) / `Ctrl+Shift+P` (Windows/Linux) and run **"Markify: Open Converter Panel"**
2. The panel checks for Python and MarkItDown. If MarkItDown isn't installed, click **Install** — it takes about 30 seconds.
3. **Drag a file** from the VS Code Explorer sidebar into the drop zone, or click **Choose files…**
4. Your Markdown appears instantly. The token savings badge shows how much smaller the content is compared to the original.

---

## Usage

### From the Explorer sidebar (recommended)

Drag any supported file from the Explorer into the Markify panel drop zone.

### Right-click menu

Right-click any supported file in the Explorer and choose **"Markify: Convert to Markdown"**.

### Command palette

Open the command palette and run:
- **Markify: Open Converter Panel** — opens the main UI
- **Markify: Convert to Markdown** — converts the currently active file
- **Markify: Check Setup (Python & MarkItDown)** — diagnoses your Python environment

---

## Settings

| Setting | Default | Description |
|---|---|---|
| `markitdown.pythonPath` | *(auto)* | Path to Python executable. Leave blank to auto-detect. |
| `markitdown.outputMode` | `sameFolder` | `sameFolder`, `openInEditor`, or `ask` |
| `markitdown.showTokenStats` | `true` | Show token count and savings after conversion |

---

## Privacy & Security

- **No telemetry.** No analytics. No tracking.
- **No network calls.** All conversion happens locally using Python subprocess.
- **No API keys.** MarkItDown is a free, open-source library.
- Token counting uses [gpt-tokenizer](https://github.com/niieani/gpt-tokenizer) — a local implementation of the OpenAI tokenizer. No data leaves your machine.

---

## How Token Savings Are Calculated

For each conversion, Markify counts the tokens in:
- **Before:** the raw file content (text formats) or extracted plain text (binary formats like PDF/DOCX)
- **After:** the resulting Markdown

Savings = `(before − after) / before × 100%`

When Markdown actually adds structure (e.g. for a JSON file or a rich PDF), the panel shows *"Markdown helps with AI structure"* — because structured Markdown often produces better AI results even if the raw token count is higher.

---

## Attribution & License

MIT. This extension is an independent wrapper around [microsoft/markitdown](https://github.com/microsoft/markitdown) (MIT licensed, © Microsoft Corporation). Not affiliated with or endorsed by Microsoft.

See [CHANGELOG.md](CHANGELOG.md) · [LICENSE](LICENSE)
