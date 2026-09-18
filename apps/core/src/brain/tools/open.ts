import { spawn } from "node:child_process";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { config } from "../../config";
import { readJson } from "../../store";

/**
 * Apps permitidos: nome → comando. Editável em data/apps.json.
 * Allowlist evita o modelo executar qualquer binário.
 */
const DEFAULT_APPS: Record<string, string> = {
  chrome: "chrome",
  edge: "msedge",
  vscode: "code",
  notepad: "notepad",
  calculadora: "calc",
  explorer: "explorer",
  spotify: "spotify",
  terminal: "wt",
};

async function loadApps() {
  return { ...DEFAULT_APPS, ...(await readJson<Record<string, string>>(config.appsFile, {})) };
}

function launch(cmd: string, args: string[] = []) {
  const child = spawn(cmd, args, { detached: true, stdio: "ignore", shell: false });
  child.unref();
  return new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("spawn", resolve);
  });
}

export const openUrlTool = betaZodTool({
  name: "open_url",
  description: "Abre uma URL no navegador padrão do usuário.",
  inputSchema: z.object({
    url: z.string().url().describe("URL completa com http(s)://"),
  }),
  run: async ({ url }) => {
    if (!/^https?:\/\//i.test(url)) return "Erro: só http(s).";
    await launch("rundll32", ["url.dll,FileProtocolHandler", url]);
    return `Abri ${url}.`;
  },
});

export const openAppTool = betaZodTool({
  name: "open_app",
  description: `Abre um aplicativo do computador. Apps disponíveis: ${Object.keys(DEFAULT_APPS).join(", ")} (mais os configurados em apps.json). Use 'list' pra ver todos.`,
  inputSchema: z.object({
    app: z.string().describe("Nome do app (chave da lista) ou 'list'"),
  }),
  run: async ({ app }) => {
    const apps = await loadApps();
    if (app === "list") return Object.keys(apps).join(", ");
    const cmd = apps[app.toLowerCase()];
    if (!cmd) return `App "${app}" não está na lista. Disponíveis: ${Object.keys(apps).join(", ")}.`;
    try {
      await launch("cmd", ["/c", "start", "", cmd]);
      return `Abri ${app}.`;
    } catch (err) {
      return `Falha ao abrir ${app}: ${(err as Error).message}`;
    }
  },
});
