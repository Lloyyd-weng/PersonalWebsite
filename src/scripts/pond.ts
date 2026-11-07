// 首页整屏的「水面」效果 —— HTML-in-Canvas 的渐进增强(试做,2026-11-07)
//
// 只在支持 HTML-in-Canvas 的浏览器(Chrome 157+)里生效。不支持、用户开了「减弱动画」、
// 或 WebGL 起不来时,什么都不做,页面保持原样 —— 内容始终先作为普通 HTML 写在页面里,
// 这里只是在支持时把整个 <main>「搬进」canvas;运行中任何一步出错,都会把它搬回原位。
//
// 结构(照 html-in-canvas.dev 的 wishing-pond):
//   holder —— 原位留下的占位容器,高度跟 <main> 同步,撑住页面布局。
//   c2  —— 2D canvas,content="drawable",真实的 <main> 就在它里面。paint 事件里用
//          drawElementImage 画一份不变形的画面;2D 绘制会让浏览器自动同步点击区域,
//          所以链接、选字、键盘焦点、页内查找都落在内容真实的位置上。
//   glc —— WebGL2 canvas,盖在 c2 上面,pointer-events: none(点击穿透到 c2)。
//          把 c2 当贴图,按水面高度场的梯度做折射偏移,再加一点受光明暗。
//   高度场 —— CPU 上跑的经典二缓冲波动方程,粗网格,每帧当 R16F 贴图传上去。
//
// 水面偏移只有几个像素,点击区域按不变形的位置算,误差在可接受范围内。

type Ctx2D = CanvasRenderingContext2D & {
  drawElementImage(el: Element, x: number, y: number, w: number, h: number): void;
};
type DrawableCanvas = HTMLCanvasElement & { requestPaint?: () => void };

const CELL = 4; // 高度场一格对应的 CSS 像素
const DAMP = 0.984; // 每步衰减
const STEP_MS = 1000 / 60; // 固定步长,高刷屏上波速不翻倍
const REFRACT = 16; // 梯度 → 折射偏移(CSS px)
const SWAY = 0.55; // 常驻的轻微晃动幅度(CSS px)

const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
const darkScheme = matchMedia("(prefers-color-scheme: dark)");

export function supportsHtmlInCanvas(): boolean {
  const t = document.createElement("canvas");
  t.setAttribute("content", "drawable");
  return (
    (t as unknown as { content?: string }).content === "drawable" &&
    "drawElementImage" in CanvasRenderingContext2D.prototype
  );
}

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5); // y=0 在顶部,与 canvas 行序一致
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uText;   // c2 的画面(预乘 alpha)
uniform sampler2D uH;      // 高度场
uniform vec2 uGridMul;     // vUv → 高度场贴图坐标
uniform vec2 uGridAdd;
uniform vec2 uTexel;       // 高度场一格的贴图坐标宽度
uniform vec2 uPx;          // 1 CSS px 对应的 vUv 宽度
uniform vec3 uBg;
uniform vec3 uFg;
uniform float uT;
void main() {
  vec2 g = vUv * uGridMul + uGridAdd;
  float hl = texture(uH, g - vec2(uTexel.x, 0.0)).r;
  float hr = texture(uH, g + vec2(uTexel.x, 0.0)).r;
  float hu = texture(uH, g - vec2(0.0, uTexel.y)).r;
  float hd = texture(uH, g + vec2(0.0, uTexel.y)).r;
  vec2 grad = vec2(hr - hl, hd - hu);

  // 常驻的轻微晃动:让内容像沉在静水下面,不碰也在微微浮动
  vec2 sway = vec2(
    sin(vUv.y * 11.0 + uT * 0.9),
    sin(vUv.x * 7.0 + uT * 0.7 + 1.3)
  ) * ${SWAY.toFixed(2)};

  vec2 uv = vUv + (grad * ${REFRACT.toFixed(1)} + sway) * uPx;
  vec4 t = texture(uText, uv);
  vec3 col = uBg * (1.0 - t.a) + t.rgb;

  // 受光:朝光的波面往前景色偏一点,背光的往反方向。纯灰阶,不引入彩色
  float s = dot(grad, vec2(-0.6, -0.8));
  col += (uFg - uBg) * clamp(s * 0.9, -0.07, 0.07);
  outColor = vec4(col, 1.0);
}`;

function parseRgb(s: string): [number, number, number] {
  const m = s.match(/[\d.]+/g);
  if (!m || m.length < 3) return [1, 1, 1];
  return [+m[0] / 255, +m[1] / 255, +m[2] / 255];
}

function makeProgram(gl: WebGL2RenderingContext): WebGLProgram | null {
  const prog = gl.createProgram();
  if (!prog) return null;
  for (const [type, src] of [
    [gl.VERTEX_SHADER, VERT],
    [gl.FRAGMENT_SHADER, FRAG],
  ] as const) {
    const sh = gl.createShader(type);
    if (!sh) return null;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.warn("[pond]", gl.getShaderInfoLog(sh));
      return null;
    }
    gl.attachShader(prog, sh);
  }
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.warn("[pond]", gl.getProgramInfoLog(prog));
    return null;
  }
  return prog;
}

// 只在 dev 下挂到 window.__pond,用来验证「拆掉后复原」「离开视口停循环」;生产构建会被摇掉
const debug = { frames: 0, stop: () => {}, start: () => {} };

/** 把 target 沉进水面。返回拆除函数;挂不上时返回 null,页面原样不动。 */
function mount(target: HTMLElement): (() => void) | null {
  // ---- 先把 GL 准备好,失败就直接放弃,DOM 一下都不碰 ----
  const glc = document.createElement("canvas");
  const gl = glc.getContext("webgl2", { alpha: false, antialias: false });
  if (!gl) return null;
  const prog = makeProgram(gl);
  if (!prog) return null;
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, "aPos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const U = (n: string) => gl.getUniformLocation(prog, n);
  const uGridMul = U("uGridMul"), uGridAdd = U("uGridAdd"), uTexel = U("uTexel");
  const uPx = U("uPx"), uBg = U("uBg"), uFg = U("uFg"), uT = U("uT");
  gl.uniform1i(U("uText"), 0);
  gl.uniform1i(U("uH"), 1);

  for (const unit of [0, 1]) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

  const c2 = document.createElement("canvas") as DrawableCanvas;
  const ctx = c2.getContext("2d") as Ctx2D | null;
  if (!ctx) return null;

  // ---- 状态 ----
  const holder = document.createElement("div");
  const targetStyle = target.getAttribute("style");
  let alive = true;
  // target 的布局尺寸。注意不能用 getBoundingClientRect 量 canvas 里的元素 ——
  // 它返回的是「画出来之后」的几何,画多大量出来就多大,会自己绕圈
  let tw = target.offsetWidth, th = target.offsetHeight;
  let raf = 0;
  let visible = true;
  let dirty = true;
  let W = 0, H = 0, dpr = 0;
  let GW = 0, GH = 0;
  let cur = new Float32Array(0), prev = new Float32Array(0);
  let last = 0, acc = 0, nextDrop = 0;
  let px = -1, py = -1, pt = 0;

  // ---- DOM:原位留一个等高的占位,target 整个搬进 canvas ----
  // canvas 里的子元素按 shrink-to-fit 排版(宽度缩到内容的 max-content),
  // 所以要显式撑满 canvas,才和原来在 body 里的宽度一致;class 一个都不用改
  holder.style.cssText = `position:relative;height:${th}px`;
  target.style.width = "100%";
  const fill = "position:absolute;inset:0;width:100%;height:100%;display:block;";
  c2.style.cssText = fill;
  glc.style.cssText = fill + "pointer-events:none;";
  c2.setAttribute("content", "drawable");
  target.setAttribute("drawable", "");
  target.replaceWith(holder);
  c2.append(target);
  holder.append(c2, glc);

  const ro = new ResizeObserver((entries) =>
    guard(() => {
      for (const e of entries) {
        if (e.target !== target) continue;
        tw = e.borderBoxSize[0].inlineSize;
        th = e.borderBoxSize[0].blockSize;
      }
      layout();
    }),
  );
  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting && !document.hidden;
    kick();
  });

  function teardown() {
    if (!alive) return;
    alive = false;
    cancelAnimationFrame(raf);
    ro.disconnect();
    io.disconnect();
    document.removeEventListener("visibilitychange", onVis);
    darkScheme.removeEventListener("change", onScheme);
    target.removeAttribute("drawable");
    if (targetStyle === null) target.removeAttribute("style");
    else target.setAttribute("style", targetStyle);
    holder.replaceWith(target); // holder 连同两块 canvas、监听器一起丢掉
    gl!.getExtension("WEBGL_lose_context")?.loseContext();
  }

  // 运行中任何一步抛错 → 搬回原样,不留一块空白
  function guard(fn: () => void) {
    if (!alive) return;
    try {
      fn();
    } catch (err) {
      console.warn("[pond] 关闭水面效果:", err);
      teardown();
    }
  }

  function readColors() {
    gl!.uniform3f(uBg, ...parseRgb(getComputedStyle(document.body).backgroundColor));
    gl!.uniform3f(uFg, ...parseRgb(getComputedStyle(target).color));
  }

  // ---- 尺寸 ----
  function layout() {
    if (!tw || !th) return;
    if (Math.abs(parseFloat(holder.style.height) - th) > 0.5) {
      holder.style.height = `${th}px`;
    }
    const nd = Math.min(window.devicePixelRatio || 1, 2);
    if (tw !== W || th !== H || nd !== dpr) {
      W = tw;
      H = th;
      dpr = nd;
      const bw = Math.max(1, Math.round(W * dpr));
      const bh = Math.max(1, Math.round(H * dpr));
      c2.width = glc.width = bw;
      c2.height = glc.height = bh;
      gl!.viewport(0, 0, bw, bh);

      GW = Math.ceil(W / CELL) + 1;
      GH = Math.ceil(H / CELL) + 1;
      cur = new Float32Array(GW * GH);
      prev = new Float32Array(GW * GH);
      gl!.activeTexture(gl!.TEXTURE1);
      gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.R16F, GW, GH, 0, gl!.RED, gl!.FLOAT, cur);
      gl!.uniform2f(uGridMul, W / CELL / GW, H / CELL / GH);
      gl!.uniform2f(uGridAdd, 0.5 / GW, 0.5 / GH);
      gl!.uniform2f(uTexel, 1 / GW, 1 / GH);
      gl!.uniform2f(uPx, 1 / W, 1 / H);
      // 改 canvas 尺寸会清空画面,要重画
      c2.requestPaint?.();
    }
    kick();
  }

  // ---- 2D:画不变形的画面 ----
  c2.addEventListener("paint", () =>
    guard(() => {
      // 主题一变,文字颜色跟着变就会触发 paint;顺手重读颜色,背景永远跟得上
      readColors();
      ctx.clearRect(0, 0, c2.width, c2.height);
      ctx.drawElementImage(target, 0, 0, W * dpr, H * dpr);
      dirty = true;
      kick();
    }),
  );

  // ---- 水面 ----
  function drop(cx: number, cy: number, r: number, amp: number) {
    const gx = cx / CELL, gy = cy / CELL;
    const x0 = Math.max(1, Math.floor(gx - r)), x1 = Math.min(GW - 2, Math.ceil(gx + r));
    const y0 = Math.max(1, Math.floor(gy - r)), y1 = Math.min(GH - 2, Math.ceil(gy + r));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x - gx, y - gy) / r;
        if (d < 1) cur[y * GW + x] += amp * 0.5 * (1 + Math.cos(Math.PI * d));
      }
    }
  }

  function step() {
    for (let y = 1; y < GH - 1; y++) {
      for (let x = 1; x < GW - 1; x++) {
        const i = y * GW + x;
        prev[i] = ((cur[i - 1] + cur[i + 1] + cur[i - GW] + cur[i + GW]) * 0.5 - prev[i]) * DAMP;
      }
    }
    const t = cur;
    cur = prev;
    prev = t;
  }

  function render(now: number) {
    acc += Math.min(now - (last || now), 100);
    last = now;
    while (acc >= STEP_MS) {
      step();
      acc -= STEP_MS;
    }
    if (now > nextDrop) {
      // 偶尔落一滴,不碰的时候水面也是活的
      if (nextDrop) drop(Math.random() * W, Math.random() * H, 2.5, -0.5 - Math.random() * 0.4);
      nextDrop = now + 2200 + Math.random() * 2800;
    }
    const g = gl!;
    g.activeTexture(g.TEXTURE1);
    g.texSubImage2D(g.TEXTURE_2D, 0, 0, 0, GW, GH, g.RED, g.FLOAT, cur);
    if (dirty) {
      g.activeTexture(g.TEXTURE0);
      g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, c2);
      g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      dirty = false;
    }
    g.uniform1f(uT, now / 1000);
    g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
  }

  function frame(now: number) {
    raf = 0;
    if (!alive || !visible) return; // 离开视口或切到后台:停循环,回来再 kick
    if (import.meta.env.DEV) debug.frames++;
    guard(() => render(now));
    if (alive) raf = requestAnimationFrame(frame);
  }

  function kick() {
    if (alive && visible && !raf) {
      last = 0;
      raf = requestAnimationFrame(frame);
    }
  }

  // ---- 输入 ----
  function onMove(e: PointerEvent) {
    if (!W) return;
    const r = holder.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const now = e.timeStamp;
    if (px >= 0 && now - pt < 120) {
      const dist = Math.hypot(x - px, y - py);
      const speed = dist / Math.max(1, now - pt); // px/ms
      const amp = Math.min(speed * 0.35, 0.9);
      // 沿路径补点,快速划过也是连续的一道
      const n = Math.max(1, Math.ceil(dist / (CELL * 2)));
      for (let k = 1; k <= n; k++) {
        drop(px + ((x - px) * k) / n, py + ((y - py) * k) / n, 2, -amp / n);
      }
    }
    px = x;
    py = y;
    pt = now;
  }
  function onDown(e: PointerEvent) {
    if (!W) return;
    const r = holder.getBoundingClientRect();
    drop(e.clientX - r.left, e.clientY - r.top, 4, -0.9);
  }
  function onLeave() {
    px = -1;
  }
  function onVis() {
    visible = !document.hidden;
    kick();
  }
  function onScheme() {
    guard(() => {
      readColors();
      c2.requestPaint?.();
      dirty = true;
    });
  }

  holder.addEventListener("pointermove", onMove, { passive: true });
  holder.addEventListener("pointerdown", onDown, { passive: true });
  holder.addEventListener("pointerleave", onLeave);
  document.addEventListener("visibilitychange", onVis);
  darkScheme.addEventListener("change", onScheme);
  glc.addEventListener("webglcontextlost", () => teardown());
  ro.observe(holder);
  ro.observe(target);
  io.observe(holder);

  guard(() => {
    readColors();
    layout();
  });
  return alive ? teardown : null;
}

export function initPond() {
  const target = document.getElementById("pond");
  if (!target || !supportsHtmlInCanvas()) return;

  let stop: (() => void) | null = null;
  const start = () => {
    if (!stop && !reduceMotion.matches) stop = mount(target);
  };
  const halt = () => {
    stop?.();
    stop = null;
  };
  // 运行中切到「减弱动画」:整个拆掉,回到原样的静态页面
  reduceMotion.addEventListener("change", () => (reduceMotion.matches ? halt() : start()));
  start();

  if (import.meta.env.DEV) {
    debug.stop = halt;
    debug.start = start;
    (window as unknown as { __pond: typeof debug }).__pond = debug;
  }
}
