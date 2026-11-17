const KEY = "uddang-vessel-map-v11";

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.vessels)) return null;
    return data;
  } catch {
    return null;
  }
}

export function saveState(state) {
  const payload = {
    vessels: state.vessels,
    markers: state.markers,
    background: state.background,
  };
  localStorage.setItem(KEY, JSON.stringify(payload));
}

export function clearState() {
  localStorage.removeItem(KEY);
}
