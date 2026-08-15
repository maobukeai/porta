import { marked, type Tokens } from "marked";
import { getApiBase } from "../api/client";

const SAFE_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);
const SAFE_IMAGE_PROTOCOLS = new Set(["http:", "https:", "data:", "blob:"]);

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function decodeHtmlEntities(text: string): string {
  return text.replace(
    /&(?:#(\d+)|#x([0-9a-fA-F]+)|([a-zA-Z]+));/g,
    (_match, dec, hex, named) => {
      if (dec) {
        return String.fromCodePoint(parseInt(dec, 10));
      }
      if (hex) {
        return String.fromCodePoint(parseInt(hex, 16));
      }
      switch (named.toLowerCase()) {
        case "colon":
          return ":";
        case "tab":
          return "\t";
        case "newline":
          return "\n";
        case "amp":
          return "&";
        default:
          return _match;
      }
    },
  );
}

function stripUnsafeUriChars(text: string): string {
  return Array.from(text)
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code > 0x20 && (code < 0x7f || code > 0x9f);
    })
    .join("");
}

function isSafeUri(
  uri: string | null | undefined,
  allowedProtocols: ReadonlySet<string>,
): boolean {
  if (!uri) return false;

  const normalized = stripUnsafeUriChars(decodeHtmlEntities(uri.trim()))
    .toLowerCase();

  if (!normalized) return false;

  if (
    normalized.startsWith("#") ||
    normalized.startsWith("/") ||
    normalized.startsWith("./") ||
    normalized.startsWith("../") ||
    normalized.startsWith("?") ||
    normalized.startsWith("//")
  ) {
    return true;
  }

  const schemeMatch = normalized.match(/^([a-z][a-z0-9+.-]*:)/);
  if (!schemeMatch) {
    return true;
  }

  return allowedProtocols.has(schemeMatch[1]);
}

const renderer = new marked.Renderer();
const originalLink = renderer.link.bind(renderer);
const originalImage = renderer.image.bind(renderer);

renderer.html = function ({ text }: Tokens.HTML | Tokens.Tag) {
  return escapeHtml(text);
};

renderer.link = function (token: Tokens.Link) {
  if (!isSafeUri(token.href, SAFE_LINK_PROTOCOLS)) {
    return this.parser.parseInline(token.tokens);
  }

  const html = originalLink(token);
  // Inject target="_blank" and security attrs into every <a> tag
  return html.replace(/^<a /, '<a target="_blank" rel="noopener noreferrer" ');
};

renderer.image = function (token: Tokens.Image) {
  if (!isSafeUri(token.href, SAFE_IMAGE_PROTOCOLS)) {
    return escapeHtml(token.text);
  }

  return originalImage(token);
};

marked.setOptions({ gfm: true, breaks: true, renderer });

// ── Caching Markdown Rendering ──

const markdownCache = new Map<string, string>();

/** Convert file:// and local paths in markdown to proxy URLs */
export function rewriteFileUris(text: string): string {
  const base = getApiBase();
  return text.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    (fullMatch, alt, uri) => {
      const trimmed = uri.trim();
      if (
        trimmed.startsWith("http://") ||
        trimmed.startsWith("https://") ||
        trimmed.startsWith("data:") ||
        trimmed.startsWith("blob:") ||
        (base && trimmed.startsWith(`${base}/api/files`)) ||
        (!base && trimmed.startsWith("/api/files"))
      ) {
        return fullMatch;
      }
      if (
        trimmed.startsWith("file://") ||
        /^[A-Za-z]:[\\/]/.test(trimmed) ||
        trimmed.startsWith("/C:") ||
        trimmed.startsWith("/Users/") ||
        trimmed.startsWith("/home/") ||
        trimmed.startsWith("/tmp/") ||
        trimmed.startsWith("/var/")
      ) {
        return `![${alt}](${base}/api/files?uri=${encodeURIComponent(trimmed)})`;
      }
      return fullMatch;
    },
  );
}

export function renderMarkdown(text: string): string {
  if (markdownCache.has(text)) {
    return markdownCache.get(text)!;
  }

  const rewritten = rewriteFileUris(text);
  const html = marked.parse(rewritten, { async: false }) as string;

  // Cap the cache to prevent unbounded growth
  if (markdownCache.size > 500) {
    const firstKey = markdownCache.keys().next().value!;
    markdownCache.delete(firstKey);
  }

  markdownCache.set(text, html);
  return html;
}
