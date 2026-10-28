// Utilidades puras para los formularios.

/** Interpreta montos escritos a la argentina: "6.200", "6200,50", "1.234.567,89". */
export function parseAmount(input) {
  let s = String(input ?? "").trim().replace(/[^\d.,-]/g, "");
  if (!s) return NaN;
  const neg = s.startsWith("-");
  s = s.replace(/-/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s);
  return isFinite(n) ? (neg ? -n : n) : NaN;
}

/** Nombres en MAYÚSCULAS del banco a "Mayúsculas Iniciales". Lo que ya tiene minúsculas no se toca. */
export function prettyMerchant(text) {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!t || t !== t.toUpperCase()) return t;
  return t.toLowerCase().replace(/(^|[\s*(\-])([a-záéíóúñ])/g, (_, a, b) => a + b.toUpperCase());
}

/** Compra parecida ya cargada: misma moneda, mismo monto (o de cuota) y fecha a no más de un día. */
export function findSimilar(movs, { fecha, monto, moneda, cuotas = 1 }) {
  const day = (s) => Date.parse(s + "T00:00:00Z");
  const per = cuotas > 1 ? monto / cuotas : monto;
  return movs.find((m) => {
    if (m.moneda !== moneda) return false;
    if (Math.abs(day(m.fecha) - day(fecha)) > 86400000) return false;
    const mPer = m.cuotas > 1 ? m.monto / m.cuotas : m.monto;
    return Math.abs(m.monto - monto) < 0.02 || Math.abs(mPer - monto) < 0.02 || Math.abs(m.monto - per) < 0.02;
  }) ?? null;
}

/** Resumen de tarjeta al que pertenece un impuesto: el primero que cierra en esa fecha o después. */
export function resumenDeImpuesto(fecha, cycles) {
  const c = cycles.find((x) => x.cierre && x.cierre >= fecha);
  return c ? c.period : fecha.slice(0, 7);
}

/** Estado inicial sugerido: lo de tarjeta queda pendiente hasta pagar el resumen. */
export function estadoInicial(medio) {
  return medio === "Tarjeta de Crédito" ? "Pendiente" : "Pagado";
}

export const ERRORES = {
  fecha: "La fecha no es válida.",
  monto: "El monto no es válido.",
  descripcion: "Falta la descripción.",
  categoria: "Elegí una categoría.",
  medio: "Elegí el medio de pago.",
  moneda: "Elegí la moneda.",
  estado: "Elegí el estado.",
  cuotas: "La cantidad de cuotas no es válida.",
  cuotas_sin_tarjeta: "Las cuotas solo aplican a tarjeta de crédito.",
  cft: "El interés no es válido.",
  tipo: "Falta el tipo de impuesto.",
  origen: "Falta el origen.",
  resumen: "El resumen no es válido.",
  destino: "Falta el destino.",
  nombre: "El nombre no es válido.",
  ya_existe: "Esa categoría ya existe.",
  period_not_listed: "Ese mes no está en la lista de ingresos de Config.",
  inversiones_full: "La hoja Inversiones no tiene más filas libres.",
  bandeja_llena: "La bandeja está llena.",
  ya_resuelto: "Ese movimiento ya se resolvió.",
  id_no_encontrado: "No encontré ese movimiento en la bandeja.",
  no_se_pudo_cargar: "No se pudo cargar. Revisá los datos.",
  value: "El valor no es válido.",
};
