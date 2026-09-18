/**
 * Protocolo WebSocket entre o core (hub) e os clientes (desktop, voz, celular).
 * Tudo é JSON com campo `type`.
 */

export type AroState = "idle" | "thinking" | "speaking" | "tool";

export type Tier = "fast" | "main" | "deep";
export type RouteSource = "forced" | "rule" | "classifier" | "fallback" | "voice";
export type Channel = "text" | "voice";
/** listening = ativou e espera fala (janela abre aqui); hearing = já detectou fala */
export type VoiceState = "off" | "idle" | "listening" | "hearing" | "transcribing" | "speaking";
export type ClientKind = "desktop" | "voice" | "mobile";

/** Pedidos do core pro "corpo" (desktop/voz): quem souber responder, responde. */
export type SysKind = "screen" | "clipboard" | "media";
export interface SysRequest {
  type: "sys.request";
  id: string;
  kind: SysKind;
  args?: Record<string, unknown>;
}
export interface SysResult {
  type: "sys.result";
  id: string;
  ok: boolean;
  /** screen: jpeg base64 · clipboard: texto · media: mensagem curta */
  data?: string;
  error?: string;
}

export interface TranscriptEntry {
  id: string;
  role: "user" | "aro";
  text: string;
  thinking?: string;
  thinkingMs?: number;
  tier?: Tier;
  model?: string;
  channel?: Channel;
  costUsd?: number;
  at: number;
}

// ── Cliente → Core ──────────────────────────────────────────────

export type ClientEvent =
  | { type: "client.hello"; kind: ClientKind }
  | { type: "user.message"; text: string; channel?: Channel }
  | { type: "session.reset" }
  | { type: "history.get" }
  // voz — qualquer cliente pode pedir; o serviço de voz executa
  | { type: "voice.listen.start" }
  | { type: "voice.listen.stop" }
  | { type: "voice.mute"; muted: boolean }
  // emitidos pelo serviço de voz; o hub repassa pra todos
  | { type: "voice.state"; state: VoiceState }
  | { type: "voice.level"; level: number }
  | { type: "voice.chunk"; text: string; words: { t: number; w: string }[] }
  | SysResult
  // janela em foco no Windows (mandado pelo serviço de voz, que tem acesso ao sistema)
  | { type: "context.window"; title: string; app: string };

// ── Core → Cliente ──────────────────────────────────────────────

export type ServerEvent =
  | { type: "hello"; name: string; tiers: Record<Tier, string> }
  | { type: "state"; state: AroState }
  | { type: "history"; entries: TranscriptEntry[] }
  | { type: "user.echo"; id: string; text: string; channel: Channel }
  | { type: "turn.start"; id: string; tier: Tier; model: string; source: RouteSource; reason?: string; channel: Channel }
  | { type: "thinking.delta"; id: string; text: string }
  | { type: "text.delta"; id: string; text: string }
  | { type: "tool.start"; id: string; name: string; toolId: string; detail?: string }
  | { type: "tool.done"; id: string; name: string; toolId: string; ok: boolean }
  | { type: "turn.done"; id: string; inputTokens: number; outputTokens: number; costUsd: number }
  | { type: "reminder.fired"; text: string }
  | SysRequest
  | { type: "voice.state"; state: VoiceState }
  | { type: "voice.level"; level: number }
  | { type: "voice.chunk"; text: string; words: { t: number; w: string }[] }
  | { type: "voice.listen.start" }
  | { type: "voice.listen.stop" }
  | { type: "voice.mute"; muted: boolean }
  | { type: "error"; message: string };

export function parseClientEvent(raw: string): ClientEvent | null {
  try {
    const data = JSON.parse(raw) as { type?: unknown };
    if (typeof data.type !== "string") return null;
    return data as ClientEvent;
  } catch {
    return null;
  }
}
