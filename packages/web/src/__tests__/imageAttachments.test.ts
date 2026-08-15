import { describe, expect, it } from "vitest";
import {
  attachmentLimits,
  prepareAttachment,
  prepareAttachments,
  convertMediaToAttachmentPreviews,
  ensureMediaAttachment,
} from "../utils/imageAttachments";

function fileOfSize(size: number, name: string, type: string): File {
  return new File([new Uint8Array(size)], name, { type });
}

describe("imageAttachments", () => {
  it("passes through small svg files", async () => {
    const file = new File(["<svg></svg>"], "small.svg", {
      type: "image/svg+xml",
    });

    const prepared = await prepareAttachment(file);

    expect(prepared.mimeType).toBe("image/svg+xml");
    expect(prepared.bytes).toBe(file.size);
    expect(prepared.inlineData.length).toBeGreaterThan(0);
  });

  it("rejects oversized svg files", async () => {
    const file = fileOfSize(
      attachmentLimits.maxAttachmentBytes + 1,
      "large.svg",
      "image/svg+xml",
    );

    await expect(prepareAttachment(file)).rejects.toThrow(
      "GIF and SVG attachments must stay under",
    );
  });

  it("rejects attachment batches that exceed the total limit", async () => {
    const perFile = Math.min(
      attachmentLimits.maxAttachmentBytes - 1,
      900 * 1024,
    );
    const files = [
      fileOfSize(perFile, "one.svg", "image/svg+xml"),
      fileOfSize(perFile, "two.svg", "image/svg+xml"),
      fileOfSize(perFile, "three.svg", "image/svg+xml"),
    ];

    await expect(prepareAttachments(files)).rejects.toThrow(
      "Attachments exceed",
    );
  });

  it("converts revert media items to attachment previews and ensures media attachments for send", async () => {
    const rawMedia = [
      {
        mimeType: "image/png",
        inlineData: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      },
      {
        payload: {
          case: "inlineData",
          value: {
            mimeType: "image/jpeg",
            data: "abc123456",
          },
        },
      },
      "data:image/webp;base64,UklGRkAAAABXRUJQVlA4IDQAAADwAQCdASoBAAEAAQAcJaACdLoAAP7/2wAA",
    ];

    const previews = convertMediaToAttachmentPreviews(rawMedia);
    expect(previews).toHaveLength(3);
    expect(previews[0].inlineData).toBeDefined();
    expect(previews[0].mimeType).toBe("image/png");
    expect(previews[1].inlineData).toBe("abc123456");
    expect(previews[1].mimeType).toBe("image/jpeg");
    expect(previews[2].mimeType).toBe("image/webp");

    const m0 = await ensureMediaAttachment(previews[0]);
    expect(m0?.mimeType).toBe("image/png");
    expect(m0?.inlineData).toBeTruthy();

    const m1 = await ensureMediaAttachment(previews[1]);
    expect(m1?.mimeType).toBe("image/jpeg");
    expect(m1?.inlineData).toBe("abc123456");

    const m2 = await ensureMediaAttachment(previews[2]);
    expect(m2?.mimeType).toBe("image/webp");
    expect(m2?.inlineData).toBe("UklGRkAAAABXRUJQVlA4IDQAAADwAQCdASoBAAEAAQAcJaACdLoAAP7/2wAA");
  });
});

