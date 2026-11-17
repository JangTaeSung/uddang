import { BODY_IMAGE, MAP_HEIGHT, MAP_WIDTH, cloneVessels, createDefaultVessels, useEnglishNames } from "./vessels.js";
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
    for (const vessel of state.vessels.filter((item) => item.side === side)) {
      const row = document.createElement("div");
      row.className = "vessel-row";
      if (!vessel.visible) row.classList.add("hidden-vessel");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "vessel-check";
      checkbox.checked = vessel.visible;
      checkbox.setAttribute("aria-label", `${vessel.sideName} ${vessel.name} 표시`);
      checkbox.addEventListener("change", () => {
        vessel.visible = checkbox.checked;
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
  vesselLayer.replaceChildren();
  labelLayer.replaceChildren();
  for (const vessel of state.vessels) {
    if (!vessel.visible) continue;
    const d = curvePath(vessel.points);
    const hit = document.createElementNS("http://www.w3.org/2000/svg", "path");
    hit.setAttribute("d", d);
    hit.setAttribute("fill", "none");
    hit.setAttribute("stroke", "transparent");
    hit.setAttribute("stroke-width", String(Math.max(16, strokeWidth(vessel) + 10)));
    hit.dataset.vessel = vessel.id;
    hit.style.cursor = "pointer";
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

    const end = vessel.points[Math.max(0, vessel.points.length - 2)];
    const outward = vessel.side === "rt" ? -1 : 1;
    const stack = { A: -7, B: 0, C: -9, D: 6, E: -12, F: 8, G: 2 }[vessel.code] || 0;
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", String(end.x + outward * 4));
    text.setAttribute("y", String(end.y + stack));
    text.setAttribute("text-anchor", vessel.side === "rt" ? "end" : "start");
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
  if (!vessel || state.mode !== "path" || !vessel.visible) return;
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
  if (vessel) {
    title.textContent = `${vessel.sideName} ${vessel.name}`;
    hint.textContent = "흰 점을 끌어 위치를 옮기고, 노란 핸들로 구부립니다.";
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
    hint.textContent = "왼쪽 체크를 켜면 혈관이 나타납니다. 이름을 누르면 굵기, 색, 굽힘을 바꿉니다.";
  }
  document.querySelector("#mode-path").classList.toggle("active", state.mode === "path");
  document.querySelector("#mode-marker").classList.toggle("active", state.mode === "marker");
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
    if (drag.kind === "anchor") {
      anchor.x = point.x;
      anchor.y = point.y;
    } else {
      anchor.hx = point.x - anchor.x;
      anchor.hy = point.y - anchor.y;
    }
  }
  renderVessels();
  renderMarkers();
  renderHandles();
}

function onPointerUp() {
  if (!drag) return;
  drag = null;
  commit();
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
  vessel.visible = event.target.checked;
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
  vessel.points.splice(state.selectedPoint, 1);
  state.selectedPoint = Math.min(state.selectedPoint, vessel.points.length - 1);
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
