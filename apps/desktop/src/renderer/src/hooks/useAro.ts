import { useCallback, useEffect, useReducer, useRef } from "react";
import type { AroState, RouteSource, ServerEvent, Tier, TranscriptEntry, VoiceSource, VoiceState } from "@aro/shared";

const HUB_URL = new URLSearchParams(window.location.search).get("hub") ?? "ws://localhost:7777";

export interface ToolCall {
  toolId: string;
  name: string;
  ok?: boolean;
  /** memory create/str_replace/insert — faísca quando terminar */
  saving?: boolean;
}

export interface LiveTurn {
  id: string;
  tier: Tier;
  model: string;
  source: RouteSource;
  reason?: string;
  thinking: string;
  text: string;
  tools: ToolCall[];
  startedAt: number;
  firstTextAt?: number;
  costUsd?: number;
}

export interface SpokenChunk {
  text: string;
  words: { t: number; w: string }[];
  /** performance.now() de quando começou a tocar */
  at: number;
}

export type Entry =
  | TranscriptEntry
  | { id: string; role: "alert"; text: string; at: number }
  | { id: string; role: "reminder"; text: string; at: number };

interface State {
  connected: boolean;
  tiers: Record<Tier, string> | null;
  lastModel: string;
  aroState: AroState;
  voiceState: VoiceState;
  voiceSource: VoiceSource | null;
  voiceLevel: number;
  muted: boolean;
  entries: Entry[];
  live: LiveTurn | null;
  spoken: SpokenChunk | null;
  memorySaves: number;
  lastActivity: number;
  compact: boolean;
}

type Action =
  | { type: "connected"; value: boolean }
  | { type: "server"; event: ServerEvent }
  | { type: "compact"; value: boolean }
  | { type: "activity" };

const initial: State = {
  connected: false,
  tiers: null,
  lastModel: "",
  aroState: "idle",
  voiceState: "off",
  voiceSource: null,
  voiceLevel: 0,
  muted: false,
  entries: [],
  live: null,
  spoken: null,
  memorySaves: 0,
  lastActivity: Date.now(),
  compact: false,
};

/** Cliente conectou no meio do turno: monta um turno ao vivo mínimo pra não perder o stream. */
function orphanLive(id: string): LiveTurn {
  return { id, tier: "main", model: "", source: "fallback", thinking: "", text: "", tools: [], startedAt: Date.now() };
}

const QUIET_EVENTS = new Set(["hello", "history", "state", "voice.mute"]);

function reducer(state: State, action: Action): State {
  if (action.type === "compact") return { ...state, compact: action.value };
  if (action.type === "activity") return { ...state, lastActivity: Date.now() };
  if (action.type === "server") {
    const e = action.event;
    const quiet = QUIET_EVENTS.has(e.type) || (e.type === "voice.level" && e.level < 0.25) || (e.type === "voice.state" && e.state === "idle");
    if (!quiet) state = { ...state, lastActivity: Date.now() };
  }
  if (action.type === "connected") {
    return {
      ...state,
      connected: action.value,
      aroState: action.value ? state.aroState : "idle",
      voiceState: action.value ? state.voiceState : "off",
    };
  }

  const e = action.event;
  switch (e.type) {
    case "hello":
      return { ...state, tiers: e.tiers };
    case "state":
      return { ...state, aroState: e.state };
    case "history":
      return { ...state, entries: e.entries, live: null };
    case "user.echo":
      return {
        ...state,
        entries: [...state.entries, { id: e.id, role: "user", text: e.text, channel: e.channel, at: Date.now() }],
      };
    case "turn.start":
      return {
        ...state,
        spoken: null,
        lastModel: e.model,
        live: {
          id: e.id,
          tier: e.tier,
          model: e.model,
          source: e.source,
          reason: e.reason,
          thinking: "",
          text: "",
          tools: [],
          startedAt: Date.now(),
        },
      };
    case "thinking.delta": {
      const live = state.live ?? orphanLive(e.id);
      return { ...state, live: { ...live, thinking: live.thinking + e.text } };
    }
    case "text.delta": {
      const live = state.live ?? orphanLive(e.id);
      return { ...state, live: { ...live, text: live.text + e.text, firstTextAt: live.firstTextAt ?? Date.now() } };
    }
    case "tool.start": {
      const live = state.live ?? orphanLive(e.id);
      const saving = e.name === "memory" && ["create", "str_replace", "insert"].includes(e.detail ?? "");
      return { ...state, live: { ...live, tools: [...live.tools, { toolId: e.toolId, name: e.name, saving }] } };
    }
    case "tool.done": {
      if (!state.live) return state;
      const saved = e.ok && state.live.tools.some((t) => t.toolId === e.toolId && t.saving);
      return {
        ...state,
        memorySaves: saved ? state.memorySaves + 1 : state.memorySaves,
        live: {
          ...state.live,
          tools: state.live.tools.map((t) => (t.toolId === e.toolId ? { ...t, ok: e.ok } : t)),
        },
      };
    }
    case "turn.done": {
      if (!state.live) return state;
      const { id, text, thinking, startedAt, firstTextAt, tier, model } = state.live;
      const costUsd = e.costUsd;
      const entry: TranscriptEntry = {
        id,
        role: "aro",
        text,
        thinking: thinking || undefined,
        thinkingMs: thinking ? (firstTextAt ?? Date.now()) - startedAt : undefined,
        tier,
        model,
        costUsd,
        at: Date.now(),
      };
      return { ...state, live: null, entries: [...state.entries, entry] };
    }
    case "error":
      return {
        ...state,
        live: null,
        entries: [...state.entries, { id: crypto.randomUUID(), role: "alert", text: e.message, at: Date.now() }],
      };
    case "voice.state":
      return {
        ...state,
        voiceState: e.state,
        voiceSource: e.source ?? null,
        voiceLevel: e.state === "listening" || e.state === "hearing" ? state.voiceLevel : 0,
        spoken: e.state === "speaking" ? state.spoken : null,
      };
    case "voice.chunk": {
      // mesma frase chegando com mais palavras (streaming): mantém o relógio, atualiza a lista
      if (state.spoken && state.spoken.text === e.text) {
        return { ...state, spoken: { ...state.spoken, words: e.words.length >= state.spoken.words.length ? e.words : state.spoken.words } };
      }
      return { ...state, spoken: { text: e.text, words: e.words, at: performance.now() } };
    }
    case "voice.level":
      return { ...state, voiceLevel: e.level };
    case "voice.mute":
      return { ...state, muted: e.muted };
    case "reminder.fired":
      return {
        ...state,
        entries: [...state.entries, { id: crypto.randomUUID(), role: "reminder", text: e.text, at: Date.now() }],
      };
    default:
      return state;
  }
}

/** Pedidos do core que o desktop sabe atender: print da tela, área de transferência. */
async function answerSysRequest(ws: WebSocket, id: string, kind: "screen" | "clipboard") {
  try {
    const data = kind === "screen" ? await window.aro.captureScreen() : await window.aro.readClipboard();
    ws.send(JSON.stringify({ type: "sys.result", id, ok: true, data }));
  } catch (err) {
    ws.send(JSON.stringify({ type: "sys.result", id, ok: false, error: err instanceof Error ? err.message : String(err) }));
  }
}

export function useAro() {
  const [state, dispatch] = useReducer(reducer, initial);
  const wsRef = useRef<WebSocket | null>(null);
  const liveRef = useRef(state.live);
  liveRef.current = state.live;

  useEffect(() => {
    let retry = 1000;
    let timer: number | undefined;
    let closed = false;

    const connect = () => {
      const ws = new WebSocket(HUB_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        retry = 1000;
        dispatch({ type: "connected", value: true });
      };
      ws.onmessage = (m) => {
        const event = JSON.parse(m.data as string) as ServerEvent;
        if (event.type === "turn.done" && !liveRef.current) ws.send(JSON.stringify({ type: "history.get" }));
        if (event.type === "sys.request" && (event.kind === "screen" || event.kind === "clipboard")) {
          void answerSysRequest(ws, event.id, event.kind);
          return;
        }
        dispatch({ type: "server", event });
        if (event.type === "reminder.fired" && Notification.permission !== "denied") {
          new Notification("ARO", { body: event.text });
        }
      };
      ws.onclose = () => {
        dispatch({ type: "connected", value: false });
        if (closed) return;
        timer = window.setTimeout(connect, retry);
        retry = Math.min(retry * 2, 8000);
      };
      ws.onerror = () => ws.close();
    };

    connect();
    return () => {
      closed = true;
      window.clearTimeout(timer);
      wsRef.current?.close();
    };
  }, []);

  const send = useCallback((text: string) => {
    wsRef.current?.send(JSON.stringify({ type: "user.message", text }));
  }, []);

  const reset = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ type: "session.reset" }));
  }, []);

  const voiceStateRef = useRef(state.voiceState);
  voiceStateRef.current = state.voiceState;

  const toggleListen = useCallback(() => {
    const current = voiceStateRef.current;
    if (current === "off") return;
    const type = current === "listening" || current === "hearing" ? "voice.listen.stop" : "voice.listen.start";
    wsRef.current?.send(JSON.stringify({ type }));
  }, []);

  const mutedRef = useRef(state.muted);
  mutedRef.current = state.muted;

  const toggleMute = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ type: "voice.mute", muted: !mutedRef.current }));
  }, []);

  useEffect(() => window.aro.onVoiceToggle(toggleListen), [toggleListen]);

  useEffect(() => {
    void window.aro.isCompact().then((v) => dispatch({ type: "compact", value: v }));
    return window.aro.onCompact((v) => dispatch({ type: "compact", value: v }));
  }, []);

  const setCompact = useCallback((value: boolean) => {
    void window.aro.setCompact(value);
  }, []);

  const touch = useCallback(() => dispatch({ type: "activity" }), []);

  return { ...state, send, reset, toggleListen, toggleMute, setCompact, touch };
}
