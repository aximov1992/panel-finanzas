import { API_URL } from "./config.js";

export class ApiError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

// POST con text/plain para evitar el preflight de CORS (Apps Script no responde OPTIONS).
export async function readTab(tab, pin) {
  let res;
  try {
    res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "read", tab, pin }),
      redirect: "follow",
    });
  } catch {
    throw new ApiError("network", "No se pudo conectar con la planilla. Revisá tu conexión.");
  }
  let data;
  try {
    data = await res.json();
  } catch {
    throw new ApiError("bad_response", "La planilla respondió algo que no se pudo leer.");
  }
  if (!data || !data.ok) throw new ApiError((data && data.error) || "unknown", "Error del script: " + ((data && data.error) || "desconocido"));
  return data;
}

const TABS = ["Config", "Movimientos", "Inversiones", "Presupuesto"];

export async function readAll(pin) {
  const results = await Promise.all(TABS.map((t) => readTab(t, pin)));
  return Object.fromEntries(TABS.map((t, i) => [t, results[i]]));
}
