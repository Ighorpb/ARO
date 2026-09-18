// Hub falso: roteiro de eventos pra testar a UI sem gastar token.
// Uso: node scripts/mock-hub.mjs
import { WebSocketServer } from "ws";

const PORT = Number(process.env.ARO_PORT ?? 7777);
const wss = new WebSocketServer({ port: PORT });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const THINKING =
  "Ele quer saber a hora. Vou chamar get_datetime pra pegar o horário local certo em vez de chutar. Depois respondo curto, sem enrolar.";
const ANSWER = "São 18h42 de uma quarta. Ainda dá tempo de fazer alguma coisa útil hoje.";

function send(_ws, e) {
  for (const c of wss.clients) if (c.readyState === 1) c.send(JSON.stringify(e));
}

async function stream(ws, id, type, text, delay) {
  for (const word of text.split(/(?<=\s)/)) {
    send(ws, { type, id, text: word });
    await sleep(delay);
  }
}

wss.on("connection", (ws) => {
  console.log("[mock] cliente conectado");
  send(ws, { type: "hello", name: "ARO", tiers: { fast: "claude-sonnet-5", main: "claude-opus-5", deep: "claude-opus-5" } });
  send(ws, { type: "history", entries: [] });
  send(ws, { type: "state", state: "idle" });
  send(ws, { type: "voice.state", state: "idle" });

  ws.on("message", async (raw) => {
    const e = JSON.parse(raw.toString());
    // simula o serviço de voz: ouve ~2s com nível oscilando, transcreve, manda a msg
    if (e.type === "voice.listen.start") {
      send(ws, { type: "voice.state", state: "listening" });
      for (let i = 0; i < 20; i++) {
        send(ws, { type: "voice.level", level: Math.abs(Math.sin(i / 2)) * 0.9 });
        await sleep(100);
      }
      send(ws, { type: "voice.state", state: "transcribing" });
      await sleep(700);
      send(ws, { type: "voice.state", state: "idle" });
      ws.emit("message", JSON.stringify({ type: "user.message", text: "que horas são?", channel: "voice" }));
      return;
    }
    if (e.type.startsWith("voice.")) return send(ws, e);
    if (e.type !== "user.message") return;
    const id = crypto.randomUUID();
    send(ws, { type: "user.echo", id: crypto.randomUUID(), text: e.text, channel: e.channel ?? "text" });
    send(ws, { type: "turn.start", id, tier: "fast", model: "claude-sonnet-5", source: "rule", channel: e.channel ?? "text" });
    send(ws, { type: "state", state: "thinking" });
    await sleep(600);
    await stream(ws, id, "thinking.delta", THINKING, 45);
    await sleep(300);
    send(ws, { type: "state", state: "tool" });
    send(ws, { type: "tool.start", id, name: "get_datetime", toolId: "t1" });
    send(ws, { type: "tool.start", id, name: "get_weather", toolId: "t2" });
    send(ws, { type: "tool.start", id, name: "memory", toolId: "t3", detail: "create" });
    await sleep(2500);
    send(ws, { type: "tool.done", id, name: "get_datetime", toolId: "t1", ok: true });
    send(ws, { type: "tool.done", id, name: "get_weather", toolId: "t2", ok: true });
    send(ws, { type: "tool.done", id, name: "memory", toolId: "t3", ok: true });
    send(ws, { type: "state", state: "speaking" });
    send(ws, { type: "voice.state", state: "speaking" });
    // palavras com tempo, como o Edge devolve
    const words = ANSWER.split(" ").map((w, i) => ({ t: i * 0.32, w: w.replace(/[.,!?]/g, "") }));
    send(ws, { type: "voice.chunk", text: ANSWER, words });
    await stream(ws, id, "text.delta", ANSWER, 30);
    await sleep(words.length * 320 + 800);
    send(ws, { type: "voice.state", state: "idle" });
    send(ws, { type: "turn.done", id, inputTokens: 1200, outputTokens: 80 });
    send(ws, { type: "state", state: "idle" });
  });
});

console.log(`[mock] ARO falso em ws://localhost:${PORT}`);
