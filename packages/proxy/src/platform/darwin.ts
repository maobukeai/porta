import { hasAliveSignal, parseLsofPorts, parsePsCandidates, runCommand } from "./shared.js";
import type { PlatformAdapter } from "./types.js";

export const darwinAdapter: PlatformAdapter = {
  id: "darwin",

  async isPidAlive(pid) {
    if (!hasAliveSignal(pid)) return false;

    try {
      const comm = await runCommand("ps", ["-p", String(pid), "-o", "comm="]);
      return comm.includes("language_server");
    } catch {
      return false;
    }
  },

  async discoverFromProcess() {
    try {
      const output = await runCommand("ps", ["-axo", "pid=,args="]);
      return parsePsCandidates(output);
    } catch {
      return [];
    }
  },

  async discoverPortsForPid(pid) {
    try {
      const output = await runCommand("lsof", [
        "-nP",
        "-iTCP",
        "-sTCP:LISTEN",
        "-a",
        "-p",
        String(pid),
      ]);
      return parseLsofPorts(output);
    } catch {
      return [];
    }
  },

  async findProcessPidsByName(imageName) {
    try {
      const output = await runCommand("pgrep", ["-f", imageName]);
      return output
        .split("\n")
        .map((line) => parseInt(line.trim(), 10))
        .filter((pid) => !Number.isNaN(pid) && pid > 0);
    } catch {
      return [];
    }
  },
};
