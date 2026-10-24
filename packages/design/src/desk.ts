/**
 * 登录页左格“写故事的桌面”和右格集中线里看起来随机的形状（docs/design/comic 的“登录页”一节）：
 * 等高线、湖、文稿上的字条、集中线。都用固定种子的伪随机生成，同一个种子每次画出来都一样，
 * 页面每次打开桌面不变，截图也对得上。网页（apps/web 的 pages/auth/Desk.tsx）和手机端平板横屏的登录页
 * （apps/mobile 的 components/AuthDesk.tsx）共用这里；位置、大小这些确定的数值在两边的组件里，照设计稿源码。
 */

export type Pt = { x: number; y: number };
export type Box = { width: number; height: number };

/** 伪随机数（mulberry32）：同一个种子给出同一串 [0, 1) 的数 */
export function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** 一圈不规则的闭合线：半径随角度起伏（几个正弦叠起来），共 points 个点 */
function wobblyRing(center: Pt, rx: number, ry: number, wave: number[][], points: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2;
    let k = 1;
    for (const [amp, freq, phase] of wave) k += amp! * Math.sin(freq! * a + phase!);
    out.push({ x: round1(center.x + Math.cos(a) * rx * k), y: round1(center.y + Math.sin(a) * ry * k) });
  }
  return out;
}

function waveOf(rand: () => number, strength: number): number[][] {
  return [2, 3, 5].map((freq, i) => [strength * (0.6 - i * 0.15) * (0.5 + rand()), freq, rand() * Math.PI * 2]);
}

/**
 * 一座山的等高线：count 圈，从外往里一圈比一圈小（最里面一圈是最外面的 1/count 左右），形状大致相同、各有一点出入。
 * rx、ry 是最外面一圈的半径；起伏留了余量，最外圈不会超出 rx、ry 的 1.35 倍
 */
export function contours(seed: number, center: Pt, rx: number, ry: number, count: number, points = 20): Pt[][] {
  const rand = random(seed);
  const shape = waveOf(rand, 0.14);
  const rings: Pt[][] = [];
  for (let i = 0; i < count; i++) {
    const scale = 1 - i / count;
    const jitter = waveOf(rand, 0.025);
    // 越往里，圆心越往一边偏一点（山顶不在正中）
    const drift = { x: center.x + (1 - scale) * rx * 0.08, y: center.y - (1 - scale) * ry * 0.06 };
    rings.push(wobblyRing(drift, rx * scale, ry * scale, [...shape, ...jitter], points));
  }
  return rings;
}

/** 湖：一块不规则的圆，比等高线起伏大 */
export function lake(seed: number, center: Pt, r: number, points = 16): Pt[] {
  const rand = random(seed);
  return wobblyRing(center, r, r * 0.92, waveOf(rand, 0.16), points);
}

/** 穿过这些点的平滑曲线（Catmull-Rom 换成三次贝塞尔），给 SVG 的 path */
export function smoothPath(points: Pt[], closed: boolean): string {
  const n = points.length;
  if (n < 2) return "";
  const at = (i: number): Pt => {
    if (closed) return points[((i % n) + n) % n]!;
    return points[Math.min(Math.max(i, 0), n - 1)]!;
  };
  const f = (v: number): string => String(round1(v));
  let d = `M${f(at(0).x)} ${f(at(0).y)}`;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += `C${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(p2.x)} ${f(p2.y)}`;
  }
  return closed ? `${d}Z` : d;
}

/** 文稿上的一根字条：y 是这一行的上沿，dark 是段首那一行（颜色深一档） */
export type Strip = { y: number; width: number; dark: boolean };

/**
 * 一张文稿上的字条：从 top 开始每行 18，段与段之间多空 14；每段 3–6 行，段首颜色深一档，段尾短一些。
 * 宽度在 [min, max] 之间；写满 lines 行或者到了 bottom 就停
 */
export function strips(
  seed: number,
  opts: { top: number; bottom: number; lines: number; min: number; max: number },
): Strip[] {
  const rand = random(seed);
  const out: Strip[] = [];
  let y = opts.top;
  while (out.length < opts.lines) {
    const size = 3 + Math.floor(rand() * 4);
    for (let i = 0; i < size && out.length < opts.lines; i++) {
      if (y + 6 > opts.bottom) return out;
      const end = i === size - 1;
      const span = opts.max - opts.min;
      const width = Math.round(opts.min + (end ? rand() * 0.45 : 0.3 + rand() * 0.7) * span);
      out.push({ y, width, dark: i === 0 });
      y += 18;
    }
    y += 14;
  }
  return out;
}

/** 文稿上被划掉的一行：一道折线，从 x0 到 x1，每 14 一折，在这一行（y 是上沿，行高 6）上下摆 3 */
export function zigzag(x0: number, x1: number, y: number): string {
  let d = `M${x0} ${y + 3}`;
  let up = true;
  for (let x = x0 + 14; x <= x1; x += 14) {
    d += `L${x} ${up ? y : y + 6}`;
    up = !up;
  }
  return d;
}

/** 集中线的一根：三角形，尖朝里 */
export type Ray = [Pt, Pt, Pt];

/**
 * 集中线：count 根细长的三角形，尖在离中心 [inner, inner + spread] 的地方，底边在半径 outer 的圆上（画布外面，被格子裁掉），
 * 底边宽 [minWidth, maxWidth]。中心以 (0, 0) 为原点
 */
export function rays(
  seed: number,
  opts: { count: number; inner: number; spread: number; outer: number; minWidth: number; maxWidth: number },
): Ray[] {
  const rand = random(seed);
  const out: Ray[] = [];
  for (let i = 0; i < opts.count; i++) {
    const a = ((i + rand() * 0.8) / opts.count) * Math.PI * 2;
    const tip = opts.inner + rand() * opts.spread;
    const half = (opts.minWidth + rand() * (opts.maxWidth - opts.minWidth)) / 2;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    out.push([
      { x: round1(dx * tip), y: round1(dy * tip) },
      { x: round1(dx * opts.outer - dy * half), y: round1(dy * opts.outer + dx * half) },
      { x: round1(dx * opts.outer + dy * half), y: round1(dy * opts.outer - dx * half) },
    ]);
  }
  return out;
}

/** 点在不在画布里（含边） */
export function inside(p: Pt, box: Box): boolean {
  return p.x >= 0 && p.y >= 0 && p.x <= box.width && p.y <= box.height;
}
