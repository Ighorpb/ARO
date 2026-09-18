import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { system } from "../system";

export const seeScreenTool = betaZodTool({
  name: "see_screen",
  description:
    "Tira um print da tela do chefe e devolve a imagem pra você olhar. Use quando ele perguntar sobre algo que está vendo, um erro, o que fazer numa tela, ou pedir pra você olhar. Custa um pouco — não use à toa.",
  inputSchema: z.object({}),
  run: async () => {
    const r = await system.request("screen", undefined, 8000);
    if (!r.ok || !r.data) return `Não consegui ver a tela: ${r.error ?? "sem imagem"}.`;
    return [
      { type: "text" as const, text: "Print da tela do chefe agora:" },
      { type: "image" as const, source: { type: "base64" as const, media_type: "image/jpeg" as const, data: r.data } },
    ];
  },
});

export const clipboardTool = betaZodTool({
  name: "read_clipboard",
  description: "Lê o texto que o chefe copiou (área de transferência). Use quando ele disser 'isso que eu copiei', 'resume isso', 'traduz isso' sem colar nada.",
  inputSchema: z.object({}),
  run: async () => {
    const r = await system.request("clipboard");
    if (!r.ok) return `Não consegui ler a área de transferência: ${r.error}.`;
    const text = (r.data ?? "").trim();
    if (!text) return "Área de transferência vazia (ou não é texto).";
    return text.length > 12000 ? `${text.slice(0, 12000)}\n\n[cortado: ${text.length} caracteres no total]` : text;
  },
});

export const mediaTool = betaZodTool({
  name: "media_control",
  description: "Controla mídia e volume do Windows: pausar/tocar, próxima/anterior faixa, volume pra cima/baixo, mudo, ou definir volume em %.",
  inputSchema: z.object({
    action: z.enum(["play_pause", "next", "previous", "volume_up", "volume_down", "mute", "set_volume"]),
    value: z.number().int().min(0).max(100).describe("Só em set_volume: 0 a 100").optional(),
  }),
  run: async ({ action, value }) => {
    const r = await system.request("media", { action, value });
    return r.ok ? (r.data ?? "Feito.") : `Não deu: ${r.error}.`;
  },
});
