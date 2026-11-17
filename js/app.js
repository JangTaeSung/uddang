import { BODY_IMAGE, MAP_HEIGHT, MAP_WIDTH, cloneVessels, closestOnPath, createDefaultVessels, curvePoint, curveTangent, syncCatalog, useEnglishNames } from "./vessels.js";
import { clearState, loadState, saveState } from "./storage.js";

const svg = document.querySelector("#map");
const vesselLayer = document.querySelector("#vessels");
const labelLayer = document.querySelector("#labels");
const paintLayer = document.querySelector("#paint");
const markerLayer = document.querySelector("#markers");
const handleLayer = document.querySelector("#handles");
const listEl = document.querySelector("#vessel-list");

const defaults = createDefaultVessels();
const saved = loadState();

const state = {
  vessels: saved?.vessels?.length ? syncCatalog(useEnglishNames(saved.vessels)) : cloneVessels(defaults),
  markers: Array.isArray(saved?.markers) ? saved.markers : [],
  paint: Array.isArray(saved?.paint) ? saved.paint : [],
  background: saved?.background || "",
  mode: "path",
  markerType: "borderline",
  paintColor: "#2b2b2b",
  paintSize: 6,
  erasing: false,
  selectedVesselId: null,
  selectedPoint: null,
  selectedMarkerId: null,
};

const view = { x: 0, y: 0, width: MAP_WIDTH, height: MAP_HEIGHT };

const history = [];
let historyIndex = -1;
let drag = null;
let menuHit = null;

const MARKERS = {
  borderline: { label: "BL", fill: "#00acc1" },
  thrombosis: { label: "Th", fill: "#c62828" },
  bend: { label: "굽", fill: "#f9a825" },
  branch: { label: "Br", fill: "#2e7d32" },
};

for (const id of ["bg-image"]) {
  document.querySelector(`#${id}`).style.pointerEvents = "none";
}

function snapshot() {
  return JSON.stringify({
    vessels: state.vessels,
    markers: state.markers,
    paint: state.paint,
    background: state.background,
  });
}

function commit() {
  const snap = snapshot();
  if (history[historyIndex] === snap) return;
  history.splice(historyIndex + 1);
  history.push(snap);
  if (history.length > 80) history.shift();
  historyIndex = history.length - 1;
  persist();
  render();
}

function persist() {
  saveState(state);
  document.querySelector("#undo").disabled = historyIndex <= 0;
  document.querySelector("#redo").disabled = historyIndex >= history.length - 1;
}

function restore(snap) {
  const data = JSON.parse(snap);
  state.vessels = data.vessels;
  state.markers = data.markers;
  state.paint = Array.isArray(data.paint) ? data.paint : [];
  state.background = data.background || "";
  persist();
  render();
}

function applyView() {
  svg.setAttribute("viewBox", `${view.x} ${view.y} ${view.width} ${view.height}`);
}

function clampView() {
  if (view.width >= MAP_WIDTH - 0.5) {
    view.x = 0;
    view.y = 0;
    view.width = MAP_WIDTH;
    view.height = MAP_HEIGHT;
    return;
  }
  const minX = -view.width * 0.2;
  const minY = -view.height * 0.2;
  view.x = Math.min(MAP_WIDTH - view.width * 0.3, Math.max(minX, view.x));
  view.y = Math.min(MAP_HEIGHT - view.height * 0.3, Math.max(minY, view.y));
}

function zoomAt(clientX, clientY, factor) {
  const point = svgPoint({ clientX, clientY });
  const nextWidth = Math.min(MAP_WIDTH, Math.max(MAP_WIDTH / 5, view.width / factor));
  const nextHeight = nextWidth * (MAP_HEIGHT / MAP_WIDTH);
  const rx = (point.x - view.x) / view.width;
  const ry = (point.y - view.y) / view.height;
  view.width = nextWidth;
  view.height = nextHeight;
  view.x = point.x - rx * nextWidth;
  view.y = point.y - ry * nextHeight;
  clampView();
  applyView();
}

function zoomBy(factor) {
  const box = svg.getBoundingClientRect();
  zoomAt(box.left + box.width / 2, box.top + box.height / 2, factor);
}

function svgPoint(event) {
  const point = svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  const mapped = point.matrixTransform(svg.getScreenCTM().inverse());
  return { x: mapped.x, y: mapped.y };
}

function vesselById(id) {
  return state.vessels.find((vessel) => vessel.id === id);
}

function isShown(vessel, seen = new Set()) {
  if (!vessel || seen.has(vessel.id) || !vessel.visible) return false;
  if (!vessel.parentId) return true;
  seen.add(vessel.id);
  return isShown(vesselById(vessel.parentId), seen);
}

function descendantIds(id) {
  const ids = [];
  const queue = [id];
  while (queue.length) {
    const current = queue.shift();
    for (const vessel of state.vessels) {
      if (vessel.parentId === current) {
        ids.push(vessel.id);
        queue.push(vessel.id);
      }
    }
  }
  return ids;
}

function vesselsInOrder(side) {
  const rows = [];
  const visit = (vessel, depth) => {
    rows.push({ vessel, depth });
    for (const child of state.vessels) {
      if (child.parentId === vessel.id) visit(child, depth + 1);
    }
  };
  for (const vessel of state.vessels) {
    if (vessel.side === side && !vessel.parentId) visit(vessel, 0);
  }
  return rows;
}

function syncJunctions() {
  for (let pass = 0; pass < 6; pass += 1) {
    for (const vessel of state.vessels) {
      if (!vessel.junction || !vessel.parentId || vessel.points.length < 1) continue;
      const parent = vesselById(vessel.parentId);
      if (!parent || parent.points.length < 2) continue;
      const segment = Math.max(0, Math.min(parent.points.length - 2, vessel.junction.segment | 0));
      const t = Math.min(1, Math.max(0, Number(vessel.junction.t) || 0));
      vessel.junction.segment = segment;
      vessel.junction.t = t;
      const point = curvePoint(parent.points[segment], parent.points[segment + 1], t);
      vessel.points[0].x = point.x;
      vessel.points[0].y = point.y;
    }
  }
}

function aimOutward(vessel) {
  const origin = vessel.points[0];
  const tip = vessel.points[vessel.points.length - 1];
  const dx = tip.x - origin.x;
  const dy = tip.y - origin.y;
  const length = Math.hypot(dx, dy) || 1;
  origin.hx = (dx / length) * Math.min(18, length * 0.35);
  origin.hy = (dy / length) * Math.min(18, length * 0.35);
  tip.hx = (dx / length) * Math.min(14, length * 0.25);
  tip.hy = (dy / length) * Math.min(14, length * 0.25);
}

function nextBranchName(parentId) {
  const names = new Set(state.vessels.filter((vessel) => vessel.parentId === parentId).map((vessel) => vessel.name));
  if (!names.has("Branch")) return "Branch";
  let index = 2;
  while (names.has(`Branch ${index}`)) index += 1;
  return `Branch ${index}`;
}

function buildBranch(parent, hit) {
  const width = Math.max(0.8, Math.round(mmWidth(parent.diameter) * 0.55 * 10) / 10);
  return {
    id: `br-${Date.now().toString(36)}-${Math.floor(Math.random() * 10000)}`,
    parentId: parent.id,
    junction: { segment: hit.segment, t: Math.round(hit.t * 1000) / 1000 },
    side: parent.side,
    sideName: parent.sideName,
    code: "Br",
    name: nextBranchName(parent.id),
    kind: parent.kind,
    color: parent.color,
    visible: true,
    diameter: width,
    style: "normal",
    points: [
      { x: hit.x, y: hit.y, hx: 0, hy: 0, w: width },
      { x: hit.x, y: hit.y, hx: 0, hy: 0, w: width },
    ],
  };
}

function mmWidth(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 1;
}

function pointMm(point, vessel) {
  return mmWidth(point?.w ?? vessel.diameter);
}

function pxWidth(mm, vessel) {
  let width = Math.max(5, mmWidth(mm) * 2.4);
  if (vessel?.style === "considerable") width *= 1.35;
  if (vessel?.style === "borderline") width *= 0.8;
  return width;
}

function lockIncoming(point) {
  if (!Number.isFinite(point.ix) || !Number.isFinite(point.iy)) {
    point.ix = -point.hx;
    point.iy = -point.hy;
  }
}

function insertOnCurve(vessel, hit) {
  if (hit.t <= 0.12) return hit.segment;
  if (hit.t >= 0.88) return hit.segment + 1;
  const index = hit.segment;
  const t = hit.t;
  const a = vessel.points[index];
  const b = vessel.points[index + 1];
  const p0 = { x: a.x, y: a.y };
  const c1 = { x: a.x + a.hx, y: a.y + a.hy };
  const c2 = {
    x: b.x + (Number.isFinite(b.ix) ? b.ix : -b.hx),
    y: b.y + (Number.isFinite(b.iy) ? b.iy : -b.hy),
  };
  const p1 = { x: b.x, y: b.y };
  const mix = (p, q) => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
  const a1 = mix(p0, c1);
  const a2 = mix(c1, c2);
  const a3 = mix(c2, p1);
  const b1 = mix(a1, a2);
  const b2 = mix(a2, a3);
  const mid = mix(b1, b2);
  lockIncoming(a);
  lockIncoming(b);
  a.hx = a1.x - a.x;
  a.hy = a1.y - a.y;
  b.ix = a3.x - b.x;
  b.iy = a3.y - b.y;
  vessel.points.splice(index + 1, 0, {
    x: mid.x,
    y: mid.y,
    hx: b2.x - mid.x,
    hy: b2.y - mid.y,
    ix: b1.x - mid.x,
    iy: b1.y - mid.y,
    w: pointMm(a, vessel) * (1 - t) + pointMm(b, vessel) * t,
  });
  retargetJunctions(vessel.id, index, t);
  return index + 1;
}

function retargetJunctions(parentId, segment, t) {
  for (const child of state.vessels) {
    if (child.parentId !== parentId || !child.junction) continue;
    const junction = child.junction;
    if (junction.segment > segment) junction.segment += 1;
    else if (junction.segment === segment) {
      const old = Number(junction.t) || 0;
      if (old <= t) junction.t = t === 0 ? 0 : old / t;
      else {
        junction.segment = segment + 1;
        junction.t = (old - t) / (1 - t);
      }
    }
  }
}

function ribbonSamples(vessel) {
  const points = vessel.points;
  const samples = [];
  if (points.length < 2) return samples;
  for (let index = 0; index < points.length - 1; index += 1) {
    const steps = 10;
    for (let step = 0; step <= steps; step += 1) {
      if (step === steps && index < points.length - 2) continue;
      const t = step / steps;
      const at = curvePoint(points[index], points[index + 1], t);
      const mm = pointMm(points[index], vessel) * (1 - t) + pointMm(points[index + 1], vessel) * t;
      samples.push({ x: at.x, y: at.y, width: pxWidth(mm, vessel) });
    }
  }
  return samples;
}

function wallWeight(vessel) {
  return vessel.style === "considerable" ? 2 : 1.6;
}

function appendWall(parent, points, vessel) {
  if (points.length < 2) return null;
  const edge = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  edge.setAttribute("points", points.map((point) => `${point.x},${point.y}`).join(" "));
  edge.setAttribute("fill", "none");
  edge.setAttribute("stroke", displayColor(vessel));
  edge.setAttribute("stroke-width", String(wallWeight(vessel)));
  edge.setAttribute("stroke-linecap", "butt");
  edge.setAttribute("stroke-linejoin", "round");
  edge.setAttribute("pointer-events", "none");
  if (vessel.style === "borderline") edge.setAttribute("stroke-opacity", "0.55");
  parent.append(edge);
  return edge;
}

function refreshWall(item, side) {
  item[`${side}Node`].setAttribute("points", item[side].map((point) => `${point.x},${point.y}`).join(" "));
}

function moveTip(tip, side, point) {
  const line = tip.item[side];
  if (tip.which === "start") line[0] = { x: point.x, y: point.y };
  else line[line.length - 1] = { x: point.x, y: point.y };
  refreshWall(tip.item, side);
}

function wallDir(tip, side) {
  const line = tip.item[side];
  const from = tip.which === "start" ? line[0] : line[line.length - 2];
  const to = tip.which === "start" ? line[1] : line[line.length - 1];
  const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  return { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
}

function lineIntersect(origin, direction, other, otherDirection) {
  const det = direction.x * otherDirection.y - direction.y * otherDirection.x;
  if (Math.abs(det) < 0.0001) return null;
  const t = ((other.x - origin.x) * otherDirection.y - (other.y - origin.y) * otherDirection.x) / det;
  return { x: origin.x + direction.x * t, y: origin.y + direction.y * t };
}

function meetWalls(tipA, sideA, tipB, sideB) {
  const a = tipPoint(tipA, sideA);
  const b = tipPoint(tipB, sideB);
  const hit = lineIntersect(a, wallDir(tipA, sideA), b, wallDir(tipB, sideB));
  if (!hit) return false;
  if (Math.hypot(hit.x - a.x, hit.y - a.y) > 22 || Math.hypot(hit.x - b.x, hit.y - b.y) > 22) return false;
  moveTip(tipA, sideA, hit);
  moveTip(tipB, sideB, hit);
  return true;
}

function appendJoint(a, b, vessel) {
  if (Math.hypot(a.x - b.x, a.y - b.y) > 28) return;
  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("x1", String(a.x));
  line.setAttribute("y1", String(a.y));
  line.setAttribute("x2", String(b.x));
  line.setAttribute("y2", String(b.y));
  line.setAttribute("stroke", displayColor(vessel));
  line.setAttribute("stroke-width", String(wallWeight(vessel)));
  line.setAttribute("stroke-linecap", "round");
  line.setAttribute("pointer-events", "none");
  if (vessel.style === "borderline") line.setAttribute("stroke-opacity", "0.55");
  vesselLayer.append(line);
}

function appendRibbon(vessel) {
  const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
  group.dataset.ribbon = vessel.id;
  group.setAttribute("pointer-events", "none");
  group.setAttribute("fill", "none");
  if (vessel.id === state.selectedVesselId) group.setAttribute("filter", "drop-shadow(0 0 1px rgba(0,0,0,.2))");
  const samples = ribbonSamples(vessel);
  if (samples.length < 2) {
    vesselLayer.append(group);
    return null;
  }
  let nx = 0;
  let ny = -1;
  const left = [];
  const right = [];
  for (let index = 0; index < samples.length; index += 1) {
    const prev = samples[Math.max(0, index - 1)];
    const next = samples[Math.min(samples.length - 1, index + 1)];
    const tx = next.x - prev.x;
    const ty = next.y - prev.y;
    const length = Math.hypot(tx, ty);
    if (length > 0.001) {
      nx = -ty / length;
      ny = tx / length;
    }
    const half = samples[index].width / 2;
    left.push({ x: samples[index].x + nx * half, y: samples[index].y + ny * half });
    right.push({ x: samples[index].x - nx * half, y: samples[index].y - ny * half });
  }
  const leftNode = appendWall(group, left, vessel);
  const rightNode = appendWall(group, right, vessel);
  vesselLayer.append(group);
  const second = samples[1];
  const penultimate = samples[samples.length - 2];
  const last = samples[samples.length - 1];
  return { vessel, left, right, leftNode, rightNode, samples, second, penultimate, last };
}

function tipPoint(tip, side) {
  const line = tip.item[side];
  return tip.which === "start" ? line[0] : line[line.length - 1];
}

function tipUnit(tip) {
  const length = Math.hypot(tip.dx, tip.dy) || 1;
  return { x: tip.dx / length, y: tip.dy / length };
}

function joinTwoTips(a, b) {
  const aLeft = tipPoint(a, "left");
  const aRight = tipPoint(a, "right");
  const bLeft = tipPoint(b, "left");
  const bRight = tipPoint(b, "right");
  const straight = Math.hypot(aLeft.x - bLeft.x, aLeft.y - bLeft.y) + Math.hypot(aRight.x - bRight.x, aRight.y - bRight.y);
  const crossed = Math.hypot(aLeft.x - bRight.x, aLeft.y - bRight.y) + Math.hypot(aRight.x - bLeft.x, aRight.y - bLeft.y);
  const vessel = a.item.vessel;
  if (straight <= crossed) {
    if (!meetWalls(a, "left", b, "left")) appendJoint(aLeft, bLeft, vessel);
    if (!meetWalls(a, "right", b, "right")) appendJoint(aRight, bRight, vessel);
  } else {
    if (!meetWalls(a, "left", b, "right")) appendJoint(aLeft, bRight, vessel);
    if (!meetWalls(a, "right", b, "left")) appendJoint(aRight, bLeft, vessel);
  }
}

function outerSide(branch, other) {
  const otherWay = tipUnit(other);
  const left = tipPoint(branch, "left");
  const right = tipPoint(branch, "right");
  const leftToward = (left.x - branch.x) * otherWay.x + (left.y - branch.y) * otherWay.y;
  const rightToward = (right.x - branch.x) * otherWay.x + (right.y - branch.y) * otherWay.y;
  return leftToward < rightToward ? "left" : "right";
}

function joinFork(tips) {
  let stem = tips[0];
  let stemScore = Infinity;
  for (const tip of tips) {
    const way = tipUnit(tip);
    let score = 0;
    for (const other of tips) {
      if (other === tip) continue;
      const otherWay = tipUnit(other);
      score += way.x * otherWay.x + way.y * otherWay.y;
    }
    if (score < stemScore) {
      stemScore = score;
      stem = tip;
    }
  }
  const arrival = { x: -tipUnit(stem).x, y: -tipUnit(stem).y };
  const branches = tips.filter((tip) => tip !== stem).sort((a, b) => {
    const aWay = tipUnit(a);
    const bWay = tipUnit(b);
    const aCross = arrival.x * aWay.y - arrival.y * aWay.x;
    const bCross = arrival.x * bWay.y - arrival.y * bWay.x;
    return bCross - aCross;
  });
  const leftBranch = branches[0];
  const rightBranch = branches[1];
  const leftOuter = outerSide(leftBranch, rightBranch);
  const rightOuter = outerSide(rightBranch, leftBranch);
  const leftInner = leftOuter === "left" ? "right" : "left";
  const rightInner = rightOuter === "left" ? "right" : "left";
  const stemLeft = tipPoint(stem, "left");
  const stemRight = tipPoint(stem, "right");
  const outerLeft = tipPoint(leftBranch, leftOuter);
  const outerRight = tipPoint(rightBranch, rightOuter);
  const straight = Math.hypot(stemLeft.x - outerLeft.x, stemLeft.y - outerLeft.y) + Math.hypot(stemRight.x - outerRight.x, stemRight.y - outerRight.y);
  const crossed = Math.hypot(stemLeft.x - outerRight.x, stemLeft.y - outerRight.y) + Math.hypot(stemRight.x - outerLeft.x, stemRight.y - outerLeft.y);
  const leftMatched = straight <= crossed;
  if (!(leftMatched ? meetWalls(stem, "left", leftBranch, leftOuter) : meetWalls(stem, "left", rightBranch, rightOuter))) {
    appendJoint(stemLeft, leftMatched ? outerLeft : outerRight, stem.item.vessel);
  }
  if (!(leftMatched ? meetWalls(stem, "right", rightBranch, rightOuter) : meetWalls(stem, "right", leftBranch, leftOuter))) {
    appendJoint(stemRight, leftMatched ? outerRight : outerLeft, stem.item.vessel);
  }
  if (!meetWalls(leftBranch, leftInner, rightBranch, rightInner)) {
    const innerA = tipPoint(leftBranch, leftInner);
    const innerB = tipPoint(rightBranch, rightInner);
    const mid = { x: (innerA.x + innerB.x) / 2, y: (innerA.y + innerB.y) / 2 };
    appendJoint(innerA, mid, leftBranch.item.vessel);
    appendJoint(innerB, mid, rightBranch.item.vessel);
  }
}

function joinOutlines(items) {
  const tips = [];
  for (const item of items) {
    const first = item.samples[0];
    tips.push({
      item,
      which: "start",
      x: first.x,
      y: first.y,
      dx: item.second.x - first.x,
      dy: item.second.y - first.y,
    });
    tips.push({
      item,
      which: "end",
      x: item.last.x,
      y: item.last.y,
      dx: item.penultimate.x - item.last.x,
      dy: item.penultimate.y - item.last.y,
    });
  }
  const parent = tips.map((_, index) => index);
  const find = (index) => {
    if (parent[index] !== index) parent[index] = find(parent[index]);
    return parent[index];
  };
  for (let i = 0; i < tips.length; i += 1) {
    for (let j = i + 1; j < tips.length; j += 1) {
      if (Math.hypot(tips[i].x - tips[j].x, tips[i].y - tips[j].y) <= 5) parent[find(i)] = find(j);
    }
  }
  const groups = new Map();
  tips.forEach((tip, index) => {
    const key = find(index);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(tip);
  });
  for (const group of groups.values()) {
    if (group.length === 2) joinTwoTips(group[0], group[1]);
    else if (group.length === 3) joinFork(group);
  }
}

function setAllVisible(visible) {
  for (const vessel of state.vessels) vessel.visible = visible;
  if (!visible) state.selectedPoint = null;
  commit();
}

function setVisible(vessel, visible) {
  vessel.visible = visible;
  if (visible) {
    let parent = vesselById(vessel.parentId);
    const seen = new Set([vessel.id]);
    while (parent && !seen.has(parent.id)) {
      seen.add(parent.id);
      parent.visible = true;
      parent = vesselById(parent.parentId);
    }
    return;
  }
  for (const id of descendantIds(vessel.id)) {
    const child = vesselById(id);
    if (child) child.visible = false;
  }
}

function removeVessel(id) {
  const ids = new Set([id, ...descendantIds(id)]);
  state.vessels = state.vessels.filter((vessel) => !ids.has(vessel.id));
  if (ids.has(state.selectedVesselId)) {
    state.selectedVesselId = null;
    state.selectedPoint = null;
  }
}

function defaultById(id) {
  return defaults.find((vessel) => vessel.id === id);
}

function displayColor(vessel) {
  if (vessel.style === "considerable") return "#c62828";
  if (vessel.style === "borderline") return "#00acc1";
  return vessel.color;
}

function curvePath(points) {
  if (points.length < 2) return "";
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const c1x = a.x + a.hx;
    const c1y = a.y + a.hy;
    const c2x = b.x + (Number.isFinite(b.ix) ? b.ix : -b.hx);
    const c2y = b.y + (Number.isFinite(b.iy) ? b.iy : -b.hy);
    d += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${b.x} ${b.y}`;
  }
  return d;
}

function renderBackground() {
  const image = document.querySelector("#bg-image");
  image.setAttribute("href", state.background || BODY_IMAGE);
  image.setAttribute("opacity", "1");
}

function renderList() {
  listEl.replaceChildren();
  for (const side of ["rt", "lt"]) {
    const title = document.createElement("div");
    title.className = "group-title";
    title.textContent = side === "rt" ? "오른팔 (화면 왼쪽)" : "왼팔 (화면 오른쪽)";
    listEl.append(title);
    for (const { vessel, depth } of vesselsInOrder(side)) {
      const row = document.createElement("div");
      row.className = "vessel-row";
      if (depth > 0) {
        row.classList.add("branch-row");
        row.style.marginLeft = `${16 * depth}px`;
        row.style.width = `calc(100% - ${16 * depth}px)`;
      }
      if (!vessel.visible) row.classList.add("hidden-vessel");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "vessel-check";
      checkbox.checked = vessel.visible;
      checkbox.setAttribute("aria-label", `${vessel.sideName} ${vessel.name} 표시`);
      checkbox.addEventListener("change", () => {
        setVisible(vessel, checkbox.checked);
        if (checkbox.checked) {
          state.selectedVesselId = vessel.id;
          state.selectedMarkerId = null;
          state.selectedPoint = null;
          state.mode = "path";
        } else if (state.selectedVesselId === vessel.id) {
          state.selectedPoint = null;
        }
        commit();
      });
      const button = document.createElement("button");
      button.type = "button";
      button.className = "vessel-btn";
      if (vessel.id === state.selectedVesselId) button.classList.add("selected");
      const swatch = document.createElement("i");
      swatch.className = "swatch";
      swatch.style.background = displayColor(vessel);
      const name = document.createElement("span");
      name.textContent = `${vessel.code} ${vessel.name}`;
      const meta = document.createElement("small");
      meta.textContent = `${vessel.diameter}mm`;
      button.append(swatch, name, meta);
      button.addEventListener("click", () => {
        state.selectedVesselId = vessel.id;
        state.selectedMarkerId = null;
        state.selectedPoint = null;
        state.mode = "path";
        render();
      });
      row.append(checkbox, button);
      listEl.append(row);
    }
  }
}

function renderVessels() {
  syncJunctions();
  vesselLayer.replaceChildren();
  labelLayer.replaceChildren();
  const labels = [];
  const outlines = [];
  for (const vessel of state.vessels) {
    if (!isShown(vessel)) continue;
    const center = curvePath(vessel.points);
    const hit = document.createElementNS("http://www.w3.org/2000/svg", "path");
    hit.setAttribute("d", center);
    hit.setAttribute("fill", "none");
    hit.setAttribute("stroke", "transparent");
    const widest = vessel.points.reduce((max, point) => Math.max(max, pxWidth(pointMm(point, vessel), vessel)), 16);
    hit.setAttribute("stroke-width", String(Math.max(18, widest + 8)));
    if (vessel.parentId) hit.dataset.branchOf = vessel.parentId;
    hit.dataset.vessel = vessel.id;
    hit.style.cursor = state.mode === "paint" ? "crosshair" : "grab";
    vesselLayer.append(hit);
    const outline = appendRibbon(vessel);
    if (outline) outlines.push(outline);
    const anchorIndex = Math.min(Math.max(vessel.labelAt ?? 1, 0), vessel.points.length - 1);
    const anchor = vessel.points[anchorIndex];
    if (vessel.parentId) {
      const tip = vessel.points[vessel.points.length - 1];
      const beforeTip = vessel.points[Math.max(0, vessel.points.length - 2)];
      const dx = tip.x - beforeTip.x;
      const dy = tip.y - beforeTip.y;
      const length = Math.hypot(dx, dy) || 1;
      const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
      text.setAttribute("x", String(tip.x + (dx / length) * 8));
      text.setAttribute("y", String(tip.y + (dy / length) * 8));
      text.setAttribute("text-anchor", dx < 0 ? "end" : "start");
      text.setAttribute("font-size", "8");
      text.setAttribute("fill", "#44403c");
      text.setAttribute("pointer-events", "none");
      text.textContent = vessel.name;
      labelLayer.append(text);
    } else {
      labels.push({
        id: vessel.id,
        side: vessel.side,
        name: vessel.name,
        x: anchor.x,
        y: anchor.y,
        prefer: anchor.y + (vessel.labelDy || 0),
        labelX: vessel.labelX,
        labelY: vessel.labelY,
      });
    }
  }
  for (const side of ["rt", "lt"]) {
    const labelOrder = ["Axillary artery", "Cephalic vein", "Brachial artery", "Basilic vein", "Median cubital vein", "Ulnar artery", "Radial artery"];
    const rank = (name) => {
      const index = labelOrder.indexOf(name);
      return index === -1 ? labelOrder.length : index;
    };
    const items = labels.filter((item) => item.side === side).sort((a, b) => rank(a.name) - rank(b.name) || a.prefer - b.prefer);
    const onLeft = side === "rt";
    const columnX = onLeft ? 83 : MAP_WIDTH - 83;
    let stackY = 124;
    for (const item of items) {
      const placed = Number.isFinite(item.labelX) && Number.isFinite(item.labelY);
      const textX = placed ? item.labelX : columnX;
      const textY = placed ? item.labelY : stackY;
      if (!placed) stackY += 14;
      const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
      text.setAttribute("x", String(textX));
      text.setAttribute("y", String(textY));
      text.setAttribute("text-anchor", onLeft ? "end" : "start");
      text.setAttribute("font-size", "9");
      text.setAttribute("fill", "#44403c");
      text.setAttribute("stroke", "#fffdf8");
      text.setAttribute("stroke-width", "2.5");
      text.setAttribute("paint-order", "stroke");
      text.dataset.label = item.id;
      text.style.cursor = "grab";
      text.textContent = item.name;
      labelLayer.append(text);
      const leader = document.createElementNS("http://www.w3.org/2000/svg", "line");
      leader.dataset.leader = item.id;
      leader.setAttribute("x1", String(item.x));
      leader.setAttribute("y1", String(item.y));
      leader.setAttribute("x2", String(onLeft ? textX + 3 : textX - 3));
      leader.setAttribute("y2", String(textY - 3));
      leader.setAttribute("stroke", "#a8a29e");
      leader.setAttribute("stroke-width", "0.6");
      leader.setAttribute("pointer-events", "none");
      labelLayer.insertBefore(leader, text);
    }
  }
  joinOutlines(outlines);
}

function pencilJitter(index, salt) {
  const n = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return n - Math.floor(n);
}

function renderPaint() {
  paintLayer.replaceChildren();
  const layers = [
    { salt: 1.7, opacity: 0.62, width: 0.7, reach: 0.18, count: 2 },
    { salt: 5.3, opacity: 0.38, width: 0.45, reach: 0.55, count: 3 },
    { salt: 9.1, opacity: 0.22, width: 0.35, reach: 0.92, count: 2 },
  ];
  for (const stroke of state.paint) {
    if (!stroke.points || stroke.points.length < 2) continue;
    const size = Math.max(1.6, stroke.size || 6);
    const color = stroke.color || "#2b2b2b";
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.setAttribute("pointer-events", "none");
    let travel = 0;
    for (let index = 1; index < stroke.points.length; index += 1) {
      travel += Math.hypot(stroke.points[index].x - stroke.points[index - 1].x, stroke.points[index].y - stroke.points[index - 1].y);
    }
    const spacing = Math.max(0.75, Math.min(size * 0.22, Math.max(travel, 1) / 280));
    for (const layer of layers) {
      const commands = [];
      let sample = 0;
      for (let index = 1; index < stroke.points.length; index += 1) {
        const from = stroke.points[index - 1];
        const to = stroke.points[index];
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const length = Math.hypot(dx, dy);
        if (length < 0.2) continue;
        const tx = dx / length;
        const ty = dy / length;
        const nx = -ty;
        const ny = tx;
        const steps = Math.max(1, Math.ceil(length / spacing));
        for (let step = 0; step < steps; step += 1) {
          const at = (step + 0.35) / steps;
          const x = from.x + dx * at;
          const y = from.y + dy * at;
          for (let flake = 0; flake < layer.count; flake += 1) {
            const grain = pencilJitter(sample, layer.salt + flake * 3.1);
            const side = pencilJitter(sample, layer.salt + flake * 5.7 + 1.4);
            const spin = pencilJitter(sample, layer.salt + flake * 8.9 + 2.8);
            if (grain < 0.16) {
              sample += 1;
              continue;
            }
            const offset = (side - 0.5) * size * layer.reach;
            const drift = (grain - 0.5) * spacing * 0.8;
            const originX = x + nx * offset + tx * drift;
            const originY = y + ny * offset + ty * drift;
            const angle = Math.atan2(ty, tx) + (spin - 0.5) * 1.15;
            const mark = size * (0.12 + grain * 0.28);
            commands.push(`M${originX.toFixed(2)} ${originY.toFixed(2)}l${(Math.cos(angle) * mark).toFixed(2)} ${(Math.sin(angle) * mark).toFixed(2)}`);
            sample += 1;
          }
        }
      }
      if (!commands.length) continue;
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", commands.join(""));
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", color);
      path.setAttribute("stroke-width", String(layer.width));
      path.setAttribute("stroke-opacity", String(layer.opacity));
      path.setAttribute("stroke-linecap", "round");
      group.append(path);
    }
    paintLayer.append(group);
  }
}

function renderMarkers() {
  markerLayer.replaceChildren();
  for (const marker of state.markers) {
    const spec = MARKERS[marker.type] || MARKERS.borderline;
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.dataset.marker = marker.id;
    group.style.cursor = "grab";
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", String(marker.x));
    circle.setAttribute("cy", String(marker.y));
    circle.setAttribute("r", marker.id === state.selectedMarkerId ? "16" : "13");
    circle.setAttribute("fill", spec.fill);
    circle.setAttribute("stroke", "#fff");
    circle.setAttribute("stroke-width", "2");
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", String(marker.x));
    text.setAttribute("y", String(marker.y + 4));
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("font-size", "11");
    text.setAttribute("font-weight", "700");
    text.setAttribute("fill", "#fff");
    text.setAttribute("pointer-events", "none");
    text.textContent = spec.label;
    group.append(circle, text);
    if (marker.note) {
      const note = document.createElementNS("http://www.w3.org/2000/svg", "text");
      note.setAttribute("x", String(marker.x + 18));
      note.setAttribute("y", String(marker.y + 4));
      note.setAttribute("font-size", "12");
      note.setAttribute("fill", "#292524");
      note.setAttribute("pointer-events", "none");
      note.textContent = marker.note;
      group.append(note);
    }
    markerLayer.append(group);
  }
}

function renderHandles() {
  handleLayer.replaceChildren();
  const vessel = vesselById(state.selectedVesselId);
  if (!vessel || state.mode !== "path" || !isShown(vessel)) return;
  vessel.points.forEach((point, index) => {
    const selected = state.selectedPoint === index;
    if (selected) {
      const handle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      handle.setAttribute("cx", String(point.x + point.hx));
      handle.setAttribute("cy", String(point.y + point.hy));
      handle.setAttribute("r", "6");
      handle.setAttribute("fill", "#eab308");
      handle.setAttribute("stroke", "#854d0e");
      handle.dataset.handle = String(index);
      handle.style.cursor = "grab";
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", String(point.x));
      line.setAttribute("y1", String(point.y));
      line.setAttribute("x2", String(point.x + point.hx));
      line.setAttribute("y2", String(point.y + point.hy));
      line.setAttribute("stroke", "#ca8a04");
      line.setAttribute("pointer-events", "none");
      handleLayer.append(line, handle);
    }
    const anchor = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    anchor.setAttribute("cx", String(point.x));
    anchor.setAttribute("cy", String(point.y));
    anchor.setAttribute("r", state.selectedPoint === index ? "8" : "6");
    anchor.setAttribute("fill", "#fff");
    anchor.setAttribute("stroke", "#111");
    anchor.setAttribute("stroke-width", "2");
    anchor.dataset.anchor = String(index);
    anchor.style.cursor = "grab";
    handleLayer.append(anchor);
    if (!selected) return;
    const tangent = tangentAtPoint(vessel, index);
    const length = Math.hypot(tangent.x, tangent.y) || 1;
    const nx = -tangent.y / length;
    const ny = tangent.x / length;
    const half = pxWidth(pointMm(point, vessel), vessel) / 2;
    for (const side of [1, -1]) {
      const x = point.x + nx * side * (half + 16);
      const y = point.y + ny * side * (half + 16);
      const tick = document.createElementNS("http://www.w3.org/2000/svg", "line");
      tick.setAttribute("x1", String(point.x + nx * side * (half + 1)));
      tick.setAttribute("y1", String(point.y + ny * side * (half + 1)));
      tick.setAttribute("x2", String(x));
      tick.setAttribute("y2", String(y));
      tick.setAttribute("stroke", displayColor(vessel));
      tick.setAttribute("stroke-width", "2");
      tick.setAttribute("pointer-events", "none");
      const grip = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      grip.setAttribute("cx", String(x));
      grip.setAttribute("cy", String(y));
      grip.setAttribute("r", "7");
      grip.setAttribute("fill", displayColor(vessel));
      grip.setAttribute("stroke", "#fff");
      grip.setAttribute("stroke-width", "2");
      grip.dataset.width = String(index);
      grip.style.cursor = "ew-resize";
      const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
      title.textContent = "이 지점 굵기";
      grip.append(title);
      handleLayer.append(tick, grip);
    }
  });
}

function tangentAtPoint(vessel, index) {
  const points = vessel.points;
  if (points.length < 2) return { x: 1, y: 0 };
  if (index <= 0) return curveTangent(points[0], points[1], 0);
  if (index >= points.length - 1) return curveTangent(points[index - 1], points[index], 1);
  const before = curveTangent(points[index - 1], points[index], 1);
  const after = curveTangent(points[index], points[index + 1], 0);
  return { x: before.x + after.x, y: before.y + after.y };
}

function renderInspector() {
  const vessel = vesselById(state.selectedVesselId);
  const marker = state.markers.find((item) => item.id === state.selectedMarkerId);
  const vesselFields = document.querySelector("#vessel-fields");
  const markerFields = document.querySelector("#marker-fields");
  const title = document.querySelector("#inspect-title");
  const hint = document.querySelector("#inspect-hint");
  const editingField = document.activeElement?.id?.startsWith("field-");
  vesselFields.hidden = !vessel;
  markerFields.hidden = !marker;
  document.querySelector("#delete-branch").hidden = !vessel?.parentId;
  document.querySelector("#reset-vessel").hidden = Boolean(vessel?.parentId);
  const pointWidthField = document.querySelector("#point-width-field");
  const selected = vessel && state.selectedPoint != null ? vessel.points[state.selectedPoint] : null;
  pointWidthField.hidden = !selected;
  if (vessel) {
    const parent = vesselById(vessel.parentId);
    title.textContent = `${vessel.sideName} ${vessel.name}`;
    if (state.mode === "paint") {
      hint.textContent = "연필로 긋습니다. 색을 바꾸면 다음 선부터 적용되고, 지우개로 지웁니다.";
    } else if (parent) {
      hint.textContent = `${parent.name}에서 나온 가지입니다. 선을 끌면 구부러지고, 시작 점은 그 혈관을 따라 움직입니다.`;
    } else {
      hint.textContent = "선을 끌면 그 부분이 구부러집니다. 클릭하면 가지 추가가 뜨고, 그 버튼을 누른 채 끌면 가지가 나갑니다. 색 막대를 끌면 그 지점만 굵어집니다.";
    }
    if (!editingField) {
      document.querySelector("#field-name").value = vessel.name;
      document.querySelector("#field-diameter").value = String(vessel.diameter);
      document.querySelector("#field-color").value = vessel.color;
      document.querySelector("#field-style").value = vessel.style || "normal";
      document.querySelector("#field-visible").checked = vessel.visible;
      if (selected) document.querySelector("#field-point-width").value = String(pointMm(selected, vessel));
    }
  } else if (marker) {
    const spec = MARKERS[marker.type] || MARKERS.borderline;
    title.textContent = `표식 ${spec.label}`;
    hint.textContent = "표식을 끌어 옮기거나 메모를 적습니다.";
    if (!editingField) document.querySelector("#field-note").value = marker.note || "";
  } else {
    title.textContent = state.mode === "paint" ? "연필" : "혈관을 선택하세요";
    hint.textContent = state.mode === "paint"
      ? "연필로 긋습니다. 색을 바꾸면 다음 선부터 적용되고, 지우개로 지웁니다."
      : "주요 동맥과 얕은 정맥이 켜져 있습니다. 선을 끌면 구부러지고, 클릭하면 그 자리에 가지 추가가 뜹니다. 깊은 정맥은 왼쪽에서 켭니다.";
  }
  document.querySelector("#mode-path").classList.toggle("active", state.mode === "path");
  document.querySelector("#mode-paint").classList.toggle("active", state.mode === "paint");
  document.querySelector("#mode-marker").classList.toggle("active", state.mode === "marker");
  document.querySelector("#paint-tools").hidden = state.mode !== "paint";
  svg.classList.toggle("paint-mode", state.mode === "paint");
  document.querySelector("#paint-erase").classList.toggle("active", state.erasing);
  document.querySelector("#marker-type").disabled = state.mode !== "marker";
  document.querySelector("#marker-type").value = state.markerType;
}

function render() {
  renderBackground();
  renderList();
  renderVessels();
  renderPaint();
  renderMarkers();
  renderHandles();
  renderInspector();
  persist();
}

function hideCursorMenu() {
  menuHit = null;
  document.querySelector("#cursor-menu").hidden = true;
}

function showCursorMenu(event, vessel, hit) {
  menuHit = { vesselId: vessel.id, hit };
  const menu = document.querySelector("#cursor-menu");
  menu.hidden = false;
  const pad = 8;
  const width = 120;
  const height = 44;
  menu.style.left = `${Math.min(event.clientX + pad, window.innerWidth - width)}px`;
  menu.style.top = `${Math.min(event.clientY + pad, window.innerHeight - height)}px`;
}

function moveAnchor(vessel, index, point) {
  const anchor = vessel.points[index];
  if (!anchor) return;
  if (vessel.junction && index === 0) {
    const parent = vesselById(vessel.parentId);
    const hit = parent ? closestOnPath(parent.points, point) : null;
    if (hit) {
      vessel.junction.segment = hit.segment;
      vessel.junction.t = hit.t;
    }
    return;
  }
  anchor.x = point.x;
  anchor.y = point.y;
}

function onPointerDown(event) {
  const target = event.target;
  if (target.closest("#cursor-menu")) return;
  const point = svgPoint(event);
  hideCursorMenu();
  const labelHit = target.closest?.("[data-label]");
  if (labelHit) {
    const id = labelHit.dataset.label;
    drag = {
      kind: "label",
      id,
      dx: point.x - Number(labelHit.getAttribute("x")),
      dy: point.y - Number(labelHit.getAttribute("y")),
    };
    labelHit.style.cursor = "grabbing";
    if (svg.contains(labelHit)) svg.setPointerCapture(event.pointerId);
    return;
  }
  if (state.mode === "paint" && (event.target === svg || svg.contains(event.target))) {
    if (state.erasing) {
      drag = { kind: "erase" };
      erasePaint(point);
    } else {
      const stroke = {
        id: `p-${Date.now().toString(36)}-${Math.floor(Math.random() * 1000)}`,
        color: state.paintColor,
        size: state.paintSize,
        points: [point],
      };
      state.paint.push(stroke);
      drag = { kind: "paint", id: stroke.id };
    }
    return;
  }
  if (target.dataset.width != null && state.selectedVesselId) {
    drag = { kind: "width", index: Number(target.dataset.width), id: state.selectedVesselId };
    state.selectedPoint = drag.index;
  } else if (target.dataset.handle != null && state.selectedVesselId) {
    drag = { kind: "handle", index: Number(target.dataset.handle), id: state.selectedVesselId };
    state.selectedPoint = drag.index;
  } else if (target.dataset.anchor != null && state.selectedVesselId) {
    drag = { kind: "anchor", index: Number(target.dataset.anchor), id: state.selectedVesselId };
    state.selectedPoint = drag.index;
    state.selectedMarkerId = null;
  } else if (target.closest("[data-marker]")) {
    const id = target.closest("[data-marker]").dataset.marker;
    state.selectedMarkerId = id;
    state.selectedVesselId = null;
    drag = { kind: "marker", id };
  } else if (target.dataset.vessel && state.mode === "path") {
    const vessel = vesselById(target.dataset.vessel);
    const hit = vessel ? closestOnPath(vessel.points, point) : null;
    state.selectedVesselId = target.dataset.vessel;
    state.selectedMarkerId = null;
    state.selectedPoint = null;
    if (hit) drag = { kind: "sculpt", id: vessel.id, hit, origin: point, moved: false, index: null };
  } else if (target.dataset.vessel && state.mode === "marker") {
    state.selectedVesselId = target.dataset.vessel;
    addMarker(point);
    return;
  } else if (state.mode === "marker") {
    addMarker(point);
    return;
  } else if (state.mode === "path" && isMapBackground(target)) {
    state.selectedVesselId = null;
    state.selectedPoint = null;
    state.selectedMarkerId = null;
    drag = { kind: "pan", cx: event.clientX, cy: event.clientY, ox: event.clientX, oy: event.clientY, moved: false };
  } else if (!target.closest("#cursor-menu")) {
    state.selectedVesselId = null;
    state.selectedPoint = null;
    state.selectedMarkerId = null;
  }
  if (drag && event.target instanceof Element && svg.contains(event.target)) svg.setPointerCapture(event.pointerId);
  render();
}

function isMapBackground(target) {
  if (!(target instanceof Element)) return false;
  const name = target.tagName.toLowerCase();
  return target === svg || target.id === "bg-image" || name === "rect";
}

function onPointerMove(event) {
  if (!drag) return;
  if (drag.kind === "label") {
    const point = svgPoint(event);
    const vessel = vesselById(drag.id);
    const text = labelLayer.querySelector(`[data-label="${drag.id}"]`);
    const leader = labelLayer.querySelector(`[data-leader="${drag.id}"]`);
    if (!vessel || !text || !leader) return;
    const x = point.x - drag.dx;
    const y = point.y - drag.dy;
    vessel.labelX = x;
    vessel.labelY = y;
    text.setAttribute("x", String(x));
    text.setAttribute("y", String(y));
    const anchorIsEnd = text.getAttribute("text-anchor") === "end";
    leader.setAttribute("x2", String(anchorIsEnd ? x + 3 : x - 3));
    leader.setAttribute("y2", String(y - 3));
    return;
  }
  if (drag.kind === "pan") {
    const dx = (event.clientX - drag.cx) * (view.width / svg.clientWidth);
    const dy = (event.clientY - drag.cy) * (view.height / svg.clientHeight);
    if (Math.hypot(event.clientX - drag.ox, event.clientY - drag.oy) > 3) drag.moved = true;
    view.x -= dx;
    view.y -= dy;
    drag.cx = event.clientX;
    drag.cy = event.clientY;
    clampView();
    applyView();
    return;
  }
  const point = svgPoint(event);
  if (drag.kind === "paint") {
    const stroke = state.paint.find((item) => item.id === drag.id);
    const last = stroke?.points[stroke.points.length - 1];
    if (stroke && (!last || Math.hypot(last.x - point.x, last.y - point.y) > 1.2)) stroke.points.push(point);
    renderPaint();
    return;
  }
  if (drag.kind === "erase") {
    erasePaint(point);
    renderPaint();
    return;
  }
  if (drag.kind === "marker") {
    const marker = state.markers.find((item) => item.id === drag.id);
    if (!marker) return;
    marker.x = point.x;
    marker.y = point.y;
    renderMarkers();
    return;
  }
  if (drag.kind === "sculpt") {
    if (!drag.moved && Math.hypot(point.x - drag.origin.x, point.y - drag.origin.y) < 4) return;
    const vessel = vesselById(drag.id);
    if (!vessel) return;
    if (!drag.moved) {
      drag.moved = true;
      const nearStart = Math.hypot(drag.hit.x - vessel.points[drag.hit.segment].x, drag.hit.y - vessel.points[drag.hit.segment].y);
      const nearEnd = Math.hypot(drag.hit.x - vessel.points[drag.hit.segment + 1].x, drag.hit.y - vessel.points[drag.hit.segment + 1].y);
      if (nearStart < 10) drag.index = drag.hit.segment;
      else if (nearEnd < 10) drag.index = drag.hit.segment + 1;
      else drag.index = insertOnCurve(vessel, drag.hit);
      state.selectedPoint = drag.index;
    }
    moveAnchor(vessel, drag.index, point);
    renderVessels();
    renderHandles();
    return;
  }
  const vessel = vesselById(drag.id);
  const anchor = vessel?.points[drag.index];
  if (!vessel || !anchor) return;
  if (drag.kind === "width") {
    const scale = vessel.style === "considerable" ? 1.35 : vessel.style === "borderline" ? 0.8 : 1;
    const half = Math.max(0.6, Math.hypot(point.x - anchor.x, point.y - anchor.y) - 16);
    anchor.w = Math.round(Math.min(40, Math.max(0.4, (half * 2) / (1.05 * scale))) * 10) / 10;
  } else if (drag.kind === "anchor") {
    moveAnchor(vessel, drag.index, point);
    if (drag.pulling) aimOutward(vessel);
  } else {
    anchor.hx = point.x - anchor.x;
    anchor.hy = point.y - anchor.y;
    anchor.ix = -anchor.hx;
    anchor.iy = -anchor.hy;
  }
  renderVessels();
  renderHandles();
}

function finishPull(pull) {
  const vessel = vesselById(pull.id);
  if (!vessel || vessel.points.length < 2) return false;
  const origin = vessel.points[0];
  const tip = vessel.points[vessel.points.length - 1];
  if (Math.hypot(tip.x - origin.x, tip.y - origin.y) < 12) {
    removeVessel(vessel.id);
    return false;
  }
  aimOutward(vessel);
  state.mode = "path";
  state.selectedPoint = vessel.points.length - 1;
  return true;
}

function onPointerUp(event) {
  if (!drag) return;
  const finished = drag;
  drag = null;
  if (finished.kind === "pan") {
    if (!finished.moved) render();
    return;
  }
  if (finished.kind === "sculpt" && !finished.moved) {
    const vessel = vesselById(finished.id);
    if (vessel && event) showCursorMenu(event, vessel, finished.hit);
    render();
    return;
  }
  if (finished.pulling && !finishPull(finished)) {
    render();
    commit();
    return;
  }
  commit();
}

function startBranch(parent, hit, event) {
  if (!parent || parent.points.length < 2 || !hit) return;
  const branch = buildBranch(parent, hit);
  setVisible(parent, true);
  state.vessels.push(branch);
  state.selectedVesselId = branch.id;
  state.selectedMarkerId = null;
  state.selectedPoint = 1;
  state.mode = "path";
  drag = { kind: "anchor", index: 1, id: branch.id, pulling: true };
  if (event?.target instanceof Element && svg.contains(event.target)) svg.setPointerCapture(event.pointerId);
  render();
}

function erasePaint(point) {
  const radius = state.paintSize;
  state.paint = state.paint.flatMap((stroke) => {
    const kept = stroke.points.filter((item) => Math.hypot(item.x - point.x, item.y - point.y) > radius);
    return kept.length > 1 ? [{ ...stroke, points: kept }] : [];
  });
}

function addMarker(point) {
  const marker = {
    id: `m-${Date.now().toString(36)}-${Math.floor(Math.random() * 1000)}`,
    type: state.markerType,
    x: point.x,
    y: point.y,
    note: "",
  };
  state.markers.push(marker);
  state.selectedMarkerId = marker.id;
  state.selectedVesselId = null;
  commit();
}

document.querySelector("#mode-path").addEventListener("click", () => {
  state.mode = "path";
  state.erasing = false;
  hideCursorMenu();
  render();
});
document.querySelector("#mode-paint").addEventListener("click", () => {
  state.mode = "paint";
  state.selectedMarkerId = null;
  hideCursorMenu();
  render();
});
document.querySelector("#mode-marker").addEventListener("click", () => {
  hideCursorMenu();
  state.mode = "marker";
  render();
});
document.querySelector("#marker-type").addEventListener("change", (event) => {
  state.markerType = event.target.value;
});

document.querySelector("#undo").addEventListener("click", () => {
  if (historyIndex <= 0) return;
  historyIndex -= 1;
  restore(history[historyIndex]);
});
document.querySelector("#redo").addEventListener("click", () => {
  if (historyIndex >= history.length - 1) return;
  historyIndex += 1;
  restore(history[historyIndex]);
});

document.querySelector("#field-name").addEventListener("input", (event) => {
  const vessel = vesselById(state.selectedVesselId);
  if (!vessel) return;
  vessel.name = event.target.value;
  commit();
});
document.querySelector("#field-diameter").addEventListener("input", (event) => {
  const vessel = vesselById(state.selectedVesselId);
  if (!vessel) return;
  const next = Number(event.target.value) || 0.4;
  const previous = vessel.diameter;
  vessel.diameter = next;
  for (const point of vessel.points) {
    if (point.w == null || Math.abs(point.w - previous) < 0.05) point.w = next;
  }
  commit();
});
document.querySelector("#field-point-width").addEventListener("input", (event) => {
  const vessel = vesselById(state.selectedVesselId);
  const point = vessel?.points[state.selectedPoint];
  if (!point) return;
  point.w = Math.min(40, Math.max(0.4, Number(event.target.value) || 0.4));
  commit();
});
document.querySelector("#field-color").addEventListener("input", (event) => {
  const vessel = vesselById(state.selectedVesselId);
  if (!vessel) return;
  vessel.color = event.target.value;
  if (vessel.style !== "normal") vessel.style = "normal";
  commit();
});
document.querySelector("#field-style").addEventListener("change", (event) => {
  const vessel = vesselById(state.selectedVesselId);
  if (!vessel) return;
  vessel.style = event.target.value;
  commit();
});
document.querySelector("#field-visible").addEventListener("change", (event) => {
  const vessel = vesselById(state.selectedVesselId);
  if (!vessel) return;
  setVisible(vessel, event.target.checked);
  commit();
});
document.querySelector("#field-note").addEventListener("input", (event) => {
  const marker = state.markers.find((item) => item.id === state.selectedMarkerId);
  if (!marker) return;
  marker.note = event.target.value;
  commit();
});

document.querySelector("#delete-point").addEventListener("click", () => {
  const vessel = vesselById(state.selectedVesselId);
  if (!vessel || vessel.points.length <= 2 || state.selectedPoint == null) return;
  if (vessel.junction && state.selectedPoint === 0) return;
  const removed = state.selectedPoint;
  vessel.points.splice(removed, 1);
  for (const child of state.vessels) {
    if (child.parentId === vessel.id && child.junction && child.junction.segment >= removed) {
      child.junction.segment = Math.max(0, child.junction.segment - 1);
    }
  }
  state.selectedPoint = Math.min(removed, vessel.points.length - 1);
  commit();
});

document.querySelector("#menu-branch").addEventListener("pointerdown", (event) => {
  event.preventDefault();
  event.stopPropagation();
  if (!menuHit) return;
  const pending = menuHit;
  const parent = vesselById(pending.vesselId);
  hideCursorMenu();
  if (!parent) return;
  event.currentTarget.setPointerCapture(event.pointerId);
  startBranch(parent, pending.hit, event);
});

document.querySelector("#delete-branch").addEventListener("click", () => {
  const vessel = vesselById(state.selectedVesselId);
  if (!vessel?.parentId) return;
  removeVessel(vessel.id);
  commit();
});

document.querySelector("#delete-marker").addEventListener("click", () => {
  state.markers = state.markers.filter((item) => item.id !== state.selectedMarkerId);
  state.selectedMarkerId = null;
  commit();
});

document.querySelector("#reset-vessel").addEventListener("click", () => {
  const fresh = defaultById(state.selectedVesselId);
  const vessel = vesselById(state.selectedVesselId);
  if (!fresh || !vessel) return;
  const copy = JSON.parse(JSON.stringify(fresh));
  Object.assign(vessel, copy);
  commit();
});

document.querySelector("#reset-all").addEventListener("click", () => {
  if (!window.confirm("혈관과 표식을 처음 도식으로 되돌릴까요?")) return;
  state.vessels = cloneVessels(defaults);
  state.markers = [];
  state.paint = [];
  state.background = "";
  state.selectedVesselId = null;
  state.selectedMarkerId = null;
  state.selectedPoint = null;
  clearState();
  commit();
});

document.querySelector("#bg-file").addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    state.background = String(reader.result || "");
    commit();
  };
  reader.readAsDataURL(file);
  event.target.value = "";
});

document.querySelector("#clear-bg").addEventListener("click", () => {
  state.background = "";
  commit();
});

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("이미지를 불러오지 못했습니다."));
    image.src = src;
  });
}

async function outlineDataUrl() {
  const href = state.background || BODY_IMAGE;
  if (href.startsWith("data:")) return href;
  const response = await fetch(href);
  const blob = await response.blob();
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function exportSvgNode() {
  const clone = svg.cloneNode(true);
  clone.querySelector("#handles")?.remove();
  const outline = await outlineDataUrl();
  const image = clone.querySelector("#bg-image");
  image.setAttribute("href", outline);
  image.setAttributeNS("http://www.w3.org/1999/xlink", "href", outline);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  clone.setAttribute("width", String(MAP_WIDTH));
  clone.setAttribute("height", String(MAP_HEIGHT));
  return clone;
}

document.querySelector("#export-svg").addEventListener("click", async () => {
  const blob = new Blob([(await exportSvgNode()).outerHTML], { type: "image/svg+xml" });
  download(blob, "uddang-vessels.svg");
});

document.querySelector("#export-png").addEventListener("click", async () => {
  const outline = await loadImage(await outlineDataUrl());
  const clone = svg.cloneNode(true);
  clone.querySelector("#handles")?.remove();
  clone.querySelector("#bg-image")?.remove();
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(MAP_WIDTH));
  clone.setAttribute("height", String(MAP_HEIGHT));
  const svgUrl = URL.createObjectURL(new Blob([clone.outerHTML], { type: "image/svg+xml;charset=utf-8" }));
  const overlay = await loadImage(svgUrl);
  const canvas = document.createElement("canvas");
  canvas.width = MAP_WIDTH * 2;
  canvas.height = MAP_HEIGHT * 2;
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(outline, 0, 0, canvas.width, canvas.height);
  context.drawImage(overlay, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(svgUrl);
  canvas.toBlob((blob) => {
    if (blob) download(blob, "uddang-vessels.png");
  });
});

window.addEventListener("keydown", (event) => {
  const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName);
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();
    if (event.shiftKey) document.querySelector("#redo").click();
    else document.querySelector("#undo").click();
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "y") {
    event.preventDefault();
    document.querySelector("#redo").click();
    return;
  }
  if (event.key === "Escape") {
    hideCursorMenu();
    render();
    return;
  }
  if (typing) return;
  if (event.key === "Delete" || event.key === "Backspace") {
    if (state.selectedMarkerId) document.querySelector("#delete-marker").click();
    else if (state.selectedPoint != null) document.querySelector("#delete-point").click();
  }
});

svg.addEventListener("pointerdown", onPointerDown);
window.addEventListener("pointermove", onPointerMove);
window.addEventListener("pointerup", onPointerUp);
window.addEventListener("pointercancel", onPointerUp);
document.querySelectorAll(".paint-color").forEach((button) => {
  button.addEventListener("click", () => {
    state.paintColor = button.dataset.color;
    state.erasing = false;
    document.querySelector("#paint-color").value = state.paintColor;
    document.querySelectorAll(".paint-color").forEach((item) => item.classList.toggle("active-color", item === button));
    renderInspector();
  });
});
document.querySelector("#paint-color").addEventListener("input", (event) => {
  state.paintColor = event.target.value;
  state.erasing = false;
  document.querySelectorAll(".paint-color").forEach((item) => item.classList.remove("active-color"));
  renderInspector();
});
document.querySelector("#paint-size").addEventListener("input", (event) => {
  state.paintSize = Number(event.target.value) || 6;
});
svg.addEventListener("wheel", (event) => {
  event.preventDefault();
  zoomAt(event.clientX, event.clientY, event.deltaY < 0 ? 1.15 : 1 / 1.15);
}, { passive: false });
document.querySelector("#zoom-in").addEventListener("click", () => zoomBy(1.25));
document.querySelector("#zoom-out").addEventListener("click", () => zoomBy(1 / 1.25));
document.querySelector("#zoom-reset").addEventListener("click", () => {
  view.x = 0;
  view.y = 0;
  view.width = MAP_WIDTH;
  view.height = MAP_HEIGHT;
  applyView();
});
document.querySelector("#vessels-all").addEventListener("click", () => setAllVisible(true));
document.querySelector("#vessels-none").addEventListener("click", () => setAllVisible(false));
document.querySelector("#paint-erase").addEventListener("click", () => {
  state.erasing = !state.erasing;
  renderInspector();
});
document.querySelector(".paint-color").classList.add("active-color");

history.push(snapshot());
historyIndex = 0;
render();
