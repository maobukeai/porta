/**
 * Windows Credential Manager access for Antigravity 2.x authentication.
 *
 * Antigravity 2.x stores its Google OAuth token as PLAINTEXT UTF-8 JSON in a
 * generic credential named "gemini:antigravity" (UserName "antigravity",
 * CRED_PERSIST_LOCAL_MACHINE). The legacy state.vscdb mechanism only applies
 * to the old "Antigravity IDE" app. Switching accounts therefore means:
 * write this credential, then restart the app so it reloads the token.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const ANTIGRAVITY_CREDENTIAL_TARGET = "gemini:antigravity";

export interface AntigravityCredentialToken {
  access_token: string;
  refresh_token: string;
  /** Epoch seconds. */
  expires_at: number;
  token_type?: string;
}

/**
 * Build the exact JSON blob the app expects (field names and auth_method
 * verified against a real credential entry).
 */
export function buildCredentialJson(token: AntigravityCredentialToken): string {
  return JSON.stringify({
    token: {
      access_token: token.access_token,
      token_type: token.token_type ?? "Bearer",
      refresh_token: token.refresh_token,
      expiry: new Date(token.expires_at * 1000).toISOString(),
    },
    auth_method: "consumer",
  });
}

// PowerShell P/Invoke shim for CredWriteW. The JSON travels base64-encoded
// via an env var to sidestep all command-line quoting hazards.
const CRED_WRITE_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;
public class CW {
  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)]
  public struct CREDENTIAL {
    public int Flags; public int Type; public string TargetName; public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist;
    public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
  }
  [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
  public static extern bool CredWriteW(ref CREDENTIAL cred,int flags);
}'
$json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:CRED_JSON_B64))
$bytes = [Text.Encoding]::UTF8.GetBytes($json)
$ptr = [Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)
try {
  [Runtime.InteropServices.Marshal]::Copy($bytes, 0, $ptr, $bytes.Length)
  $c = New-Object CW+CREDENTIAL
  $c.Type = 1
  $c.TargetName = '${ANTIGRAVITY_CREDENTIAL_TARGET}'
  $c.UserName = 'antigravity'
  $c.CredentialBlobSize = $bytes.Length
  $c.CredentialBlob = $ptr
  $c.Persist = 2
  if (-not [CW]::CredWriteW([ref]$c, 0)) { exit 2 }
} finally {
  [Runtime.InteropServices.Marshal]::FreeHGlobal($ptr)
}
`;

/** Overwrite the gemini:antigravity credential with the given token. */
export async function writeAntigravityCredential(
  token: AntigravityCredentialToken,
): Promise<void> {
  const json = buildCredentialJson(token);
  await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", CRED_WRITE_SCRIPT],
    {
      timeout: 10_000,
      windowsHide: true,
      env: {
        ...process.env,
        CRED_JSON_B64: Buffer.from(json, "utf-8").toString("base64"),
      },
    },
  );
}
