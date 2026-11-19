import { DEFAULT_LOOK, findLook, type Adjustments, type FilterRef, type LookParams } from "@/lib/adjustments";

/**
 * Single-pass WebGL2 colour pipeline. One shared instance processes photo layers and
 * video frames; results are copied out of `canvas` by the caller.
 */
const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  // Flip in the shader: UNPACK_FLIP_Y is ignored for ImageBitmap sources.
  vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform sampler3D uLut;
uniform vec2 uTexel;
uniform float uExposure, uBrightness, uContrast, uHighlights, uShadows, uWhites, uBlacks;
uniform float uTemp, uTint, uSat, uVib, uGamma, uClarity, uSharp, uDehaze, uVignette, uGrain;
uniform float uLift, uGain;
uniform vec3 uRGB;
uniform float uLutMix, uLutSize;
uniform float uLookMix, uLExposure, uLContrast, uLSat, uLTemp, uLTint, uLFade, uLGray, uLSplit;
uniform vec3 uLShadow, uLHigh;
uniform float uSeed;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
vec3 wb(vec3 c, float temp, float tint) {
  c.r *= 1.0 + temp * 0.28; c.b *= 1.0 - temp * 0.28;
  c.g *= 1.0 - tint * 0.2; c.r *= 1.0 + tint * 0.06; c.b *= 1.0 + tint * 0.06;
  return c;
}
vec3 look(vec3 c) {
  c *= pow(2.0, uLExposure * 2.0);
  c = wb(c, uLTemp, uLTint);
  c = (c - 0.5) * (1.0 + uLContrast) + 0.5;
  float l = luma(c);
  c = mix(vec3(l), c, 1.0 + uLSat);
  c = mix(c, vec3(l), uLGray);
  l = clamp(luma(c), 0.0, 1.0);
  c += (uLShadow - 0.5) * uLSplit * (1.0 - l) + (uLHigh - 0.5) * uLSplit * l;
  c = c * (1.0 - uLFade * 0.28) + uLFade * 0.12;
  return c;
}

void main() {
  vec4 src = texture(uTex, vUv);
  vec3 c = src.rgb;

  if (uSharp > 0.0 || uClarity != 0.0) {
    vec3 n = texture(uTex, vUv + vec2(uTexel.x, 0.0)).rgb + texture(uTex, vUv - vec2(uTexel.x, 0.0)).rgb
           + texture(uTex, vUv + vec2(0.0, uTexel.y)).rgb + texture(uTex, vUv - vec2(0.0, uTexel.y)).rgb;
    c += (c - n * 0.25) * uSharp * 2.0;
    if (uClarity != 0.0) {
      float r = 0.012 / max(uTexel.x, uTexel.y) ;
      vec2 o = uTexel * min(r, 24.0);
      vec3 b = vec3(0.0);
      for (int i = 0; i < 8; i++) {
        float a = float(i) * 0.7853982;
        b += texture(uTex, vUv + vec2(cos(a), sin(a)) * o).rgb;
        b += texture(uTex, vUv + vec2(cos(a + 0.39), sin(a + 0.39)) * o * 0.5).rgb;
      }
      b /= 16.0;
      float l0 = luma(c);
      float mid = 1.0 - abs(2.0 * clamp(l0, 0.0, 1.0) - 1.0);
      c += (l0 - luma(b)) * uClarity * 0.9 * (0.35 + 0.65 * mid);
    }
  }

  c *= pow(2.0, uExposure * 2.0);
  c = wb(c, uTemp, uTint);
  c += uBrightness * 0.25;
  c = (c - 0.5) * (1.0 + (uContrast > 0.0 ? uContrast * 1.2 : uContrast * 0.8)) + 0.5;

  float l = clamp(luma(c), 0.0, 1.0);
  float sh = 1.0 - smoothstep(0.0, 0.55, l);
  float hi = smoothstep(0.45, 1.0, l);
  c += sh * uShadows * 0.32 + hi * uHighlights * 0.32;

  float wp = 1.0 - uWhites * 0.22;
  float bp = -uBlacks * 0.14;
  c = (c - bp) / max(wp - bp, 0.05);

  if (uDehaze != 0.0) {
    float d = uDehaze * 0.14;
    c = (c - d) / max(1.0 - d, 0.2);
    float ld = luma(c);
    c = mix(vec3(ld), c, 1.0 + uDehaze * 0.25);
  }

  c = pow(max(c, 0.0), vec3(pow(2.0, -uGamma)));

  // lift / gain
  c = c * (1.0 + uGain * 0.5) + uLift * 0.25 * (1.0 - clamp(c, 0.0, 1.0));
  c *= uRGB;

  l = luma(c);
  c = mix(vec3(l), c, 1.0 + uSat);
  float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
  c = mix(vec3(l), c, 1.0 + uVib * (1.0 - clamp(mx - mn, 0.0, 1.0)));

  if (uLutMix > 0.0) {
    vec3 q = clamp(c, 0.0, 1.0) * ((uLutSize - 1.0) / uLutSize) + 0.5 / uLutSize;
    c = mix(c, texture(uLut, q).rgb, uLutMix);
  }
  if (uLookMix > 0.0) c = mix(c, look(c), uLookMix);

  if (uVignette != 0.0) {
    float d = distance(vUv, vec2(0.5)) * 1.4142;
    float v = smoothstep(0.35, 1.0, d);
    c *= uVignette > 0.0 ? 1.0 - v * uVignette * 0.85 : 1.0 + v * -uVignette * 0.6;
  }
  if (uGrain > 0.0) {
    float n = hash(gl_FragCoord.xy + uSeed) - 0.5;
    c += n * uGrain * 0.22 * (1.0 - 0.5 * clamp(luma(c), 0.0, 1.0));
  }
  outColor = vec4(clamp(c, 0.0, 1.0), src.a);
}`;

export interface Lut3D { size: number; data: Uint8Array; id: string }

type Src = TexImageSource & object;

export class AdjustRenderer {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private u = new Map<string, WebGLUniformLocation | null>();
  private texCache = new WeakMap<object, WebGLTexture>();
  private streamTex: WebGLTexture;
  private lutTex: WebGLTexture;
  private lutId: string | null = null;

  constructor() {
    this.canvas = document.createElement("canvas");
    const gl = this.canvas.getContext("webgl2", { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false });
    if (!gl) throw new Error("WebGL2 is not available in this browser, so colour adjustments cannot be rendered.");
    this.gl = gl;
    const mk = (type: number, srcText: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, srcText);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error("Shader error: " + gl.getShaderInfoLog(sh));
      return sh;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, mk(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, mk(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error("Program error: " + gl.getProgramInfoLog(p));
    this.prog = p;
    gl.useProgram(p);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(p, "aPos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    this.streamTex = this.makeTex();
    this.lutTex = gl.createTexture()!;
    gl.uniform1i(this.loc("uTex"), 0);
    gl.uniform1i(this.loc("uLut"), 1);
    // A 1x1x1 placeholder keeps the sampler3D complete when no LUT is loaded.
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, this.lutTex);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, 1, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    gl.activeTexture(gl.TEXTURE0);
  }

  private loc(name: string) {
    if (!this.u.has(name)) this.u.set(name, this.gl.getUniformLocation(this.prog, name));
    return this.u.get(name)!;
  }

  private makeTex() {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  private setLut(lut: Lut3D | null | undefined) {
    const gl = this.gl;
    if (!lut || lut.id === this.lutId) return;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, this.lutTex);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, lut.size, lut.size, lut.size, 0, gl.RGBA, gl.UNSIGNED_BYTE, lut.data);
    for (const k of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_3D, k, gl.LINEAR);
    for (const k of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, k, gl.CLAMP_TO_EDGE);
    gl.activeTexture(gl.TEXTURE0);
    this.lutId = lut.id;
  }

  /**
   * Renders `source` through the pipeline at w x h and returns the internal canvas.
   * `stream` sources (video frames) are re-uploaded every call; still images are cached.
   */
  render(source: Src, w: number, h: number, a: Adjustments, opts: { filter?: FilterRef; lut?: Lut3D | null; lutMix?: number; stream?: boolean; seed?: number } = {}): HTMLCanvasElement {
    const gl = this.gl;
    const max = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    if (w > max || h > max) {
      const k = max / Math.max(w, h);
      w = Math.floor(w * k);
      h = Math.floor(h * k);
    }
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.activeTexture(gl.TEXTURE0);
    if (opts.stream) {
      gl.bindTexture(gl.TEXTURE_2D, this.streamTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    } else {
      let t = this.texCache.get(source);
      if (!t) {
        t = this.makeTex();
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        this.texCache.set(source, t);
      } else gl.bindTexture(gl.TEXTURE_2D, t);
    }
    const f = (n: string, v: number) => gl.uniform1f(this.loc(n), v);
    const lk = findLook(opts.filter?.id);
    const mix = lk ? (opts.filter!.intensity ?? 100) / 100 : 0;
    const L: LookParams = { ...DEFAULT_LOOK, ...(lk?.p ?? {}) };
    gl.uniform2f(this.loc("uTexel"), 1 / w, 1 / h);
    f("uExposure", a.exposure / 100); f("uBrightness", a.brightness / 100); f("uContrast", a.contrast / 100);
    f("uHighlights", a.highlights / 100); f("uShadows", a.shadows / 100); f("uWhites", a.whites / 100); f("uBlacks", a.blacks / 100);
    f("uTemp", a.temperature / 100); f("uTint", a.tint / 100); f("uSat", a.saturation / 100); f("uVib", a.vibrance / 100);
    f("uGamma", a.gamma / 100); f("uClarity", a.clarity / 100); f("uSharp", a.sharpness / 100); f("uDehaze", a.dehaze / 100);
    f("uVignette", Math.max(-1, Math.min(1, a.vignette / 100 + L.vignette * mix)));
    f("uGrain", Math.min(1, a.grain / 100 + L.grain * mix));
    f("uLift", a.lift / 100); f("uGain", a.gain / 100);
    gl.uniform3f(this.loc("uRGB"), 1 + a.red / 200, 1 + a.green / 200, 1 + a.blue / 200);
    f("uLookMix", mix); f("uLExposure", L.exposure); f("uLContrast", L.contrast); f("uLSat", L.saturation);
    f("uLTemp", L.temperature); f("uLTint", L.tint); f("uLFade", L.fade); f("uLGray", L.gray); f("uLSplit", L.split);
    gl.uniform3f(this.loc("uLShadow"), ...L.shadowTint);
    gl.uniform3f(this.loc("uLHigh"), ...L.highTint);
    this.setLut(opts.lut);
    f("uLutMix", opts.lut ? (opts.lutMix ?? 1) : 0);
    f("uLutSize", opts.lut?.size ?? 1);
    f("uSeed", opts.seed ?? 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return this.canvas;
  }

  /** Frees the cached GPU texture for a still source that is no longer needed. */
  forget(source: object) {
    const t = this.texCache.get(source);
    if (t) {
      this.gl.deleteTexture(t);
      this.texCache.delete(source);
    }
  }
}

let shared: AdjustRenderer | null = null;
export function getAdjustRenderer(): AdjustRenderer {
  return (shared ??= new AdjustRenderer());
}

/** Parses an Adobe/Resolve .cube 3D LUT. */
export function parseCube(text: string, id: string): Lut3D {
  let size = 0;
  const vals: number[] = [];
  let lo = [0, 0, 0], hi = [1, 1, 1];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("LUT_3D_SIZE")) size = parseInt(line.split(/\s+/)[1], 10);
    else if (line.startsWith("LUT_1D_SIZE")) throw new Error("1D LUTs are not supported; please use a 3D .cube file.");
    else if (line.startsWith("DOMAIN_MIN")) lo = line.split(/\s+/).slice(1).map(Number);
    else if (line.startsWith("DOMAIN_MAX")) hi = line.split(/\s+/).slice(1).map(Number);
    else if (/^[-\d.]/.test(line)) {
      const p = line.split(/\s+/).map(Number);
      if (p.length >= 3) vals.push(p[0], p[1], p[2]);
    }
  }
  if (!size || size > 129 || vals.length !== size ** 3 * 3) throw new Error("This .cube file is not a valid 3D LUT.");
  const data = new Uint8Array(size ** 3 * 4);
  for (let i = 0, j = 0; i < vals.length; i += 3, j += 4) {
    for (let k = 0; k < 3; k++) data[j + k] = Math.round(Math.min(1, Math.max(0, (vals[i + k] - lo[k]) / (hi[k] - lo[k]))) * 255);
    data[j + 3] = 255;
  }
  return { size, data, id };
}
