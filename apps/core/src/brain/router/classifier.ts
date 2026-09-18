import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { TranscriptEntry } from "@aro/shared";
import { CLASSIFIER_MODEL, type Tier } from "./tiers";

const Decision = z.object({
  tier: z.enum(["fast", "main", "deep"]),
  reason: z.string().describe("Uma frase curta explicando a escolha"),
});

const SYSTEM = `Você classifica a próxima mensagem do usuário pro assistente ARO em um nível de esforço:

- fast: pedido simples e direto. Hora, clima, abrir app ou site, anotar, lembrete, saudação, resposta factual curta, follow-up trivial de algo que acabou de acontecer.
- main: conversa normal. Pergunta que pede explicação, opinião, pesquisa na web, tarefa com alguns passos.
- deep: raciocínio pesado. Análise, planejamento, código, comparação de opções, decisão importante, texto longo pra produzir.

Na dúvida entre fast e main, escolha main. Na dúvida entre main e deep, escolha main.
Use o contexto recente pra entender follow-ups curtos.`;

/** Classificador rápido — Haiku, sem thinking, saída JSON validada. */
export async function classify(
  client: Anthropic,
  text: string,
  recent: TranscriptEntry[],
): Promise<{ tier: Tier; reason: string; usage: Anthropic.Usage }> {
  const context = recent
    .map((e) => `${e.role === "user" ? "usuário" : "aro"}: ${e.text.slice(0, 200)}`)
    .join("\n");

  const response = await client.messages.parse({
    model: CLASSIFIER_MODEL,
    max_tokens: 256,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: context ? `Contexto recente:\n${context}\n\nMensagem nova:\n${text}` : `Mensagem nova:\n${text}`,
      },
    ],
    output_config: { format: zodOutputFormat(Decision) },
  });

  const decision = response.parsed_output ?? { tier: "main", reason: "classificador sem saída" };
  return { ...decision, usage: response.usage };
}
