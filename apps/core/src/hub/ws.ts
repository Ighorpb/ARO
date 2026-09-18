import { WebSocketServer, WebSocket } from "ws";
import { parseClientEvent, type ClientKind, type ServerEvent, type VoiceState } from "@aro/shared";
import { config } from "../config";
import type { Aro } from "../brain/aro";
import type { Session } from "../session";
import { TIERS } from "../brain/router";
import { system } from "../brain/system";

/**
 * Hub: todos os clientes (desktop, voz, celular) conectam aqui.
 * Broadcast de tudo que o ARO emite; recebe mensagens de qualquer cliente.
 * Eventos `voice.*` são repassados pra todo mundo — o serviço de voz executa,
 * o desktop reflete o estado.
 */
export class Hub {
  private wss: WebSocketServer;
  private kinds = new Map<WebSocket, ClientKind>();
  private voiceState: VoiceState = "off";

  constructor(
    private aro: Aro,
    private session: Session,
  ) {
    this.wss = new WebSocketServer({ port: config.port });
    this.wss.on("connection", (ws) => this.onConnect(ws));
    this.aro.on("event", (event) => this.broadcast(event));
    system.on("request", (req) => this.broadcast(req));
  }

  broadcast(event: ServerEvent) {
    const payload = JSON.stringify(event);
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    }
  }

  private send(ws: WebSocket, event: ServerEvent) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event));
  }

  private get hasVoice() {
    return [...this.kinds.values()].includes("voice");
  }

  private onConnect(ws: WebSocket) {
    console.log(`[hub] cliente conectado (${this.wss.clients.size})`);
    this.send(ws, {
      type: "hello",
      name: config.name,
      tiers: { fast: TIERS.fast.model, main: TIERS.main.model, deep: TIERS.deep.model },
    });
    this.send(ws, { type: "history", entries: this.session.transcript });
    this.send(ws, { type: "state", state: this.aro.isBusy ? "thinking" : "idle" });
    this.send(ws, { type: "voice.state", state: this.hasVoice ? this.voiceState : "off" });

    ws.on("message", (raw) => {
      const event = parseClientEvent(raw.toString());
      if (!event) return this.send(ws, { type: "error", message: "Evento inválido." });

      switch (event.type) {
        case "client.hello":
          this.kinds.set(ws, event.kind);
          console.log(`[hub] cliente é ${event.kind}`);
          break;
        case "user.message": {
          const text = event.text.trim();
          if (text) void this.aro.respond(text, event.channel ?? "text");
          break;
        }
        case "session.reset":
          void this.session.reset().then(() => this.broadcast({ type: "history", entries: [] }));
          break;
        case "history.get":
          this.send(ws, { type: "history", entries: this.session.transcript });
          break;
        case "voice.state":
          this.voiceState = event.state;
          this.broadcast(event);
          break;
        case "sys.result":
          system.resolve(event);
          break;
        case "context.window":
          system.window = { title: event.title, app: event.app };
          break;
        case "voice.level":
        case "voice.chunk":
        case "voice.listen.start":
        case "voice.listen.stop":
        case "voice.mute":
          this.broadcast(event);
          break;
      }
    });

    ws.on("close", () => {
      const kind = this.kinds.get(ws);
      this.kinds.delete(ws);
      console.log(`[hub] ${kind ?? "cliente"} saiu (${this.wss.clients.size})`);
      if (kind === "voice" && !this.hasVoice) {
        this.voiceState = "off";
        this.broadcast({ type: "voice.state", state: "off" });
      }
    });
  }
}
