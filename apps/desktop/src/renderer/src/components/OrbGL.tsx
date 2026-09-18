import { useEffect, useRef } from "react";
import { FRAG, VERT } from "./orb.glsl";
import type { OrbState } from "./OrbCanvas";

interface Props {
  state: OrbState;
  level: number;
  intensity: number;
  /** -1..1: tom da resposta (frio ↔ quente), bem sutil */
  mood?: number;
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
  breath: number;
}

const rgb = (hex: string): RGB => [
  parseInt(hex.slice(1, 3), 16) / 255,
  parseInt(hex.slice(3, 5), 16) / 255,
  parseInt(hex.slice(5, 7), 16) / 255,
];

const PALETTES: Record<OrbState, Palette> = {
  idle: { core: rgb("#fff1d6"), a: rgb("#e8b86d"), b: rgb("#8a5a1e"), glow: 0.5, speed: 0.22, churn: 0.3, breath: 6.5 },
  speaking: { core: rgb("#fff6e4"), a: rgb("#f0c478"), b: rgb("#a86f2a"), glow: 0.7, speed: 0.5, churn: 0.55, breath: 3.5 },
  thinking: { core: rgb("#eaf2ff"), a: rgb("#8fa3c7"), b: rgb("#2b3d66"), glow: 0.6, speed: 1.1, churn: 1.3, breath: 2.6 },
  tool: { core: rgb("#f2f7ff"), a: rgb("#b7c7e6"), b: rgb("#4a5f8a"), glow: 0.62, speed: 1.6, churn: 1.0, breath: 1.8 },
  listening: { core: rgb("#fbfdff"), a: rgb("#dbe7f0"), b: rgb("#5c6b87"), glow: 0.55, speed: 0.35, churn: 0.4, breath: 4.5 },
  offline: { core: rgb("#5a5c64"), a: rgb("#3a3d47"), b: rgb("#1c1e26"), glow: 0.12, speed: 0.05, churn: 0.1, breath: 9 },
  sleeping: { core: rgb("#9a7a50"), a: rgb("#7a5c32"), b: rgb("#3a2c18"), glow: 0.16, speed: 0.06, churn: 0.12, breath: 11 },
};

/**
 * Hora do dia: 0 = manhã (mais claro e frio), 1 = noite (mais quente e fundo).
 * Só mexe nos estados âmbar (parado, falando, dormindo).
 */
function timeOfDay(): number {
  const h = new Date().getHours() + new Date().getMinutes() / 60;
  if (h >= 6 && h < 11) return 0;
  if (h >= 11 && h < 17) return 0.4;
  if (h >= 17 && h < 20) return 0.7;
  return 1;
}

const MORNING: Pick<Palette, "a" | "b" | "core"> = { core: rgb("#fff8ea"), a: rgb("#f2cf8f"), b: rgb("#a6743a") };
const NIGHT: Pick<Palette, "a" | "b" | "core"> = { core: rgb("#ffe9c4"), a: rgb("#e0a24f"), b: rgb("#6e4416") };
const WARM_STATES = new Set<OrbState>(["idle", "speaking", "sleeping"]);

const MOOD_WARM: RGB = rgb("#f6c983");
const MOOD_COOL: RGB = rgb("#c9a56e");

function tinted(state: OrbState, mood = 0): Palette {
  const base = PALETTES[state];
  if (!WARM_STATES.has(state)) return base;
  const k = timeOfDay();
  const w = state === "sleeping" ? 0.35 : 0.6; // quanto a hora pesa
  const a = lerp3(base.a, lerp3(MORNING.a, NIGHT.a, k), w);
  const m = Math.abs(mood) * 0.35;
  return {
    ...base,
    core: lerp3(base.core, lerp3(MORNING.core, NIGHT.core, k), w),
    a: lerp3(a, mood >= 0 ? MOOD_WARM : MOOD_COOL, m),
    b: lerp3(base.b, lerp3(MORNING.b, NIGHT.b, k), w),
    glow: base.glow + mood * 0.06,
  };
}

function lerp(a: number, b: number, k: number) {
  return a + (b - a) * k;
}

function lerp3(a: RGB, b: RGB, k: number): RGB {
  return [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
}

export function supportsWebGL2(): boolean {
  try {
    return Boolean(document.createElement("canvas").getContext("webgl2"));
  } catch {
    return false;
  }
}

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`shader: ${info}`);
  }
  return shader;
}

/** Orb vivo: ruído 3D com domain warping num shader. Reage a estado, áudio, pensamento, cursor. */
export function OrbGL({ state, level, intensity, mood = 0, size }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const props = useRef({ state, level, intensity, mood });
  props.current = { state, level, intensity, mood };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false });
    if (!gl) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const px = size * 2;
    canvas.width = px * dpr;
    canvas.height = px * dpr;
    canvas.style.width = `${px}px`;
    canvas.style.height = `${px}px`;
    gl.viewport(0, 0, canvas.width, canvas.height);

    const program = gl.createProgram()!;
    try {
      gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERT));
      gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    } catch (err) {
      console.error("[orb]", err);
      return;
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error("[orb] link:", gl.getProgramInfoLog(program));
      return;
    }
    gl.useProgram(program);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    const u = (name: string) => gl.getUniformLocation(program, name);
    const loc = {
      res: u("u_res"),
      time: u("u_time"),
      core: u("u_core"),
      a: u("u_a"),
      b: u("u_b"),
      glow: u("u_glow"),
      speed: u("u_speed"),
      churn: u("u_churn"),
      level: u("u_level"),
      intensity: u("u_intensity"),
      ring: u("u_ring"),
      blink: u("u_blink"),
      breath: u("u_breath"),
      pointer: u("u_pointer"),
    };
    gl.uniform2f(loc.res, canvas.width, canvas.height);

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let cur: Palette = { ...tinted(props.current.state, props.current.mood) };
    let smoothLevel = 0;
    let smoothIntensity = 0;
    let blink = 0;
    let nextBlink = performance.now() + 3000 + Math.random() * 4000;
    const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    let time = 0;
    let last = performance.now();
    let raf = 0;

    const onMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = (e.clientX - cx) / (window.innerWidth / 2);
      const dy = (e.clientY - cy) / (window.innerHeight / 2);
      const len = Math.hypot(dx, dy) || 1;
      const k = Math.min(1, len);
      pointer.tx = (dx / len) * k;
      pointer.ty = (-dy / len) * k;
    };
    const onLeave = () => {
      pointer.tx = 0;
      pointer.ty = 0;
    };
    window.addEventListener("mousemove", onMove);
    document.addEventListener("mouseleave", onLeave);

    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      const st = props.current.state;
      const target = tinted(st, props.current.mood);
      const k = 1 - Math.exp(-dt * 3.5);
      cur = {
        core: lerp3(cur.core, target.core, k),
        a: lerp3(cur.a, target.a, k),
        b: lerp3(cur.b, target.b, k),
        glow: lerp(cur.glow, target.glow, k),
        speed: lerp(cur.speed, target.speed, k),
        churn: lerp(cur.churn, target.churn, k),
        breath: lerp(cur.breath, target.breath, k),
      };
      smoothLevel = lerp(smoothLevel, props.current.level, 1 - Math.exp(-dt * 14));
      smoothIntensity = lerp(smoothIntensity, props.current.intensity, 1 - Math.exp(-dt * 3));
      pointer.x = lerp(pointer.x, pointer.tx, 1 - Math.exp(-dt * 2.5));
      pointer.y = lerp(pointer.y, pointer.ty, 1 - Math.exp(-dt * 2.5));

      // piscada: pulso curto e irregular, só parado ou falando baixo
      if (now > nextBlink && (st === "idle" || st === "listening")) {
        blink = 1;
        nextBlink = now + 2500 + Math.random() * 6000;
      }
      blink *= Math.exp(-dt * 5);

      const thinking = st === "thinking";
      const churn = cur.churn * (thinking ? 0.7 + smoothIntensity * 0.8 : 1);
      time += dt * (thinking ? 1 + smoothIntensity : 1);

      gl.uniform1f(loc.time, time);
      gl.uniform3f(loc.core, ...cur.core);
      gl.uniform3f(loc.a, ...cur.a);
      gl.uniform3f(loc.b, ...cur.b);
      gl.uniform1f(loc.glow, cur.glow);
      gl.uniform1f(loc.speed, cur.speed);
      gl.uniform1f(loc.churn, churn);
      gl.uniform1f(loc.level, st === "speaking" ? smoothLevel : st === "idle" ? smoothLevel * 0.35 : 0);
      gl.uniform1f(loc.intensity, thinking ? smoothIntensity : st === "tool" ? 0.6 : 0);
      gl.uniform1f(loc.ring, st === "listening" ? 0.02 + smoothLevel : 0);
      gl.uniform1f(loc.blink, blink);
      gl.uniform1f(loc.breath, cur.breath);
      gl.uniform2f(loc.pointer, pointer.x, pointer.y);

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      if (!reduced) raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseleave", onLeave);
      gl.deleteProgram(program);
    };
  }, [size]);

  return <canvas ref={canvasRef} className="orb-canvas" aria-hidden />;
}
