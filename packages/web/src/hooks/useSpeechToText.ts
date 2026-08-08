import { useState, useRef, useEffect, useCallback } from "react";
import { triggerHaptic } from "../utils/haptics";

// Declare Web Speech API types for TypeScript
interface SpeechRecognitionErrorEvent extends Event {
  error: string;
}

interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: (event: SpeechRecognitionEvent) => void;
  onerror: (event: SpeechRecognitionErrorEvent) => void;
  onend: () => void;
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionInstance;
}

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

export interface UseSpeechToTextOptions {
  onTranscript?: (text: string) => void;
  lang?: string;
}

export function useSpeechToText({
  onTranscript,
  lang = "zh-CN",
}: UseSpeechToTextOptions = {}) {
  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  const userIntentListeningRef = useRef(false);

  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const SpeechRecognition =
        window.SpeechRecognition || window.webkitSpeechRecognition;
      setIsSupported(Boolean(SpeechRecognition));
    }
  }, []);

  const stopListening = useCallback(() => {
    userIntentListeningRef.current = false;
    if (recognitionRef.current) {
      triggerHaptic("medium");
      try {
        recognitionRef.current.stop();
      } catch {}
      recognitionRef.current = null;
    }
    setIsListening(false);
  }, []);

  const startListening = useCallback(() => {
    if (typeof window === "undefined") return;

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setError("当前浏览器不支持语音识别");
      return;
    }

    try {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {}
      }

      triggerHaptic("success");
      userIntentListeningRef.current = true;

      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
      const recognition = new SpeechRecognition();

      // Mobile Safari / Chrome auto-closes immediately if continuous=true is set
      recognition.continuous = !isMobile;
      recognition.interimResults = true;
      recognition.lang = lang;

      let lastEmittedText = "";

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        let text = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          text += result[0].transcript;
        }

        const trimmed = text.trim();
        if (trimmed && trimmed !== lastEmittedText && onTranscriptRef.current) {
          lastEmittedText = trimmed;
          onTranscriptRef.current(trimmed);
        }
      };

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        console.warn("[useSpeechToText] Speech error:", event.error);
        if (event.error === "not-allowed" || event.error === "service-not-allowed") {
          setError("请允许浏览器访问麦克风权限");
          userIntentListeningRef.current = false;
          setIsListening(false);
        } else if (event.error !== "no-speech" && event.error !== "aborted") {
          setError(`语音识别提示: ${event.error}`);
        }
      };

      recognition.onend = () => {
        // If user still intends to listen on desktop, keep listening
        if (userIntentListeningRef.current && !isMobile) {
          try {
            recognition.start();
            return;
          } catch {}
        }
        userIntentListeningRef.current = false;
        setIsListening(false);
      };

      recognition.start();
      recognitionRef.current = recognition;
      setIsListening(true);
      setError(null);
    } catch (err) {
      console.error("[useSpeechToText] Start error:", err);
      setError("启动语音识别失败，请检查麦克风权限");
      userIntentListeningRef.current = false;
      setIsListening(false);
    }
  }, [lang]);

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening]);

  return {
    isListening,
    isSupported,
    error,
    startListening,
    stopListening,
    toggleListening,
  };
}
