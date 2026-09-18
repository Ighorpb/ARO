export const VERT = `#version 300 es
const vec2 P[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
void main() { gl_Position = vec4(P[gl_VertexID], 0.0, 1.0); }
`;

// Simplex noise 3D — Ashima Arts / Ian McEwan (MIT)
const SNOISE = `
vec3 mod289(vec3 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x){ return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
            i.z + vec4(0.0, i1.z, i2.z, 1.0))
          + i.y + vec4(0.0, i1.y, i2.y, 1.0))
          + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
float fbm(vec3 p){
  float f = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) { f += a * snoise(p); p = p * 2.03 + 1.7; a *= 0.5; }
  return f;
}
`;

export const FRAG = `#version 300 es
precision highp float;
out vec4 o;

uniform vec2  u_res;
uniform float u_time;
uniform vec3  u_core;
uniform vec3  u_a;
uniform vec3  u_b;
uniform float u_glow;      // força do halo
uniform float u_speed;     // velocidade do fluxo
uniform float u_churn;     // turbulência (0..1.5)
uniform float u_level;     // áudio: voz dele ou seu mic (0..1)
uniform float u_intensity; // ritmo do pensamento (0..1)
uniform float u_ring;      // anel de escuta (0 = off)
uniform float u_blink;     // pulso curto de brilho (0..1)
uniform float u_breath;    // ciclo de respiração em segundos
uniform vec2  u_pointer;   // direção do cursor (-1..1)
${SNOISE}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_res) / (0.5 * u_res);
  float t = u_time * u_speed;
  float r = length(uv);

  float breathe = 1.0 + 0.025 * sin(u_time * 6.2831853 / u_breath);
  float R = 0.5 * breathe * (1.0 + u_level * 0.14) * (1.0 + u_blink * 0.04);

  // esfera: profundidade dá volume; inclina levemente pro cursor
  float z = sqrt(max(0.0, R * R - r * r)) / R;
  vec3 sp = vec3(uv / R, z);
  sp.xy += u_pointer * 0.18 * (1.0 - z);

  // fluxo: domain warping em cima do simplex
  vec3 q = sp * 1.25;
  float w1 = fbm(q + vec3(0.0, 0.0, t * 0.35));
  float w2 = fbm(q + vec3(5.2, 1.3, -t * 0.27) + w1 * (0.8 + u_churn * 1.4));
  float n  = fbm(q * 1.4 + vec3(w1, w2, t * 0.2) * (0.9 + u_churn * 1.6));
  n = n * 0.5 + 0.5;

  // veias de energia onde o ruído cruza o meio
  float width = 0.055 + 0.045 * (1.0 - min(u_churn, 1.0));
  float veins = 1.0 - smoothstep(0.0, width, abs(n - 0.5));
  veins *= 0.35 + 0.65 * u_intensity + u_level * 0.4;

  // cor base
  vec3 col = mix(mix(u_b, u_a, 0.45), u_a, smoothstep(0.15, 0.85, n));
  col += u_core * veins * 0.42;

  // brilho interno: luz vem de dentro
  float inner = pow(max(0.0, 1.0 - r / R), 1.6);
  col += mix(u_a, u_core, 0.5) * inner * 0.4;

  // núcleo mais claro no centro (profundidade), borda com fresnel
  float depth = z * z;
  col = mix(col, u_core, depth * 0.3);
  float rim = pow(1.0 - z, 3.0);
  col += mix(u_a, u_core, 0.4) * rim * 0.5;

  // pulso de brilho (piscada) e áudio
  col *= 0.98 + u_blink * 0.25 + u_level * 0.2;

  // máscara da esfera com borda macia
  float edge = 1.0 - smoothstep(R * 0.84, R * 1.0, r);

  // halo do lado de fora
  float d = max(0.0, r - R * 0.9);
  float halo = exp(-d * d / (R * R * 0.42)) * u_glow * (1.0 + u_level * 0.7 + u_blink * 0.3);
  halo *= 1.0 - edge;
  halo *= 1.0 - smoothstep(0.62, 0.96, r); // morre antes da borda do canvas

  vec3 outc = col * edge + u_a * halo;
  float alpha = max(edge, halo);

  // anel de escuta cresce com o volume do mic
  if (u_ring > 0.0) {
    float rr = R * (1.08 + u_ring * 0.45);
    float ring = 1.0 - smoothstep(0.0, 0.014, abs(r - rr));
    outc += u_core * ring * (0.3 + u_ring * 0.5);
    alpha = max(alpha, ring * 0.9);
  }

  o = vec4(outc, alpha);
}
`;
