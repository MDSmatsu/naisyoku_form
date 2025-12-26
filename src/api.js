const GAS_URL = import.meta.env.VITE_GAS_URL;
const API_KEY = import.meta.env.VITE_API_KEY;

export async function fetchWorkers() {
  const url = `${GAS_URL}?action=workers&key=${encodeURIComponent(API_KEY)}`;
  const res = await fetch(url);
  const json = await res.json();
  if (!res.ok || !json.ok) throw new Error(json.error || "fetchWorkers failed");
  return json.data;
}

export async function fetchWorks() {
  const url = `${GAS_URL}?action=works&key=${encodeURIComponent(API_KEY)}`;
  const res = await fetch(url);
  const json = await res.json();
  if (!res.ok || !json.ok) throw new Error(json.error || "fetchWorks failed");
  return json.data;
}

export async function addRecord(payload) {
  const res = await fetch(GAS_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" }, // GASの癖でこれが安定
    body: JSON.stringify({
      action: "addRecord",
      key: API_KEY,
      payload,
    }),
  });
  const json = await res.json();
  if (!res.ok || !json.ok) throw new Error(json.error || "addRecord failed");
  return json.data;
}
