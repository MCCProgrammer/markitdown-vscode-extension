import * as vscode from "vscode";
import { execFile } from "child_process";

export interface PythonEnv {
  /** Command used to invoke python, e.g. "python3" or a full path */
  python: string;
  /** True if the markitdown package is importable in that environment */
  hasMarkitdown: boolean;
  /** Parsed version string, e.g. "3.11" */
  pythonVersion: string;
}

function run(cmd: string, args: string[], timeoutMs = 5000): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (result: { ok: boolean; stdout: string; stderr: string }) => {
      if (!settled) { settled = true; resolve(result); }
    };
    const fail = () => settle({ ok: false, stdout: "", stderr: "" });

    let child: import("child_process").ChildProcess;
    try {
      // No `timeout` option — we manage it ourselves so we can use SIGKILL
      child = execFile(cmd, args, { windowsHide: true, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
        settle({ ok: !err, stdout: stdout?.toString() ?? "", stderr: stderr?.toString() ?? "" });
      });
    } catch {
      fail();
      return;
    }

    // After timeoutMs: force-kill (SIGKILL cannot be ignored; on Windows it calls TerminateProcess)
    const killTimer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* already gone */ }
      // Bail-out: if kill doesn't trigger the execFile callback within 500 ms, resolve anyway
      setTimeout(fail, 500);
    }, timeoutMs);

    // Clear kill timer if the process exits normally before the deadline
    child.on("close", () => clearTimeout(killTimer));
  });
}

/** Candidate python commands — configured path first, then common locations. */
function pythonCandidates(): string[] {
  const configured = vscode.workspace.getConfiguration("markitdown").get<string>("pythonPath")?.trim();
  const candidates = [
    "python3",
    "/opt/homebrew/bin/python3",   // Homebrew (Apple Silicon)
    "/usr/local/bin/python3",      // Homebrew (Intel)
    "python3.13", "python3.12", "python3.11", "python3.10",
    "python", "py",
  ];
  return configured ? [configured, ...candidates] : candidates;
}

function parseVersion(output: string): string {
  const m = output.match(/Python (\d+\.\d+)/);
  return m ? m[1] : "?";
}

export function meetsVersionRequirement(version: string): boolean {
  const [major, minor] = version.split(".").map(Number);
  return major > 3 || (major === 3 && minor >= 10);
}

export async function detectPython(): Promise<PythonEnv | undefined> {
  // Check all candidates in parallel so we don't wait 15 s × N sequentially
  const versionResults = await Promise.all(
    pythonCandidates().map(async (python) => {
      const r = await run(python, ["--version"], 5000);
      if (!r.ok) { return null; }
      return { python, pythonVersion: parseVersion(r.stdout || r.stderr) };
    })
  );

  const working = versionResults.filter((r): r is { python: string; pythonVersion: string } => r !== null);
  if (working.length === 0) { return undefined; }

  // Check markitdown in parallel across all working Pythons
  const envs: PythonEnv[] = await Promise.all(
    working.map(async ({ python, pythonVersion }) => {
      const check = await run(python, ["-c", "from markitdown import MarkItDown"], 8000);
      return { python, pythonVersion, hasMarkitdown: check.ok };
    })
  );

  // Prefer: has markitdown + version ok > has markitdown > version ok > any
  return (
    envs.find(e => e.hasMarkitdown && meetsVersionRequirement(e.pythonVersion)) ??
    envs.find(e => e.hasMarkitdown) ??
    envs.find(e => meetsVersionRequirement(e.pythonVersion)) ??
    envs[0]
  );
}

export async function ensureReady(context: vscode.ExtensionContext): Promise<PythonEnv | undefined> {
  const env = await detectPython();

  if (!env) {
    const choice = await vscode.window.showErrorMessage(
      "MarkItDown Converter needs Python 3, but none was found on your PATH.",
      "Download Python",
      "Set Python Path"
    );
    if (choice === "Download Python") {
      vscode.env.openExternal(vscode.Uri.parse("https://www.python.org/downloads/"));
    } else if (choice === "Set Python Path") {
      vscode.commands.executeCommand("workbench.action.openSettings", "markitdown.pythonPath");
    }
    return undefined;
  }

  if (env.hasMarkitdown) {
    return env;
  }

  if (!meetsVersionRequirement(env.pythonVersion)) {
    const choice = await vscode.window.showErrorMessage(
      `Python ${env.pythonVersion} was found but markitdown requires Python ≥ 3.10. Install a newer Python or set markitdown.pythonPath to point to one.`,
      "Download Python 3.12",
      "Set Python Path"
    );
    if (choice === "Download Python 3.12") {
      vscode.env.openExternal(vscode.Uri.parse("https://www.python.org/downloads/"));
    } else if (choice === "Set Python Path") {
      vscode.commands.executeCommand("workbench.action.openSettings", "markitdown.pythonPath");
    }
    return undefined;
  }

  const choice = await vscode.window.showInformationMessage(
    "The MarkItDown Python package is not installed in the detected environment. Install it now?",
    { detail: `Will run: ${env.python} -m pip install --upgrade "markitdown[all]"`, modal: true },
    "Install"
  );
  if (choice !== "Install") {
    return undefined;
  }

  const installed = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "Installing markitdown[all] (this can take a minute)…" },
    () => run(env.python, ["-m", "pip", "install", "--upgrade", "--user", "markitdown[all]"], 5 * 60 * 1000)
  );

  if (!installed.ok) {
    const fallback = await vscode.window.showErrorMessage(
      "Automatic install failed. You can run the install command in a terminal instead.",
      "Open Terminal"
    );
    if (fallback === "Open Terminal") {
      const term = vscode.window.createTerminal("MarkItDown install");
      term.show();
      term.sendText(`${env.python} -m pip install --upgrade --user "markitdown[all]"`, false);
    }
    return undefined;
  }

  const recheck = await detectPython();
  if (recheck?.hasMarkitdown) {
    vscode.window.showInformationMessage("MarkItDown installed successfully ✅");
    return recheck;
  }
  vscode.window.showErrorMessage("Install finished but markitdown still isn't importable. Check your Python environment.");
  return undefined;
}
