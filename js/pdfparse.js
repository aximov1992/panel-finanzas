// Lectura de resúmenes del Banco Galicia a partir de líneas de texto (sin dependencias ni DOM).
// Devuelve estructuras simples; qué hacer con cada línea se decide en importplan.js.

const AMT = String.raw`-?\d{1,3}(?:\.\d{3})*,\d{2}`;
const MESES = { ene: 1, jan: 1, feb: 2, mar: 3, abr: 4, apr: 4, may: 5, jun: 6, jul: 7, ago: 8, aug: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12, dec: 12 };

export function toNum(s) {
  return Number(String(s).replace(/\./g, "").replace(",", "."));
}

const ymd = (d, m, y) => `${y.length === 2 ? "20" + y : y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const round2 = (n) => Math.round(n * 100) / 100;

/** Une los trozos de texto que entrega pdf.js (de una página) en líneas, de arriba hacia abajo. */
export function itemsToLines(items) {
  const parts = items
    .filter((it) => typeof it.str === "string" && it.str.trim() !== "")
    .map((it) => ({ s: it.str, x: it.transform[4], y: it.transform[5], w: it.width || 0, h: Math.abs(it.transform[3]) || 10 }))
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  let cur = null;
  for (const p of parts) {
    if (!cur || Math.abs(cur.y - p.y) > 3) {
      cur = { y: p.y, parts: [] };
      lines.push(cur);
    }
    cur.parts.push(p);
  }
  return lines.map((l) => {
    l.parts.sort((a, b) => a.x - b.x);
    let out = "";
    let end = null;
    for (const p of l.parts) {
      if (end != null && p.x - end > p.h * 0.15 && !out.endsWith(" ") && !p.s.startsWith(" ")) out += " ";
      out += p.s;
      end = p.x + p.w;
    }
    return out.replace(/\s+/g, " ").trim();
  });
}

export function detectKind(lines) {
  const head = lines.slice(0, 40).join("\n");
  if (/Resumen de Caja de Ahorro/i.test(head)) return "caja";
  if (/Tarjeta\s+Cr[eé]dito/i.test(head) || /DETALLE DEL CONSUMO/i.test(lines.join("\n"))) return "visa";
  return null;
}

/* ------------------------------ Tarjeta Visa ------------------------------ */

const RE_CONSUMO = new RegExp(String.raw`^(\d{2})-(\d{2})-(\d{2})\s+(?:([*KF])\s+)?(.+?)\s+(?:(\d{2})\/(\d{2})\s+)?(\d{5,6})\s+(${AMT})(?:\s+(${AMT}))?$`);
const RE_LINEA = new RegExp(String.raw`^(\d{2})-(\d{2})-(\d{2})\s+(.+?)\s+(${AMT})$`);
const RE_TOTAL = new RegExp(String.raw`TARJETA\s+(\d{4})\s+Total Consumos.*?(${AMT})(?:\s+(${AMT}))?$`, "i");

export function parseVisa(lines) {
  const out = { tipo: "visa", cierre: null, cierreAnterior: null, vto: null, consumos: [], cargos: [], pagos: [], totales: [], avisos: [] };

  for (const l of lines) {
    const ds = [...l.matchAll(/(\d{2})-([A-Za-z]{3})-(\d{2})/g)];
    if (ds.length >= 4) {
      const f = ds.map((m) => ymd(m[1], MESES[m[2].toLowerCase()] ?? 0, m[3]));
      if (!f.some((x) => x.includes("-00-"))) { out.cierreAnterior = f[0]; out.cierre = f[2]; out.vto = f[3]; break; }
    }
  }
  if (!out.cierre) out.avisos.push("No encontré las fechas de cierre y vencimiento del resumen.");

  let enDetalle = false;
  for (const l of lines) {
    if (/DETALLE DEL CONSUMO/i.test(l)) { enDetalle = true; continue; }
    const tot = l.match(RE_TOTAL);
    if (tot) { out.totales.push({ tarjeta: tot[1], pesos: toNum(tot[2]), usd: tot[3] ? toNum(tot[3]) : 0 }); continue; }
    if (/^TOTAL A PAGAR/i.test(l)) {
      const a = [...l.matchAll(new RegExp(AMT, "g"))].map((m) => toNum(m[0]));
      out.totalAPagar = { pesos: a[0] ?? 0, usd: a[1] ?? 0 };
      continue;
    }
    const c = l.match(RE_CONSUMO);
    if (c && enDetalle) {
      let ref = c[5].trim();
      let moneda = "ARS";
      if (/USD\s+\d[\d.,]*$/.test(ref)) { moneda = "USD"; ref = ref.replace(/\s*USD\s+\d[\d.,]*$/, "").trim(); }
      out.consumos.push({
        fecha: ymd(c[1], c[2], c[3]), ref, moneda, monto: toNum(c[9]),
        cuota: c[6] ? { n: Number(c[6]), de: Number(c[7]) } : null, comprobante: c[8],
      });
      continue;
    }
    const x = l.match(RE_LINEA);
    if (x) {
      const texto = x[4].trim();
      const monto = toNum(x[5]);
      if (/^SU PAGO/i.test(texto)) out.pagos.push({ fecha: ymd(x[1], x[2], x[3]), texto, monto });
      else out.cargos.push({ fecha: ymd(x[1], x[2], x[3]), texto, monto });
    }
  }

  const sumP = round2(out.consumos.filter((c) => c.moneda === "ARS").reduce((s, c) => s + c.monto, 0));
  const sumU = round2(out.consumos.filter((c) => c.moneda === "USD").reduce((s, c) => s + c.monto, 0));
  out.suma = { pesos: sumP, usd: sumU };
  if (out.totales.length) {
    const tp = round2(out.totales.reduce((s, t) => s + t.pesos, 0));
    const tu = round2(out.totales.reduce((s, t) => s + t.usd, 0));
    out.cuadra = Math.abs(tp - sumP) < 0.02 && Math.abs(tu - sumU) < 0.02;
    out.totalConsumos = { pesos: tp, usd: tu };
  } else {
    out.cuadra = false;
    out.avisos.push("No encontré el total de consumos para verificar la lectura.");
  }
  return out;
}

/* ----------------------------- Caja de ahorro ----------------------------- */

const RE_MOV = /^(\d{2})\/(\d{2})\/(\d{2})\s+(.*)$/;
const RE_DOS = new RegExp(String.raw`^(.*?)\s*(${AMT})\s+(${AMT})$`);
const RUIDO = [/^Fecha\s+Descripci[oó]n/i, /^Resumen de Caja de Ahorro/i, /^\d{12,}[A-Z]?$/, /^P[aá]gina\s/i];

export function parseCaja(lines) {
  const out = { tipo: "caja", movs: [], avisos: [] };
  let cur = null;
  let fin = false;
  for (const l of lines) {
    if (fin) break;
    if (/^Total\s+\$/.test(l)) {
      const a = [...l.matchAll(/-?\$?\s?(\d{1,3}(?:\.\d{3})*,\d{2})/g)].map((m) => toNum(m[1]));
      out.totales = { credito: a[0] ?? 0, debito: a[1] ?? 0, saldo: a[2] ?? 0 };
      fin = true;
      continue;
    }
    if (RUIDO.some((r) => r.test(l))) continue;
    const m = l.match(RE_MOV);
    if (m) {
      const rest = m[4];
      const d = rest.match(RE_DOS);
      if (!d) { out.avisos.push("Línea de movimiento que no pude leer: " + l); cur = null; continue; }
      let desc = d[1].trim();
      let origen = "";
      const o = desc.match(/^(.*?)\s+(\d{4})$/);
      if (o) { desc = o[1]; origen = o[2]; }
      cur = { fecha: ymd(m[1], m[2], m[3]), desc, origen, monto: toNum(d[2]), saldo: toNum(d[3]), detalle: [] };
      out.movs.push(cur);
      continue;
    }
    if (cur && !/^\d{8,}$/.test(l)) cur.detalle.push(l);
  }

  // Verificación: cada saldo tiene que ser el anterior más el movimiento, y el último el que informa el banco.
  let ok = out.movs.length > 0;
  for (let i = 1; i < out.movs.length; i++) {
    if (Math.abs(out.movs[i - 1].saldo + out.movs[i].monto - out.movs[i].saldo) > 0.02) { ok = false; out.avisos.push(`El saldo no cierra en el movimiento del ${out.movs[i].fecha}.`); break; }
  }
  if (out.totales && out.movs.length && Math.abs(out.movs.at(-1).saldo - out.totales.saldo) > 0.02) ok = false;
  if (!out.totales) out.avisos.push("No encontré el total del extracto para verificar la lectura.");
  out.cuadra = ok && !!out.totales;
  return out;
}

export function parseLines(lines) {
  const kind = detectKind(lines);
  if (kind === "visa") return parseVisa(lines);
  if (kind === "caja") return parseCaja(lines);
  return null;
}
