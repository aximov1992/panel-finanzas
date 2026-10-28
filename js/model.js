// Cálculos puros (sin DOM). Replican la lógica de las fórmulas de la planilla
// Finanzas_Personales_Ian: Movimientos, Cuotas_Flujo, Dashboard, Historico_Mensual.

const TZ = "America/Argentina/Buenos_Aires";
const ymdFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
});

export function todayYMD(now = new Date()) {
  return ymdFormatter.format(now);
}

// Apps Script manda las fechas como ISO en UTC. Una fecha de planilla es medianoche
// en la zona del script, así que sumando 12 h y tomando el día UTC se recupera la
// fecha correcta sin importar la zona (de UTC-11 a UTC+12).
export function toYMD(v) {
  if (v === "" || v == null) return "";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.trim())) return v.trim();
  const d = new Date(v);
  if (isNaN(d.getTime())) return "";
  return new Date(d.getTime() + 12 * 3600 * 1000).toISOString().slice(0, 10);
}

export function toPeriod(v) {
  if (typeof v === "string" && /^\d{4}-\d{2}$/.test(v.trim())) return v.trim();
  const ymd = toYMD(v);
  return ymd ? ymd.slice(0, 7) : "";
}

function num(v) {
  if (typeof v === "number") return isFinite(v) ? v : 0;
  if (v === "" || v == null) return 0;
  const n = parseFloat(String(v).replace(/\./g, "").replace(",", "."));
  return isFinite(n) ? n : 0;
}

const isEmpty = (v) => v === "" || v == null;
const sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0);

function findRow(values, from, pred) {
  for (let i = from; i < values.length; i++) if (pred(values[i], i)) return i;
  return -1;
}

function parseConfig(values) {
  const cotizacion = num(values[3]?.[2]);
  const actualizacion = toYMD(values[4]?.[2]);

  const hCycles = findRow(values, 0, (r) => String(r[0]).startsWith("Período"));
  const hIncome = findRow(values, hCycles + 1, (r) => String(r[0]).startsWith("Período"));

  const cycles = [];
  if (hCycles >= 0) {
    for (let i = hCycles + 1; i < values.length && !isEmpty(values[i][0]); i++) {
      const p = toPeriod(values[i][0]);
      if (!p) break;
      cycles.push({ period: p, cierre: toYMD(values[i][1]), vto: toYMD(values[i][2]) });
    }
  }

  const ingresos = new Map();
  if (hIncome >= 0) {
    for (let i = hIncome + 1; i < values.length && !isEmpty(values[i][0]); i++) {
      const p = toPeriod(values[i][0]);
      const monto = num(values[i][2]);
      if (p && monto > 0) ingresos.set(p, monto);
    }
  }

  const hLists = findRow(values, 0, (r) => r[0] === "CATEGORÍAS");
  const column = (col) => {
    const out = [];
    if (hLists < 0) return out;
    for (let i = hLists + 1; i < values.length && !isEmpty(values[i][col]); i++) out.push(String(values[i][col]));
    return out;
  };

  return {
    cotizacion, actualizacion, cycles, ingresos,
    categorias: column(0), extras: column(8), medios: column(2), monedas: column(4), estados: column(6),
  };
}

function parsePresupuesto(values) {
  const budget = new Map();
  if (!values) return budget;
  const h = findRow(values, 0, (r) => r[0] === "Categoría");
  if (h < 0) return budget;
  for (let i = h + 1; i < values.length; i++) {
    const name = values[i][0];
    if (isEmpty(name) || name === "TOTAL") break;
    budget.set(String(name), num(values[i][1]));
  }
  return budget;
}

function parseAportes(values) {
  const out = [];
  if (!values) return out;
  for (let i = 3; i < values.length; i++) {
    const fecha = toYMD(values[i][0]);
    if (!fecha) continue;
    out.push({ fecha, monto: num(values[i][1]), destino: String(values[i][2] ?? ""), nota: String(values[i][3] ?? "") });
  }
  return out;
}

function parseImpuestos(values) {
  const out = [];
  if (!values) return out;
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    const fecha = toYMD(r[0]);
    const monto = num(r[3]);
    if (!fecha || !monto) continue;
    out.push({ fecha, origen: String(r[1] ?? ""), tipo: String(r[2] ?? ""), monto, resumen: String(r[4] ?? "") || fecha.slice(0, 7), nota: String(r[5] ?? "") });
  }
  return out;
}

function parseBandeja(values) {
  const out = [];
  if (!values) return out;
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    if (!r[0]) continue;
    const estado = String(r[8] ?? "");
    if (estado !== "pendiente" && estado !== "sin_parsear") continue;
    const recibido = r[1] ? new Date(r[1]) : null;
    out.push({
      id: String(r[0]), recibido: recibido && !isNaN(recibido) ? recibido : null,
      fecha: recibido && !isNaN(recibido) ? ymdFormatter.format(recibido) : "",
      texto: String(r[2] ?? ""), monto: num(r[3]), comercio: String(r[4] ?? ""), medio: String(r[5] ?? ""),
      tarjeta: String(r[6] ?? ""), hora: String(r[7] ?? ""), estado,
    });
  }
  return out.sort((a, b) => (a.recibido?.getTime() ?? 0) - (b.recibido?.getTime() ?? 0));
}

function parseSettings(values) {
  const out = {};
  if (!values) return out;
  for (let i = 1; i < values.length; i++) if (values[i][0]) out[String(values[i][0])] = values[i][1];
  return out;
}

export function buildModel(raw, today = todayYMD()) {
  const cfg = parseConfig(raw.Config.values);
  const { cotizacion: cot, cycles } = cfg;
  const budget = parsePresupuesto(raw.Presupuesto?.values);
  const aportes = parseAportes(raw.Inversiones?.values);
  const impuestos = parseImpuestos(raw.Impuestos?.values);
  const bandeja = parseBandeja(raw.Bandeja?.values);
  const settings = parseSettings(raw.Panel_Config?.values);

  // Movimientos: encabezados en la fila 3, datos desde la fila 4.
  const movs = [];
  for (const r of raw.Movimientos.values.slice(3)) {
    const fecha = toYMD(r[1]);
    if (!fecha) continue;
    const moneda = r[7] || "ARS";
    const monto = num(r[6]);
    const cuotas = Math.max(1, Math.round(num(r[8])) || 1);
    const cft = num(r[9]);
    const esTarjeta = r[5] === "Tarjeta de Crédito";
    // Rank: a qué resumen cae la compra (cantidad de cierres <= fecha, más uno).
    const rank = esTarjeta ? cycles.filter((c) => c.cierre && c.cierre <= fecha).length + 1 : 0;
    movs.push({
      id: r[0], fecha, desc: String(r[2] ?? ""), cat: String(r[3] ?? ""), sub: String(r[4] ?? ""),
      medio: String(r[5] ?? ""), monto, moneda, cuotas, cft, esTarjeta, rank,
      ars: moneda === "USD" ? monto * cot : monto,
      montoCuota: (monto * (1 + cft)) / cuotas,
      estado: String(r[14] ?? ""),
    });
  }

  // Cuotas_Flujo: cada compra con tarjeta aporta su cuota a los resúmenes rank .. rank+cuotas-1.
  const n = cycles.length;
  const flowARS = new Array(n).fill(0);
  const flowUSD = new Array(n).fill(0);
  const flowCat = new Map();
  for (const m of movs) {
    if (!m.esTarjeta) continue;
    for (let k = 0; k < m.cuotas; k++) {
      const i = m.rank - 1 + k;
      if (i < 0 || i >= n) continue;
      if (m.moneda === "USD") flowUSD[i] += m.montoCuota; else flowARS[i] += m.montoCuota;
      if (!flowCat.has(m.cat)) flowCat.set(m.cat, new Array(n).fill(0));
      flowCat.get(m.cat)[i] += m.moneda === "USD" ? m.montoCuota * cot : m.montoCuota;
    }
  }

  const periodIndex = new Map(cycles.map((c, i) => [c.period, i]));
  const cats = [...cfg.categorias, ...cfg.extras];

  function monthSummary(period) {
    const i = periodIndex.get(period);
    const cash = movs.filter((m) => !m.esTarjeta && m.fecha.slice(0, 7) === period);
    const cashTotal = sum(cash, (m) => m.ars);
    const cardTotal = i == null ? 0 : flowARS[i] + flowUSD[i] * cot;
    const byCat = cats.map((c) => {
      const real = sum(cash.filter((m) => m.cat === c), (m) => m.ars) + (i == null ? 0 : flowCat.get(c)?.[i] ?? 0);
      return { cat: c, real, presupuesto: budget.get(c) ?? 0 };
    });
    const ingreso = cfg.ingresos.get(period) ?? 0;
    const aporte = sum(aportes.filter((a) => a.fecha.slice(0, 7) === period), (a) => a.monto);
    const imp = impuestos.filter((x) => x.resumen === period);
    const impTotal = sum(imp, (x) => x.monto);
    const impByTipo = [...imp.reduce((m2, x) => m2.set(x.tipo, (m2.get(x.tipo) ?? 0) + x.monto), new Map())]
      .map(([tipo, monto]) => ({ tipo, monto })).sort((a, b) => b.monto - a.monto);
    const gasto = cashTotal + cardTotal + impTotal;
    return {
      period, gasto, cashTotal, cardTotal, impuestos: impTotal, impuestosPorTipo: impByTipo, byCat, ingreso, aporte,
      tasaAhorro: ingreso > 0 ? aporte / ingreso : null,
      presupuestoTotal: sum(byCat, (x) => x.presupuesto),
    };
  }

  // Próximo vencimiento: primer resumen cuyo vencimiento todavía no pasó.
  const nextIdx = cycles.filter((c) => c.vto && c.vto < today).length; // 0-based
  const next = cycles[nextIdx];
  const nextDue = next ? {
    period: next.period, cierre: next.cierre, vto: next.vto,
    ars: flowARS[nextIdx], usd: flowUSD[nextIdx],
    dias: Math.round((Date.parse(next.vto) - Date.parse(today)) / 86400000),
  } : null;

  const forecast = [];
  for (let i = nextIdx; i < Math.min(n, nextIdx + 12); i++) {
    forecast.push({ period: cycles[i].period, vto: cycles[i].vto, ars: flowARS[i], usd: flowUSD[i] });
  }

  const movsByPeriod = (period) =>
    movs.filter((m) => m.fecha.slice(0, 7) === period).sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : Number(b.id) - Number(a.id)));

  const dates = movs.map((m) => m.fecha).sort();
  const firstPeriod = dates[0]?.slice(0, 7) ?? today.slice(0, 7);

  // Fondo de emergencia: saldo = aportes (menos retiros) con el destino configurado.
  const destinoFondo = String(settings.fondo_destino || "Fondo de emergencia");
  const saldoFondo = sum(aportes.filter((a) => normText(a.destino) === normText(destinoFondo)), (a) => a.monto);
  const closed = [];
  for (let q = shiftPeriod(today.slice(0, 7), -1); q > firstPeriod && closed.length < 3; q = shiftPeriod(q, -1)) {
    const g = monthSummary(q).gasto;
    if (g > 0) closed.push(g);
  }
  const gastoPromedio = closed.length ? sum(closed, (x) => x) / closed.length : 0;
  const metaMeses = num(settings.fondo_meta_meses);
  const metaMonto = num(settings.fondo_meta_monto);
  const objetivo = metaMonto > 0 ? metaMonto : metaMeses > 0 ? metaMeses * gastoPromedio : 0;
  const fondo = {
    destino: destinoFondo, saldo: saldoFondo, metaMeses, metaMonto, gastoPromedio, objetivo,
    cobertura: gastoPromedio > 0 ? saldoFondo / gastoPromedio : null,
    avance: objetivo > 0 ? saldoFondo / objetivo : null,
  };

  return {
    today, cot, cotActualizacion: cfg.actualizacion, cycles, categorias: cats,
    categoriasBase: cfg.categorias, categoriasNuevas: cfg.extras,
    medios: cfg.medios, monedas: cfg.monedas, estados: cfg.estados,
    movs, firstPeriod, nextDue, forecast, monthSummary, movsByPeriod, ingresos: cfg.ingresos,
    impuestos, bandeja, aportes, fondo, settings,
  };
}

function normText(s) {
  return String(s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

// Semáforo igual al de la planilla: compromiso de tarjeta / ingreso del mes.
export function semaforo(compromiso, ingreso) {
  if (!ingreso) return { nivel: "none", texto: "Sin ingreso cargado" };
  const r = compromiso / ingreso;
  if (r < 0.5) return { nivel: "ok", texto: "Margen cómodo", ratio: r };
  if (r <= 0.8) return { nivel: "warn", texto: "Ajustado", ratio: r };
  return { nivel: "bad", texto: "Puede faltar efectivo", ratio: r };
}

export function shiftPeriod(period, delta) {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}
