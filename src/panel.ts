import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import * as crypto from "crypto";
import { detectPython, meetsVersionRequirement, PythonEnv } from "./python";
import { convertFile } from "./convert";
import { computeStats, TokenStats } from "./tokens";
import { execFile } from "child_process";

interface Totals {
  files: number;
  markdownTokens: number;
  saved: number;
}

const TOTALS_KEY = "markitdown.totals";
const THEME_KEY  = "markitdown.theme";

export class ConverterPanel {
  public static current: ConverterPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly context: vscode.ExtensionContext;
  private disposables: vscode.Disposable[] = [];
  private env: PythonEnv | undefined;

  public static show(context: vscode.ExtensionContext) {
    if (ConverterPanel.current) {
      ConverterPanel.current.panel.reveal();
      return;
    }
    const column = vscode.workspace.getConfiguration("markitdown").get<string>("panelColumn", "beside") === "active"
      ? vscode.ViewColumn.Active
      : vscode.ViewColumn.Beside;
    const panel = vscode.window.createWebviewPanel(
      "markitdownConverter",
      "MarkItDown Converter",
      column,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    ConverterPanel.current = new ConverterPanel(panel, context);
  }

  private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext) {
    this.panel = panel;
    this.context = context;
    this.panel.webview.html = this.getHtml();
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage((msg) => this.onMessage(msg), null, this.disposables);
  }

  private dispose() {
    ConverterPanel.current = undefined;
    this.disposables.forEach((d) => d.dispose());
  }

  private post(message: unknown) {
    this.panel.webview.postMessage(message);
  }

  // ---------- message handling ----------

  private async onMessage(msg: any) {
    switch (msg.type) {
      case "ready":
        await this.sendSetupStatus();
        this.sendConfig();
        this.sendTotals();
        break;
      case "checkSetup":
        await this.sendSetupStatus();
        break;
      case "installMarkitdown":
        await this.installMarkitdown();
        break;
      case "pickFiles":
        await this.pickAndConvert();
        break;
      case "convertPaths":
        await this.convertPaths(msg.paths as string[]);
        break;
      case "pickOutputFolder":
        await this.pickOutputFolder();
        break;
      case "clearOutputFolder":
        await this.context.globalState.update("markitdown.outputFolder", undefined);
        this.sendConfig();
        break;
      case "setTheme":
        await this.context.globalState.update(THEME_KEY, msg.theme as string);
        this.sendConfig();
        break;
      case "convertDropped":
        await this.convertDropped(msg.name as string, msg.bytes as number[]);
        break;
      case "openFile": {
        const doc = await vscode.workspace.openTextDocument(msg.path);
        await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Beside });
        break;
      }
      case "revealFile":
        await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(msg.path));
        break;
      case "revealInExplorer":
        await vscode.commands.executeCommand("revealInExplorer", vscode.Uri.file(msg.path));
        break;
      case "copyFile": {
        try {
          const content = fs.readFileSync(msg.path as string, "utf8");
          await vscode.env.clipboard.writeText(content);
          vscode.window.showInformationMessage("Markdown copied to clipboard.");
        } catch {
          vscode.window.showErrorMessage("Could not read the file.");
        }
        break;
      }
      case "copyText": {
        await vscode.env.clipboard.writeText(msg.text as string);
        break;
      }
      case "deleteFile": {
        try {
          fs.unlinkSync(msg.path as string);
          this.post({ type: "fileDeleted", path: msg.path });
        } catch {
          vscode.window.showErrorMessage("Could not delete the file.");
        }
        break;
      }
      case "resetTotals":
        await this.context.globalState.update(TOTALS_KEY, undefined);
        this.sendTotals();
        break;
    }
  }

  // ---------- setup ----------

  private async sendSetupStatus() {
    this.env = await detectPython();
    const versionOk = this.env ? meetsVersionRequirement(this.env.pythonVersion) : true;
    this.post({
      type: "setupStatus",
      python: this.env?.python ?? null,
      pythonVersion: this.env?.pythonVersion ?? null,
      versionOk,
      hasMarkitdown: this.env?.hasMarkitdown ?? false,
    });
  }

  private async installMarkitdown() {
    if (!this.env) {
      this.post({ type: "installFailed", message: "No Python found — cannot install." });
      return;
    }
    if (!meetsVersionRequirement(this.env.pythonVersion)) {
      this.post({ type: "installFailed", message: `Python ${this.env.pythonVersion} is too old — markitdown requires Python ≥ 3.10. Install Python 3.10+ and set markitdown.pythonPath in settings.` });
      return;
    }
    this.post({ type: "installing" });
    const python = this.env.python;
    const result = await new Promise<{ ok: boolean; out: string }>((resolve) => {
      execFile(
        python,
        ["-m", "pip", "install", "--upgrade", "--user", "markitdown[all]"],
        { timeout: 10 * 60 * 1000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
        (err, stdout, stderr) => {
          const combined = [stdout, stderr].filter(Boolean).join("\n").trim();
          const lastLines = combined.split("\n").slice(-4).join(" ");
          resolve({ ok: !err, out: lastLines });
        }
      );
    });
    if (!result.ok) {
      this.post({ type: "installFailed", message: result.out || "pip install failed — a terminal was opened with the command ready" });
      const term = vscode.window.createTerminal("MarkItDown install");
      term.show();
      term.sendText(`${python} -m pip install --upgrade --user "markitdown[all]"`, false);
      return;
    }
    await this.sendSetupStatus();
    if (!this.env?.hasMarkitdown) {
      this.post({ type: "installFailed", message: `pip finished but markitdown still isn't importable. Try running in a terminal: ${python} -m pip install --upgrade "markitdown[all]"` });
    }
  }

  // ---------- config & totals ----------

  private outputFolder(): string | undefined {
    return this.context.globalState.get<string>("markitdown.outputFolder");
  }

  private sendConfig() {
    this.post({
      type: "config",
      outputFolder: this.outputFolder() ?? null,
      theme: this.context.globalState.get<string>(THEME_KEY) ?? "auto",
    });
  }

  private async pickOutputFolder() {
    const picked = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: "Use as output folder",
    });
    if (picked?.[0]) {
      await this.context.globalState.update("markitdown.outputFolder", picked[0].fsPath);
      this.sendConfig();
    }
  }

  private getTotals(): Totals {
    return this.context.globalState.get<Totals>(TOTALS_KEY) ?? { files: 0, markdownTokens: 0, saved: 0 };
  }

  private async addToTotals(stats: TokenStats) {
    const t = this.getTotals();
    t.files += 1;
    t.markdownTokens += stats.markdownTokens;
    t.saved += stats.saved && stats.saved > 0 ? stats.saved : 0;
    await this.context.globalState.update(TOTALS_KEY, t);
    this.sendTotals();
  }

  private sendTotals() {
    this.post({ type: "totals", totals: this.getTotals() });
  }

  // ---------- conversion ----------

  private async ensureEnv(): Promise<PythonEnv | undefined> {
    if (!this.env || !this.env.hasMarkitdown) {
      await this.sendSetupStatus();
    }
    if (!this.env?.hasMarkitdown) {
      this.post({ type: "convertError", name: "", message: "Setup incomplete — install MarkItDown first (see Setup above)." });
      return undefined;
    }
    return this.env;
  }

  private saveMarkdown(sourceName: string, markdown: string, fallbackDir?: string): string {
    const dir = this.outputFolder() ?? fallbackDir ?? os.homedir();
    const base = path.basename(sourceName, path.extname(sourceName));
    let target = path.join(dir, `${base}.md`);
    let i = 1;
    while (fs.existsSync(target)) {
      target = path.join(dir, `${base}-${i}.md`);
      i++;
    }
    fs.writeFileSync(target, markdown, "utf8");
    return target;
  }

  private async convertOne(env: PythonEnv, sourcePath: string, displayName: string, fallbackDir?: string) {
    this.post({ type: "convertStart", name: displayName });
    try {
      const result = await convertFile(env.python, sourcePath);
      if (!result.markdown.trim()) {
        this.post({ type: "convertError", name: displayName, message: "No output — file may be empty or unsupported." });
        return;
      }
      const stats = computeStats(sourcePath, result.markdown, result.rawText);
      const outPath = this.saveMarkdown(displayName, result.markdown, fallbackDir);
      await this.addToTotals(stats);
      this.post({ type: "convertDone", name: displayName, outPath, stats, markdown: result.markdown });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.post({ type: "convertError", name: displayName, message });
    }
  }

  private async pickAndConvert() {
    const env = await this.ensureEnv();
    if (!env) { return; }
    const picked = await vscode.window.showOpenDialog({ canSelectMany: true, openLabel: "Convert to Markdown" });
    if (!picked?.length) { return; }
    for (const uri of picked) {
      await this.convertOne(env, uri.fsPath, path.basename(uri.fsPath), path.dirname(uri.fsPath));
    }
  }

  /** Handle file URIs dropped from the VS Code Explorer sidebar. */
  private async convertPaths(uris: string[]) {
    const env = await this.ensureEnv();
    if (!env) { return; }
    for (const uri of uris) {
      try {
        const filePath = vscode.Uri.parse(uri).fsPath;
        if (!filePath) { continue; }
        await this.convertOne(env, filePath, path.basename(filePath), path.dirname(filePath));
      } catch { /* skip invalid URIs */ }
    }
  }

  /** A file dragged into the webview arrives as bytes; write it to a temp dir first. */
  private async convertDropped(name: string, bytes: number[]) {
    const env = await this.ensureEnv();
    if (!env) { return; }
    const buf = Buffer.from(bytes);
    if (!buf.byteLength) {
      this.post({ type: "convertError", name, message: "Could not read the dropped file." });
      return;
    }
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "markitdown-"));
    const tmpFile = path.join(tmpDir, name);
    try {
      fs.writeFileSync(tmpFile, buf);
      await this.convertOne(env, tmpFile, name);
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
    }
  }

  // ---------- UI ----------

  private getHtml(): string {
    const nonce = crypto.randomBytes(16).toString("hex");
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  /* ---- base ---- */
  :root { color-scheme: light dark; }
  body {
    font-family: var(--vscode-font-family);
    color: var(--vscode-foreground);
    padding: 16px 20px 48px;
    max-width: 780px;
    margin: 0 auto;
  }
  h1 { font-size: 1.25em; margin: 0 0 2px; font-weight: 600; }
  .subtitle { opacity: .65; margin: 0 0 14px; font-size: .88em; }

  /* ---- theme overrides ---- */
  body.theme-light {
    --vscode-foreground: #1e1e1e;
    --vscode-editorWidget-background: #f0f0f0;
    --vscode-button-background: #0066b8;
    --vscode-button-foreground: #fff;
    --vscode-button-hoverBackground: #0053a0;
    --vscode-button-secondaryBackground: #ddd;
    --vscode-button-secondaryForeground: #1e1e1e;
    --vscode-widget-border: rgba(0,0,0,.2);
    --vscode-focusBorder: #0066b8;
    --vscode-textLink-foreground: #0066b8;
    --vscode-list-hoverBackground: rgba(0,0,0,.06);
    --vscode-textCodeBlock-background: #e5e5e5;
    --vscode-testing-iconPassed: #388a34;
    --vscode-testing-iconFailed: #c72e0f;
    background: #f8f8f8;
  }
  body.theme-dark {
    --vscode-foreground: #cccccc;
    --vscode-editorWidget-background: #252526;
    --vscode-button-background: #0e639c;
    --vscode-button-foreground: #fff;
    --vscode-button-hoverBackground: #1177bb;
    --vscode-button-secondaryBackground: #3a3d41;
    --vscode-button-secondaryForeground: #cccccc;
    --vscode-widget-border: rgba(255,255,255,.15);
    --vscode-focusBorder: #007fd4;
    --vscode-textLink-foreground: #3794ff;
    --vscode-list-hoverBackground: rgba(255,255,255,.06);
    --vscode-textCodeBlock-background: #2d2d30;
    --vscode-testing-iconPassed: #73c991;
    --vscode-testing-iconFailed: #f14c4c;
    background: #1e1e1e;
  }

  /* ---- card ---- */
  .card {
    background: var(--vscode-editorWidget-background);
    border: 1px solid var(--vscode-widget-border, rgba(128,128,128,.25));
    border-radius: 8px;
    padding: 14px 16px;
    margin-bottom: 12px;
  }
  .card-title { font-weight: 600; margin: 0 0 10px; display: flex; align-items: center; justify-content: space-between; }

  /* ---- buttons ---- */
  button {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none; border-radius: 4px;
    padding: 5px 13px; cursor: pointer; font-size: .88em;
  }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary {
    background: var(--vscode-button-secondaryBackground, transparent);
    color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
    border: 1px solid var(--vscode-widget-border, rgba(128,128,128,.4));
  }
  button.sm { padding: 3px 9px; font-size: .8em; }

  /* ---- helpers ---- */
  .row { display: flex; align-items: center; gap: 8px; margin: 5px 0; flex-wrap: wrap; }
  .ok  { color: var(--vscode-testing-iconPassed, #3fb950); }
  .bad { color: var(--vscode-testing-iconFailed, #f85149); }
  .muted { opacity: .65; font-size: .85em; }
  .mono {
    font-family: var(--vscode-editor-font-family, monospace); font-size: .82em;
    background: var(--vscode-textCodeBlock-background); padding: 2px 6px; border-radius: 4px;
    word-break: break-all; display: inline-block; max-width: 100%;
  }
  .spinner { display: inline-block; animation: spin 1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  a.link { cursor: pointer; color: var(--vscode-textLink-foreground); text-decoration: none; }
  a.link:hover { text-decoration: underline; }

  /* ---- setup card collapse ---- */
  #setupDone { display: none; font-size: .88em; opacity: .75; }
  #setupDone.visible { display: flex; align-items: center; gap: 8px; }
  #setupDetail.hidden { display: none; }

  /* ---- stats ---- */
  .stats-row { display: flex; gap: 28px; flex-wrap: wrap; margin-top: 8px; }
  .stat .num { font-size: 1.45em; font-weight: 600; }
  .stat .label { font-size: .78em; opacity: .65; }
  .stats-note { font-size: .75em; opacity: .5; margin-top: 8px; }

  /* ---- drop zone ---- */
  #dropzone {
    border: 2px dashed var(--vscode-widget-border, rgba(128,128,128,.45));
    border-radius: 10px;
    padding: 28px 20px 22px;
    text-align: center;
    transition: border-color .15s, background .15s;
    margin-bottom: 12px;
  }
  #dropzone.dragover {
    border-color: var(--vscode-focusBorder);
    background: var(--vscode-list-hoverBackground);
  }
  #dropzone.disabled { opacity: .4; pointer-events: none; }
  #dropzone p { margin: 5px 0; }
  #dropzone .big-icon { font-size: 2em; line-height: 1; margin-bottom: 6px; }
  #pickBtn { margin: 8px 0 4px; padding: 7px 20px; font-size: .95em; }

  /* ---- results ---- */
  #results { margin-bottom: 4px; }
  .result {
    padding: 9px 12px;
    margin: 6px 0;
    background: var(--vscode-editorWidget-background);
    border-radius: 6px;
    border: 1px solid var(--vscode-widget-border, rgba(128,128,128,.2));
    border-left: 3px solid var(--vscode-focusBorder);
  }
  .result.error { border-left-color: var(--vscode-testing-iconFailed, #f85149); }
  .result-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 3px; }
  .result-name { font-weight: 600; font-size: .95em; cursor: grab; user-select: none; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .result-name:active { cursor: grabbing; }
  .result-copy { font-size: .75em; padding: 2px 7px; }
  .result-delete { opacity: 0; transition: opacity .15s; font-size: .75em; padding: 2px 7px; background: transparent; color: var(--vscode-testing-iconFailed, #f85149); border: 1px solid var(--vscode-testing-iconFailed, #f85149); margin-top: 4px; }
  .result:hover .result-delete { opacity: 1; }
  .result-stats { font-size: .82em; opacity: .7; margin-bottom: 3px; }
  .result-stats .ai-note { opacity: .6; font-style: italic; }
  .result-path { font-size: .76em; opacity: .5; font-family: var(--vscode-editor-font-family, monospace); word-break: break-all; margin-bottom: 4px; }
  .result-actions { display: flex; gap: 12px; }
  .result-actions a { cursor: pointer; color: var(--vscode-textLink-foreground); font-size: .82em; }
  #moreBtn {
    display: none;
    width: 100%; text-align: center; background: transparent;
    color: var(--vscode-textLink-foreground); border: 1px solid var(--vscode-widget-border, rgba(128,128,128,.3));
    border-radius: 6px; padding: 6px; margin: 4px 0 12px; font-size: .88em; cursor: pointer;
  }
  #moreBtn:hover { background: var(--vscode-list-hoverBackground); }

  /* ---- settings ---- */
  details.card summary {
    cursor: pointer; font-weight: 600; list-style: none; user-select: none;
    display: flex; align-items: center; gap: 6px;
  }
  details.card summary::-webkit-details-marker { display: none; }
  details.card summary::before { content: '▶'; font-size: .7em; transition: transform .15s; }
  details.card[open] summary::before { transform: rotate(90deg); }
  .settings-section { margin-top: 14px; border-top: 1px solid var(--vscode-widget-border, rgba(128,128,128,.2)); padding-top: 12px; }
  .settings-label { font-size: .82em; font-weight: 600; opacity: .8; margin-bottom: 6px; text-transform: uppercase; letter-spacing: .04em; }
  .theme-btns { display: flex; gap: 6px; }
  .theme-btn { border: 1px solid var(--vscode-widget-border, rgba(128,128,128,.4)) !important; background: transparent !important; color: var(--vscode-foreground) !important; }
  .theme-btn.active { background: var(--vscode-button-background) !important; color: var(--vscode-button-foreground) !important; border-color: var(--vscode-button-background) !important; }
  .info-box { font-size: .82em; opacity: .7; background: var(--vscode-textCodeBlock-background); border-radius: 5px; padding: 8px 10px; line-height: 1.6; margin-top: 4px; }
</style>
</head>
<body>
  <h1>MarkItDown Converter</h1>
  <p class="subtitle">Convert documents to clean Markdown — files never leave your machine.</p>

  <!-- Stats at top -->
  <div class="card">
    <div class="card-title">
      All-time stats
      <button class="secondary sm" id="resetBtn">Reset</button>
    </div>
    <div class="stats-row">
      <div class="stat"><div class="num" id="tFiles">0</div><div class="label">files converted</div></div>
      <div class="stat"><div class="num" id="tTokens">0</div><div class="label">markdown tokens</div></div>
      <div class="stat"><div class="num" id="tSaved">0</div><div class="label">tokens saved</div></div>
    </div>
    <div class="stats-note">Tokens saved counts only when markdown is smaller than the raw source text.</div>
  </div>

  <!-- Setup (collapses when ready) -->
  <div class="card" id="setupCard">
    <div id="setupDone">
      <span class="ok">✔</span> Python + MarkItDown ready
      <a class="link" id="expandSetup" style="font-size:.85em">details</a>
    </div>
    <div id="setupDetail">
      <div class="card-title">Setup</div>
      <div class="row" id="pyRow"><span class="spinner">⏳</span> Checking Python…</div>
      <div class="row" id="mdRow"></div>
      <div class="row" id="setupActions"></div>
    </div>
  </div>

  <!-- Drop zone -->
  <div id="dropzone" class="disabled">
    <div class="big-icon">📄 → 📝</div>
    <p><strong>Drag files here</strong> from the Explorer sidebar</p>
    <button id="pickBtn">Choose files…</button>
    <p class="muted">PDF · Word · Excel · PowerPoint · HTML · CSV · images · audio · EPUB…</p>
    <p style="font-size:.76em; margin-top:6px; opacity:.4">Drag from the VS Code Explorer panel on the left — OS drags are intercepted by VS Code</p>
  </div>

  <!-- Results -->
  <div id="results"></div>
  <button id="moreBtn"></button>

  <!-- Settings -->
  <details class="card">
    <summary>Settings</summary>

    <div class="settings-section">
      <div class="settings-label">Theme</div>
      <div class="theme-btns">
        <button class="secondary theme-btn" data-theme="auto">Auto</button>
        <button class="secondary theme-btn" data-theme="light">Light</button>
        <button class="secondary theme-btn" data-theme="dark">Dark</button>
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-label">Output folder</div>
      <div class="muted" id="folderLabel">Not set — saves next to the original file (dropped files go to home folder)</div>
      <div class="mono" id="folderPath" style="display:none"></div>
      <div class="row" style="margin-top:8px">
        <button class="secondary sm" id="folderBtn">Choose folder…</button>
        <button class="secondary sm" id="folderClearBtn" style="display:none">Clear</button>
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-label">File naming</div>
      <div class="info-box">
        Files are saved as <code>filename.md</code>.<br>
        If that already exists: <code>filename-1.md</code>, <code>filename-2.md</code>, etc.<br>
        No existing file is ever overwritten.
      </div>
    </div>
  </details>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => Number(n).toLocaleString("en-US");
  const esc = (s) => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  const fmtBytes = (b) => b < 1024 ? b + ' B' : b < 1048576 ? Math.round(b/1024) + ' KB' : (b/1048576).toFixed(1) + ' MB';

  let setupOk = false;

  // ---- theme ----
  function applyTheme(t) {
    document.body.classList.remove('theme-light','theme-dark','theme-auto');
    document.body.classList.add('theme-' + t);
    document.querySelectorAll('.theme-btn').forEach(b => b.classList.toggle('active', b.dataset.theme === t));
  }
  document.querySelectorAll('.theme-btn').forEach(b => {
    b.addEventListener('click', () => vscode.postMessage({ type: 'setTheme', theme: b.dataset.theme }));
  });

  // ---- setup card ---- (collapses when done)
  $("expandSetup").onclick = () => {
    $("setupDone").classList.remove("visible");
    $("setupDetail").classList.remove("hidden");
  };

  function renderSetup(s) {
    const py = $("pyRow"), md = $("mdRow"), actions = $("setupActions");
    if (s.python) {
      const ver = s.pythonVersion ? ' <span class="muted">(Python ' + esc(s.pythonVersion) + ')</span>' : '';
      py.innerHTML = '<span class="ok">✔</span> Python: <span class="mono">' + esc(s.python) + '</span>' + ver;
    } else {
      py.innerHTML = '<span class="bad">✘</span> Python 3 not found — <a class="link" href="https://www.python.org/downloads/">python.org/downloads</a>, then Re-check';
    }

    if (s.python && s.hasMarkitdown) {
      md.innerHTML = '<span class="ok">✔</span> MarkItDown installed';
      actions.innerHTML = '';
      setupOk = true;
      $("setupDone").classList.add("visible");
      $("setupDetail").classList.add("hidden");
    } else if (s.python && !s.versionOk) {
      md.innerHTML = '<span class="bad">✘</span> Python ' + esc(s.pythonVersion) + ' is too old — markitdown requires ≥ 3.10';
      actions.innerHTML = '<a class="link" href="https://www.python.org/downloads/">Download Python 3.12</a> &nbsp; then set <code>markitdown.pythonPath</code> &nbsp; <button class="secondary sm" id="recheckBtn">Re-check</button>';
      $("recheckBtn").onclick = () => vscode.postMessage({ type: "checkSetup" });
      setupOk = false;
    } else if (s.python) {
      md.innerHTML = '<span class="bad">✘</span> MarkItDown not installed';
      actions.innerHTML = '<button id="installBtn">Install MarkItDown</button> <button class="secondary sm" id="recheckBtn">Re-check</button>';
      $("installBtn").onclick = () => vscode.postMessage({ type: "installMarkitdown" });
      $("recheckBtn").onclick = () => vscode.postMessage({ type: "checkSetup" });
      setupOk = false;
    } else {
      md.innerHTML = '';
      actions.innerHTML = '<button class="secondary sm" id="recheckBtn">Re-check</button>';
      $("recheckBtn").onclick = () => vscode.postMessage({ type: "checkSetup" });
      setupOk = false;
    }
    $("dropzone").classList.toggle("disabled", !setupOk);
  }

  // ---- drop zone ----
  const dz = $("dropzone");
  ["dragenter","dragover"].forEach(ev => dz.addEventListener(ev, () => { if (setupOk) dz.classList.add("dragover"); }));
  dz.addEventListener("dragleave", () => dz.classList.remove("dragover"));

  async function handleNativeFiles(files) {
    for (const file of files) {
      if (file.size > 200 * 1024 * 1024) {
        pushResult({ error: true, name: file.name, message: "File larger than 200 MB — use Choose files… instead." });
        continue;
      }
      const buf = await file.arrayBuffer();
      vscode.postMessage({ type: "convertDropped", name: file.name, bytes: Array.from(new Uint8Array(buf)) });
    }
  }

  document.addEventListener("dragenter", e => { e.preventDefault(); if (setupOk) dz.classList.add("dragover"); });
  document.addEventListener("dragover",  e => e.preventDefault());
  document.addEventListener("dragleave", e => { if (!e.relatedTarget) dz.classList.remove("dragover"); });
  document.addEventListener("drop", async e => {
    e.preventDefault();
    dz.classList.remove("dragover");

    // VS Code Explorer sidebar drag: provides text/uri-list
    const uriList = e.dataTransfer?.getData?.('text/uri-list') || '';
    if (uriList.trim()) {
      const paths = uriList.split(/\\r?\\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#'));
      if (paths.length) {
        if (!setupOk) { pushResult({ error: true, name: paths[0], message: "Setup incomplete — install MarkItDown first." }); return; }
        vscode.postMessage({ type: "convertPaths", paths });
        return;
      }
    }

    // Native OS file drop (usually empty — VS Code intercepts at window level)
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length) {
      if (!setupOk) { pushResult({ error: true, name: files[0]?.name || "File", message: "Setup incomplete — install MarkItDown first." }); return; }
      await handleNativeFiles(files);
      return;
    }

    pushResult({ error: true, name: "Drop", message: "No files detected. Drag from the VS Code Explorer panel, or use 'Choose files…'." });
  });

  $("pickBtn").onclick = () => vscode.postMessage({ type: "pickFiles" });

  // ---- settings ----
  $("folderBtn").onclick      = () => vscode.postMessage({ type: "pickOutputFolder" });
  $("folderClearBtn").onclick = () => vscode.postMessage({ type: "clearOutputFolder" });
  $("resetBtn").onclick       = () => vscode.postMessage({ type: "resetTotals" });

  function renderConfig(c) {
    const has = !!c.outputFolder;
    $("folderLabel").style.display    = has ? "none" : "";
    $("folderPath").style.display     = has ? "" : "none";
    $("folderPath").textContent       = c.outputFolder || "";
    $("folderClearBtn").style.display = has ? "" : "none";
    applyTheme(c.theme || "auto");
  }

  // ---- totals ----
  function renderTotals(t) {
    $("tFiles").textContent  = fmt(t.files);
    $("tTokens").textContent = fmt(t.markdownTokens);
    $("tSaved").textContent  = fmt(t.saved);
  }

  // ---- results with pagination ----
  const PAGE = 10;
  let allResults = [];
  let showAll = false;
  let nextId = 0;

  function buildStatsText(s) {
    if (!s) { return ''; }
    if (s.rawTokens != null) {
      if (s.saved > 0) {
        return fmt(s.rawTokens) + ' → ' + fmt(s.markdownTokens) + ' tokens (' + s.savedPercent + '% saved)';
      }
      return '<span class="ai-note">Markdown helps with AI structure</span>';
    }
    if (s.fileSize != null) {
      return fmtBytes(s.fileSize) + ' → ' + fmt(s.markdownTokens) + ' markdown tokens';
    }
    return fmt(s.markdownTokens) + ' tokens';
  }

  function makeCard(r) {
    const el = document.createElement("div");
    el.dataset.rid = r.id;
    el.className = "result" + (r.error ? " error" : "");

    if (r.pending) {
      el.innerHTML = '<div class="result-name"><span class="spinner">⏳</span> <span class="rn"></span></div>';
      el.querySelector('.rn').textContent = r.name;
    } else if (r.error) {
      el.innerHTML = '<div class="result-name bad rn"></div><div class="result-stats rmsg"></div>';
      el.querySelector('.rn').textContent   = '✘ ' + r.name;
      el.querySelector('.rmsg').textContent = r.message || '';
    } else {
      el.innerHTML =
        '<div class="result-header">' +
          '<div class="result-name ok rn" draggable="true" title="Drag to VS Code editor — content also copied to clipboard so you can Cmd+V / Ctrl+V into any AI chat"></div>' +
          '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:0">' +
            '<button class="secondary sm result-copy rc" title="Copy markdown to clipboard">Copy</button>' +
            '<button class="secondary sm result-delete rd" title="Delete file">Delete</button>' +
          '</div>' +
        '</div>' +
        '<div class="result-stats rst"></div>' +
        '<div class="result-path rp"></div>' +
        '<div class="result-actions"><a class="link ro">Open in editor</a><a class="link rr">Show in folder</a><a class="link re" title="Reveals the file in the VS Code Explorer sidebar so you can drag it into any AI chat panel">Reveal in Explorer ↗</a></div>';

      const nameEl = el.querySelector('.rn');
      nameEl.textContent = '✔ ' + r.name;

      // Draggable: file URI for VS Code editor; markdown text for other targets.
      // Also auto-copies to clipboard so Cmd+V works in any AI chat if the drop doesn't land.
      nameEl.addEventListener('dragstart', e => {
        const fileUri = 'file://' + r.outPath;
        e.dataTransfer.setData('text/uri-list', fileUri);
        e.dataTransfer.setData('text/plain', r.markdown || r.outPath);
        e.dataTransfer.effectAllowed = 'copy';
        if (r.markdown) { vscode.postMessage({ type: "copyText", text: r.markdown }); }
      });

      el.querySelector('.rst').innerHTML = buildStatsText(r.stats);
      el.querySelector('.rp').textContent = r.outPath || '';
      el.querySelector('.rc').onclick = () => vscode.postMessage({ type: "copyFile", path: r.outPath });
      el.querySelector('.ro').onclick = () => vscode.postMessage({ type: "openFile",      path: r.outPath });
      el.querySelector('.rr').onclick = () => vscode.postMessage({ type: "revealFile",    path: r.outPath });
      el.querySelector('.re').onclick = () => vscode.postMessage({ type: "revealInExplorer", path: r.outPath });
      const delBtn = el.querySelector('.rd');
      delBtn.onclick = () => {
        if (delBtn.dataset.confirm === '1') {
          vscode.postMessage({ type: "deleteFile", path: r.outPath });
        } else {
          delBtn.dataset.confirm = '1';
          delBtn.textContent = 'Sure?';
          setTimeout(() => { delBtn.dataset.confirm = '0'; delBtn.textContent = 'Delete'; }, 3000);
        }
      };
    }
    return el;
  }

  function renderResults() {
    const container = $("results");
    const visible = showAll ? allResults : allResults.slice(0, PAGE);
    container.innerHTML = '';
    visible.forEach(r => container.appendChild(makeCard(r)));

    const hidden = allResults.length - PAGE;
    const btn = $("moreBtn");
    if (!showAll && hidden > 0) {
      btn.textContent = 'Show ' + hidden + ' older result' + (hidden > 1 ? 's' : '') + '…';
      btn.style.display = 'block';
    } else {
      btn.style.display = 'none';
    }
  }

  $("moreBtn").onclick = () => { showAll = true; renderResults(); };

  function pushResult(r) {
    r.id = String(++nextId);
    allResults.unshift(r);
    renderResults();
  }

  function updatePending(name, update) {
    const idx = allResults.findIndex(r => r.pending && r.name === name);
    if (idx !== -1) {
      allResults[idx] = { ...allResults[idx], ...update, pending: false };
    } else {
      allResults.unshift({ id: String(++nextId), ...update });
    }
    renderResults();
  }

  // ---- message bridge ----
  window.addEventListener("message", e => {
    const m = e.data;
    switch (m.type) {
      case "setupStatus":  renderSetup(m); break;
      case "config":       renderConfig(m); break;
      case "totals":       renderTotals(m.totals); break;
      case "installing":
        $("setupActions").innerHTML = '<span class="spinner">⏳</span> Installing markitdown[all]…';
        break;
      case "installFailed":
        $("setupActions").innerHTML =
          '<span class="bad">Install failed: ' + esc(m.message || '') + '</span> — ' +
          'a terminal was opened; press Enter there, then ' +
          '<button class="secondary sm" id="recheckBtn2">Re-check</button>';
        $("recheckBtn2").onclick = () => vscode.postMessage({ type: "checkSetup" });
        break;
      case "convertStart":
        pushResult({ pending: true, name: m.name });
        break;
      case "convertDone": {
        const mdName = m.outPath.replace(/\\\\/g, '/').split('/').pop() || m.outPath;
        updatePending(m.name, { name: mdName, outPath: m.outPath, stats: m.stats, markdown: m.markdown });
        break;
      }
      case "convertError":
        updatePending(m.name || "File", { error: true, name: m.name || "File", message: m.message });
        break;
      case "fileDeleted":
        allResults = allResults.filter(r => r.outPath !== m.path);
        renderResults();
        break;
    }
  });

  vscode.postMessage({ type: "ready" });
</script>
</body>
</html>`;
  }
}
