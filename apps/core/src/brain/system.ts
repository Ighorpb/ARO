import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type { SysKind, SysRequest, SysResult } from "@aro/shared";

/**
 * Ponte entre o cérebro e o "corpo": o core pede (print da tela, clipboard,
 * mídia) e o cliente que souber fazer responde pelo hub.
 */
export class SystemBridge extends EventEmitter<{ request: [SysRequest] }> {
  private pending = new Map<string, { resolve: (r: SysResult) => void; timer: NodeJS.Timeout }>();

  /** Última janela em foco no Windows (vem do serviço de voz). */
  window: { title: string; app: string } | null = null;

  request(kind: SysKind, args?: Record<string, unknown>, timeoutMs = 6000): Promise<SysResult> {
    const id = randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ type: "sys.result", id, ok: false, error: "ninguém respondeu (desktop ou voz desligados?)" });
      }, timeoutMs);
      this.pending.set(id, { resolve, timer });
      this.emit("request", { type: "sys.request", id, kind, args });
    });
  }

  resolve(result: SysResult) {
    const p = this.pending.get(result.id);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(result.id);
    p.resolve(result);
  }
}

export const system = new SystemBridge();
