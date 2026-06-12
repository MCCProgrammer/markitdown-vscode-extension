import * as vscode from "vscode";
import { execFile } from "child_process";

export interface PythonEnv {
  /** Command used to invoke python, e.g. "python3" or a full path */
  python: string;
  /** True if the markitdown package is importable in that environment */
  hasMarkitdown: boolean;
}

function run(cmd: string, args: string[], timeoutMs = 15000): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: stdout?.toString() ?? "", stderr: stderr?.toString() ?? "" });
    });
  });
}

/** Candidate python commands, configured path first. */
function pythonCandidates(): string[] {
  const configured = vscode.workspace.getConfiguration("markitdown").get<string>("pythonPath")?.trim();
  const candidates = ["python3", "python", "py"];
  return configured ? [configured, ...candidates] : candidates;
}

/**
 * Find a working Python and check whether `markitdown` is importable in it.
 * Checking the *module* (not a global `markitdown` binary) means we use the
 * same environment we'd install into, avoiding PATH mismatches.
 */
export async function detectPython(): Promise<PythonEnv | undefined> {
  for (const candidate of pythonCandidates()) {
    const version = await run(candidate, ["--version"]);
    if (!version.ok) {
      continue;
    }
    const check = await run(candidate, ["-c", "import markitdown; print(markitdown.__version__ if hasattr(markitdown,'__version__') else 'ok')"]);
    return { python: candidate, hasMarkitdown: check.ok };
  }
  return undefined;
}

/**
 * Make sure Python + markitdown are available, guiding the user through
 * installation if needed. Returns a ready-to-use environment or undefined
 * if the user declined / setup failed.
 */
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

  const choice = await vscode.window.showInformationMessage(
    "The MarkItDown Python package is not installed in the detected environment. Install it now?",
    { detail: `Will run: ${env.python} -m pip install "markitdown[all]"`, modal: true },
    "Install"
  );
  if (choice !== "Install") {
    return undefined;
  }

  const installed = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "Installing markitdown[all] (this can take a minute)…" },
    async () => {
      const result = await run(env.python, ["-m", "pip", "install", "--user", "markitdown[all]"], 5 * 60 * 1000);
      if (!result.ok) {
        // Some environments (e.g. Debian/Ubuntu system Python) refuse --user installs
        // or are externally managed; surface the real error and offer the terminal.
        return result;
      }
      return result;
    }
  );

  if (!installed.ok) {
    const fallback = await vscode.window.showErrorMessage(
      "Automatic install failed. You can run the install command in a terminal instead.",
      "Open Terminal"
    );
    if (fallback === "Open Terminal") {
      const term = vscode.window.createTerminal("MarkItDown install");
      term.show();
      term.sendText(`${env.python} -m pip install --user "markitdown[all]"`, false);
    }
    return undefined;
  }

  const recheck = await detectPython();
  if (recheck?.hasMarkitdown) {
    vscode.window.showInformationMessage("MarkItDown installed successfully ✅");
    return recheck;
  }
  vscode.window.showErrorMessage("Install finished but the markitdown module still isn't importable. Check your Python environment.");
  return undefined;
}
