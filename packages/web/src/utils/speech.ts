/**
 * Utility for Web Speech STT (Speech To Text) and TTS (Text To Speech)
 */

// ── Markdown Stripper for TTS ──

/**
 * Strips code blocks, Markdown symbols, HTML tags, and URLs from markdown text,
 * leaving clean natural language sentences suitable for TTS voice reading.
 */
export function stripMarkdownForTTS(markdown: string): string {
  if (!markdown) return "";

  let text = markdown;

  // Remove code blocks (```...```)
  text = text.replace(/```[\s\S]*?```/g, " [代码块已略过] ");

  // Remove inline code (`...`)
  text = text.replace(/`([^`]+)`/g, "$1");

  // Remove markdown headers (#, ##, etc.)
  text = text.replace(/^#{1,6}\s+/gm, "");

  // Remove images (![alt](url))
  text = text.replace(/!\[.*?\]\(.*?\)/g, "");

  // Replace links ([text](url)) with text
  text = text.replace(/\[([^\]]+)\]\(.*?\)/g, "$1");

  // Remove HTML tags
  text = text.replace(/<[^>]*>/g, "");

  // Remove bold, italic, strikethrough (*, _, ~)
  text = text.replace(/([*_~]{1,3})(.*?)\1/g, "$2");

  // Remove blockquotes (>)
  text = text.replace(/^\s*>\s+/gm, "");

  // Remove horizontal rules (---, ***)
  text = text.replace(/^[-*_]{3,}\s*$/gm, "");

  // Remove excess whitespace
  text = text.replace(/\n+/g, " ").replace(/\s+/g, " ").trim();

  return text;
}

// ── Speech To Text (STT) ──

export interface STTController {
  start: () => void;
  stop: () => void;
  isListening: boolean;
}

export function isSTTSupported(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(
    window.SpeechRecognition || (window as any).webkitSpeechRecognition,
  );
}

export function createSTT({
  onResult,
  onError,
  onEnd,
}: {
  onResult: (transcript: string, isFinal: boolean) => void;
  onError?: (err: string) => void;
  onEnd?: () => void;
}): STTController | null {
  if (!isSTTSupported()) return null;

  const SpeechRecognitionClass =
    window.SpeechRecognition || (window as any).webkitSpeechRecognition;
  const recognition = new SpeechRecognitionClass();

  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = "zh-CN";

  let listening = false;

  recognition.onresult = (event: any) => {
    let finalTranscript = "";
    let interimTranscript = "";

    for (let i = event.resultIndex; i < event.results.length; ++i) {
      if (event.results[i].isFinal) {
        finalTranscript += event.results[i][0].transcript;
      } else {
        interimTranscript += event.results[i][0].transcript;
      }
    }

    const transcript = finalTranscript || interimTranscript;
    if (transcript) {
      onResult(transcript, Boolean(finalTranscript));
    }
  };

  recognition.onerror = (event: any) => {
    listening = false;
    onError?.(event.error);
  };

  recognition.onend = () => {
    listening = false;
    onEnd?.();
  };

  return {
    start: () => {
      try {
        listening = true;
        recognition.start();
      } catch (e) {
        listening = false;
        onError?.(String(e));
      }
    },
    stop: () => {
      listening = false;
      try {
        recognition.stop();
      } catch {}
    },
    get isListening() {
      return listening;
    },
  };
}

// ── Text To Speech (TTS) ──

export function isTTSSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean("speechSynthesis" in window) &&
    Boolean("SpeechSynthesisUtterance" in window)
  );
}

export function speakTTS(
  text: string,
  options?: {
    onEnd?: () => void;
    onError?: () => void;
  },
): boolean {
  if (!isTTSSupported()) return false;

  stopTTS();

  const cleanText = stripMarkdownForTTS(text);
  if (!cleanText) return false;

  const utterance = new SpeechSynthesisUtterance(cleanText);
  utterance.lang = "zh-CN";
  utterance.rate = 1.0;
  utterance.pitch = 1.0;

  utterance.onend = () => {
    options?.onEnd?.();
  };

  utterance.onerror = () => {
    options?.onError?.();
  };

  window.speechSynthesis.speak(utterance);
  return true;
}

export function stopTTS(): void {
  if (isTTSSupported() && window.speechSynthesis.speaking) {
    window.speechSynthesis.cancel();
  }
}

export function isTTSSpeaking(): boolean {
  return isTTSSupported() && window.speechSynthesis.speaking;
}
