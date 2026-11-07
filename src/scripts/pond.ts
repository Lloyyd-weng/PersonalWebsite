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
const STEP_MS = 1000 / 60; // 固定步长,高刷屏上波速不翻倍

// ---- 波速:交互波纹和常驻涌浪要在同一个量级,不然一眼就像两套水 ----
// 深水的色散关系是 c ∝ √λ:波长越长跑得越快。涌浪按这个关系从 SWELL_SPEED 往下排;
// 交互波纹是短波,给一个和最长涌浪相当的速度,两者看起来才是同一片水。
const RIPPLE_SPEED = 170; // 交互波纹的传播速度(CSS px/s);170 是这个格式的上限(c² = 0.5)
const SWELL_SPEED = 150; // 最长那道涌浪(λ = 680px)的速度(CSS px/s)
// 波动方程的 c²(单位:格²/步²)。显式格式要求 c² ≤ 0.5 才稳定;原来写死的就是 0.5,约 170px/s
const C2 = Math.min(0.5, (RIPPLE_SPEED / ((CELL * 1000) / STEP_MS)) ** 2);
// 每步衰减按「每走一格衰减多少」折算:波走得慢了,每步的衰减也要跟着放轻,不然走不远就没了
const DAMP = 0.988 ** (Math.sqrt(C2) / Math.SQRT1_2);
// 一点粘性:每步往邻格平均靠一点,专门压掉格子尺度的毛刺(波走慢了以后毛刺散得慢,会把字撕碎)
const VISC = 0.03;

// ---- 泳池 ----
// 从正上方看一个泳池:一圈池沿、池底瓷砖、蓝色池水、右上角一架扶梯,页面内容画在池底。
// 颜色只活在这个 shader 里,global.css 的黑白 token 一个没动;不支持时页面仍是原来的黑白。
// 「看内容的折射」和「水底光斑」分开调:折射只给几个像素,光斑用大得多的等效深度。
const VIEW_DEPTH = 45; // 视线折射:水面坡度 → 池底偏移(再乘水深)
const RIPPLE_H = 6; // 交互波纹高度场 1 个单位 = 多少 px 的水面起伏
const CAUSTIC_SWELL = 1500; // 涌浪在池底聚光的等效深度:再大会过聚焦,亮的反而成大片
const CAUSTIC_SOFT = 0.15; // 光纹峰值的软化(越大越柔;小一点亮纹细,不成大块)
const CAUSTIC_RIPPLE = 30; // 交互波纹在池底聚光的等效深度
const CAUSTIC_GAIN = 0.5; // 池底光纹的强度
const PARALLAX = 30; // 光斜着照下来,池底光影相对水面错开的距离
const TILE = 60; // 瓷砖边长(CSS px)
const GROUT = 3; // 勾缝宽(CSS px)
const GROUT_LINES = false; // 瓷砖之间画不画勾缝描边(false 时只留极淡的色差)
const TEXT_TINT = 0.45; // 文字吃多少池水的颜色:1 = 和瓷砖一样被染蓝,小一点字更清楚
// 池水是蓝的,原来的浅灰 --muted 落在上面几乎看不清;泳池模式下换一档对比够的颜色(只改 canvas 里那份)
const MUTED_ON_WATER = { light: "#3b4654", dark: "#aab4c0" };

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

const f = (n: number) => n.toFixed(4);
const FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uText;   // c2 的画面(预乘 alpha)
uniform sampler2D uH;      // 交互波纹高度场
uniform vec2 uSize;        // 画面尺寸(CSS px)
uniform vec2 uTexSize;     // 文字贴图尺寸(设备像素)
uniform vec2 uGridMul;     // CSS px → 高度场贴图坐标
uniform vec2 uGridAdd;
uniform vec2 uTexel;       // 高度场一格的贴图坐标宽度
uniform float uLight;      // 1 = 浅色(白天),0 = 深色(夜泳池)
uniform float uT;
uniform float uRim;        // 池沿宽(CSS px)
uniform float uRadius;     // 池子内侧圆角半径
uniform vec3 uLadder;      // 扶梯:左竖杆的 x、缩放
uniform vec2 uFloorMin;    // 池底在屏幕上的矩形(透视下比池口小一圈,露出池壁)
uniform vec2 uFloorMax;

const float CELL = ${f(CELL)};
const vec2 LUP = vec2(-0.6, -0.8);   // 指向光源:左上

// ---- 调色板:白天 / 夜里 ----
const vec3 RIM_L = vec3(0.953, 0.947, 0.935);   // 米白水磨石池沿
const vec3 RIM_D = vec3(0.150, 0.150, 0.155);
const vec3 TILE_L = vec3(0.86, 0.93, 0.98);     // 池底瓷砖(没被水染色时)
const vec3 TILE_D = vec3(0.34, 0.45, 0.56);
const vec3 GROUT_L = vec3(0.97, 0.99, 1.00);    // 勾缝
const vec3 GROUT_D = vec3(0.44, 0.54, 0.64);
const vec3 ABS_L = vec3(1.05, 0.42, 0.10);      // 池水吸收:红光吃得最多,所以越深越蓝
const vec3 ABS_D = vec3(1.90, 1.00, 0.45);
const vec3 LAMP = vec3(0.30, 0.80, 1.00);       // 夜里墙上那盏水下灯

const vec3 WAVES[5] = vec3[5](
  vec3(0.30, 680.0, 2.40),
  vec3(2.10, 470.0, 1.60),
  vec3(4.00, 360.0, 1.10),
  vec3(1.20, 260.0, 0.70),
  vec3(5.30, 190.0, 0.45)
);

// 常驻涌浪:几道不同方向的慢浪叠加,速度按深水色散 c ∝ √λ。hess = (hxx, hyy, hxy)
void swell(vec2 p, out vec2 grad, out vec3 hess) {
  grad = vec2(0.0);
  hess = vec3(0.0);
  for (int i = 0; i < 5; i++) {
    vec3 w = WAVES[i];
    float spd = ${f(SWELL_SPEED)} * sqrt(w.y / 680.0);
    float k = 6.2831853 / w.y;
    vec2 kv = vec2(cos(w.x), sin(w.x)) * k;
    float th = dot(kv, p) - spd * k * uT + float(i) * 1.7;
    float s = sin(th), c = cos(th);
    grad += w.z * c * kv;
    hess -= w.z * s * vec3(kv.x * kv.x, kv.y * kv.y, kv.x * kv.y);
  }
}

float hAt(vec2 g) { return texture(uH, g).r; }

// 交互波纹:差分求坡度与曲率
void ripple(vec2 p, out vec2 grad, out vec3 hess) {
  vec2 g = p * uGridMul + uGridAdd;
  vec2 ex = vec2(uTexel.x, 0.0), ey = vec2(0.0, uTexel.y);
  float c = hAt(g);
  float l = hAt(g - ex), r = hAt(g + ex), u = hAt(g - ey), d = hAt(g + ey);
  float ul = hAt(g - ex - ey), ur = hAt(g + ex - ey), dl = hAt(g - ex + ey), dr = hAt(g + ex + ey);
  grad = vec2(r - l, d - u) * (${f(RIPPLE_H)} / (2.0 * CELL));
  hess = vec3(r + l - 2.0 * c, d + u - 2.0 * c, (dr - ur - dl + ul) * 0.25)
       * (${f(RIPPLE_H)} / (CELL * CELL));
}

// 文字贴图用 Catmull-Rom 双三次采样:亚像素偏移下字边不糊,偏移为零时就是原像素。
// 4×4 的核用 5 次双线性取样近似(省掉四个角,权重很小)。
vec4 sampleSharp(vec2 uv) {
  vec2 p = uv * uTexSize - 0.5;
  vec2 i = floor(p);
  vec2 t = p - i;
  vec2 w0 = t * (-0.5 + t * (1.0 - 0.5 * t));
  vec2 w1 = 1.0 + t * t * (-2.5 + 1.5 * t);
  vec2 w2 = t * (0.5 + t * (2.0 - 1.5 * t));
  vec2 w3 = t * t * (-0.5 + 0.5 * t);
  vec2 w12 = w1 + w2;
  vec2 c0 = (i - 0.5) / uTexSize;
  vec2 c3 = (i + 2.5) / uTexSize;
  vec2 c12 = (i + 0.5 + w2 / w12) / uTexSize;
  float a = w12.x * w0.y, b = w0.x * w12.y, c = w12.x * w12.y, d = w3.x * w12.y, e = w12.x * w3.y;
  vec4 col = texture(uText, vec2(c12.x, c0.y)) * a
           + texture(uText, vec2(c0.x, c12.y)) * b
           + texture(uText, c12) * c
           + texture(uText, vec2(c3.x, c12.y)) * d
           + texture(uText, vec2(c12.x, c3.y)) * e;
  col /= a + b + c + d + e;
  col = clamp(col, 0.0, 1.0);
  col.rgb = min(col.rgb, vec3(col.a));
  return col;
}

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

// ---- 透视:从斜上方往池子里看 ----
// 池口(池沿内侧)离镜头近,看起来大;池底离得远,看起来小,中间露出四面池壁。
// 池底在屏幕上的矩形 uFloorMin..uFloorMax 由页面留白决定 —— 页面内容整块落在池底上,
// 不缩放、不移位,文字照样锐利,链接的点击位置也不受影响。
// z 是深度:0 = 池沿,1 = 池底;ZW = 水面所在的深度,水线以上那截池壁是干的。
const float ZW = 0.16;
const float WALL_H = ${f(TILE * 2.6)};   // 池壁高度(世界 px),池壁上大约两排半砖

// 透视压缩:靠近池沿的那段在屏幕上占得宽,越往下越窄
float zeta(float z) { return 1.8 * z / (1.0 + 0.8 * z); }

// 深度 z 那一圈的轮廓(圆角矩形)SDF,顺手给出那一圈的矩形
float sdLevel(vec2 p, float z, out vec2 mn, out vec2 mx) {
  float e = zeta(z);
  mn = mix(vec2(uRim), uFloorMin, e);
  mx = mix(uSize - vec2(uRim), uFloorMax, e);
  float r = mix(uRadius, uRadius * 0.6, e);
  vec2 q = abs(p - (mn + mx) * 0.5) - ((mx - mn) * 0.5 - vec2(r));
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
float sdLevel(vec2 p, float z) { vec2 a, b; return sdLevel(p, z, a, b); }
float sdPool(vec2 p) { return sdLevel(p, 0.0); }   // 池口:< 0 在池子里,> 0 在池沿上

// 视线从深度 z0 往下走,找它撞上池壁的深度(轮廓随 z 往里收,sd 单调增,二分就够)
float hitLevel(vec2 p, float z0) {
  float lo = z0, hi = 1.0;
  for (int i = 0; i < 10; i++) {
    float m = 0.5 * (lo + hi);
    if (sdLevel(p, m) < 0.0) lo = m; else hi = m;
  }
  return 0.5 * (lo + hi);
}

// 池壁上的点:换算成墙面坐标(沿墙方向 u 对齐池底的砖缝,竖直方向 v 从墙脚往上量)和朝里的法线
void wallCoord(vec2 p, float z, out vec2 uv, out vec2 nIn) {
  vec2 mn, mx;
  sdLevel(p, z, mn, mx);
  vec2 omn = vec2(uRim), omx = uSize - vec2(uRim);
  float v = (1.0 - z) * WALL_H;
  float ux = omn.x + (p.x - mn.x) / (mx.x - mn.x) * (omx.x - omn.x);
  float uy = omn.y + (p.y - mn.y) / (mx.y - mn.y) * (omx.y - omn.y);
  float dl = p.x - mn.x, dr = mx.x - p.x, dt = p.y - mn.y, db = mx.y - p.y;
  if (min(dl, dr) < min(dt, db)) {
    uv = vec2(uy, v);
    nIn = vec2(dl < dr ? 1.0 : -1.0, 0.0);
  } else {
    uv = vec2(ux, v);
    nIn = vec2(0.0, dt < db ? 1.0 : -1.0);
  }
}

// 瓷砖。q 是世界坐标(px)。GROUT_LINES = 0 时不画勾缝和倒角,只留每块砖之间极淡的色差
vec3 tiles(vec2 q, float light) {
  vec2 g = q / ${f(TILE)};
  vec3 tile = mix(TILE_D, TILE_L, light) * (0.975 + 0.05 * hash(floor(g)));
#if ${GROUT_LINES ? 1 : 0}
  vec2 fr = fract(g);
  vec2 e = min(fr, 1.0 - fr) * ${f(TILE)};
  float edge = min(e.x, e.y);
  float aa = max(fwidth(edge), 0.5);
  float grout = 1.0 - smoothstep(${f(GROUT / 2)} - aa, ${f(GROUT / 2)} + aa, edge);
  tile *= 1.0 - 0.05 * (1.0 - smoothstep(${f(GROUT / 2)}, ${f(GROUT / 2 + 4)}, edge));
  tile = mix(tile, mix(GROUT_D, GROUT_L, light), grout);
#endif
  return tile;
}

vec3 chrome(float hl, float light) {
  vec3 base = mix(vec3(0.38, 0.40, 0.43), vec3(0.74, 0.76, 0.79), light);
  return mix(base * (0.7 + 0.3 * hl), vec3(1.0), pow(max(hl, 0.0), 6.0) * mix(0.5, 0.85, light));
}

// 扶梯挂在上池壁靠右:两根竖杆顺着墙往下,三根踏杆。坐标用墙面的 (u, z)
float ladderWall(float u, float z, out float hl) {
  float s = uLadder.y, x0 = uLadder.x;
  float R = 3.0 * s, aa = 0.8;
  float m = 0.0;
  hl = 0.0;
  for (int i = 0; i < 2; i++) {
    float dx = abs(u - x0 - float(i) * 48.0 * s);
    float c = (1.0 - smoothstep(R - aa, R + aa, dx)) * step(z, 0.93);
    if (c > m) { m = c; hl = 1.0 - dx / R; }
  }
  for (int k = 0; k < 3; k++) {
    float dz = abs(z - (0.36 + float(k) * 0.24)) * WALL_H;
    float c = (1.0 - smoothstep(R - aa, R + aa, dz)) * step(x0, u) * step(u, x0 + 48.0 * s);
    if (c > m) { m = c; hl = 1.0 - dz / R; }
  }
  return m;
}

// 池沿:水磨石颗粒 + 靠水一侧往下卷的圆角沿口 + 跨在上池沿的扶手和它的影子
vec3 rim(vec2 S, float d, float light) {
  vec3 base = mix(RIM_D, RIM_L, light);
  vec3 c = base * (0.985 + 0.03 * hash(floor(S / 40.0)));
  c = mix(c, base * mix(1.7, 0.72, light), step(0.982, hash(floor(S / 1.6))) * 0.8);
  c = mix(c, base * mix(1.3, 0.86, light), step(0.990, hash(floor(S / 1.6) + 17.0)) * 0.6);
  c = mix(c, base * mix(1.5, 0.78, light), step(0.996, hash(floor(S / 4.0) + 3.0)) * 0.7);
  float lip = 1.0 - smoothstep(0.0, 7.0, d);
  vec2 ex = vec2(1.0, 0.0);
  vec2 out_ = normalize(vec2(sdPool(S + ex) - sdPool(S - ex), sdPool(S + ex.yx) - sdPool(S - ex.yx)));
  c *= 1.0 + lip * (0.10 * dot(-out_, normalize(LUP)) - 0.05);
  // 扶手:从池沿外侧伸过来,接上墙上的竖杆
  float s = uLadder.y, R = 3.0 * s;
  float lm = 0.0, hl = 0.0, sh = 0.0;
  for (int i = 0; i < 2; i++) {
    float x = uLadder.x + float(i) * 48.0 * s;
    float inY = smoothstep(0.25 * uRim - 1.0, 0.25 * uRim + 1.0, S.y) * step(S.y, uRim + 2.0);
    float dx = abs(S.x - x);
    float c1 = (1.0 - smoothstep(R - 0.8, R + 0.8, dx)) * inY;
    if (c1 > lm) { lm = c1; hl = 1.0 - dx / R; }
    sh = max(sh, (1.0 - smoothstep(R - 1.5, R + 1.5, abs(S.x - x - 5.0 * s))) * inY);
  }
  c *= 1.0 - 0.22 * sh * (1.0 - lm);
  return mix(c, chrome(hl, light), lm);
}

void main() {
  vec2 S = vUv * uSize;
  float light = uLight;
  vec2 n01 = S / uSize;
  vec3 absorb = mix(ABS_D, ABS_L, light);

  // 1. 水面坡度;水深左上浅、右下深(只影响颜色和折射强度)
  vec2 gs, gr; vec3 hs, hr;
  swell(S, gs, hs);
  ripple(S, gr, hr);
  vec2 grad = gs + gr;
  float depth = 0.72 + 0.28 * clamp(dot(n01, vec2(0.55, 0.45)), 0.0, 1.0);

  // 2. 视线:进了水才折射;然后往下走,看先撞上池壁还是池底
  float dWater = sdLevel(S, ZW);
  bool inWater = dWater < 0.0;
  vec2 X = inWater ? S + grad * ${f(VIEW_DEPTH)} * depth : S;
  bool onFloor = sdLevel(X, 1.0) < 0.0;
  float z = onFloor ? 1.0 : hitLevel(X, inWater ? ZW : 0.0);

  vec3 col;
  float tA = 0.0;
  float wet;   // 光在水里走过的路程,0 = 水线以上的干池壁,1 = 池底
  if (onFloor) {
    // 池底:瓷砖 + 画在上面的页面内容(内容本来就在屏幕坐标里,直接取)
    vec4 t = sampleSharp(X / uSize);
    tA = t.a;
    vec2 pf = vec2(uRim) + (X - uFloorMin) / (uFloorMax - uFloorMin) * (uSize - 2.0 * vec2(uRim));
    col = tiles(pf - vec2(uRim), light) * (1.0 - t.a) + t.rgb;
    // 池壁和池沿挡住斜射的光,在靠左上那两边的池底投下影子;墙脚一圈略暗
    float occl = smoothstep(-8.0, 8.0, sdLevel(X + normalize(LUP) * 34.0, 1.0));
    float nearWall = smoothstep(-40.0, 0.0, sdLevel(X, 1.0));
    col *= (1.0 - 0.30 * occl) * (1.0 - 0.18 * nearWall);
    wet = 1.0;
  } else {
    // 池壁:朝光的(下、右)亮,背光的(上、左)暗;墙脚更暗
    vec2 uv, nIn;
    wallCoord(X, z, uv, nIn);
    col = tiles(uv - vec2(uRim, 0.0), light);
    col *= 0.80 + 0.22 * dot(nIn, normalize(LUP));
    col *= 1.0 - 0.18 * smoothstep(0.75, 1.0, z);
    if (nIn.y > 0.5) {
      float hl, h2;
      float sh = ladderWall(uv.x - 6.0 * uLadder.y, z - 0.06, h2);
      float lm = ladderWall(uv.x, z, hl);
      col *= 1.0 - 0.30 * sh * (1.0 - lm);
      col = mix(col, chrome(hl, light), lm);
    }
    wet = inWater ? clamp((z - ZW) / (1.0 - ZW), 0.0, 1.0) : 0.0;
  }

  // 3. 焦散(只在水下)。照到 X 的光来自斜上方水面 X - 视差 处
  float lamp = exp(-length(X - vec2(uFloorMin.x, uSize.y * 0.55)) / (uSize.y * 0.45));
  if (wet > 0.0) {
    vec2 P = X - vec2(0.6, 0.8) * ${f(PARALLAX)};
    swell(P, gs, hs);
    ripple(P, gr, hr);
    vec3 H = hs * ${f(CAUSTIC_SWELL)} + hr * ${f(CAUSTIC_RIPPLE)};
    float det = (1.0 + H.x) * (1.0 + H.y) - H.z * H.z;
    float I = min(1.0 / max(abs(det), ${f(CAUSTIC_SOFT)}), 3.2) - 1.0;
    float Ic = max(I - 1.0, 0.0) * mix(0.12, 0.07, light) * wet;   // 只取聚得最狠的那一截,成细线
    float amb = mix(0.55 + 1.1 * lamp, 1.0, light);                 // 夜里压暗,水下灯照亮附近
    col *= mix(amb, mix(amb, 1.0, 0.6), tA) * (1.0 + Ic * ${f(CAUSTIC_GAIN / 0.5)});
  } else {
    col *= mix(0.62, 1.0, light);   // 夜里,水线以上的干池壁也暗
  }

  // 4. 池水吸收:光在水里走得越远越蓝;文字少染一点,保证读得清
  vec3 tint = exp(-absorb * depth * wet);
  col *= mix(tint, mix(vec3(1.0), tint, ${f(TEXT_TINT)}), tA);
  col += (1.0 - light) * LAMP * lamp * 0.10 * wet;

  // 5. 水面:水线一道亮线;波峰高光;左上一片天光
  col += (1.0 - smoothstep(0.0, 2.5, abs(dWater))) * mix(0.04, 0.08, light);
  if (inWater) {
    vec3 nrm = normalize(vec3(-grad * 2.0, 1.0));
    vec3 hv = normalize(normalize(vec3(-0.35, -0.45, 1.0)) + vec3(0.0, 0.0, 1.0));
    col += pow(max(dot(nrm, hv), 0.0), 220.0) * mix(0.25, 0.55, light);
    col += (1.0 - smoothstep(0.0, 0.85, length((n01 - vec2(0.12, 0.08)) * vec2(1.0, 1.4)))) * mix(0.02, 0.06, light);
  }

  // 6. 池沿在最上面,不折射;边界抗锯齿
  float d = sdPool(S);
  col = mix(col, rim(S, d, light), smoothstep(-0.8, 0.8, d));
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
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
const debug = {
  frames: 0,
  stop: () => {},
  start: () => {},
  // 读高度场,用来实测波纹传播速度
  field: (): { h: Float32Array; GW: number; GH: number; drop: (x: number, y: number) => void } | null => null,
};

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
  const uSize = U("uSize"), uLight = U("uLight"), uT = U("uT");
  const uTexSize = U("uTexSize");
  const uRim = U("uRim"), uRadius = U("uRadius"), uLadder = U("uLadder");
  const uFloorMin = U("uFloorMin"), uFloorMax = U("uFloorMax");
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
    const bg = parseRgb(getComputedStyle(document.body).backgroundColor);
    const lum = 0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2];
    gl!.uniform1f(uLight, lum > 0.5 ? 1 : 0);
    const muted = lum > 0.5 ? MUTED_ON_WATER.light : MUTED_ON_WATER.dark;
    if (target.style.getPropertyValue("--muted") !== muted) target.style.setProperty("--muted", muted);
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
      gl!.uniform2f(uGridMul, 1 / (CELL * GW), 1 / (CELL * GH));
      gl!.uniform2f(uGridAdd, 0.5 / GW, 0.5 / GH);
      gl!.uniform2f(uTexel, 1 / GW, 1 / GH);
      gl!.uniform2f(uSize, W, H);
      gl!.uniform2f(uTexSize, bw, bh);
      // 池沿和扶梯随屏幕宽度缩放:手机上窄一点,扶梯小一点
      const rimW = Math.min(26, Math.max(14, W * 0.014));
      const ls = Math.min(1, Math.max(0.55, W / 1600));
      gl!.uniform1f(uRim, rimW);
      gl!.uniform1f(uRadius, rimW * 1.4);
      // 透视下露出来的池壁宽度。上池壁露得最多(镜头略偏下),扶梯挂在那里。
      // 宽度受页面留白约束:左右要小于内容的左右留白(桌面 96px、手机 48px),
      // 底部要小于 main 的 pb-20(80px),这样页面内容整块落在池底上,不会压到池壁
      const bandX = Math.min(60, Math.max(12, W * 0.032));
      const bandT = Math.min(72, Math.max(24, H * 0.075));
      const bandB = Math.min(36, Math.max(14, H * 0.035));
      gl!.uniform2f(uFloorMin, rimW + bandX, rimW + bandT);
      gl!.uniform2f(uFloorMax, W - rimW - bandX, H - rimW - bandB);
      gl!.uniform3f(uLadder, W - rimW - bandX - 130 * ls, ls, 0);
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
        const sum = cur[i - 1] + cur[i + 1] + cur[i - GW] + cur[i + GW];
        const next = (2 - 4 * C2) * cur[i] + C2 * sum - prev[i];
        prev[i] = (next + VISC * (sum * 0.25 - next)) * DAMP;
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
      if (nextDrop) drop(Math.random() * W, Math.random() * H, 4, -0.5 - Math.random() * 0.4);
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
        drop(px + ((x - px) * k) / n, py + ((y - py) * k) / n, 4, -amp / n);
      }
    }
    px = x;
    py = y;
    pt = now;
  }
  function onDown(e: PointerEvent) {
    if (!W) return;
    const r = holder.getBoundingClientRect();
    drop(e.clientX - r.left, e.clientY - r.top, 5, -1.4);
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

  if (import.meta.env.DEV) {
    debug.field = () => ({ h: cur, GW, GH, drop: (x: number, y: number) => drop(x, y, 3, -1) });
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
