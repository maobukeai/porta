import {
  isLanguageServerExecutable,
  parseNetstatPorts,
  parseWin32ProcessCandidates,
  runCommand,
} from "./shared.js";
import type { PlatformAdapter } from "./types.js";

const POWERSHELL = "powershell.exe";
const DISCOVER_PROCESS_COMMAND =
  "Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'language_server*' } | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress";

export const win32Adapter: PlatformAdapter = {
  id: "win32",

  async isPidAlive(pid) {
    try {
      const output = await runCommand(POWERSHELL, [
        "-NoProfile",
        "-Command",
        `Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" | Select-Object Name | ConvertTo-Json -Compress`,
      ]);
      const trimmed = output.trim();
      if (!trimmed) return false;

      const parsed = JSON.parse(trimmed) as
        | { Name?: string | null }
        | { Name?: string | null }[]
        | null;
      const record = Array.isArray(parsed) ? parsed[0] : parsed;
      return typeof record?.Name === "string" && isLanguageServerExecutable(record.Name);
    } catch {
      return false;
    }
  },

  async discoverFromProcess() {
    try {
      const output = await runCommand(POWERSHELL, [
        "-NoProfile",
        "-Command",
        DISCOVER_PROCESS_COMMAND,
      ]);
      return parseWin32ProcessCandidates(output);
    } catch {
      return [];
    }
  },

  async discoverPortsForPid(pid) {
    try {
      const output = await runCommand("netstat", ["-ano", "-p", "tcp"]);
      return parseNetstatPorts(output, pid);
    } catch {
      return [];
    }
  },

  async findProcessPidsByName(imageName) {
    const exeName = imageName.toLowerCase().endsWith(".exe")
      ? imageName
      : `${imageName}.exe`;
    try {
      const output = await runCommand("tasklist", [
        "/FI",
        `IMAGENAME eq ${exeName}`,
        "/FO",
        "CSV",
        "/NH",
      ]);
      const pids: number[] = [];
      for (const line of output.split("\n")) {
        const columns = line.split('","');
        if (columns.length < 2) continue;
        const pid = parseInt(columns[1].replace(/[^0-9]/g, ""), 10);
        if (!Number.isNaN(pid) && pid > 0) pids.push(pid);
      }
      return pids;
    } catch {
      return [];
    }
  },
};
