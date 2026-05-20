import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function runPicker(command, args, { parse = (stdout) => stdout.trim() } = {}) {
  try {
    const { stdout } = await execFileAsync(command, args, { timeout: 120_000 });
    const path = parse(stdout);
    return path ? { path } : { path: null };
  } catch (error) {
    if (error.code === 1 || error.signal === "SIGTERM") return { path: null };
    return null;
  }
}

export async function pickFolder() {
  const attempts = [
    () => runPicker("zenity", ["--file-selection", "--directory", "--title=Select project folder"]),
    () => runPicker("kdialog", ["--getexistingdirectory", process.env.HOME || "/"]),
    () => runPicker("yad", ["--file-selection", "--directory", "--title=Select project folder"]),
    () =>
      runPicker("python3", [
        "-c",
        [
          "import tkinter as tk",
          "from tkinter import filedialog",
          "root=tk.Tk()",
          "root.withdraw()",
          "path=filedialog.askdirectory(title='Select project folder')",
          "print(path or '')"
        ].join(";")
      ])
  ];

  for (const attempt of attempts) {
    const result = await attempt();
    if (result) return result;
  }

  throw new Error("No folder picker found. Install zenity, kdialog, yad, or python3-tk.");
}
