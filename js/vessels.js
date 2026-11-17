/** 상지 혈관 기본 도식. 화면 왼쪽 = 오른팔, 화면 오른쪽 = 왼팔. 위쪽 = 요골(엄지) 쪽. */

const CENTER = 550;

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
    axillary: [
      { x: 360, y: 230 },
      { x: 300, y: 275 },
    ],
    brachial: [
      { x: 300, y: 275 },
      { x: 230, y: 350 },
      { x: 195, y: 400 },
    ],
    radial: [
      { x: 195, y: 400 },
      { x: 145, y: 465 },
      { x: 105, y: 520 },
    ],
    ulnar: [
      { x: 195, y: 400 },
      { x: 185, y: 470 },
      { x: 165, y: 535 },
    ],
    cephalic: [
      { x: 325, y: 195 },
      { x: 250, y: 280 },
      { x: 175, y: 375 },
      { x: 115, y: 470 },
    ],
    basilic: [
      { x: 390, y: 255 },
      { x: 310, y: 330 },
      { x: 250, y: 415 },
      { x: 210, y: 500 },
    ],
    median: [
      { x: 175, y: 375 },
      { x: 230, y: 400 },
      { x: 250, y: 415 },
    ],
  },
};

const CATALOG = [
  { key: "axillary", code: "A", name: "액와동맥", kind: "artery", color: "#b03a2e", diameter: 7 },
  { key: "brachial", code: "B", name: "상완동맥", kind: "artery", color: "#c0392b", diameter: 5 },
  { key: "radial", code: "C", name: "요골동맥", kind: "artery", color: "#e74c3c", diameter: 2.5 },
  { key: "ulnar", code: "D", name: "척골동맥", kind: "artery", color: "#a93226", diameter: 2.4 },
  { key: "cephalic", code: "E", name: "두정맥", kind: "vein", color: "#2e86c1", diameter: 3 },
  { key: "basilic", code: "F", name: "기저정맥", kind: "vein", color: "#1a5276", diameter: 4 },
  { key: "median", code: "G", name: "정중주와정맥", kind: "vein", color: "#5dade2", diameter: 3 },
];

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
        visible: true,
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

export const BODY_LINE =
  "M 508 55 L 490 130 Q 400 150 330 185 Q 240 250 175 360 Q 120 450 78 515 L 132 548 Q 175 450 230 370 Q 290 290 340 250 L 420 300 L 550 328 L 680 300 L 760 250 Q 810 290 870 370 Q 925 450 968 548 L 1022 515 Q 980 450 925 360 Q 860 250 770 185 Q 700 150 610 130 L 592 55";

export const BODY_FILL = `${BODY_LINE} Z`;
