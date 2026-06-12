import * as fs from "fs";
import * as path from "path";
import { encode } from "gpt-tokenizer";

export interface TokenStats {
  markdownTokens: number;
  rawTokens?: number;
  saved?: number;
  savedPercent?: number;
  /** Original file size in bytes — always populated when the file is readable */
  fileSize?: number;
}

const TEXT_EXTENSIONS = new Set([".html", ".htm", ".xml", ".csv", ".tsv", ".json", ".txt", ".md"]);

export function countTokens(text: string): number {
  return encode(text).length;
}

export function computeStats(sourceFile: string, markdown: string, rawText?: string): TokenStats {
  const markdownTokens = countTokens(markdown);
  const ext = path.extname(sourceFile).toLowerCase();

  let fileSize: number | undefined;
  try { fileSize = fs.statSync(sourceFile).size; } catch { /* ignore */ }

  // For text formats, compare raw file bytes vs markdown output.
  // For binary formats, use the extracted raw text if available.
  const rawSource = TEXT_EXTENSIONS.has(ext)
    ? (() => { try { return fs.readFileSync(sourceFile, "utf8"); } catch { return undefined; } })()
    : rawText?.trim() || undefined;

  if (rawSource) {
    const rawTokens = countTokens(rawSource);
    const saved = rawTokens - markdownTokens;
    const savedPercent = rawTokens > 0 ? Math.round((saved / rawTokens) * 100) : 0;
    return { markdownTokens, rawTokens, saved, savedPercent, fileSize };
  }

  return { markdownTokens, fileSize };
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024) { return `${bytes} B`; }
  if (bytes < 1024 * 1024) { return `${Math.round(bytes / 1024)} KB`; }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatStats(stats: TokenStats): string {
  const fmt = (n: number) => n.toLocaleString("en-US");
  if (stats.rawTokens !== undefined && stats.saved !== undefined && stats.saved > 0) {
    return `${fmt(stats.rawTokens)} → ${fmt(stats.markdownTokens)} tokens (${stats.savedPercent}% saved)`;
  }
  if (stats.fileSize !== undefined && stats.rawTokens === undefined) {
    return `${fmtBytes(stats.fileSize)} → ${fmt(stats.markdownTokens)} markdown tokens`;
  }
  return `${fmt(stats.markdownTokens)} tokens`;
}
