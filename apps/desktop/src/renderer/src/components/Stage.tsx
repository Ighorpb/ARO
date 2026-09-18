import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { VoiceState } from "@aro/shared";
import { ORB_SIZE } from "./OrbLayer";
import type { OrbState } from "./OrbCanvas";
import type { Entry, LiveTurn, SpokenChunk } from "../hooks/useAro";

interface Props {
  slotRef: RefObject<HTMLDivElement | null>;
  orbState: OrbState;
  voiceState: VoiceState;
  live: LiveTurn | null;
  entries: Entry[];
  connected: boolean;
  spoken: SpokenChunk | null;
}

interface Caption {
  kind: "answer" | "alert" | "reminder";
  text: string;
  at: number;
}

const HEARD_TTL = 6000;
const ANSWER_TTL = 8000;
const REMINDER_TTL = 15000;
const THOUGHT_TAIL = 360;

export function statusOf(orbState: OrbState, voiceState: VoiceState, live: LiveTurn | null): string {
  if (orbState === "offline") return "core desligado";
  if (orbState === "sleeping") return "dormindo";
  if (voiceState === "listening" || voiceState === "hearing") return "ouvindo";
  if (voiceState === "transcribing") return "transcrevendo";
  if (live) {
    if (live.text) return "respondendo";
    if (live.tools.some((t) => t.ok === undefined)) return "usando ferramenta";
    return "pensando";
  }
  if (voiceState === "speaking") return "falando";
  return "";
}

/** Ritmo do pensamento em 0..1 a partir do crescimento do texto. */
export function useThinkIntensity(length: number, active: boolean): number {
  const samples = useRef<{ t: number; n: number }[]>([]);
  const [intensity, setIntensity] = useState(0);

  useEffect(() => {
    if (!active) {
      samples.current = [];
      setIntensity(0);
      return;
    }
    const now = performance.now();
    samples.current.push({ t: now, n: length });
    samples.current = samples.current.filter((s) => now - s.t <= 1200);
    const first = samples.current[0];
    if (first && now - first.t > 200) {
      const rate = ((length - first.n) / (now - first.t)) * 1000;
      setIntensity(Math.min(1, rate / 60));
    }
  }, [length, active]);

  return intensity;
}

const WARM_WORDS = /\b(boa|bom|ótim[oa]|show|beleza|legal|massa|perfeito|feito|pronto|tranquilo|top|maravilha|sucesso|deu certo)\b|!/i;
const COOL_WORDS = /\b(infelizmente|erro|falhou|não consegui|não deu|cuidado|problema|atenção|ruim|pior|perigo|atrasad[oa])\b/i;

/** -1..1: tom da resposta, só pra tingir o orb de leve. */
export function moodOf(text: string): number {
  if (!text) return 0;
  const tail = text.slice(-240);
  const warm = (tail.match(WARM_WORDS) ?? []).length;
  const cool = (tail.match(COOL_WORDS) ?? []).length;
  return Math.max(-1, Math.min(1, (warm - cool) * 0.5));
}

const normalize = (w: string) =>
  w
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");

/** Karaokê: quantas palavras da legenda já foram faladas (null = sem sincronia). */
function useSaidCount(captionText: string, captionKey: string, spoken: SpokenChunk | null): number | null {
  const pointer = useRef(0);
  const consumed = useRef<{ key: number; done: number }>({ key: 0, done: 0 });
  const [said, setSaid] = useState<number | null>(null);

  useEffect(() => {
    pointer.current = 0;
    consumed.current = { key: 0, done: 0 };
    setSaid(null);
  }, [captionKey]);

  useEffect(() => {
    if (!spoken || spoken.words.length === 0) return;
    const captionWords = captionText.split(/\s+/).filter(Boolean).map(normalize);
    const timer = window.setInterval(() => {
      const elapsed = (performance.now() - spoken.at) / 1000;
      const due = spoken.words.filter((w) => w.t <= elapsed);
      if (consumed.current.key !== spoken.at) consumed.current = { key: spoken.at, done: 0 };
      while (consumed.current.done < due.length) {
        const target = normalize(due[consumed.current.done]!.w);
        let idx = -1;
        for (let i = pointer.current; i < Math.min(captionWords.length, pointer.current + 8); i++) {
          if (captionWords[i] === target) {
            idx = i;
            break;
          }
        }
        pointer.current = idx >= 0 ? idx + 1 : Math.min(captionWords.length, pointer.current + 1);
        consumed.current.done++;
      }
      setSaid(pointer.current);
    }, 60);
    return () => window.clearInterval(timer);
  }, [spoken, captionText]);

  return said;
}

function Words({ text, said }: { text: string; said: number | null }) {
  const pieces = useMemo(() => text.split(/(\s+)/), [text]);
  if (said === null) return <>{text}</>;
  let index = 0;
  return (
    <>
      {pieces.map((piece, i) => {
        if (piece === "" || /^\s+$/.test(piece)) return piece;
        const k = index++;
        return (
          <span key={i} className={k < said ? "w said" : "w"}>
            {piece}
          </span>
        );
      })}
    </>
  );
}

/** Palco do modo cheio: o que ele ouviu, o lugar do orb, status, legendas. O orb em si vive no OrbLayer. */
export function Stage({ slotRef, orbState, voiceState, live, entries, connected, spoken }: Props) {
  const [heard, setHeard] = useState<{ text: string; at: number } | null>(null);
  const [caption, setCaption] = useState<Caption | null>(null);
  const lastEntry = entries.at(-1);
  const lastVoice = useRef(voiceState);
  const captionBox = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!lastEntry) return;
    const at = Date.now();
    if (lastEntry.role === "user") setHeard({ text: lastEntry.text, at });
    else if (lastEntry.role === "aro") setCaption({ kind: "answer", text: lastEntry.text, at });
    else if (lastEntry.role === "alert") setCaption({ kind: "alert", text: lastEntry.text, at });
    else if (lastEntry.role === "reminder") setCaption({ kind: "reminder", text: `Lembrete: ${lastEntry.text}`, at });
  }, [lastEntry?.id]);

  useEffect(() => {
    if (lastVoice.current === "speaking" && voiceState !== "speaking") {
      setCaption((c) => (c ? { ...c, at: Date.now() } : c));
    }
    lastVoice.current = voiceState;
  }, [voiceState]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      setHeard((h) => (h && now - h.at > HEARD_TTL && !live ? null : h));
      setCaption((c) => {
        if (!c || voiceState === "speaking") return c;
        const ttl = c.kind === "reminder" ? REMINDER_TTL : ANSWER_TTL;
        return now - c.at > ttl ? null : c;
      });
    }, 400);
    return () => window.clearInterval(timer);
  }, [live, voiceState]);

  const thinkingLive = Boolean(live && live.thinking && !live.text);
  const answer = live?.text ? { kind: "answer" as const, text: live.text, at: 0 } : caption;
  const thought = thinkingLive ? live!.thinking.slice(-THOUGHT_TAIL) : "";
  const captionKey = live?.id ?? `${caption?.at ?? 0}`;
  const said = useSaidCount(answer?.text ?? "", captionKey, spoken);

  useEffect(() => {
    const box = captionBox.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [answer?.text.length, thought.length]);

  const status = statusOf(orbState, voiceState, live);

  return (
    <main className="stage">
      <p className="heard" data-show={String(Boolean(heard))}>
        {heard?.text}
      </p>

      <div ref={slotRef} className="orb-slot" style={{ width: ORB_SIZE * 2, height: ORB_SIZE * 2 }} />

      <p className="status">{status || (connected ? "" : "sobe o core com pnpm dev:core")}</p>

      <div ref={captionBox} className="captions">
        <p className="thought caption-thought" data-show={String(Boolean(thought))} aria-live="polite">
          {thought}
          {thought && <span className="caret" />}
        </p>
        <p className={`caption caption-${answer?.kind ?? "answer"}`} data-show={String(Boolean(answer))} aria-live="polite">
          {answer && <Words text={answer.text} said={answer.kind === "answer" ? said : null} />}
          {live?.text && <span className="caret" />}
        </p>
      </div>
    </main>
  );
}
