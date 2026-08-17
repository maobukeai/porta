export interface ProcessDiscoveryCandidate {
  pid: number;
  csrfToken: string;
  workspaceId?: string;
  appDataDir?: string;
  httpsPort: number;
  httpPort: number;
  lspPort: number;
  /** Absolute path of the language_server executable, when known. */
  executablePath?: string;
}

export interface PlatformAdapter {
  readonly id: "linux" | "darwin" | "win32";
  isPidAlive(pid: number): Promise<boolean>;
  discoverFromProcess(): Promise<ProcessDiscoveryCandidate[]>;
  discoverPortsForPid(pid: number): Promise<number[]>;
  /** PIDs of running processes whose image name matches (e.g. "Antigravity"). */
  findProcessPidsByName(imageName: string): Promise<number[]>;
}
