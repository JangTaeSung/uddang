/** 상지 혈관 기본 도식. 화면 왼쪽 = 오른팔, 화면 오른쪽 = 왼팔. 바깥쪽 = 요골(엄지) 쪽.
 * 좌표는 assets/body-outline.png (583×419) 위에 맞춘다.
 */

const CENTER = 583 / 2;

function mirrorX(points) {
  return points.map((p) => ({ x: CENTER * 2 - p.x, y: p.y }));
}

function withHandles(raw) {
  return raw.map((p, i) => {
    const prev = raw[Math.max(0, i - 1)];
    const next = raw[Math.min(raw.length - 1, i + 1)];
    const scale = i === 0 || i === raw.length - 1 ? 0.28 : 0.2;
    return {
      x: p.x,
      y: p.y,
      hx: (next.x - prev.x) * scale,
      hy: (next.y - prev.y) * scale,
    };
  });
}

const ARM = {
  rt: {
    // 동맥은 액와에서 상완으로 이어지고, 팔꿈치에서 요골(가쪽)과 척골(안쪽)로 갈라진다.
    axillary: [
      { x: 186, y: 166 },
      { x: 174, y: 186 },
      { x: 162, y: 206 },
    ],
    brachial: [
      { x: 162, y: 206 },
      { x: 146, y: 234 },
      { x: 132, y: 260 },
      { x: 118, y: 284 },
    ],
    radial: [
      { x: 118, y: 284 },
      { x: 96, y: 308 },
      { x: 74, y: 326 },
      { x: 52, y: 340 },
    ],
    ulnar: [
      { x: 118, y: 284 },
      { x: 110, y: 306 },
      { x: 94, y: 324 },
      { x: 74, y: 338 },
    ],
    // 얕은 정맥. 두정맥은 가쪽, 기저정맥은 안쪽, 정중주와정맥이 팔꿈치에서 둘을 잇는다.
    cephalic: [
      { x: 160, y: 172 },
      { x: 142, y: 204 },
      { x: 124, y: 234 },
      { x: 106, y: 262 },
      { x: 86, y: 292 },
      { x: 66, y: 318 },
      { x: 46, y: 338 },
    ],
    basilic: [
      { x: 192, y: 180 },
      { x: 174, y: 214 },
      { x: 156, y: 246 },
      { x: 142, y: 274 },
      { x: 124, y: 304 },
      { x: 102, y: 320 },
      { x: 86, y: 334 },
    ],
    median: [
      { x: 106, y: 262 },
      { x: 124, y: 266 },
      { x: 142, y: 274 },
    ],
    subclavian: [
      { x: 196, y: 172 },
      { x: 186, y: 186 },
      { x: 176, y: 200 },
    ],
    "axillary-vein": [
      { x: 176, y: 200 },
      { x: 168, y: 220 },
      { x: 158, y: 238 },
    ],
    "brachial-vein": [
      { x: 158, y: 238 },
      { x: 146, y: 258 },
      { x: 134, y: 276 },
      { x: 122, y: 292 },
    ],
  },
};

const CATALOG = [
  { key: "axillary", code: "A", name: "Axillary artery", kind: "artery", color: "#c0392b", diameter: 5, visible: true, labelAt: 0, labelDy: -2 },
  { key: "brachial", code: "B", name: "Brachial artery", kind: "artery", color: "#e74c3c", diameter: 4.5, visible: true, labelAt: 1, labelDy: -4 },
  { key: "radial", code: "C", name: "Radial artery", kind: "artery", color: "#e74c3c", diameter: 2.5, visible: true, labelAt: 2, labelDy: -2 },
  { key: "ulnar", code: "D", name: "Ulnar artery", kind: "artery", color: "#c0392b", diameter: 2.5, visible: true, labelAt: 2, labelDy: 8 },
  { key: "cephalic", code: "E", name: "Cephalic vein", kind: "vein", color: "#2e86c1", diameter: 3, visible: true, labelAt: 1, labelDy: -10 },
  { key: "basilic", code: "F", name: "Basilic vein", kind: "vein", color: "#1a5276", diameter: 3.5, visible: true, labelAt: 2, labelDy: 8 },
  { key: "median", code: "G", name: "Median cubital vein", kind: "vein", color: "#5dade2", diameter: 2.5, visible: true, labelAt: 1, labelDy: -8 },
  { key: "brachial-vein", code: "H", name: "Brachial vein", kind: "vein", color: "#3498db", diameter: 3.5, visible: false, labelAt: 1, labelDy: 6 },
  { key: "axillary-vein", code: "I", name: "Axillary vein", kind: "vein", color: "#2471a3", diameter: 5, visible: false, labelAt: 0, labelDy: 8 },
  { key: "subclavian", code: "J", name: "Subclavian vein", kind: "vein", color: "#1a365d", diameter: 6, visible: false, labelAt: 0, labelDy: -6 },
];

const KOREAN_NAMES = {
  "액와동맥": "Axillary artery",
  "상완동맥": "Brachial artery",
  "요골동맥": "Radial artery",
  "척골동맥": "Ulnar artery",
  "두정맥": "Cephalic vein",
  "기저정맥": "Basilic vein",
  "정중주와정맥": "Median cubital vein",
  "상완정맥": "Brachial vein",
  "액와정맥": "Axillary vein",
  "쇄골하정맥": "Subclavian vein",
};

const OLD_RT = {
  brachial: [[160.8, 196.5], [142.8, 224.6], [122.8, 252.6], [102.8, 280.6]],
  radial: [[95.7, 275.1], [75.8, 301], [55.9, 324.8], [42, 340.7]],
  subclavian: [[246, 86], [228, 104], [210, 130]],
  "axillary-vein": [[210, 136], [196, 154], [184, 172]],
  "brachial-vein": [[184.7, 172.3], [166.7, 200.3], [148.6, 228.5], [128.5, 256.6], [108.5, 284.6]],
  cephalic: [[167.1, 161], [149.1, 189], [131.2, 216.7], [111.4, 244.4], [91.6, 272.3], [71.8, 297.9], [52.1, 321.6], [38.2, 337.4]],
  basilic: [[170.9, 203], [152.8, 231.3], [132.6, 259.6], [112.4, 287.7], [92.2, 314.1], [72, 338.3]],
  median: [[91.6, 272.3], [112.4, 287.7]],
};

function oldCourse(id) {
  const key = id.slice(3);
  const raw = OLD_RT[key];
  if (!raw || (id.slice(0, 3) !== "rt-" && id.slice(0, 3) !== "lt-")) return null;
  if (id.startsWith("rt-")) return raw;
  return raw.map(([x, y]) => [CENTER * 2 - x, y]);
}

function sameCourse(points, raw) {
  if (!points || !raw || points.length !== raw.length) return false;
  return points.every((point, index) => Math.hypot(point.x - raw[index][0], point.y - raw[index][1]) < 1.5);
}

export function createDefaultVessels() {
  const vessels = [];
  for (const side of ["rt", "lt"]) {
    const sideName = side === "rt" ? "오른팔" : "왼팔";
    for (const spec of CATALOG) {
      const raw = side === "rt" ? ARM.rt[spec.key] : mirrorX(ARM.rt[spec.key]);
      vessels.push({
        id: `${side}-${spec.key}`,
        side,
        sideName,
        code: spec.code,
        name: spec.name,
        kind: spec.kind,
        color: spec.color,
        visible: spec.visible,
        diameter: spec.diameter,
        style: "normal",
        labelAt: spec.labelAt,
        labelDy: spec.labelDy,
        points: withHandles(raw),
      });
    }
  }
  return vessels;
}

export function cloneVessels(vessels) {
  return JSON.parse(JSON.stringify(vessels));
}

export function useEnglishNames(vessels) {
  return vessels.map((vessel) => {
    const name = KOREAN_NAMES[vessel.name];
    return name ? { ...vessel, name } : vessel;
  });
}

export function syncCatalog(vessels) {
  const byId = new Map();
  for (const vessel of vessels) byId.set(vessel.id, vessel);
  const result = [];
  for (const fresh of createDefaultVessels()) {
    const existing = byId.get(fresh.id);
    if (existing) {
      if (sameCourse(existing.points, oldCourse(fresh.id))) {
        existing.points = fresh.points;
        existing.visible = fresh.visible;
        existing.diameter = fresh.diameter;
        existing.color = fresh.color;
      }
      existing.code = fresh.code;
      existing.labelAt = fresh.labelAt;
      existing.labelDy = fresh.labelDy;
      result.push(existing);
      byId.delete(fresh.id);
    } else {
      result.push(fresh);
    }
  }
  for (const vessel of byId.values()) result.push(vessel);
  return result;
}

export const BODY_IMAGE = "assets/body-outline.png";
export const MAP_WIDTH = 583;
export const MAP_HEIGHT = 419;

function bezierControls(a, b) {
  const incomingX = Number.isFinite(b.ix) ? b.ix : -b.hx;
  const incomingY = Number.isFinite(b.iy) ? b.iy : -b.hy;
  return {
    p0: a,
    c1: { x: a.x + a.hx, y: a.y + a.hy },
    c2: { x: b.x + incomingX, y: b.y + incomingY },
    p1: b,
  };
}

export function curvePoint(a, b, t) {
  const { p0, c1, c2, p1 } = bezierControls(a, b);
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p1.x,
    y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p1.y,
  };
}

export function curveTangent(a, b, t) {
  const { p0, c1, c2, p1 } = bezierControls(a, b);
  const u = 1 - t;
  return {
    x: 3 * u * u * (c1.x - p0.x) + 6 * u * t * (c2.x - c1.x) + 3 * t * t * (p1.x - c2.x),
    y: 3 * u * u * (c1.y - p0.y) + 6 * u * t * (c2.y - c1.y) + 3 * t * t * (p1.y - c2.y),
  };
}

export function closestOnPath(points, point) {
  if (!points || points.length < 2) return null;
  let best = null;
  for (let i = 0; i < points.length - 1; i += 1) {
    for (let step = 0; step <= 24; step += 1) {
      const t = step / 24;
      const sample = curvePoint(points[i], points[i + 1], t);
      const dist = Math.hypot(sample.x - point.x, sample.y - point.y);
      if (!best || dist < best.dist) best = { segment: i, t, x: sample.x, y: sample.y, dist };
    }
  }
  const a = points[best.segment];
  const b = points[best.segment + 1];
  let lo = Math.max(0, best.t - 1 / 24);
  let hi = Math.min(1, best.t + 1 / 24);
  for (let pass = 0; pass < 14; pass += 1) {
    const t1 = lo + (hi - lo) / 3;
    const t2 = hi - (hi - lo) / 3;
    const p1 = curvePoint(a, b, t1);
    const p2 = curvePoint(a, b, t2);
    const d1 = Math.hypot(p1.x - point.x, p1.y - point.y);
    const d2 = Math.hypot(p2.x - point.x, p2.y - point.y);
    if (d1 < d2) hi = t2;
    else lo = t1;
  }
  const t = (lo + hi) / 2;
  const sample = curvePoint(a, b, t);
  return {
    segment: best.segment,
    t,
    x: sample.x,
    y: sample.y,
    dist: Math.hypot(sample.x - point.x, sample.y - point.y),
    tangent: curveTangent(a, b, t),
  };
}

export function pointAlong(points, fraction) {
  if (!points || points.length < 2) return null;
  const samples = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    let previous = curvePoint(points[i], points[i + 1], 0);
    for (let step = 1; step <= 20; step += 1) {
      const t = step / 20;
      const sample = curvePoint(points[i], points[i + 1], t);
      total += Math.hypot(sample.x - previous.x, sample.y - previous.y);
      samples.push({ segment: i, t, x: sample.x, y: sample.y, traveled: total });
      previous = sample;
    }
  }
  const target = total * Math.min(1, Math.max(0, fraction));
  let chosen = samples[samples.length - 1];
  for (const sample of samples) {
    if (sample.traveled >= target) {
      chosen = sample;
      break;
    }
  }
  const a = points[chosen.segment];
  const b = points[chosen.segment + 1];
  return {
    segment: chosen.segment,
    t: chosen.t,
    x: chosen.x,
    y: chosen.y,
    tangent: curveTangent(a, b, chosen.t),
  };
}
