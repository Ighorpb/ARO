import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import type { VoiceState } from "@aro/shared";
import { OrbCanvas, type OrbState } from "./OrbCanvas";
import { OrbGL, supportsWebGL2 } from "./OrbGL";
import { ToolIcon } from "./ToolIcon";
import type { ToolCall } from "../hooks/useAro";

export const ORB_SIZE = 260; // raio do orb; a caixa (canvas) tem o dobro
const BOX = ORB_SIZE * 2;
const MINI_SCALE = 0.46;
const MINI_MARGIN = 24;
const HIT_RADIUS = 118; // raio clicável no minimalista (orb + um pouco do halo)
const POS_KEY = "aro.orbPos";

interface Spark {
  id: number;
  angle: number;
  dist: number;
}

interface Props {
  slotRef: RefObject<HTMLDivElement | null>;
  compact: boolean;
  orbState: OrbState;
  level: number;
  intensity: number;
  mood: number;
  tools: ToolCall[];
  memorySaves: number;
  voiceState: VoiceState;
  connected: boolean;
  status: string;
  onToggleListen: () => void;
  onToggleCompact: () => void;
}

interface Point {
  x: number;
  y: number;
}

function defaultMiniPos(): Point {
  const r = ORB_SIZE * MINI_SCALE;
  return { x: window.innerWidth - MINI_MARGIN - r, y: window.innerHeight - MINI_MARGIN - r };
}

function loadMiniPos(): Point {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Point;
      if (Number.isFinite(p.x) && Number.isFinite(p.y)) return clampToWindow(p);
    }
  } catch {
    /* sem storage: usa o padrão */
  }
  return defaultMiniPos();
}

function clampToWindow(p: Point): Point {
  const r = ORB_SIZE * MINI_SCALE * 0.6;
  return {
    x: Math.min(window.innerWidth - r, Math.max(r, p.x)),
    y: Math.min(window.innerHeight - r, Math.max(r, p.y)),
  };
}

/**
 * Camada do orb, por cima de tudo. No modo cheio ele senta no "slot" do palco;
 * no minimalista vai pro canto (ou onde você largou) e encolhe — tudo por transform,
 * então a transição é lisa. Fora do orb, o minimalista deixa o clique atravessar.
 */
export function OrbLayer({
  slotRef,
  compact,
  orbState,
  level,
  intensity,
  mood,
  tools,
  memorySaves,
  voiceState,
  connected,
  status,
  onToggleListen,
  onToggleCompact,
}: Props) {
  const gl = useMemo(supportsWebGL2, []);
  const [slotCenter, setSlotCenter] = useState<Point>({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  const [miniPos, setMiniPos] = useState<Point>(loadMiniPos);
  const [dragging, setDragging] = useState(false);
  const [hover, setHover] = useState(false);
  const [sparks, setSparks] = useState<Spark[]>([]);
  const controlsRef = useRef<HTMLDivElement>(null);
  const ignoring = useRef<boolean | null>(null);
  const drag = useRef<{ start: Point; origin: Point; moved: boolean } | null>(null);

  // onde o palco quer o orb no modo cheio
  useLayoutEffect(() => {
    const el = slotRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSlotCenter({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [slotRef]);

  useEffect(() => {
    const onResize = () => setMiniPos((p) => clampToWindow(p));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // faísca quando ele salva algo na memória
  useEffect(() => {
    if (memorySaves === 0) return;
    const base = Date.now();
    const burst: Spark[] = Array.from({ length: 5 }, (_, i) => ({ id: base + i, angle: Math.random() * 360, dist: 90 + Math.random() * 70 }));
    setSparks((s) => [...s, ...burst]);
    const t = window.setTimeout(() => setSparks((s) => s.filter((x) => !burst.includes(x))), 1600);
    return () => window.clearTimeout(t);
  }, [memorySaves]);

  const center = compact ? miniPos : slotCenter;
  const scale = compact ? MINI_SCALE : 1;

  // minimalista: cursor dentro do orb (ou dos botões) → janela recebe mouse; fora → atravessa
  const applyIgnore = useCallback((ignore: boolean) => {
    if (ignoring.current === ignore) return;
    ignoring.current = ignore;
    void window.aro.setIgnoreMouse(ignore);
  }, []);

  useEffect(() => {
    if (!compact) {
      ignoring.current = null;
      setHover(false);
      return;
    }
    const onMove = (e: MouseEvent) => {
      const dx = e.clientX - miniPos.x;
      const dy = e.clientY - miniPos.y;
      let inside = Math.hypot(dx, dy) <= HIT_RADIUS;
      const c = controlsRef.current?.getBoundingClientRect();
      if (!inside && c) inside = e.clientX >= c.left - 8 && e.clientX <= c.right + 8 && e.clientY >= c.top - 8 && e.clientY <= c.bottom + 8;
      if (drag.current) inside = true;
      setHover(inside);
      applyIgnore(!inside);
    };
    const onLeave = () => {
      setHover(false);
      applyIgnore(true);
    };
    window.addEventListener("mousemove", onMove);
    document.addEventListener("mouseleave", onLeave);
    applyIgnore(true);
    return () => {
      window.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseleave", onLeave);
    };
  }, [compact, miniPos, applyIgnore]);

  // arrastar o orb no minimalista
  const onPointerDown = (e: React.PointerEvent) => {
    if (!compact || e.button !== 0) return;
    drag.current = { start: { x: e.clientX, y: e.clientY }, origin: miniPos, moved: false };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.start.x;
    const dy = e.clientY - d.start.y;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    d.moved = true;
    setDragging(true);
    setMiniPos(clampToWindow({ x: d.origin.x + dx, y: d.origin.y + dy }));
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    if (d?.moved) {
      try {
        localStorage.setItem(POS_KEY, JSON.stringify(miniPos));
      } catch {
        /* sem storage */
      }
    }
  };

  const boxStyle: CSSProperties = {
    width: BOX,
    height: BOX,
    transform: `translate(${center.x - ORB_SIZE}px, ${center.y - ORB_SIZE}px) scale(${scale})`,
  };
  const controlsStyle: CSSProperties = {
    transform: `translate(${center.x}px, ${center.y + ORB_SIZE * scale + 18}px)`,
  };
  const pending = tools.filter((t) => t.ok === undefined);

  return (
    <div className="orb-layer" data-compact={String(compact)} data-dragging={String(dragging)} data-hover={String(hover)}>
      <div
        className="orb-box"
        style={boxStyle}
        title={compact ? status : "Duplo clique: modo minimalista"}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => {
          if (!drag.current?.moved) onToggleCompact();
        }}
      >
        <div className="orb-float">
          {gl ? (
            <OrbGL state={orbState} level={level} intensity={intensity} mood={mood} size={ORB_SIZE} />
          ) : (
            <OrbCanvas state={orbState} level={level} intensity={intensity} size={ORB_SIZE} />
          )}
        </div>
        {pending.length > 0 && (
          <div className="orbit" style={{ "--n": pending.length, "--r": `${ORB_SIZE * 0.62}px` } as CSSProperties}>
            {pending.map((t, i) => (
              <span key={t.toolId} className="orbit-item" style={{ "--i": i } as CSSProperties} title={t.name}>
                <ToolIcon name={t.name} />
              </span>
            ))}
          </div>
        )}
        {sparks.map((s) => (
          <span key={s.id} className="spark" style={{ "--angle": `${s.angle}deg`, "--dist": `${s.dist}px` } as CSSProperties} />
        ))}
      </div>

      <div ref={controlsRef} className="mini-controls" style={controlsStyle}>
        <button
          type="button"
          className="mini-btn"
          data-state={voiceState}
          disabled={voiceState === "off" || voiceState === "transcribing" || !connected}
          onClick={onToggleListen}
          title={voiceState === "listening" || voiceState === "hearing" ? "Ouvindo" : "Falar com o ARO"}
          aria-label="Falar com o ARO"
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="5.5" y="1.5" width="5" height="8" rx="2.5" />
            <path d="M3 7.5a5 5 0 0 0 10 0M8 12.5v2" strokeLinecap="round" />
          </svg>
        </button>
        <button type="button" className="mini-btn" onClick={onToggleCompact} title="Expandir" aria-label="Expandir">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M9 2.5h4.5V7M13.5 2.5 8.5 7.5M7 13.5H2.5V9M2.5 13.5l5-5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
