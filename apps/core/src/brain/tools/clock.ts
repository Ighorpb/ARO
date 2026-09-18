import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

export const clockTool = betaZodTool({
  name: "get_datetime",
  description: "Retorna data e hora atuais do computador do usuário (fuso local).",
  inputSchema: z.object({}),
  run: async () => {
    const now = new Date();
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const formatted = now.toLocaleString("pt-BR", { dateStyle: "full", timeStyle: "short" });
    return JSON.stringify({ iso: now.toISOString(), local: formatted, timezone: tz });
  },
});
