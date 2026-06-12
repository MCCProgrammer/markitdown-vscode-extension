import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { detectPython, PythonEnv } from "./python";
import { convertFile } from "./convert";
import { computeStats, TokenStats } from "./tokens";
import { execFile } from "child_process";

interface Totals {
  files: number;
  markdownTokens: number;
  saved: number;
}

const TOTALS_KEY = "markitdown.totals";

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
    const panel = vscode.window.createWebviewPanel(
      "markitdownConverter",
      "MarkItDown Converter",
      vscode.ViewColumn.One,
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
      case "pickOutputFolder":
        await this.pickOutputFolder();
        break;
      case "clearOutputFolder":
        await this.context.globalState.update("markitdown.outputFolder", undefined);
        this.sendConfig();
        break;
      case "convertDropped":
        await this.convertDropped(msg.name as string, msg.bytes as Uint8Array);
        break;
      case "openFile": {
        const doc = await vscode.workspace.openTextDocument(msg.path);
        await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Beside });
        break;
      }
      case "revealFile":
        await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(msg.path));
        break;
      case "resetTotals":
        await this.context.globalState.update(TOTALS_KEY, undefined);
        this.sendTotals();
        break;
    }
  }

  // ---------- setup ----------

  private async sendSetupStatus() {
    this.env = await detectPython();
    this.post({
      type: "setupStatus",
      python: this.env?.python ?? null,
      hasMarkitdown: this.env?.hasMarkitdown ?? false,
    });
  }

  private async installMarkitdown() {
    if (!this.env) {
      return;
    }
    this.post({ type: "installing" });
    const python = this.env.python;
    const result = await new Promise<{ ok: boolean; err: string }>((resolve) => {
      execFile(
        python,
        ["-m", "pip", "install", "--user", "markitdown[all]"],
        { timeout: 10 * 60 * 1000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
        (err, _stdout, stderr) => resolve({ ok: !err, err: stderr?.toString().trim().split("\n").slice(-2).join(" ") ?? "" })
      );
    });
    if (!result.ok) {
      this.post({ type: "installFailed", message: result.err || "pip install failed" });
      // Offer a terminal fallback
      const term = vscode.window.createTerminal("MarkItDown install");
      term.show();
      term.sendText(`${python} -m pip install --user "markitdown[all]"`, false);
      return;
    }
    await this.sendSetupStatus();
  }

  // ---------- config & totals ----------

  private outputFolder(): string | undefined {
    return this.context.globalState.get<string>("markitdown.outputFolder");
  }

  private sendConfig() {
    this.post({ type: "config", outputFolder: this.outputFolder() ?? null });
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

  /** Decide where the .md goes and write it without overwriting. */
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
      const stats = computeStats(sourcePath, result.markdown);
      const outPath = this.saveMarkdown(displayName, result.markdown, fallbackDir);
      await this.addToTotals(stats);
      this.post({ type: "convertDone", name: displayName, outPath, stats });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.post({ type: "convertError", name: displayName, message });
    }
  }

  private async pickAndConvert() {
    const env = await this.ensureEnv();
    if (!env) {
      return;
    }
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: true,
      openLabel: "Convert to Markdown",
    });
    if (!picked?.length) {
      return;
    }
    for (const uri of picked) {
      // Files picked from disk: fall back to saving next to the source
      await this.convertOne(env, uri.fsPath, path.basename(uri.fsPath), path.dirname(uri.fsPath));
    }
  }

  /** A file dragged into the webview arrives as bytes; write it to a temp dir first. */
  private async convertDropped(name: string, bytes: Uint8Array) {
    const env = await this.ensureEnv();
    if (!env) {
      return;
    }
    if (!bytes || !(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
      this.post({ type: "convertError", name, message: "Could not read the dropped file." });
      return;
    }
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "markitdown-"));
    const tmpFile = path.join(tmpDir, name);
    try {
      fs.writeFileSync(tmpFile, Buffer.from(bytes));
      await this.convertOne(env, tmpFile, name);
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    }
  }

  // ---------- UI ----------

  private getHtml(): string {
    const nonce = Math.random().toString(36).slice(2);
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  :root { color-scheme: light dark; }
  body {
    font-family: var(--vscode-font-family);
    color: var(--vscode-foreground);
    padding: 16px 20px 40px;
    max-width: 760px;
    margin: 0 auto;
  }
  h1 { font-size: 1.3em; margin: 0 0 4px; }
  .subtitle { opacity: .7; margin: 0 0 20px; font-size: .9em; }
  .card {
    background: var(--vscode-editorWidget-background);
    border: 1px solid var(--vscode-widget-border, rgba(128,128,128,.25));
    border-radius: 8px;
    padding: 14px 16px;
    margin-bottom: 14px;
  }
  .row { display: flex; align-items: center; gap: 8px; margin: 6px 0; }
  .ok { color: var(--vscode-testing-iconPassed, #3fb950); }
  .bad { color: var(--vscode-testing-iconFailed, #f85149); }
  button {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none; border-radius: 4px;
    padding: 6px 14px; cursor: pointer; font-size: .9em;
  }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary {
    background: var(--vscode-button-secondaryBackground, transparent);
    color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
    border: 1px solid var(--vscode-widget-border, rgba(128,128,128,.4));
  }
  #dropzone {
    border: 2px dashed var(--vscode-widget-border, rgba(128,128,128,.5));
    border-radius: 10px;
    padding: 36px 20px;
    text-align: center;
    transition: border-color .15s, background .15s;
    margin-bottom: 14px;
  }
  #dropzone.dragover {
    border-color: var(--vscode-focusBorder);
    background: var(--vscode-list-hoverBackground);
  }
  #dropzone.disabled { opacity: .45; pointer-events: none; }
  #dropzone p { margin: 6px 0; }
  .muted { opacity: .65; font-size: .85em; }
  .totals { display: flex; gap: 24px; flex-wrap: wrap; }
  .totals .stat .num { font-size: 1.5em; font-weight: 600; }
  .totals .stat .label { font-size: .8em; opacity: .7; }
  .result {
    border-left: 3px solid var(--vscode-focusBorder);
    padding: 8px 12px; margin: 8px 0;
    background: var(--vscode-editorWidget-background);
    border-radius: 0 6px 6px 0;
  }
  .result.error { border-left-color: var(--vscode-testing-iconFailed, #f85149); }
  .result .name { font-weight: 600; }
  .result .links { margin-top: 4px; }
  .result .links a { cursor: pointer; color: var(--vscode-textLink-foreground); margin-right: 14px; }
  .folder-path {
    font-family: var(--vscode-editor-font-family); font-size: .85em;
    background: var(--vscode-textCodeBlock-background); padding: 2px 6px; border-radius: 4px;
    word-break: break-all;
  }
  .spinner { display: inline-block; animation: spin 1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
  <h1>MarkItDown Converter</h1>
  <p class="subtitle">Convert documents to clean Markdown locally — your files never leave this machine.</p>

  <div class="card" id="setupCard">
    <strong>Setup</strong>
    <div class="row" id="pyRow"><span class="spinner">⏳</span> Checking Python…</div>
    <div class="row" id="mdRow"></div>
    <div class="row" id="setupActions"></div>
  </div>

  <div id="dropzone" class="disabled">
    <p style="font-size:2em; margin:0">📄→📝</p>
    <p><strong>Drop files here</strong> or</p>
    <button id="pickBtn">Choose files…</button>
    <p class="muted">PDF, Word, Excel, PowerPoint, HTML, CSV, images, audio, EPUB…</p>
  </div>

  <div class="card">
    <div class="row" style="justify-content: space-between">
      <div>
        <strong>Output folder</strong>
        <div class="muted" id="folderLabel">Not set — files save next to the original (or home folder for dropped files)</div>
        <div class="folder-path" id="folderPath" style="display:none"></div>
      </div>
      <div style="display:flex; gap:6px">
        <button class="secondary" id="folderBtn">Choose…</button>
        <button class="secondary" id="folderClearBtn" style="display:none">Clear</button>
      </div>
    </div>
  </div>

  <div class="card">
    <div class="row" style="justify-content: space-between">
      <strong>All-time stats</strong>
      <button class="secondary" id="resetBtn">Reset</button>
    </div>
    <div class="totals">
      <div class="stat"><div class="num" id="tFiles">0</div><div class="label">files converted</div></div>
      <div class="stat"><div class="num" id="tTokens">0</div><div class="label">markdown tokens produced</div></div>
      <div class="stat"><div class="num" id="tSaved">0</div><div class="label">tokens saved (text formats)</div></div>
    </div>
  </div>

  <div id="results"></div>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => Number(n).toLocaleString("en-US");
  let setupOk = false;

  // ---- setup card ----
  function renderSetup(s) {
    const py = $("pyRow"), md = $("mdRow"), actions = $("setupActions");
    if (s.python) {
      py.innerHTML = '<span class="ok">✔</span> Python found: <code>' + s.python + '</code>';
    } else {
      py.innerHTML = '<span class="bad">✘</span> Python 3 not found — install it from <span class="folder-path">python.org/downloads</span>, then re-check';
    }
    if (s.python && s.hasMarkitdown) {
      md.innerHTML = '<span class="ok">✔</span> MarkItDown package installed';
      actions.innerHTML = '';
      setupOk = true;
    } else if (s.python) {
      md.innerHTML = '<span class="bad">✘</span> MarkItDown package not installed';
      actions.innerHTML = '<button id="installBtn">Install MarkItDown</button> <button class="secondary" id="recheckBtn">Re-check</button>';
      $("installBtn").onclick = () => vscode.postMessage({ type: "installMarkitdown" });
      $("recheckBtn").onclick = () => vscode.postMessage({ type: "checkSetup" });
      setupOk = false;
    } else {
      md.innerHTML = '';
      actions.innerHTML = '<button class="secondary" id="recheckBtn">Re-check</button>';
      $("recheckBtn").onclick = () => vscode.postMessage({ type: "checkSetup" });
      setupOk = false;
    }
    $("dropzone").classList.toggle("disabled", !setupOk);
  }

  // ---- drop zone ----
  const dz = $("dropzone");
  ["dragenter","dragover"].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add("dragover"); }));
  ["dragleave","drop"].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove("dragover"); }));
  dz.addEventListener("drop", async (e) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files || []);
    for (const file of files) {
      if (file.size > 200 * 1024 * 1024) {
        addResult({ error: true, name: file.name, message: "File larger than 200 MB — too big to convert via drag & drop. Use Choose files… instead." });
        continue;
      }
      const buf = await file.arrayBuffer();
      vscode.postMessage({ type: "convertDropped", name: file.name, bytes: new Uint8Array(buf) });
    }
  });
  $("pickBtn").onclick = () => vscode.postMessage({ type: "pickFiles" });

  // ---- output folder ----
  $("folderBtn").onclick = () => vscode.postMessage({ type: "pickOutputFolder" });
  $("folderClearBtn").onclick = () => vscode.postMessage({ type: "clearOutputFolder" });
  function renderConfig(c) {
    const has = !!c.outputFolder;
    $("folderLabel").style.display = has ? "none" : "";
    $("folderPath").style.display = has ? "" : "none";
    $("folderPath").textContent = c.outputFolder || "";
    $("folderClearBtn").style.display = has ? "" : "none";
  }

  // ---- totals ----
  $("resetBtn").onclick = () => vscode.postMessage({ type: "resetTotals" });
  function renderTotals(t) {
    $("tFiles").textContent = fmt(t.files);
    $("tTokens").textContent = fmt(t.markdownTokens);
    $("tSaved").textContent = fmt(t.saved);
  }

  // ---- results ----
  const inProgress = new Map();
  function addResult(r) {
    const div = document.createElement("div");
    div.className = "result" + (r.error ? " error" : "");
    if (r.pending) {
      div.innerHTML = '<span class="spinner">⏳</span> Converting <span class="name"></span>…';
      div.querySelector(".name").textContent = r.name;
      inProgress.set(r.name, div);
    } else if (r.error) {
      div.innerHTML = '<div class="name"></div><div class="muted msg"></div>';
      div.querySelector(".name").textContent = "✘ " + r.name;
      div.querySelector(".msg").textContent = r.message;
    } else {
      let statsText = fmt(r.stats.markdownTokens) + " tokens";
      if (r.stats.rawTokens != null && r.stats.saved > 0) {
        statsText = fmt(r.stats.rawTokens) + " → " + fmt(r.stats.markdownTokens) + " tokens (" + r.stats.savedPercent + "% saved)";
      }
      div.innerHTML = '<div class="name"></div><div class="muted">' + statsText + '</div>' +
        '<div class="muted folder-path out"></div>' +
        '<div class="links"><a class="open">Open</a><a class="reveal">Show in folder</a></div>';
      div.querySelector(".name").textContent = "✔ " + r.name;
      div.querySelector(".out").textContent = r.outPath;
      div.querySelector(".open").onclick = () => vscode.postMessage({ type: "openFile", path: r.outPath });
      div.querySelector(".reveal").onclick = () => vscode.postMessage({ type: "revealFile", path: r.outPath });
    }
    const existing = inProgress.get(r.name);
    if (!r.pending && existing) {
      existing.replaceWith(div);
      inProgress.delete(r.name);
    } else {
      $("results").prepend(div);
    }
  }

  // ---- message bridge ----
  window.addEventListener("message", (e) => {
    const m = e.data;
    if (m.type === "setupStatus") renderSetup(m);
    if (m.type === "installing") $("setupActions").innerHTML = '<span class="spinner">⏳</span> Installing markitdown[all]… this can take a minute';
    if (m.type === "installFailed") {
      $("setupActions").innerHTML = '<span class="bad">Install failed: ' + (m.message || '') + '</span> — a terminal was opened with the command ready; press Enter there, then <button class="secondary" id="recheckBtn2">Re-check</button>';
      $("recheckBtn2").onclick = () => vscode.postMessage({ type: "checkSetup" });
    }
    if (m.type === "config") renderConfig(m);
    if (m.type === "totals") renderTotals(m.totals);
    if (m.type === "convertStart") addResult({ pending: true, name: m.name });
    if (m.type === "convertDone") addResult({ name: m.name, outPath: m.outPath, stats: m.stats });
    if (m.type === "convertError") addResult({ error: true, name: m.name || "File", message: m.message });
  });

  vscode.postMessage({ type: "ready" });
</script>
</body>
</html>`;
  }
}
