import { spawn } from "child_process";

export interface ConvertResult {
  markdown: string;
  /** Raw text extracted without markdown formatting — for binary formats only */
  rawText?: string;
}

// Single Python call: converts to markdown AND extracts raw text for binary formats.
// Raw text is used to compute an honest "before vs after" token savings metric.
// Output is JSON: { "markdown": "...", "raw": "..." }
const CONVERT_SCRIPT = `
import sys, json
from markitdown import MarkItDown

fp = sys.argv[1]
ext = fp.rsplit('.', 1)[-1].lower() if '.' in fp else ''

markdown = MarkItDown().convert(fp).text_content or ''

raw = ''
try:
    if ext == 'pdf':
        from pdfminer.high_level import extract_text
        raw = extract_text(fp) or ''
    elif ext in ('docx', 'doc'):
        from docx import Document
        raw = '\\n'.join(p.text for p in Document(fp).paragraphs if p.text.strip())
    elif ext in ('pptx', 'ppt'):
        from pptx import Presentation
        slides = Presentation(fp).slides
        raw = '\\n'.join(sh.text_frame.text for sl in slides for sh in sl.shapes if hasattr(sh, 'text_frame'))
    elif ext in ('xlsx', 'xls'):
        import openpyxl
        wb = openpyxl.load_workbook(fp, read_only=True, data_only=True)
        rows = ['\\t'.join(str(c or '') for c in row) for ws in wb.worksheets for row in ws.iter_rows(values_only=True)]
        raw = '\\n'.join(rows)
except Exception:
    pass

sys.stdout.write(json.dumps({"markdown": markdown, "raw": raw}))
`.trim();

export function convertFile(python: string, filePath: string, timeoutMs = 10 * 60 * 1000): Promise<ConvertResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(python, ["-c", CONVERT_SCRIPT, filePath], {
      windowsHide: true,
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Conversion timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      if (code !== 0) {
        const lastLines = stderr.trim().split("\n").slice(-3).join("\n");
        reject(new Error(lastLines || `MarkItDown exited with code ${code}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout);
        resolve({
          markdown: parsed.markdown ?? "",
          rawText: parsed.raw || undefined,
        });
      } catch {
        // Fallback: treat the whole stdout as plain markdown (old behaviour)
        resolve({ markdown: stdout });
      }
    });
  });
}
