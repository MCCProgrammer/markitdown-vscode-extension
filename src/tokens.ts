import * as fs from "fs";
import * as path from "path";
import { encode } from "gpt-tokenizer";

export interface TokenStats {
  /** Tokens in the converted markdown */
  markdownTokens: number;
  /** Tokens in the raw file content — only for text-based formats */
  rawTokens?: number;
  /** rawTokens - markdownTokens, when rawTokens is measurable */
  saved?: number;
  /** Percentage saved, when measurable */
  savedPercent?: number;
}

/**
 * Formats whose raw bytes are text an LLM could plausibly have ingested
 * directly — for these, "tokens saved" is an honest before/after comparison.
 * For binary formats (PDF, DOCX, …) the raw bytes were never LLM input,
 * so we only report the markdown's token count, not a fake "savings".
 */
const TEXT_EXTENSIONS = new Set([".html", ".htm", ".xml", ".csv", ".tsv", ".json", ".txt", ".md"]);

export function countTokens(text: string): number {
  return encode(text).length;
}

export function computeStats(sourceFile: string, markdown: string): TokenStats {
  const markdownTokens = countTokens(markdown);
  const ext = path.extname(sourceFile).toLowerCase();

  if (!TEXT_EXTENSIONS.has(ext)) {
    return { markdownTokens };
  }

  try {
    const raw = fs.readFileSync(sourceFile, "utf8");
    const rawTokens = countTokens(raw);
    const saved = rawTokens - markdownTokens;
    const savedPercent = rawTokens > 0 ? Math.round((saved / rawTokens) * 100) : 0;
    return { markdownTokens, rawTokens, saved, savedPercent };
  } catch {
    return { markdownTokens };
  }
}

export function formatStats(stats: TokenStats): string {
  const fmt = (n: number) => n.toLocaleString("en-US");
  if (stats.rawTokens !== undefined && stats.saved !== undefined && stats.saved > 0) {
    return `${fmt(stats.rawTokens)} → ${fmt(stats.markdownTokens)} tokens (${stats.savedPercent}% saved)`;
  }
  return `${fmt(stats.markdownTokens)} tokens`;
}
