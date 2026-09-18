import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { VoiceState } from "@aro/shared";

interface Props {
  disabled: boolean;
  busy: boolean;
  voiceState: VoiceState;
  onSend: (text: string) => void;
  onToggleListen: () => void;
}

const VOICE_TITLE: Record<VoiceState, string> = {
  off: "Voz desligada. Sobe com pnpm dev:voice",
  idle: "Falar com o ARO (Ctrl+Shift+Espaço ou duas palmas)",
  listening: "Ouvindo. Clica de novo pra parar",
  hearing: "Ouvindo. Clica de novo pra parar",
  transcribing: "Transcrevendo",
  speaking: "Falar (interrompe o ARO)",
};

/** Mic sempre visível. Campo de texto aparece quando você começa a digitar; Esc esconde. */
export function Dock({ disabled, busy, voiceState, onSend, onToggleListen }: Props) {
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (typing || disabled) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT")) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.length === 1) {
        e.preventDefault();
        setText(e.key);
        setTyping(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [typing, disabled]);

  useEffect(() => {
    if (typing && ref.current) {
      ref.current.focus();
      const len = ref.current.value.length;
      ref.current.setSelectionRange(len, len);
    }
  }, [typing]);

  const dismiss = () => {
    setTyping(false);
    setText("");
  };

  const submit = () => {
    const value = text.trim();
    if (!value || disabled || busy) return;
    onSend(value);
    dismiss();
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      dismiss();
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const grow = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };

  return (
    <div className="dock" data-typing={String(typing)}>
      <button
        type="button"
        className="mic"
        data-state={voiceState}
        disabled={disabled || voiceState === "off" || voiceState === "transcribing"}
        onClick={onToggleListen}
        title={VOICE_TITLE[voiceState]}
        aria-label="Falar com o ARO"
        aria-pressed={voiceState === "listening" || voiceState === "hearing"}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="5.5" y="1.5" width="5" height="8" rx="2.5" />
          <path d="M3 7.5a5 5 0 0 0 10 0M8 12.5v2" strokeLinecap="round" />
        </svg>
      </button>

      {typing ? (
        <form
          className="dock-form"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <textarea
            ref={ref}
            rows={1}
            value={text}
            placeholder={busy ? "ARO está respondendo…" : "Fala com o ARO"}
            onChange={(e) => {
              setText(e.target.value);
              grow(e.target);
            }}
            onKeyDown={onKey}
            onBlur={() => {
              if (!text.trim()) dismiss();
            }}
            aria-label="Mensagem pro ARO"
          />
          <button className="send" type="submit" disabled={busy || !text.trim()} aria-label="Enviar">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M8 13V3M4 7l4-4 4 4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </form>
      ) : (
        <span className="dock-hint">{disabled ? "" : "digite pra escrever"}</span>
      )}
    </div>
  );
}
