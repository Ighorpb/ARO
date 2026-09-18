import { useEffect, useRef, useState } from "react";
import type { OrbState } from "./components/OrbCanvas";
import { Header } from "./components/Header";
import { OrbLayer } from "./components/OrbLayer";
import { Stage, moodOf, statusOf, useThinkIntensity } from "./components/Stage";
import { Dock } from "./components/Dock";
import { useAro } from "./hooks/useAro";

const SLEEP_AFTER_MS = 20 * 60 * 1000;
const AUTO_COLLAPSE_MS = 5 * 1000;

export function App() {
  const aro = useAro();
  const busy = aro.aroState !== "idle";
  const sessionCost = aro.entries.reduce((sum, e) => sum + (e.role === "aro" ? (e.costUsd ?? 0) : 0), 0);
  const lastAro = [...aro.entries].reverse().find((e) => e.role === "aro");
  const lastModel = aro.lastModel || (lastAro && "model" in lastAro ? (lastAro.model ?? "") : "");
  const slotRef = useRef<HTMLDivElement>(null);

  // sono: 20 min sem nada → orb apaga e desacelera; qualquer atividade acorda
  const [sleeping, setSleeping] = useState(false);
  useEffect(() => {
    const check = () => setSleeping(Date.now() - aro.lastActivity > SLEEP_AFTER_MS);
    check();
    const timer = window.setInterval(check, 15000);
    return () => window.clearInterval(timer);
  }, [aro.lastActivity]);

  useEffect(() => {
    if (!sleeping) return;
    const wake = () => aro.touch();
    window.addEventListener("mousemove", wake, { once: true });
    window.addEventListener("keydown", wake, { once: true });
    return () => {
      window.removeEventListener("mousemove", wake);
      window.removeEventListener("keydown", wake);
    };
  }, [sleeping, aro.touch]);

  useEffect(() => {
    document.body.dataset.compact = String(aro.compact);
  }, [aro.compact]);

  // ── abre sozinho quando ativado; volta pro canto quando termina ──
  const autoExpanded = useRef(false);
  const lastEntry = aro.entries.at(-1);
  // palma e atalho são deliberados: abre já no listening. Wake word pode ser alucinação do Whisper,
  // então fica no canto até virar hearing (fala de verdade)
  const deliberate = aro.voiceState === "listening" && (aro.voiceSource === "clap" || aro.voiceSource === "hotkey");
  const engaged =
    deliberate ||
    aro.voiceState === "hearing" ||
    aro.voiceState === "transcribing" ||
    (lastEntry?.role === "reminder" && Date.now() - lastEntry.at < 3000);

  useEffect(() => {
    if (engaged && aro.compact) {
      autoExpanded.current = true;
      aro.setCompact(false);
    }
  }, [engaged, aro.compact, aro.setCompact]);

  const quiet = !aro.live && aro.aroState === "idle" && (aro.voiceState === "idle" || aro.voiceState === "off");
  useEffect(() => {
    if (aro.compact || !autoExpanded.current || !quiet) return;
    const t = window.setTimeout(() => {
      autoExpanded.current = false;
      aro.setCompact(true);
    }, AUTO_COLLAPSE_MS);
    return () => window.clearTimeout(t);
  }, [aro.compact, quiet, aro.lastActivity, aro.setCompact]);

  // follow-up (escuta depois da resposta) acabou sem ninguém falar → recolhe na hora, sem esperar o timer
  const prevVoice = useRef<{ state: typeof aro.voiceState; source: typeof aro.voiceSource }>({ state: "off", source: null });
  useEffect(() => {
    const prev = prevVoice.current;
    prevVoice.current = { state: aro.voiceState, source: aro.voiceSource ?? prev.source };
    const followUpGaveUp = prev.state === "listening" && prev.source === "follow_up" && aro.voiceState === "idle";
    if (followUpGaveUp && autoExpanded.current && !aro.compact) {
      autoExpanded.current = false;
      aro.setCompact(true);
    }
  }, [aro.voiceState, aro.voiceSource, aro.compact, aro.setCompact]);

  // expandiu/recolheu na mão → não volta sozinho
  const toggleCompactManual = () => {
    autoExpanded.current = false;
    aro.setCompact(!aro.compact);
  };

  const orbState: OrbState = !aro.connected
    ? "offline"
    : aro.voiceState === "listening" || aro.voiceState === "hearing"
      ? "listening"
      : aro.voiceState === "transcribing"
        ? "thinking"
        : aro.voiceState === "speaking"
          ? "speaking"
          : aro.aroState !== "idle"
            ? aro.aroState
            : sleeping
              ? "sleeping"
              : "idle";

  const thinkingLive = Boolean(aro.live && aro.live.thinking && !aro.live.text);
  const intensity = useThinkIntensity(aro.live?.thinking.length ?? 0, thinkingLive);
  const answerText = aro.live?.text || (lastAro && "text" in lastAro ? lastAro.text : "");
  const mood = moodOf(answerText);
  const status = statusOf(orbState, aro.voiceState, aro.live);

  return (
    <div className="pane" data-compact={String(aro.compact)}>
      <Header
        lastModel={lastModel}
        tiers={aro.tiers}
        connected={aro.connected}
        sessionCost={sessionCost}
        voiceState={aro.voiceState}
        muted={aro.muted}
        onReset={aro.reset}
        onToggleMute={aro.toggleMute}
      />
      <Stage
        slotRef={slotRef}
        orbState={orbState}
        voiceState={aro.voiceState}
        live={aro.live}
        entries={aro.entries}
        connected={aro.connected}
        spoken={aro.spoken}
      />
      <Dock
        disabled={!aro.connected}
        busy={busy}
        voiceState={aro.voiceState}
        onSend={aro.send}
        onToggleListen={aro.toggleListen}
      />
      <OrbLayer
        slotRef={slotRef}
        compact={aro.compact}
        orbState={orbState}
        level={aro.voiceLevel}
        intensity={intensity}
        mood={mood}
        tools={aro.live?.tools ?? []}
        memorySaves={aro.memorySaves}
        voiceState={aro.voiceState}
        connected={aro.connected}
        status={status}
        onToggleListen={aro.toggleListen}
        onToggleCompact={toggleCompactManual}
      />
    </div>
  );
}
