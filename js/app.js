import { BODY_IMAGE, MAP_HEIGHT, MAP_WIDTH, cloneVessels, closestOnPath, createDefaultVessels, curvePoint, curveTangent, pointAlong, useEnglishNames } from "./vessels.js";
import { clearState, loadState, saveState } from "./storage.js";

const svg = document.querySelector("#map");
const vesselLayer = document.querySelector("#vessels");
const labelLayer = document.querySelector("#labels");
const markerLayer = document.querySelector("#markers");
const handleLayer = document.querySelector("#handles");
const listEl = document.querySelector("#vessel-list");

const defaults = createDefaultVessels();
const saved = loadState();

const state = {
  vessels: saved?.vessels?.length ? useEnglishNames(saved.vessels) : cloneVessels(defaults),
  markers: Array.isArray(saved?.markers) ? saved.markers : [],
  background: saved?.background || "",
  mode: "path",
  markerType: "borderline",
  selectedVesselId: null,
  selectedPoint: null,
  selectedMarkerId: null,
};

const history = [];
let historyIndex = -1;
let drag = null;

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
  state.background = data.background || "";
  persist();
  render();
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

function tangentAt(parent, junction) {
  if (!parent || !junction || parent.points.length < 2) return { x: 0, y: 1 };
  const segment = Math.max(0, Math.min(parent.points.length - 2, junction.segment | 0));
  const t = Math.min(1, Math.max(0, Number(junction.t) || 0));
  return curveTangent(parent.points[segment], parent.points[segment + 1], t);
}

function perpendicularAway(hit) {
  const length = Math.hypot(hit.tangent.x, hit.tangent.y) || 1;
  let nx = -hit.tangent.y / length;
  let ny = hit.tangent.x / length;
  const away = hit.x - MAP_WIDTH / 2;
  if (nx * away < 0) {
    nx = -nx;
    ny = -ny;
  }
  if (Math.abs(nx * away) < 0.5 && ny > 0) {
    nx = -nx;
    ny = -ny;
  }
  if (Math.hypot(nx, ny) < 0.001) return { x: hit.x < MAP_WIDTH / 2 ? -1 : 1, y: 0 };
  return { x: nx, y: ny };
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
  const direction = perpendicularAway(hit);
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
    diameter: Math.max(0.8, Math.round(parent.diameter * 0.55 * 10) / 10),
    style: "normal",
    points: [
      { x: hit.x, y: hit.y, hx: direction.x * 14, hy: direction.y * 14 },
      { x: hit.x, y: hit.y, hx: direction.x * 10, hy: direction.y * 10 },
    ],
  };
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

function strokeWidth(vessel) {
  const base = Math.max(1.2, Number(vessel.diameter) * 1.05);
  if (vessel.style === "considerable") return base * 1.55;
  if (vessel.style === "borderline") return Math.max(1.4, base * 0.75);
  return base;
}

function curvePath(points) {
  if (points.length < 2) return "";
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const c1x = a.x + a.hx;
    const c1y = a.y + a.hy;
    const c2x = b.x - b.hx;
    const c2y = b.y - b.hy;
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
  for (const vessel of state.vessels) {
    if (!isShown(vessel)) continue;
    const d = curvePath(vessel.points);
    const hit = document.createElementNS("http://www.w3.org/2000/svg", "path");
    hit.setAttribute("d", d);
    hit.setAttribute("fill", "none");
    hit.setAttribute("stroke", "transparent");
    const hitWidth = state.mode === "branch" ? Math.max(22, strokeWidth(vessel) + 14) : Math.max(16, strokeWidth(vessel) + 10);
    hit.setAttribute("stroke-width", String(hitWidth));
    if (vessel.parentId) hit.dataset.branchOf = vessel.parentId;
    hit.dataset.vessel = vessel.id;
    hit.style.cursor = state.mode === "branch" ? "crosshair" : "pointer";
    const visual = document.createElementNS("http://www.w3.org/2000/svg", "path");
    visual.setAttribute("d", d);
    visual.setAttribute("fill", "none");
    visual.setAttribute("stroke", displayColor(vessel));
    visual.setAttribute("stroke-width", String(strokeWidth(vessel)));
    visual.setAttribute("stroke-linecap", "round");
    visual.setAttribute("stroke-linejoin", "round");
    if (vessel.id === state.selectedVesselId) {
      visual.setAttribute("stroke-dasharray", vessel.style === "borderline" ? "7 5" : "");
      visual.setAttribute("filter", "drop-shadow(0 0 2px rgba(0,0,0,.25))");
    } else if (vessel.style === "borderline") {
      visual.setAttribute("stroke-dasharray", "7 5");
    }
    visual.setAttribute("pointer-events", "none");
    vesselLayer.append(hit, visual);

    const tip = vessel.points[vessel.points.length - 1];
    const beforeTip = vessel.points[Math.max(0, vessel.points.length - 2)];
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    if (vessel.parentId) {
      const dx = tip.x - beforeTip.x;
      const dy = tip.y - beforeTip.y;
      const length = Math.hypot(dx, dy) || 1;
      text.setAttribute("x", String(tip.x + (dx / length) * 8));
      text.setAttribute("y", String(tip.y + (dy / length) * 8));
      text.setAttribute("text-anchor", dx < 0 ? "end" : "start");
    } else {
      const outward = vessel.side === "rt" ? -1 : 1;
      const stack = { A: -7, B: 0, C: -9, D: 6, E: -12, F: 8, G: 2 }[vessel.code] || 0;
      text.setAttribute("x", String(beforeTip.x + outward * 4));
      text.setAttribute("y", String(beforeTip.y + stack));
      text.setAttribute("text-anchor", vessel.side === "rt" ? "end" : "start");
    }
    text.setAttribute("font-size", "9");
    text.setAttribute("fill", "#44403c");
    text.setAttribute("pointer-events", "none");
    text.textContent = `${vessel.code} ${vessel.diameter}`;
    labelLayer.append(text);
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
    const anchor = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    anchor.setAttribute("cx", String(point.x));
    anchor.setAttribute("cy", String(point.y));
    anchor.setAttribute("r", state.selectedPoint === index ? "8" : "6");
    anchor.setAttribute("fill", "#fff");
    anchor.setAttribute("stroke", "#111");
    anchor.setAttribute("stroke-width", "2");
    anchor.dataset.anchor = String(index);
    anchor.style.cursor = "grab";
    handleLayer.append(line, handle, anchor);
  });
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
  if (vessel) {
    const parent = vesselById(vessel.parentId);
    title.textContent = `${vessel.sideName} ${vessel.name}`;
    if (state.mode === "branch") {
      hint.textContent = "표시된 혈관 중간을 누른 채 끌어 가지를 뺍니다. 짧게 누르면 바깥쪽으로 짧은 가지가 생깁니다.";
    } else if (parent) {
      hint.textContent = `${parent.name}에 붙은 가지입니다. 시작 흰 점은 그 혈관을 따라 움직이고, 끝점은 자유롭게 구부립니다.`;
    } else {
      hint.textContent = "흰 점을 끌어 위치를 옮기고, 노란 핸들로 구부립니다. 중간에서 가지는 길이의 한가운데에서 가지를 뺍니다.";
    }
    if (!editingField) {
      document.querySelector("#field-name").value = vessel.name;
      document.querySelector("#field-diameter").value = String(vessel.diameter);
      document.querySelector("#field-color").value = vessel.color;
      document.querySelector("#field-style").value = vessel.style || "normal";
      document.querySelector("#field-visible").checked = vessel.visible;
    }
  } else if (marker) {
    const spec = MARKERS[marker.type] || MARKERS.borderline;
    title.textContent = `표식 ${spec.label}`;
    hint.textContent = "표식을 끌어 옮기거나 메모를 적습니다.";
    if (!editingField) document.querySelector("#field-note").value = marker.note || "";
  } else {
    title.textContent = "혈관을 선택하세요";
    hint.textContent = state.mode === "branch"
      ? "표시된 혈관 중간을 누른 채 끌어 가지를 뺍니다. 짧게 누르면 바깥쪽으로 짧은 가지가 생깁니다."
      : "왼쪽 체크를 켜면 혈관이 나타납니다. 가지 따기를 누른 뒤 혈관 중간을 끌어 가지를 뺍니다.";
  }
  document.querySelector("#mode-path").classList.toggle("active", state.mode === "path");
  document.querySelector("#mode-branch").classList.toggle("active", state.mode === "branch");
  document.querySelector("#mode-marker").classList.toggle("active", state.mode === "marker");
  svg.classList.toggle("branch-mode", state.mode === "branch");
  document.querySelector("#marker-type").disabled = state.mode !== "marker";
  document.querySelector("#marker-type").value = state.markerType;
}

function render() {
  renderBackground();
  renderList();
  renderVessels();
  renderMarkers();
  renderHandles();
  renderInspector();
  persist();
}

function onPointerDown(event) {
  const target = event.target;
  const point = svgPoint(event);
  if (target.dataset.handle != null && state.selectedVesselId) {
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
  } else if (target.dataset.vessel && state.mode === "branch") {
    startBranch(vesselById(target.dataset.vessel), point, event);
    return;
  } else if (target.dataset.vessel) {
    state.selectedVesselId = target.dataset.vessel;
    state.selectedMarkerId = null;
    state.selectedPoint = null;
    if (state.mode === "marker") {
      addMarker(point);
      return;
    }
  } else if (state.mode === "marker") {
    addMarker(point);
    return;
  } else {
    state.selectedVesselId = null;
    state.selectedPoint = null;
    state.selectedMarkerId = null;
  }
  if (drag) svg.setPointerCapture(event.pointerId);
  render();
}

function onPointerMove(event) {
  if (!drag) return;
  const point = svgPoint(event);
  if (drag.kind === "marker") {
    const marker = state.markers.find((item) => item.id === drag.id);
    if (!marker) return;
    marker.x = point.x;
    marker.y = point.y;
  } else {
    const vessel = vesselById(drag.id);
    const anchor = vessel?.points[drag.index];
    if (!anchor) return;
    if (drag.kind === "anchor" && vessel.junction && drag.index === 0 && !drag.pulling) {
      const parent = vesselById(vessel.parentId);
      const hit = parent ? closestOnPath(parent.points, point) : null;
      if (hit) {
        vessel.junction.segment = hit.segment;
        vessel.junction.t = hit.t;
      }
    } else if (drag.kind === "anchor") {
      anchor.x = point.x;
      anchor.y = point.y;
    } else {
      anchor.hx = point.x - anchor.x;
      anchor.hy = point.y - anchor.y;
    }
    if (drag.pulling) aimOutward(vessel);
  }
  renderVessels();
  renderMarkers();
  renderHandles();
}

function finishPull(pull) {
  const vessel = vesselById(pull.id);
  if (!vessel || vessel.points.length < 2) return;
  const origin = vessel.points[0];
  const tip = vessel.points[vessel.points.length - 1];
  if (Math.hypot(tip.x - origin.x, tip.y - origin.y) < 20) {
    const parent = vesselById(vessel.parentId);
    const direction = perpendicularAway({
      x: origin.x,
      y: origin.y,
      tangent: tangentAt(parent, vessel.junction),
    });
    tip.x = origin.x + direction.x * 48;
    tip.y = origin.y + direction.y * 48;
  }
  aimOutward(vessel);
  state.mode = "path";
  state.selectedPoint = vessel.points.length - 1;
}

function onPointerUp() {
  if (!drag) return;
  if (drag.pulling) finishPull(drag);
  drag = null;
  commit();
}

function startBranch(parent, point, event) {
  if (!parent || parent.points.length < 2) return;
  const hit = closestOnPath(parent.points, point);
  if (!hit) return;
  const branch = buildBranch(parent, hit);
  setVisible(parent, true);
  state.vessels.push(branch);
  state.selectedVesselId = branch.id;
  state.selectedMarkerId = null;
  state.selectedPoint = 1;
  drag = { kind: "anchor", index: 1, id: branch.id, pulling: true };
  if (event) svg.setPointerCapture(event.pointerId);
  render();
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
  render();
});
document.querySelector("#mode-branch").addEventListener("click", () => {
  state.mode = "branch";
  state.selectedMarkerId = null;
  render();
});
document.querySelector("#mode-marker").addEventListener("click", () => {
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
  vessel.diameter = Number(event.target.value) || 0.4;
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

document.querySelector("#add-point").addEventListener("click", () => {
  const vessel = vesselById(state.selectedVesselId);
  if (!vessel) return;
  const index = state.selectedPoint == null ? vessel.points.length - 1 : state.selectedPoint;
  const current = vessel.points[index];
  const next = vessel.points[Math.min(vessel.points.length - 1, index + 1)];
  const created = {
    x: (current.x + next.x) / 2 + 12,
    y: (current.y + next.y) / 2 + 12,
    hx: current.hx * 0.5,
    hy: current.hy * 0.5,
  };
  vessel.points.splice(index + 1, 0, created);
  state.selectedPoint = index + 1;
  commit();
});

document.querySelector("#delete-point").addEventListener("click", () => {
  const vessel = vesselById(state.selectedVesselId);
  if (!vessel || vessel.points.length <= 2 || state.selectedPoint == null) return;
  if (vessel.junction && state.selectedPoint === 0) return;
  vessel.points.splice(state.selectedPoint, 1);
  state.selectedPoint = Math.min(state.selectedPoint, vessel.points.length - 1);
  commit();
});

document.querySelector("#add-branch").addEventListener("click", () => {
  const parent = vesselById(state.selectedVesselId);
  if (!parent || parent.points.length < 2) return;
  const hit = pointAlong(parent.points, 0.5);
  if (!hit) return;
  const branch = buildBranch(parent, hit);
  const direction = perpendicularAway(hit);
  branch.points[1].x = hit.x + direction.x * 48;
  branch.points[1].y = hit.y + direction.y * 48;
  aimOutward(branch);
  setVisible(parent, true);
  state.vessels.push(branch);
  state.selectedVesselId = branch.id;
  state.selectedMarkerId = null;
  state.selectedPoint = 1;
  state.mode = "path";
  commit();
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
  if (typing) return;
  if (event.key === "Delete" || event.key === "Backspace") {
    if (state.selectedMarkerId) document.querySelector("#delete-marker").click();
    else if (state.selectedPoint != null) document.querySelector("#delete-point").click();
  }
});

svg.addEventListener("pointerdown", onPointerDown);
svg.addEventListener("pointermove", onPointerMove);
svg.addEventListener("pointerup", onPointerUp);
svg.addEventListener("pointercancel", onPointerUp);

history.push(snapshot());
historyIndex = 0;
render();
