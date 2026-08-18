// Pure helpers for the RSVP endpoint. Kept dependency-free and runtime-agnostic
// so bun test can exercise them directly.

export function validEmail(s) {
  return typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
}

export function cleanDisplayName(s) {
  return String(s || "").replace(/[<>]/g, "").trim().slice(0, 40);
}

// Known emails show their poker handle; unknown ones show what they typed,
// falling back to the email local-part. Never the full email.
export function resolveDisplay(email, providedName, rosterRows) {
  const hit = rosterRows.find(r => r.email.toLowerCase() === String(email).toLowerCase());
  if (hit) return hit.handle;
  const cleaned = cleanDisplayName(providedName);
  return cleaned || String(email).split("@")[0];
}
