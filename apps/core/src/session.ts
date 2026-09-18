import type Anthropic from "@anthropic-ai/sdk";
import type { TranscriptEntry } from "@aro/shared";
import { config } from "./config";
import { readJson, writeJson } from "./store";

type Messages = Anthropic.Beta.BetaMessageParam[];

interface SessionData {
  messages: Messages;
  transcript: TranscriptEntry[];
}

/**
 * Histórico da conversa atual.
 * `messages` é o que vai pra API (inclui tool_use/tool_result).
 * `transcript` é o que a UI mostra (só texto + pensamento).
 */
export class Session {
  private data: SessionData = { messages: [], transcript: [] };

  async load() {
    this.data = await readJson<SessionData>(config.sessionFile, { messages: [], transcript: [] });
  }

  get messages(): Messages {
    return this.data.messages;
  }

  get transcript(): TranscriptEntry[] {
    return this.data.transcript;
  }

  setMessages(messages: Messages) {
    this.data.messages = messages;
  }

  addTranscript(entry: TranscriptEntry) {
    this.data.transcript.push(entry);
  }

  async reset() {
    this.data = { messages: [], transcript: [] };
    await this.save();
  }

  async save() {
    await writeJson(config.sessionFile, this.data);
  }
}
