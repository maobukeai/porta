import { describe, expect, it } from "vitest";
import { resolveSafeHomeFilePath, resolveLocalCandidatePath } from "../routes/files.js";
import { resolve } from "node:path";

describe("resolveSafeHomeFilePath", () => {
  it("allows files under home", () => {
    expect(resolveSafeHomeFilePath("/home/test/image.png", "/home/test")).toBe(
      "/home/test/image.png",
    );
  });

  it("allows relative paths rooted at home", () => {
    expect(resolveSafeHomeFilePath("pics/cat.png", "/home/test")).toBe(
      "/home/test/pics/cat.png",
    );
  });

  it("rejects parent traversal outside home", () => {
    expect(resolveSafeHomeFilePath("../other/image.png", "/home/test")).toBeNull();
  });

  it("rejects prefix collisions outside home", () => {
    expect(resolveSafeHomeFilePath("/home/test2/image.png", "/home/test")).toBeNull();
  });

  it("allows file URIs under home", () => {
    expect(
      resolveSafeHomeFilePath("file:///home/test/pics/cat.png", "/home/test"),
    ).toBe("/home/test/pics/cat.png");
  });

  it("allows Windows drive-letter URIs under home", () => {
    expect(
      resolveSafeHomeFilePath(
        "file:///C:/Users/test/image.png",
        "C:\\Users\\test",
        true,
      ),
    ).toBe("C:\\Users\\test\\image.png");
  });

  it("allows legacy Windows drive-letter paths under home", () => {
    expect(
      resolveSafeHomeFilePath(
        "/C:/Users/test/image.png",
        "C:\\Users\\test",
        true,
      ),
    ).toBe("C:\\Users\\test\\image.png");
  });

  it("infers Windows paths from a Windows home", () => {
    expect(
      resolveSafeHomeFilePath("file:///C:/Users/test/pics/cat.png", "C:\\Users\\test"),
    ).toBe("C:\\Users\\test\\pics\\cat.png");
  });

  it("rejects Windows paths outside home", () => {
    expect(
      resolveSafeHomeFilePath(
        "file:///D:/shared/image.png",
        "C:\\Users\\test",
        true,
      ),
    ).toBeNull();
  });
});

describe("resolveLocalCandidatePath", () => {
  it("decodes URL encoded file URIs and finds existing files", () => {
    const pkgJson = resolve(process.cwd(), "package.json");
    const encoded = `file:///${encodeURIComponent(pkgJson.replaceAll("\\", "/"))}`;
    const result = resolveLocalCandidatePath(encoded);
    expect(result).toBeTruthy();
  });

  it("resolves relative path using workspaceUri", () => {
    const cwd = process.cwd();
    const result = resolveLocalCandidatePath("package.json", cwd);
    expect(result).toBeTruthy();
  });

  it("returns null for non-existent files", () => {
    const result = resolveLocalCandidatePath("definitely-not-existing-file-12345.xyz");
    expect(result).toBeNull();
  });
});
