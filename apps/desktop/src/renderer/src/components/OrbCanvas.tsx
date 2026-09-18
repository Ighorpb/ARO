import { useEffect, useRef } from "react";
import type { AroState } from "@aro/shared";

export type OrbState = AroState | "offline" | "listening" | "sleeping";

interface Props {
  state: OrbState;
  /** 0..1 — volume do mic (ouvindo) ou da voz dele (falando) */
  level: number;
  /** 0..1 — ritmo do pensamento (tokens/s normalizado) */
  intensity: number;
  size: number;
}

type RGB = [number, number, number];

interface Palette {
  core: RGB;
  a: RGB;
  b: RGB;
  glow: number;
  speed: number;
  churn: number;
}

const PALETTES: Record<OrbState, Palette> = {
  idle: { core: [255, 244, 220], a: [232, 184, 109], b: [184, 134, 58], glow: 0.42, speed: 0.12, churn: 0.25 },
  speaking: { core: [255, 248, 230], a: [240, 196, 120], b: [200, 146, 62], glow: 0.62, speed: 0.35, churn: 0.45 },
  thinking: { core: [236, 244, 252], a: [143, 163, 199], b: [74, 95, 138], glow: 0.55, speed: 0.9, churn: 1.0 },
  tool: { core: [240, 246, 255], a: [183, 199, 230], b: [143, 163, 199], glow: 0.58, speed: 1.4, churn: 0.8 },
  listening: { core: [250, 252, 255], a: [219, 231, 240], b: [143, 163, 199], glow: 0.5, speed: 0.25, churn: 0.35 },
  offline: { core: [90, 92, 100], a: [58, 61, 71], b: [42, 44, 52], glow: 0.1, speed: 0.04, churn: 0.1 },
  sleeping: { core: [150, 120, 80], a: [120, 90, 50], b: [70, 52, 30], glow: 0.14, speed: 0.05, churn: 0.12 },
};

const BLOBS = 7;

/** Ruído suave e determinístico por semente — soma de senos, sem dependência. */
function noise(t: number, seed: number): number {
  return 0.5 + 0.5 * (0.5 * Math.sin(t * 0.7 + seed) + 0.3 * Math.sin(t * 1.3 + seed * 2.1) + 0.2 * Math.sin(t * 2.9 + seed * 0.7));
}

function lerp(a: number, b: number, k: number) {
  return a + (b - a) * k;
}

function lerpRgb(a: RGB, b: RGB, k: number): RGB {
  return [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
}

function rgba([r, g, b]: RGB, alpha: number) {
  return `rgba(${r | 0}, ${g | 0}, ${b | 0}, ${alpha})`;
}

export function OrbCanvas({ state, level, intensity, size }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const props = useRef({ state, level, intensity });
  props.current = { state, level, intensity };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const px = size * 2; // margem pro halo
    canvas.width = px * dpr;
    canvas.height = px * dpr;
    canvas.style.width = `${px}px`;
    canvas.style.height = `${px}px`;
    ctx.scale(dpr, dpr);

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const center = px / 2;
    const R = size / 2;

    // valores atuais (interpolados) pra transição suave entre estados
    let cur: Palette = { ...PALETTES[props.current.state] };
    let smoothLevel = 0;
    let smoothIntensity = 0;
    let phase = 0;
    let last = performance.now();
    let raf = 0;

    const seeds = Array.from({ length: BLOBS }, (_, i) => i * 1.618 + 0.3);

    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      const target = PALETTES[props.current.state];
      const k = 1 - Math.exp(-dt * 4);
      cur = {
        core: lerpRgb(cur.core, target.core, k),
        a: lerpRgb(cur.a, target.a, k),
        b: lerpRgb(cur.b, target.b, k),
        glow: lerp(cur.glow, target.glow, k),
        speed: lerp(cur.speed, target.speed, k),
        churn: lerp(cur.churn, target.churn, k),
      };
      smoothLevel = lerp(smoothLevel, props.current.level, 1 - Math.exp(-dt * 12));
      smoothIntensity = lerp(smoothIntensity, props.current.intensity, 1 - Math.exp(-dt * 3));

      const st = props.current.state;
      const speaking = st === "speaking";
      const listening = st === "listening";
      const thinking = st === "thinking";

      const churn = cur.churn * (thinking ? 0.6 + smoothIntensity * 1.2 : 1);
      phase += dt * (cur.speed * (thinking ? 0.7 + smoothIntensity * 1.5 : 1));

      const breathe = 1 + 0.03 * Math.sin((now / 1000) * ((2 * Math.PI) / 6));
      const pulse = speaking ? 1 + smoothLevel * 0.22 : 1;
      const scale = breathe * pulse;

      ctx.clearRect(0, 0, px, px);

      // halo
      const haloR = R * 1.55 * scale;
      const halo = ctx.createRadialGradient(center, center, 0, center, center, haloR);
      halo.addColorStop(0, rgba(cur.a, cur.glow * (speaking ? 0.8 + smoothLevel * 0.5 : 0.8)));
      halo.addColorStop(0.45, rgba(cur.a, cur.glow * 0.28));
      halo.addColorStop(1, rgba(cur.a, 0));
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, px, px);

      // blobs de luz, blend aditivo
      ctx.globalCompositeOperation = "lighter";
      const t = phase;
      for (let i = 0; i < BLOBS; i++) {
        const s = seeds[i]!;
        const ang = s * 4 + t * (0.6 + (i % 3) * 0.25) + noise(t * 0.5, s) * churn * 2;
        const rad = R * (0.14 + 0.4 * noise(t * 0.8, s + 7) * (0.6 + churn * 0.6));
        const bx = center + Math.cos(ang) * rad * scale;
        const by = center + Math.sin(ang) * rad * scale;
        const br = R * (0.42 + 0.2 * noise(t * 1.1, s + 13)) * scale;
        const col = i % 2 === 0 ? cur.a : cur.b;
        const g = ctx.createRadialGradient(bx, by, 0, bx, by, br);
        g.addColorStop(0, rgba(col, 0.5));
        g.addColorStop(0.5, rgba(col, 0.17));
        g.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(bx, by, br, 0, Math.PI * 2);
        ctx.fill();
      }

      // núcleo
      const coreR = R * 0.74 * scale;
      const core = ctx.createRadialGradient(center, center, 0, center, center, coreR);
      core.addColorStop(0, rgba(cur.core, 0.78));
      core.addColorStop(0.4, rgba(cur.a, 0.5));
      core.addColorStop(1, rgba(cur.a, 0));
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(center, center, coreR, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = "source-over";

      // anel de escuta cresce com o volume do mic
      if (listening) {
        const ringR = R * (1.02 + smoothLevel * 0.5);
        ctx.strokeStyle = rgba(cur.core, 0.35 + smoothLevel * 0.4);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(center, center, ringR, 0, Math.PI * 2);
        ctx.stroke();
      }

      if (!reduced) raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [size]);

  return <canvas ref={canvasRef} className="orb-canvas" aria-hidden />;
}
