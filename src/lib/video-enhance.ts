/**
 * 画质增强：用 WebGL 把视频帧经 CAS（AMD FidelityFX Contrast Adaptive Sharpening）
 * 锐化后画到盖在 <video> 上的 canvas。低分辨率片源放大到全屏时细节更清楚，且不会像
 * 普通锐化那样在边缘出白边。
 *
 * hls.js 走 MSE（blob 源，同源），读取帧像素不受跨域限制；直连跨域 mp4 若读不了，
 * 会调用 onError 由调用方关掉增强，原视频照常播放。
 *
 * shortcut: canvas 覆盖后播放器的「画面比例 / 翻转」设置对增强画面不生效；需要时再把
 * video 的 CSS transform / 比例同步到 canvas。
 */

const VERTEX = `
attribute vec2 pos;
varying vec2 uv;
void main() {
  uv = vec2(pos.x * 0.5 + 0.5, 0.5 - pos.y * 0.5);
  gl_Position = vec4(pos, 0.0, 1.0);
}`;

const FRAGMENT = `
precision mediump float;
uniform sampler2D tex;
uniform vec2 px;
uniform float sharp;
varying vec2 uv;
vec3 at(float x, float y) { return texture2D(tex, uv + vec2(x, y) * px).rgb; }
void main() {
  vec3 a = at(-1.0, -1.0), b = at(0.0, -1.0), c = at(1.0, -1.0);
  vec3 d = at(-1.0, 0.0),  e = at(0.0, 0.0),  f = at(1.0, 0.0);
  vec3 g = at(-1.0, 1.0),  h = at(0.0, 1.0),  i = at(1.0, 1.0);
  vec3 mn = min(min(min(d, e), min(f, b)), h);
  mn += min(mn, min(min(a, c), min(g, i)));
  vec3 mx = max(max(max(d, e), max(f, b)), h);
  mx += max(mx, max(max(a, c), max(g, i)));
  vec3 amp = sqrt(clamp(min(mn, 2.0 - mx) / max(mx, vec3(1e-5)), 0.0, 1.0));
  vec3 w = amp * (-1.0 / mix(8.0, 5.0, sharp));
  vec3 color = (b * w + d * w + f * w + h * w + e) / (1.0 + 4.0 * w);
  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}`;

/** 增强档位：0 关闭；1 标准；2 强 */
export type EnhanceLevel = 0 | 1 | 2;
const SHARPNESS: Record<EnhanceLevel, number> = { 0: 0, 1: 0.5, 2: 1 };

export class VideoEnhancer {
  private canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext;
  private uPx: WebGLUniformLocation | null;
  private uSharp: WebGLUniformLocation | null;
  private level: EnhanceLevel = 0;
  private frameHandle = 0;
  private resizeObserver: ResizeObserver;

  constructor(
    private video: HTMLVideoElement,
    private onError: (message: string) => void
  ) {
    this.canvas = document.createElement('canvas');
    Object.assign(this.canvas.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
      display: 'none',
      background: '#000',
    });
    video.insertAdjacentElement('afterend', this.canvas);

    const gl = this.canvas.getContext('webgl', { alpha: false, antialias: false });
    if (!gl) throw new Error('当前环境不支持 WebGL');
    this.gl = gl;
    const program = gl.createProgram()!;
    for (const [type, src] of [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, FRAGMENT]] as const) {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const pos = gl.getAttribLocation(program, 'pos');
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.uPx = gl.getUniformLocation(program, 'px');
    this.uSharp = gl.getUniformLocation(program, 'sharp');

    this.resizeObserver = new ResizeObserver(() => this.draw());
    this.resizeObserver.observe(this.canvas);
  }

  setLevel(level: EnhanceLevel): void {
    this.level = level;
    this.canvas.style.display = level ? 'block' : 'none';
    if (level) {
      this.draw();
      this.scheduleFrame();
    }
  }

  private scheduleFrame(): void {
    if (!this.level || this.frameHandle) return;
    this.frameHandle = this.video.requestVideoFrameCallback(() => {
      this.frameHandle = 0;
      this.draw();
      this.scheduleFrame();
    });
  }

  private draw(): void {
    const { gl, video, canvas } = this;
    if (!this.level || video.readyState < 2 || !video.videoWidth) return;
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.round(canvas.clientWidth * dpr);
    const ch = Math.round(canvas.clientHeight * dpr);
    if (!cw || !ch) return;
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }
    // 与 video 的 object-fit: contain 一致的居中留黑边
    const scale = Math.min(cw / video.videoWidth, ch / video.videoHeight);
    const w = Math.round(video.videoWidth * scale);
    const h = Math.round(video.videoHeight * scale);
    gl.viewport(0, 0, cw, ch);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.viewport(Math.round((cw - w) / 2), Math.round((ch - h) / 2), w, h);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);
    } catch {
      this.setLevel(0);
      this.onError('该片源不支持画质增强，已恢复原画');
      return;
    }
    gl.uniform2f(this.uPx, 1 / video.videoWidth, 1 / video.videoHeight);
    gl.uniform1f(this.uSharp, SHARPNESS[this.level]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  destroy(): void {
    this.level = 0;
    if (this.frameHandle) this.video.cancelVideoFrameCallback(this.frameHandle);
    this.resizeObserver.disconnect();
    this.canvas.remove();
  }
}
