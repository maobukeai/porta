/**
 * Universal cross-platform clipboard copy helper.
 *
 * Supports:
 * - Modern HTTPS / localhost via navigator.clipboard.writeText
 * - Non-secure HTTP LAN IP (e.g. mobile browser accessing http://192.168.x.x) via document.execCommand fallback
 * - iOS Safari & Android WebView range selection
 */
export async function copyText(text: string): Promise<boolean> {
  if (typeof text !== "string") {
    text = String(text ?? "");
  }

  // 1. Try modern Clipboard API if supported and in a secure context
  if (
    typeof navigator !== "undefined" &&
    navigator.clipboard &&
    typeof navigator.clipboard.writeText === "function"
  ) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permission denied or non-secure context — fallback to execCommand below
    }
  }

  // 2. Fallback using temporary textarea + document.execCommand('copy')
  try {
    if (typeof document === "undefined" || !document.body) {
      return false;
    }

    const textArea = document.createElement("textarea");
    textArea.value = text;

    // Prevent zoom/scrolling and keep out of viewport visually
    textArea.style.position = "fixed";
    textArea.style.top = "0";
    textArea.style.left = "0";
    textArea.style.width = "2em";
    textArea.style.height = "2em";
    textArea.style.padding = "0";
    textArea.style.border = "none";
    textArea.style.outline = "none";
    textArea.style.boxShadow = "none";
    textArea.style.background = "transparent";
    textArea.style.opacity = "0";
    textArea.style.zIndex = "-9999";
    textArea.setAttribute("readonly", "");
    textArea.setAttribute("aria-hidden", "true");

    document.body.appendChild(textArea);

    // iOS Safari requires range selection
    const isIOS =
      typeof navigator !== "undefined" &&
      /iPad|iPhone|iPod/.test(navigator.userAgent || "");

    if (isIOS) {
      const range = document.createRange();
      range.selectNodeContents(textArea);
      const selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
        selection.addRange(range);
      }
      textArea.setSelectionRange(0, text.length);
    } else {
      textArea.focus({ preventScroll: true });
      textArea.select();
    }

    const successful = document.execCommand("copy");
    document.body.removeChild(textArea);
    return successful;
  } catch (err) {
    console.error("[clipboard] copy failed:", err);
    return false;
  }
}
