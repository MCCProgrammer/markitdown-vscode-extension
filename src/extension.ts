import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { ensureReady, detectPython } from "./python";
import { convertFile } from "./convert";
import { computeStats, formatStats } from "./tokens";
import { ConverterPanel } from "./panel";

const CONVERTIBLE = /\.(pdf|docx?|xlsx?|pptx?|html?|csv|tsv|json|xml|epub|msg|zip|jpe?g|png|mp3|wav|txt|md)$/i;
const FIRST_RUN_KEY = "markitdown.firstRunDone";

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("markitdown.convertFile", (uri?: vscode.Uri) => convertCommand(context, uri)),
    vscode.commands.registerCommand("markitdown.checkSetup", checkSetupCommand),
    vscode.commands.registerCommand("markitdown.openPanel", () => ConverterPanel.show(context))
  );

  // First install: open the panel once so the setup wizard greets the user
  if (!context.globalState.get<boolean>(FIRST_RUN_KEY)) {
    context.globalState.update(FIRST_RUN_KEY, true);
    ConverterPanel.show(context);
  }
}

async function pickSourceFile(uri?: vscode.Uri): Promise<vscode.Uri | undefined> {
  // 1. Invoked from explorer/editor-title context menu → uri is provided
  if (uri) {
    return uri;
  }
  // 2. Invoked from the command palette with a convertible file active
  const active = vscode.window.activeTextEditor?.document.uri;
  if (active && active.scheme === "file" && CONVERTIBLE.test(active.fsPath)) {
    return active;
  }
  // 3. Fall back to a file picker
  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    openLabel: "Convert to Markdown",
    filters: {
      "Convertible files": ["pdf", "docx", "doc", "xlsx", "xls", "pptx", "ppt", "html", "htm", "csv", "tsv", "json", "xml", "epub", "msg", "zip", "jpg", "jpeg", "png", "mp3", "wav"],
      "All files": ["*"],
    },
  });
  return picked?.[0];
}

async function convertCommand(context: vscode.ExtensionContext, uri?: vscode.Uri) {
  const source = await pickSourceFile(uri);
  if (!source) {
    return;
  }

  const env = await ensureReady(context);
  if (!env) {
    return;
  }

  const config = vscode.workspace.getConfiguration("markitdown");
  const fileName = path.basename(source.fsPath);

  try {
    const result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Converting ${fileName}…`, cancellable: false },
      () => convertFile(env.python, source.fsPath)
    );

    if (!result.markdown.trim()) {
      vscode.window.showWarningMessage(`MarkItDown produced no output for ${fileName}. The file may be empty or unsupported.`);
      return;
    }

    // Token stats
    let statsSuffix = "";
    if (config.get<boolean>("showTokenStats", true)) {
      const stats = computeStats(source.fsPath, result.markdown);
      statsSuffix = ` — ${formatStats(stats)}`;
    }

    // Output
    let mode = config.get<string>("outputMode", "sameFolder");
    if (mode === "ask") {
      const choice = await vscode.window.showQuickPick(
        [
          { label: "Save next to original", value: "sameFolder" },
          { label: "Open in new editor tab", value: "openInEditor" },
        ],
        { placeHolder: "Where should the Markdown go?" }
      );
      if (!choice) {
        return;
      }
      mode = choice.value;
    }

    if (mode === "openInEditor") {
      const doc = await vscode.workspace.openTextDocument({ language: "markdown", content: result.markdown });
      await vscode.window.showTextDocument(doc, { preview: false });
      vscode.window.showInformationMessage(`Converted ${fileName}${statsSuffix}`);
      return;
    }

    // sameFolder: write <name>.md next to the source, never overwriting silently
    const target = await uniqueMarkdownPath(source.fsPath);
    fs.writeFileSync(target, result.markdown, "utf8");
    const open = await vscode.window.showInformationMessage(
      `Saved ${path.basename(target)}${statsSuffix}`,
      "Open File"
    );
    if (open === "Open File") {
      const doc = await vscode.workspace.openTextDocument(target);
      await vscode.window.showTextDocument(doc, { preview: false });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`Conversion failed: ${message}`);
  }
}

/** foo.pdf → foo.md, or foo-1.md / foo-2.md if it already exists. */
async function uniqueMarkdownPath(sourcePath: string): Promise<string> {
  const dir = path.dirname(sourcePath);
  const base = path.basename(sourcePath, path.extname(sourcePath));
  let candidate = path.join(dir, `${base}.md`);
  let i = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${base}-${i}.md`);
    i++;
  }
  return candidate;
}

async function checkSetupCommand() {
  const env = await detectPython();
  if (!env) {
    vscode.window.showErrorMessage("Python 3 not found on PATH. Install it from https://www.python.org/downloads/ or set markitdown.pythonPath in settings.");
    return;
  }
  if (!env.hasMarkitdown) {
    vscode.window.showWarningMessage(`Python found (${env.python}) but the markitdown package is not installed. Run a conversion to be prompted, or: ${env.python} -m pip install "markitdown[all]"`);
    return;
  }
  vscode.window.showInformationMessage(`All good ✅  Python: ${env.python}, markitdown: installed.`);
}

export function deactivate() {}
