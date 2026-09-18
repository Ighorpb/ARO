import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { betaMemoryTool } from "@anthropic-ai/sdk/helpers/beta/memory";
import { BetaLocalFilesystemMemoryTool } from "@anthropic-ai/sdk/tools/memory/node";
import type { BetaRunnableTool } from "@anthropic-ai/sdk/lib/tools/BetaRunnableTool";
import type { Channel, ServerEvent } from "@aro/shared";
import { config } from "../config";
import type { Session } from "../session";
import { SYSTEM_PROMPT } from "./prompt";
import { createLocalTools } from "./tools";
import type { ReminderScheduler } from "./tools/reminders";
import { route, type Route } from "./router";
import { tierRequestParams } from "./router/tiers";
import { costOf, fmtUsd } from "./pricing";
import { system } from "./system";

type Emit = (event: ServerEvent) => void;

/** Envolve `run` da tool pra emitir início/fim pro cliente. */
function instrument<T extends BetaRunnableTool<any>>(tool: T, emit: Emit, turnId: () => string): T {
  return {
    ...tool,
    run: async (input: unknown, context) => {
      const toolId = context?.toolUse.id ?? randomUUID();
      // memory: qual comando (view/create/str_replace...) — a UI faz faísca quando ele salva
      const command = (input as { command?: unknown } | null)?.command;
      emit({ type: "tool.start", id: turnId(), name: tool.name, toolId, detail: typeof command === "string" ? command : undefined });
      try {
        const result = await tool.run(input, context);
        emit({ type: "tool.done", id: turnId(), name: tool.name, toolId, ok: true });
        return result;
      } catch (err) {
        emit({ type: "tool.done", id: turnId(), name: tool.name, toolId, ok: false });
        throw err;
      }
    },
  };
}

/**
 * O cérebro. Recebe texto, roda um turno com Claude (streaming + tools)
 * e emite eventos que o hub repassa pros clientes.
 */
export class Aro extends EventEmitter<{ event: [ServerEvent] }> {
  private client = new Anthropic();
  private tools: BetaRunnableTool<any>[] = [];
  private busy = false;
  private currentTurn = "";

  constructor(
    private session: Session,
    private scheduler: ReminderScheduler,
  ) {
    super();
  }

  async init() {
    const memoryFs = await BetaLocalFilesystemMemoryTool.init(config.memoryDir);
    const emit: Emit = (e) => this.emit("event", e);
    const turnId = () => this.currentTurn;

    this.tools = [...createLocalTools(this.scheduler), betaMemoryTool(memoryFs)].map((t) =>
      instrument(t, emit, turnId),
    );
  }

  get isBusy() {
    return this.busy;
  }

  /** "[qua 16/09/2026 19:04 voz · janela: VS Code · primeira conversa do dia]" */
  private stampFor(channel: Channel): string {
    const parts = [stamp()];
    if (channel === "voice") parts.push("voz");
    const win = system.window;
    if (win?.title) parts.push(`janela: ${win.title.slice(0, 70)}`);
    const last = this.session.transcript.filter((e) => e.role === "user").at(-2);
    const today = new Date().toDateString();
    if (!last || new Date(last.at).toDateString() !== today) parts.push("primeira conversa do dia");
    return `[${parts.join(" · ")}]`;
  }

  async respond(text: string, channel: Channel = "text"): Promise<void> {
    if (this.busy) {
      this.emit("event", { type: "error", message: "ARO ainda está respondendo. Espera um segundo." });
      return;
    }
    this.busy = true;
    const id = randomUUID();
    this.currentTurn = id;

    const userId = randomUUID();
    const recent = this.session.transcript.slice(-4);
    this.session.addTranscript({ id: userId, role: "user", text, channel, at: Date.now() });
    this.emit("event", { type: "user.echo", id: userId, text, channel });
    this.emit("event", { type: "state", state: "thinking" });

    let thinking = "";
    let answer = "";
    let firstTextAt = 0;
    const startedAt = Date.now();
    let inputTokens = 0;
    let outputTokens = 0;
    let chosen: Route | null = null;
    let costUsd = 0;

    try {
      chosen = await route(this.client, text, recent, channel);
      costUsd += chosen.costUsd;
      console.log(`[router] ${chosen.tier} (${chosen.source}${chosen.reason ? `: ${chosen.reason}` : ""})`);
      this.emit("event", {
        type: "turn.start",
        id,
        tier: chosen.tier,
        model: chosen.model,
        source: chosen.source,
        reason: chosen.reason,
        channel,
      });

      const runner = this.client.beta.messages.toolRunner({
        ...tierRequestParams(chosen.tier),
        max_tokens: 64000,
        stream: true,
        context_management: { edits: [{ type: "compact_20260112" }] },
        // prefixo fixo (tools + system) com breakpoint explícito; conversa cresce com breakpoint automático
        cache_control: { type: "ephemeral", ttl: config.cacheTtl },
        system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral", ttl: config.cacheTtl } }],
        tools: [...this.tools, { type: "web_search_20260209", name: "web_search", max_uses: 5 }],
        messages: [...this.session.messages, { role: "user", content: `${this.stampFor(channel)} ${text}` }],
        max_iterations: 15,
      });

      for await (const stream of runner) {
        for await (const event of stream) {
          if (event.type === "content_block_start") {
            const block = event.content_block;
            if (block.type === "thinking") this.emit("event", { type: "state", state: "thinking" });
            else if (block.type === "text") this.emit("event", { type: "state", state: "speaking" });
            else if (block.type === "tool_use" || block.type === "server_tool_use") {
              this.emit("event", { type: "state", state: "tool" });
              if (block.type === "server_tool_use") {
                this.emit("event", { type: "tool.start", id, name: block.name, toolId: block.id });
              }
            }
          } else if (event.type === "content_block_delta") {
            const delta = event.delta;
            if (delta.type === "thinking_delta") {
              thinking += delta.thinking;
              this.emit("event", { type: "thinking.delta", id, text: delta.thinking });
            } else if (delta.type === "text_delta") {
              firstTextAt ||= Date.now();
              answer += delta.text;
              this.emit("event", { type: "text.delta", id, text: delta.text });
            }
          } else if (event.type === "content_block_stop") {
            // Sem acesso ao bloco aqui; tool.done de server tools fica implícito na próxima resposta
          }
        }

        const message = await stream.finalMessage();
        const u = message.usage;
        inputTokens += u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
        outputTokens += u.output_tokens;
        const callCost = costOf(message.model, u, config.cacheTtl);
        costUsd += callCost;
        console.log(
          `[aro] ${message.model} in=${u.input_tokens} cache_read=${u.cache_read_input_tokens ?? 0} cache_write=${u.cache_creation_input_tokens ?? 0} out=${u.output_tokens} ${fmtUsd(callCost)} stop=${message.stop_reason}`,
        );

        if (message.stop_reason === "refusal") {
          answer ||= "Não consigo ajudar com isso.";
          this.emit("event", { type: "text.delta", id, text: answer });
          break;
        }
        if (message.stop_reason === "max_tokens" && message.content.some((b) => b.type === "tool_use")) {
          throw new Error("Resposta cortada no meio de uma ferramenta (max_tokens).");
        }
      }

      this.session.setMessages([...runner.params.messages]);
      this.session.addTranscript({ id, role: "aro", text: answer, thinking: thinking || undefined, thinkingMs: thinking ? (firstTextAt || Date.now()) - startedAt : undefined, tier: chosen.tier, model: chosen.model, costUsd, at: Date.now() });
      await this.session.save();
      console.log(`[aro] turno ${fmtUsd(costUsd)}`);
      this.emit("event", { type: "turn.done", id, inputTokens, outputTokens, costUsd });
    } catch (err) {
      const message = describeError(err);
      console.error("[aro] erro no turno:", err);
      this.emit("event", { type: "error", message });
    } finally {
      this.busy = false;
      this.currentTurn = "";
      this.emit("event", { type: "state", state: "idle" });
    }
  }
}

/** Carimbo curto de data/hora local, ex: "qua 16/09/2026 19:04" */
function stamp(): string {
  return new Date().toLocaleString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).replace(",", "");
}

function describeError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "Chave da API inválida ou ausente. Configura ANTHROPIC_API_KEY no .env.";
  if (err instanceof Anthropic.RateLimitError) return "Limite de requisições atingido. Tenta de novo em instantes.";
  if (err instanceof Anthropic.APIConnectionError) return "Sem conexão com a API. Verifica a internet.";
  if (err instanceof Anthropic.APIError) return `Erro da API (${err.status}): ${err.message}`;
  // SDK lança Error genérico quando não acha credencial nenhuma
  if (err instanceof Error && err.message.includes("Could not resolve authentication")) {
    return "Sem credencial da API. Configura ANTHROPIC_API_KEY no .env ou roda ant auth login.";
  }
  return err instanceof Error ? err.message : String(err);
}
