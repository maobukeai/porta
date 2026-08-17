import { describe, it, expect } from "vitest";
import { buildCredentialJson } from "../win-credential.js";

describe("buildCredentialJson", () => {
  it("builds the exact blob format Antigravity 2.x expects", () => {
    const json = JSON.parse(
      buildCredentialJson({
        access_token: "ya29.test",
        refresh_token: "1//rt",
        expires_at: 1786890418,
      }),
    );
    expect(Object.keys(json)).toEqual(["token", "auth_method"]);
    expect(json.auth_method).toBe("consumer");
    expect(json.token.access_token).toBe("ya29.test");
    expect(json.token.refresh_token).toBe("1//rt");
    expect(json.token.token_type).toBe("Bearer");
    // expiry must be RFC3339 from epoch seconds
    expect(json.token.expiry).toBe(new Date(1786890418 * 1000).toISOString());
  });
});
