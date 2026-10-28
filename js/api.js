import { API_URL } from "./config.js";

export class ApiError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

const MENSAJES = {
  unauthorized: "PIN incorrecta.",
  locked: "Demasiados intentos fallidos. Esperá unos 15 minutos y probá de nuevo.",
  script_old: "Falta actualizar el script de la planilla. Los pasos están en el README del repositorio.",
  exception: "El script tuvo un error al procesar el pedido.",
};

// POST como text/plain para evitar el preflight de CORS: Apps Script no responde OPTIONS.
async function post(body) {
  let res;
  try {
    res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body),
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
  if (!data || !data.ok) {
    const code = (data && data.error) || "unknown";
    throw new ApiError(code === "unknown_action" ? "script_old" : code, MENSAJES[code === "unknown_action" ? "script_old" : code] || "Error del script: " + code);
  }
  return data;
}

export const readTab = (tab, pin) => post({ action: "read", tab, pin });

const REQUIRED = ["Config", "Movimientos"];
// Con el script viejo estas hojas no se pueden leer: el panel sigue andando sin ellas.
const OPTIONAL = ["Inversiones", "Presupuesto", "Impuestos", "Bandeja", "Panel_Config"];

export async function readAll(pin) {
  const all = await Promise.all([
    ...REQUIRED.map((t) => readTab(t, pin)),
    ...OPTIONAL.map((t) => readTab(t, pin).catch((e) => {
      if (e instanceof ApiError && (e.code === "tab_not_allowed" || e.code === "tab_not_found")) return { ok: true, tab: t, values: [] };
      throw e;
    })),
  ]);
  return Object.fromEntries([...REQUIRED, ...OPTIONAL].map((t, i) => [t, all[i]]));
}

/** Acciones de escritura. Devuelve la respuesta del script o lanza ApiError. */
export const send = (action, payload, pin) => post({ action, pin, ...payload });
