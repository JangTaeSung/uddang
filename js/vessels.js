/** 상지 혈관 기본 도식. 화면 왼쪽 = 오른팔, 화면 오른쪽 = 왼팔. 위쪽 = 요골(엄지) 쪽.
 * 좌표는 assets/body-outline.png (583×419) 위에 맞춘다.
 */

const CENTER = 583 / 2;

const RT_AXIS = [
  { x: 178, y: 168 },
  { x: 160, y: 196 },
  { x: 142, y: 224 },
  { x: 122, y: 252 },
  { x: 102, y: 280 },
  { x: 82, y: 306 },
  { x: 62, y: 330 },
  { x: 48, y: 346 },
];

function offsetPath(points, amount) {
  return points.map((point, index) => {
    const prev = points[Math.max(0, index - 1)];
    const next = points[Math.min(points.length - 1, index + 1)];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const length = Math.hypot(dx, dy) || 1;
    return {
      x: Math.round((point.x + (-dy / length) * amount) * 10) / 10,
      y: Math.round((point.y + (dx / length) * amount) * 10) / 10,
    };
  });
}

function sliceAxis(start, end, amount) {
  return offsetPath(RT_AXIS.slice(start, end), amount);
}

function elbowPoint(amount) {
  return offsetPath(RT_AXIS.slice(3, 6), amount)[1];
}

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
    brachial: sliceAxis(1, 5, -1),
    radial: sliceAxis(4, 8, 8),
    subclavian: [
      { x: 246, y: 86 },
      { x: 228, y: 104 },
      { x: 210, y: 130 },
    ],
    "axillary-vein": [
      { x: 210, y: 136 },
      { x: 196, y: 154 },
      { x: 184, y: 172 },
    ],
    "brachial-vein": sliceAxis(0, 5, -8),
    cephalic: sliceAxis(0, 8, 13),
    basilic: sliceAxis(1, 7, -13),
    median: [elbowPoint(13), elbowPoint(-13)],
  },
};

const CATALOG = [
  { key: "brachial", code: "A", name: "Brachial artery", kind: "artery", color: "#c0392b", diameter: 5 },
  { key: "radial", code: "B", name: "Radial artery", kind: "artery", color: "#e74c3c", diameter: 2.5 },
  { key: "subclavian", code: "C", name: "Subclavian vein", kind: "vein", color: "#1a365d", diameter: 8 },
  { key: "axillary-vein", code: "D", name: "Axillary vein", kind: "vein", color: "#2471a3", diameter: 6 },
  { key: "brachial-vein", code: "E", name: "Brachial vein", kind: "vein", color: "#3498db", diameter: 4 },
  { key: "cephalic", code: "F", name: "Cephalic vein", kind: "vein", color: "#2e86c1", diameter: 3 },
  { key: "basilic", code: "G", name: "Basilic vein", kind: "vein", color: "#1a5276", diameter: 4 },
  { key: "median", code: "H", name: "Median cubital vein", kind: "vein", color: "#5dade2", diameter: 3 },
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

const REMOVED_IDS = ["rt-axillary", "lt-axillary", "rt-ulnar", "lt-ulnar"];

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
        visible: false,
        diameter: spec.diameter,
        style: "normal",
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
  const removed = new Set(REMOVED_IDS);
  let grew = true;
  while (grew) {
    grew = false;
    for (const vessel of vessels) {
      if (vessel.parentId && removed.has(vessel.parentId) && !removed.has(vessel.id)) {
        removed.add(vessel.id);
        grew = true;
      }
    }
  }
  const byId = new Map();
  for (const vessel of vessels) {
    if (!removed.has(vessel.id)) byId.set(vessel.id, vessel);
  }
  const result = [];
  for (const fresh of createDefaultVessels()) {
    const existing = byId.get(fresh.id);
    if (existing) {
      existing.code = fresh.code;
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
