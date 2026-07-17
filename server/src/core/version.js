// Semantic-ish minor version bump, shared by the service and (mirrored in)
// the front-end. "1.2" -> "1.3", missing/garbage -> "1.0".
export function bumpVersion(v) {
  const m = String(v ?? "").match(/^(\d+)\.(\d+)/);
  if (!m) return "1.0";
  return `${m[1]}.${Number(m[2]) + 1}`;
}
