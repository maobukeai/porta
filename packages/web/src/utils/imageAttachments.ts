import type { MediaAttachment } from "../types";

const RASTER_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const PASSTHROUGH_TYPES = new Set(["image/gif", "image/svg+xml"]);
const MAX_ATTACHMENT_BYTES = 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 2621440;
const MAX_RASTER_DIMENSION = 2048;
const SCALE_STEPS = [1, 0.85, 0.7, 0.55];
const QUALITY_STEPS = [0.86, 0.76, 0.66, 0.56];

export interface PreparedAttachment extends MediaAttachment {
  bytes: number;
}

export function formatAttachmentBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.ceil(bytes / 1024)} KB`;
}

export async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function clampDimensions(width: number, height: number) {
  const longestEdge = Math.max(width, height);
  if (longestEdge <= MAX_RASTER_DIMENSION) return { width, height };
  const ratio = MAX_RASTER_DIMENSION / longestEdge;
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`Failed to decode ${file.name}`));
    };
    img.src = objectUrl;
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Image compression failed"));
          return;
        }
        resolve(blob);
      },
      mimeType,
      quality,
    );
  });
}

async function transcodeRaster(file: File): Promise<PreparedAttachment> {
  const img = await loadImage(file);
  const baseSize = clampDimensions(
    img.naturalWidth || img.width,
    img.naturalHeight || img.height,
  );
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    throw new Error("Canvas is unavailable for image processing");
  }

  for (const scale of SCALE_STEPS) {
    const width = Math.max(1, Math.round(baseSize.width * scale));
    const height = Math.max(1, Math.round(baseSize.height * scale));
    canvas.width = width;
    canvas.height = height;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    for (const mimeType of ["image/webp", "image/jpeg"]) {
      for (const quality of QUALITY_STEPS) {
        const blob = await canvasToBlob(canvas, mimeType, quality);
        if (blob.size <= MAX_ATTACHMENT_BYTES) {
          return {
            mimeType,
            inlineData: await blobToBase64(blob),
            bytes: blob.size,
          };
        }
      }
    }
  }

  throw new Error(
    `Couldn't shrink ${file.name} below ${formatAttachmentBytes(MAX_ATTACHMENT_BYTES)}.`,
  );
}

export async function prepareAttachment(file: File): Promise<PreparedAttachment> {
  if (RASTER_TYPES.has(file.type)) {
    if (file.size <= MAX_ATTACHMENT_BYTES) {
      return {
        mimeType: file.type,
        inlineData: await blobToBase64(file),
        bytes: file.size,
      };
    }
    return transcodeRaster(file);
  }

  if (PASSTHROUGH_TYPES.has(file.type)) {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      throw new Error(
        `${file.name} is ${formatAttachmentBytes(file.size)}. GIF and SVG attachments must stay under ${formatAttachmentBytes(MAX_ATTACHMENT_BYTES)}.`,
      );
    }
    return {
      mimeType: file.type,
      inlineData: await blobToBase64(file),
      bytes: file.size,
    };
  }

  throw new Error(`Unsupported image type: ${file.type || "unknown"}`);
}

export async function prepareAttachments(
  files: File[],
): Promise<PreparedAttachment[]> {
  const prepared: PreparedAttachment[] = [];
  let totalBytes = 0;

  for (const file of files) {
    const attachment = await prepareAttachment(file);
    totalBytes += attachment.bytes;
    if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
      throw new Error(
        `Attachments exceed ${formatAttachmentBytes(MAX_TOTAL_ATTACHMENT_BYTES)} total. Remove an image or use a smaller one.`,
      );
    }
    prepared.push(attachment);
  }

  return prepared;
}

export const attachmentLimits = {
  maxAttachmentBytes: MAX_ATTACHMENT_BYTES,
  maxTotalAttachmentBytes: MAX_TOTAL_ATTACHMENT_BYTES,
};

export interface AttachmentPreview {
  file?: File;
  dataUrl: string;
  mimeType?: string;
  inlineData?: string;
}

export function resolveMediaSrc(mediaItem: unknown): string | null {
  if (!mediaItem) return null;
  const item = mediaItem as any;

  // Direct string (data URL, blob, http, or local file path)
  if (typeof item === "string") {
    const trimmed = item.trim();
    if (
      trimmed.startsWith("data:") ||
      trimmed.startsWith("http://") ||
      trimmed.startsWith("https://") ||
      trimmed.startsWith("blob:")
    ) {
      return trimmed;
    }
    return `/api/files?uri=${encodeURIComponent(trimmed)}`;
  }

  // Extract mimeType
  const mimeType =
    item.mimeType ||
    item.mime_type ||
    item.payload?.mimeType ||
    item.payload?.mime_type ||
    "image/png";

  // Check fileUri / path / url / uri properties
  const uri =
    item.fileUri ||
    item.file_uri ||
    item.uri ||
    item.path ||
    item.url ||
    item.filePath;
  if (typeof uri === "string" && uri.trim()) {
    const trimmed = uri.trim();
    if (
      trimmed.startsWith("data:") ||
      trimmed.startsWith("http://") ||
      trimmed.startsWith("https://") ||
      trimmed.startsWith("blob:")
    ) {
      return trimmed;
    }
    return `/api/files?uri=${encodeURIComponent(trimmed)}`;
  }

  // Check payload from Connect RPC / Protobuf
  if (item.payload) {
    if (typeof item.payload === "string") {
      const trimmed = item.payload.trim();
      if (
        trimmed.startsWith("data:") ||
        trimmed.startsWith("http://") ||
        trimmed.startsWith("https://") ||
        trimmed.startsWith("blob:")
      ) {
        return trimmed;
      }
      return `/api/files?uri=${encodeURIComponent(trimmed)}`;
    }

    if (typeof item.payload === "object") {
      const pCase = item.payload.case;
      let pVal =
        item.payload.value ?? item.payload.inlineData ?? item.payload.data;
      let effMime = mimeType;
      if (typeof pVal === "object" && pVal !== null) {
        if (pVal.mimeType || pVal.mime_type) effMime = pVal.mimeType || pVal.mime_type;
        pVal = pVal.data || pVal.inlineData || pVal.value || pVal.bytes || pVal.fileUri || pVal.uri;
      }
      if (typeof pVal === "string" && pVal.trim()) {
        const trimmed = pVal.trim();
        if (
          pCase === "fileUri" ||
          pCase === "uri" ||
          pCase === "path" ||
          trimmed.startsWith("file://") ||
          trimmed.startsWith("/") ||
          /^[A-Za-z]:[\\/]/.test(trimmed)
        ) {
          return `/api/files?uri=${encodeURIComponent(trimmed)}`;
        }
        if (
          trimmed.startsWith("data:") ||
          trimmed.startsWith("http://") ||
          trimmed.startsWith("https://") ||
          trimmed.startsWith("blob:")
        ) {
          return trimmed;
        }
        return `data:${effMime};base64,${trimmed}`;
      }
    }
  }

  // Check inlineData / inline_data / data / bytes / base64
  let rawData =
    item.inlineData ??
    item.inline_data ??
    item.data ??
    item.bytes ??
    item.base64;

  if (typeof rawData === "object" && rawData !== null) {
    rawData =
      rawData.data || rawData.inlineData || rawData.value || rawData.bytes;
  }

  if (typeof rawData === "string" && rawData.trim()) {
    const trimmed = rawData.trim();
    if (
      trimmed.startsWith("file://") ||
      trimmed.startsWith("/") ||
      /^[A-Za-z]:[\\/]/.test(trimmed)
    ) {
      return `/api/files?uri=${encodeURIComponent(trimmed)}`;
    }
    if (
      trimmed.startsWith("data:") ||
      trimmed.startsWith("http://") ||
      trimmed.startsWith("https://") ||
      trimmed.startsWith("blob:")
    ) {
      return trimmed;
    }
    return `data:${mimeType};base64,${trimmed}`;
  }

  return null;
}

export function convertMediaToAttachmentPreviews(media: unknown[]): AttachmentPreview[] {
  if (!Array.isArray(media)) return [];
  const results: AttachmentPreview[] = [];

  for (const m of media) {
    if (!m) continue;
    const src = resolveMediaSrc(m);
    if (!src) continue;

    let mimeType = "image/png";
    let inlineData = "";

    const item = m as any;
    if (item.mimeType || item.mime_type) {
      mimeType = item.mimeType || item.mime_type;
    } else if (item.payload?.mimeType || item.payload?.mime_type) {
      mimeType = item.payload.mimeType || item.payload.mime_type;
    }

    // Extract raw base64 data from any known property
    let raw =
      item.inlineData ??
      item.inline_data ??
      item.data ??
      item.bytes ??
      item.base64 ??
      item.payload?.value ??
      item.payload?.inlineData ??
      item.payload?.inline_data ??
      item.payload?.data ??
      item.payload?.bytes;

    if (typeof raw === "object" && raw !== null) {
      if (raw.mimeType || raw.mime_type) {
        mimeType = raw.mimeType || raw.mime_type;
      }
      raw = raw.data || raw.inlineData || raw.value || raw.bytes;
    }

    if (typeof raw === "string" && raw.trim()) {
      const trimmed = raw.trim();
      if (trimmed.startsWith("data:")) {
        const commaIdx = trimmed.indexOf(",");
        if (commaIdx !== -1) {
          const header = trimmed.slice(0, commaIdx);
          const mimeMatch = header.match(/data:([^;]+)/);
          if (mimeMatch) mimeType = mimeMatch[1];
          inlineData = trimmed.slice(commaIdx + 1);
        }
      } else if (
        !trimmed.startsWith("file://") &&
        !trimmed.startsWith("/") &&
        !/^[A-Za-z]:[\\/]/.test(trimmed) &&
        !trimmed.startsWith("http://") &&
        !trimmed.startsWith("https://")
      ) {
        inlineData = trimmed;
      }
    } else if (src.startsWith("data:")) {
      const commaIdx = src.indexOf(",");
      if (commaIdx !== -1) {
        const header = src.slice(0, commaIdx);
        const mimeMatch = header.match(/data:([^;]+)/);
        if (mimeMatch) mimeType = mimeMatch[1];
        inlineData = src.slice(commaIdx + 1);
      }
    }

    results.push({
      dataUrl: src,
      mimeType,
      inlineData: inlineData || undefined,
    });
  }

  return results;
}

/** Converts any AttachmentPreview (local file, data URI, proxy url, blob) into a valid MediaAttachment ready for sending */
export async function ensureMediaAttachment(
  att: AttachmentPreview,
): Promise<MediaAttachment | null> {
  // 1. If we already have inlineData and mimeType, use it directly
  if (att.inlineData && typeof att.inlineData === "string" && att.inlineData.trim()) {
    let cleanBase64 = att.inlineData.trim();
    if (cleanBase64.startsWith("data:")) {
      const idx = cleanBase64.indexOf(",");
      if (idx !== -1) {
        cleanBase64 = cleanBase64.slice(idx + 1);
      }
    }
    return {
      mimeType: att.mimeType || "image/png",
      inlineData: cleanBase64,
    };
  }

  // 2. If it has a local File object, prepare and transcode it
  if (att.file instanceof File || (att.file && typeof (att.file as any).slice === "function")) {
    const [prepared] = await prepareAttachments([att.file]);
    if (prepared) {
      return {
        mimeType: prepared.mimeType,
        inlineData: prepared.inlineData,
      };
    }
  }

  // 3. If dataUrl is a base64 data URI (e.g. data:image/png;base64,...)
  if (att.dataUrl && att.dataUrl.startsWith("data:")) {
    const commaIdx = att.dataUrl.indexOf(",");
    if (commaIdx !== -1) {
      const header = att.dataUrl.slice(0, commaIdx);
      const base64 = att.dataUrl.slice(commaIdx + 1);
      const mimeMatch = header.match(/data:([^;]+)/);
      const mimeType = mimeMatch ? mimeMatch[1] : att.mimeType || "image/png";
      if (base64) {
        return {
          mimeType,
          inlineData: base64,
        };
      }
    }
  }

  // 4. If dataUrl is a fetchable URL (e.g. /api/files?uri=..., blob:..., http://..., https://...)
  if (att.dataUrl && typeof att.dataUrl === "string" && att.dataUrl.trim()) {
    try {
      const res = await fetch(att.dataUrl);
      if (res.ok) {
        const blob = await res.blob();
        const base64 = await blobToBase64(blob);
        const mimeType = att.mimeType || blob.type || "image/png";
        if (base64) {
          return {
            mimeType,
            inlineData: base64,
          };
        }
      }
    } catch (err) {
      console.warn("Failed to fetch image attachment from dataUrl:", att.dataUrl, err);
    }
  }

  return null;
}

