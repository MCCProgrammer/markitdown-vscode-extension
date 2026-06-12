import { spawn } from "child_process";

export interface ConvertResult {
  markdown: string;
}

/**
 * Convert a file to Markdown by running MarkItDown as a module in the
 * detected Python environment:  python -m markitdown <file>
 *
 * Using `-m markitdown` (instead of a global `markitdown` binary) guarantees
 * we run in the same environment where the package was installed.
 * Output is captured from stdout; MarkItDown writes the markdown there.
 */
export function convertFile(python: string, filePath: string, timeoutMs = 10 * 60 * 1000): Promise<ConvertResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(python, ["-m", "markitdown", filePath], {
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
      if (code === 0) {
        resolve({ markdown: stdout });
      } else {
        // Surface the most useful line of stderr to the user
        const lastLines = stderr.trim().split("\n").slice(-3).join("\n");
        reject(new Error(lastLines || `MarkItDown exited with code ${code}`));
      }
    });
  });
}
