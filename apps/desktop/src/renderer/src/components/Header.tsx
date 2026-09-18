import { useEffect, useState } from "react";
import type { Tier, VoiceState } from "@aro/shared";
import { fmtUsd, modelName } from "../lib/model";

interface Props {
  lastModel: string;
  tiers: Record<Tier, string> | null;
  connected: boolean;
  sessionCost: number;
  voiceState: VoiceState;
  muted: boolean;
  onReset: () => void;
  onToggleMute: () => void;
}

export function Header({ lastModel, tiers, connected, sessionCost, voiceState, muted, onReset, onToggleMute }: Props) {
  const [pinned, setPinned] = useState(true);

  useEffect(() => {
    void window.aro.isPinned().then(setPinned);
  }, []);

  const togglePin = async () => setPinned(await window.aro.togglePin());

  return (
    <header className="header chrome flex items-center justify-between px-5 pt-4 pb-1">
      <div className="flex items-baseline gap-3">
        <span className="wordmark">ARO</span>
        <span
          className="meta"
          title={tiers ? `rápido: ${modelName(tiers.fast)}  ·  normal: ${modelName(tiers.main)}  ·  profundo: ${modelName(tiers.deep)}` : undefined}
        >
          {connected ? (lastModel ? modelName(lastModel) : "roteamento automático") : "core desligado"}
        </span>
        {connected && sessionCost > 0 && (
          <span className="meta" title="Gasto nesta conversa">
            {fmtUsd(sessionCost)}
          </span>
        )}
      </div>
      <div className="no-drag flex items-center gap-0.5">
        {voiceState !== "off" && (
          <button
            className="win-btn"
            data-active={muted}
            onClick={onToggleMute}
            title={muted ? "ARO está mudo. Clica pra voltar a falar" : "Silenciar o ARO"}
            aria-label="Silenciar o ARO"
            aria-pressed={muted}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M2.5 6h2.5l3-2.5v9L5 10H2.5z" strokeLinejoin="round" />
              {muted ? (
                <path d="M10.5 6l3 4M13.5 6l-3 4" strokeLinecap="round" />
              ) : (
                <path d="M10.5 5.5a3.5 3.5 0 0 1 0 5M12.5 3.5a6 6 0 0 1 0 9" strokeLinecap="round" />
              )}
            </svg>
          </button>
        )}
        <button className="win-btn" onClick={onReset} title="Nova conversa" aria-label="Nova conversa">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 8a5 5 0 0 1 8.5-3.5M13 8a5 5 0 0 1-8.5 3.5" strokeLinecap="round" />
            <path d="M11.5 1.5v3h-3M4.5 14.5v-3h3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          className="win-btn"
          data-active={pinned}
          onClick={togglePin}
          title={pinned ? "Desafixar" : "Manter sobre as janelas"}
          aria-label="Fixar sobre as janelas"
          aria-pressed={pinned}
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M6 2h4l1 5 2 2H3l2-2 1-5ZM8 9v5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button className="win-btn" onClick={() => window.aro.minimize()} title="Minimizar" aria-label="Minimizar">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 8h10" strokeLinecap="round" />
          </svg>
        </button>
        <button className="win-btn" onClick={() => window.aro.close()} title="Fechar" aria-label="Fechar">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </header>
  );
}
