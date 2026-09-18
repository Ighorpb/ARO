import { EventEmitter } from "node:events";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { config } from "../../config";
import { readJson, writeJson } from "../../store";

interface Reminder {
  id: number;
  text: string;
  at: string;
}

/**
 * Agenda lembretes com setTimeout e persiste em JSON.
 * Emite "fired" quando dispara — o hub repassa pros clientes.
 */
export class ReminderScheduler extends EventEmitter<{ fired: [Reminder] }> {
  private timers = new Map<number, NodeJS.Timeout>();
  private reminders: Reminder[] = [];

  async load() {
    this.reminders = await readJson<Reminder[]>(config.remindersFile, []);
    const now = Date.now();
    for (const r of this.reminders) {
      // Lembrete que venceu com o core desligado: dispara já
      if (new Date(r.at).getTime() <= now) this.fire(r);
      else this.schedule(r);
    }
  }

  async add(text: string, at: Date): Promise<Reminder> {
    const reminder: Reminder = {
      id: (this.reminders.at(-1)?.id ?? 0) + 1,
      text,
      at: at.toISOString(),
    };
    this.reminders.push(reminder);
    this.schedule(reminder);
    await this.save();
    return reminder;
  }

  async remove(id: number): Promise<boolean> {
    const idx = this.reminders.findIndex((r) => r.id === id);
    if (idx === -1) return false;
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    this.reminders.splice(idx, 1);
    await this.save();
    return true;
  }

  list(): Reminder[] {
    return [...this.reminders].sort((a, b) => a.at.localeCompare(b.at));
  }

  private schedule(r: Reminder) {
    const delay = Math.max(0, new Date(r.at).getTime() - Date.now());
    // setTimeout estoura em ~24.8 dias; acima disso, reagenda em etapas
    const step = Math.min(delay, 2 ** 31 - 1);
    const timer = setTimeout(() => {
      if (step < delay) this.schedule(r);
      else this.fire(r);
    }, step);
    this.timers.set(r.id, timer);
  }

  private fire(r: Reminder) {
    this.timers.delete(r.id);
    this.reminders = this.reminders.filter((x) => x.id !== r.id);
    void this.save();
    this.emit("fired", r);
  }

  private save() {
    return writeJson(config.remindersFile, this.reminders);
  }
}

export function createRemindersTool(scheduler: ReminderScheduler) {
  return betaZodTool({
    name: "reminders",
    description:
      "Lembretes com horário. Use 'add' com data/hora ISO absoluta (chame get_datetime antes pra calcular relativos como 'daqui 10 min' ou 'amanhã às 9'). O ARO avisa o usuário quando disparar.",
    inputSchema: z.object({
      action: z.enum(["add", "list", "remove"]),
      text: z.string().describe("O que lembrar (em 'add')").optional(),
      at: z.string().describe("Data/hora ISO 8601 com fuso, ex: 2026-09-16T15:30:00-03:00 (em 'add')").optional(),
      id: z.number().int().describe("ID do lembrete (em 'remove')").optional(),
    }),
    run: async ({ action, text, at, id }) => {
      switch (action) {
        case "add": {
          if (!text || !at) return "Erro: 'text' e 'at' obrigatórios.";
          const date = new Date(at);
          if (Number.isNaN(date.getTime())) return `Erro: data inválida "${at}".`;
          if (date.getTime() <= Date.now()) return "Erro: horário já passou.";
          const r = await scheduler.add(text, date);
          return `Lembrete #${r.id} agendado pra ${date.toLocaleString("pt-BR")}.`;
        }
        case "list": {
          const all = scheduler.list();
          if (all.length === 0) return "Nenhum lembrete agendado.";
          return all.map((r) => `#${r.id} ${new Date(r.at).toLocaleString("pt-BR")} — ${r.text}`).join("\n");
        }
        case "remove": {
          if (id === undefined) return "Erro: 'id' obrigatório.";
          return (await scheduler.remove(id)) ? `Lembrete #${id} removido.` : `Lembrete #${id} não existe.`;
        }
      }
    },
  });
}
