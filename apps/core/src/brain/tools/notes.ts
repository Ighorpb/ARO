import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { config } from "../../config";
import { readJson, writeJson } from "../../store";

interface Note {
  id: number;
  text: string;
  done: boolean;
  createdAt: string;
}

async function load() {
  return readJson<Note[]>(config.notesFile, []);
}

export const notesTool = betaZodTool({
  name: "notes",
  description: "Lista de notas e tarefas do usuário. Use pra anotar coisas, criar to-dos, marcar como feito ou remover.",
  inputSchema: z.object({
    action: z.enum(["add", "list", "done", "remove"]),
    text: z.string().describe("Conteúdo da nota (só em 'add')").optional(),
    id: z.number().int().describe("ID da nota (em 'done' e 'remove')").optional(),
    includeDone: z.boolean().describe("Em 'list': incluir concluídas").optional(),
  }),
  run: async ({ action, text, id, includeDone = false }) => {
    const notes = await load();

    switch (action) {
      case "add": {
        if (!text) return "Erro: 'text' obrigatório pra adicionar.";
        const note: Note = {
          id: (notes.at(-1)?.id ?? 0) + 1,
          text,
          done: false,
          createdAt: new Date().toISOString(),
        };
        notes.push(note);
        await writeJson(config.notesFile, notes);
        return `Nota #${note.id} criada.`;
      }
      case "list": {
        const visible = includeDone ? notes : notes.filter((n) => !n.done);
        if (visible.length === 0) return "Nenhuma nota.";
        return visible.map((n) => `#${n.id} [${n.done ? "x" : " "}] ${n.text}`).join("\n");
      }
      case "done": {
        const note = notes.find((n) => n.id === id);
        if (!note) return `Nota #${id} não existe.`;
        note.done = true;
        await writeJson(config.notesFile, notes);
        return `Nota #${id} concluída.`;
      }
      case "remove": {
        const idx = notes.findIndex((n) => n.id === id);
        if (idx === -1) return `Nota #${id} não existe.`;
        notes.splice(idx, 1);
        await writeJson(config.notesFile, notes);
        return `Nota #${id} removida.`;
      }
    }
  },
});
