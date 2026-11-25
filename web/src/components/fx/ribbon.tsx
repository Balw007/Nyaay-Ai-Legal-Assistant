"use client";
import { useEffect, useRef } from "react";
import { useTheme } from "@/components/providers";
import { cn } from "@/lib/utils";

// The ribbon of light in the background of the login screen and Home: 64 fine strands drawn on the GPU.
// Soft strand edges make the glow, so there are no blur filters. It stops drawing when it is off screen, while the
// welcome video plays, and for people who ask their system for reduced motion (they get one still frame).
// Work screens use `live={false}`: one faint frame, so reading and drafting stay calm and cost nothing.

export type RibbonShape = "login" | "home" | "quiet";

// Six control points per shape, as fractions of the canvas (x, y).
const SHAPES: Record<RibbonShape, [number, number][]> = {
  login: [[-0.12, 1.04], [0.14, 0.82], [0.4, 0.84], [0.6, 0.56], [0.82, 0.14], [1.14, -0.06]],
  home: [[-0.06, 0.24], [0.15, 0.56], [0.37, 0.65], [0.58, 0.55], [0.74, 0.24], [1.1, -0.08]],
  quiet: [[0.5, -0.15], [0.76, 0.1], [0.94, 0.34], [0.9, 0.62], [0.78, 0.86], [0.6, 1.15]],
};

// Tall canvases (phones) get gentler curves that stay clear of the text and buttons.
const PORTRAIT: Partial<Record<RibbonShape, [number, number][]>> = {
  login: [[-0.3, 1.02], [0, 0.95], [0.32, 0.92], [0.64, 0.9], [0.96, 0.84], [1.3, 0.72]],
  home: [[-0.3, 0.42], [0, 0.57], [0.32, 0.63], [0.66, 0.59], [0.98, 0.44], [1.3, 0.18]],
};

const VERT = `attribute vec3 a;uniform vec2 P[6],res;uniform float T,wide,alpha,thin;uniform vec3 c0,c1,c2;varying float e;varying vec4 col;
vec2 at(float u){float x=min(u,.9999)*5.;int i=int(x);float t=x-float(i);vec2 p0=P[0],p1=P[0],p2=P[1],p3=P[2];
for(int k=0;k<5;k++){if(k==i){p1=P[k];p2=P[k+1];p0=P[k>0?k-1:0];p3=P[k<4?k+2:5];}}
return .5*(2.*p1+(p2-p0)*t+(2.*p0-5.*p1+4.*p2-p3)*t*t+(3.*p1-p0-3.*p2+p3)*t*t*t);}
void main(){float u=a.x,s=a.y,o=s/63.-.5;vec2 p=at(u),d=at(min(u+.012,1.))-at(max(u-.012,0.));vec2 n=normalize(vec2(-d.y,d.x)+1e-5);
float w=min(res.x,res.y)*(thin+.5*pow(abs(u-.5),1.5));
float off=o*w+sin(u*9.+s*.71-T*1.1)*w*.09+sin(u*4.+s*.15+T*.7)*6.;
float big=step(.5,1.-mod(s,9.));float th=wide*(1.+big*.8);
p+=n*(off+a.z*th);gl_Position=vec4(p.x/res.x*2.-1.,1.-p.y/res.y*2.,0.,1.);e=a.z;
float core=1.-abs(o)*2.;vec3 k=mix(c0,c1,core*core);float al=alpha*(.25+core*core);
if(mod(s,5.)<.5){k=c2;al=alpha*.75;}
al*=.75+.25*sin(u*7.-T*1.7+s*1.7);al*=smoothstep(0.,.08,u)*smoothstep(1.,.92,u);col=vec4(k,al);}`;
// Premultiplied output, so the canvas sits correctly on any page colour.
const FRAG = `precision mediump float;varying float e;varying vec4 col;
void main(){float f=max(exp(-e*e*4.5)-.011,0.);float a=col.a*f;gl_FragColor=vec4(col.rgb*a,a);}`;

const STRANDS = 64, SEG = 110;
/** One triangle strip for all strands; every fourth strand comes first so the soft passes can draw a subset. */
function geometry() {
  const rank = (s: number) => (s % 4 ? (s % 2 ? 2 : 1) : 0);
  const order = [...Array(STRANDS).keys()].sort((a, b) => rank(a) - rank(b));
  const v: number[] = [];
  for (const s of order) for (let k = 0; k <= SEG; k++) {
    const u = k / SEG;
    if (k === 0) v.push(u, s, -1);
    v.push(u, s, -1, u, s, 1);
    if (k === SEG) v.push(u, s, 1);
  }
  return new Float32Array(v);
}

const rgb = (r: number, g: number, b: number) => [r / 255, g / 255, b / 255] as const;
const TONES = {
  dark: [rgb(190, 128, 48), rgb(255, 214, 140), rgb(80, 130, 255)],
  light: [rgb(190, 142, 60), rgb(150, 105, 30), rgb(110, 145, 215)],
};

export function Ribbon({ shape, intensity = 1, live = true, className }: { shape: RibbonShape; intensity?: number; live?: boolean; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { theme } = useTheme();

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false, powerPreference: "high-performance" });
    // Without WebGL a soft wash of the same colour stands in.
    const fallback = () => { canvas.style.background = "radial-gradient(ellipse 60% 45% at 75% 60%, color-mix(in srgb, var(--brass) 16%, transparent), transparent 70%)"; };
    if (!gl) { fallback(); return; }

    const still = !live || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const tone = TONES[theme];
    const pts = new Float32Array(12);
    let W = 0, H = 0, quality = 1, raf = 0, visible = true, prev = 0, frames = 0, slow = 0;
    let mx = 0, my = 0, tx = 0, ty = 0;
    let res: { prog: WebGLProgram; buf: WebGLBuffer; n: number; u: Record<string, WebGLUniformLocation | null>; a: number } | null = null;

    const init = () => {
      const shader = (type: number, src: string) => {
        const o = gl.createShader(type)!;
        gl.shaderSource(o, src); gl.compileShader(o);
        return o;
      };
      const prog = gl.createProgram()!;
      const vs = shader(gl.VERTEX_SHADER, VERT), fs = shader(gl.FRAGMENT_SHADER, FRAG);
      gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
      gl.deleteShader(vs); gl.deleteShader(fs);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { gl.deleteProgram(prog); return null; }
      const data = geometry();
      const buf = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      const u = Object.fromEntries(["P", "res", "T", "wide", "alpha", "thin", "c0", "c1", "c2"].map((n) => [n, gl.getUniformLocation(prog, n)]));
      return { prog, buf, n: data.length / 3, u, a: gl.getAttribLocation(prog, "a") };
    };

    const draw = (T: number) => {
      if (!res || !W || !H) return;
      const base = (H > W ? PORTRAIT[shape] : undefined) ?? SHAPES[shape];
      for (let j = 0; j < 6; j++) {
        pts[j * 2] = (base[j][0] + 0.022 * Math.sin(T * 0.5 + j * 1.7)) * W + mx * 12;
        pts[j * 2 + 1] = (base[j][1] + 0.03 * Math.sin(T * 0.65 + j)) * H + my * 10;
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      // Dark: light adds up. Light: strands are laid over the paper, since adding light to ivory shows nothing.
      gl.blendFunc(gl.ONE, theme === "dark" ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(res.prog); gl.bindBuffer(gl.ARRAY_BUFFER, res.buf);
      gl.enableVertexAttribArray(res.a); gl.vertexAttribPointer(res.a, 3, gl.FLOAT, false, 0, 0);
      const u = res.u, k = intensity * (W < 720 ? 0.55 : 1) * (theme === "dark" ? 1 : 0.7);
      gl.uniform2fv(u.P, pts); gl.uniform2f(u.res, W, H); gl.uniform1f(u.T, T);
      gl.uniform1f(u.thin, shape === "home" ? 0.026 : 0.018);
      gl.uniform3fv(u.c0, tone[0]); gl.uniform3fv(u.c1, tone[1]); gl.uniform3fv(u.c2, tone[2]);
      // Two wide faint passes for the glow, then the crisp strands.
      for (const [wide, alpha, part] of [[38, 0.06, 0.25], [11, 0.1, 0.5], [1.8, 0.4, 1]]) {
        gl.uniform1f(u.wide, wide); gl.uniform1f(u.alpha, alpha * k);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, Math.floor(res.n * part));
      }
    };

    const size = () => {
      W = canvas.clientWidth; H = canvas.clientHeight;
      const d = Math.min(window.devicePixelRatio || 1, 1.25) * quality;
      canvas.width = Math.max(1, Math.round(W * d)); canvas.height = Math.max(1, Math.round(H * d));
      draw(still ? 4 : prev / 1000);
    };

    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (!visible || document.documentElement.dataset.intro) { prev = 0; return; }
      const dt = prev ? Math.min(0.05, (t - prev) / 1000) : 0.016;
      // On a slow machine, draw fewer pixels rather than drop frames.
      if (prev) {
        frames++; if (t - prev > 24) slow++;
        if (frames === 90) { if (slow > 45 && quality > 0.5) { quality -= 0.25; prev = t; size(); } frames = slow = 0; }
      }
      prev = t;
      const k = 1 - Math.exp(-3 * dt);
      mx += (tx - mx) * k; my += (ty - my) * k;
      draw(t / 1000);
    };

    res = init();
    if (!res) { fallback(); return; }
    canvas.style.background = "";

    const ro = new ResizeObserver(size); ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }); io.observe(canvas);
    const move = (e: PointerEvent) => { tx = (e.clientX / window.innerWidth) * 2 - 1; ty = (e.clientY / window.innerHeight) * 2 - 1; };
    const lost = (e: Event) => { e.preventDefault(); res = null; };
    const restored = () => { res = init(); size(); };
    canvas.addEventListener("webglcontextlost", lost);
    canvas.addEventListener("webglcontextrestored", restored);
    size();
    if (!still) { window.addEventListener("pointermove", move, { passive: true }); raf = requestAnimationFrame(loop); }

    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); io.disconnect();
      window.removeEventListener("pointermove", move);
      canvas.removeEventListener("webglcontextlost", lost);
      canvas.removeEventListener("webglcontextrestored", restored);
      if (res) { gl.deleteBuffer(res.buf); gl.deleteProgram(res.prog); }
      // Hand the context back once the canvas has really left the page (not on a re-run of this effect).
      window.setTimeout(() => { if (!canvas.isConnected) gl.getExtension("WEBGL_lose_context")?.loseContext(); }, 0);
    };
  }, [shape, intensity, live, theme]);

  return <canvas ref={ref} aria-hidden data-ribbon={shape} className={cn("pointer-events-none block h-full w-full", className)} />;
}
