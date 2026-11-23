// Arma el plan de importación: qué hacer con cada línea de los resúmenes, comparando con la planilla.
// Función pura: recibe lo leído de los PDF, el modelo del panel y el sugeridor de categorías.
import { prettyMerchant } from "./util.js";

const DAY = 86400000;
const t = (s) => Date.parse(s + "T00:00:00Z");
const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const cents = (n) => Math.round(n * 100) / 100;
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export const periodoTexto = (p) => `${MESES[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`;

export function tipoImpuesto(texto) {
  const x = String(texto).toUpperCase();
  if (/IIBB/.test(x)) return /CABA/.test(x) ? "IIBB percepción CABA" : "IIBB percepción";
  if (/IVA/.test(x)) return /RG\s*(\d{4})/.test(x) ? `IVA RG ${x.match(/RG\s*(\d{4})/)[1]}` : "IVA";
  if (/RG\s*(\d{4})/.test(x)) return `Percepción RG ${x.match(/RG\s*(\d{4})/)[1]}`;
  if (/SELLOS/.test(x)) return "Sellos";
  if (/25\.?413|D[EÉ]B.*CR[EÉ]D|IMP.*D[EÉ]B/.test(x)) return "Impuesto a los débitos y créditos";
  return "Otro impuesto";
}
const esImpuesto = (texto) => /IIBB|IVA|PERCEP|RG\s*\d{4}|IMP\.|IMPUESTO|SELLOS|DB\.RG|25\.?413/i.test(texto);

export function buildPlan(docs, model, suggest) {
  const rows = [];
  const avisos = [];
  const infoDocs = [];
  let seq = 0;
  const add = (r) => { rows.push({ id: "r" + ++seq, selected: false, ...r }); return rows.at(-1); };

  const catOk = (c) => (model.categorias.includes(c) ? c : model.categorias.includes("Otros/Imprevistos") ? "Otros/Imprevistos" : model.categorias[0]);
  const medio = (n) => (model.medios.includes(n) ? n : model.medios[0]);
  const estadoDe = (m) => (m === "Tarjeta de Crédito" && model.estados.includes("Pendiente") ? "Pendiente" : model.estados.includes("Pagado") ? "Pagado" : model.estados[0]);

  // Compras de la planilla disponibles para emparejar (cada una se usa una sola vez).
  const pool = model.movs.map((m) => ({ m, used: false }));
  const take = (pred, prefer) => {
    const c = pool.filter((p) => !p.used && pred(p.m));
    if (!c.length) return null;
    c.sort((a, b) => prefer(a.m) - prefer(b.m));
    c[0].used = true;
    return c[0].m;
  };
  const dist = (a, b) => Math.abs(t(a) - t(b)) / DAY;

  const clasifica = (texto, medioDef) => {
    const s = suggest ? suggest(texto) : null;
    if (s && model.categorias.includes(s.cat)) return { cat: s.cat, sub: s.sub, medio: medioDef, sugerido: true };
    return { cat: catOk("Otros/Imprevistos"), sub: "Sin identificar", medio: medioDef, sugerido: false };
  };

  for (const doc of docs) {
    if (doc.tipo === "visa") planVisa(doc);
    else if (doc.tipo === "caja") planCaja(doc);
  }

  /* ----------------------------- Visa ----------------------------- */
  function planVisa(doc) {
    const cycle = model.cycles.find((c) => c.cierre === doc.cierre);
    const period = cycle ? cycle.period : doc.cierre ? doc.cierre.slice(0, 7) : null;
    infoDocs.push({
      fuente: "visa", titulo: `Visa · resumen de ${period ? periodoTexto(period) : "?"}`, cuadra: doc.cuadra,
      detalle: `${doc.consumos.length} consumos · cierre ${doc.cierre ?? "?"} · vence ${doc.vto ?? "?"}`, avisos: doc.avisos,
    });
    if (!doc.cuadra) avisos.push("Visa: la suma de los consumos no coincide con el total del resumen. Revisá antes de importar.");
    if (!cycle) avisos.push(`Visa: el cierre ${doc.cierre} no está en la lista de resúmenes de tu planilla (Config).`);

    const tarjetaMovs = (m) => m.esTarjeta;
    for (const c of doc.consumos) {
      const base = { fuente: "visa", fecha: c.fecha, moneda: c.moneda, texto: prettyMerchant(c.ref), monto: c.monto, cuota: c.cuota };
      const near = (m) => dist(m.fecha, c.fecha);
      if (c.cuota) {
        const tol = Math.max(1, c.monto * 0.01);
        const ok = take((m) => tarjetaMovs(m) && m.moneda === c.moneda && near(m) <= 1 && m.cuotas === c.cuota.de && Math.abs(m.montoCuota - c.monto) <= tol, near);
        if (ok) { add({ ...base, kind: "mov", estado: "existe", motivo: `Cuota ${c.cuota.n}/${c.cuota.de} · ya está cargada` }); continue; }
        // Misma fecha y comercio, pero cuotas o importe distintos: la planilla y el resumen no coinciden.
        const core = norm(c.ref.replace(/^[A-Z]+\*/, "")).slice(0, 6);
        const raro = take((m) => tarjetaMovs(m) && m.moneda === c.moneda && near(m) <= 1 && core && norm(m.desc).includes(core), near);
        if (raro) {
          add({ ...base, kind: "mov", estado: "difiere", motivo: `En la planilla: ${raro.cuotas} cuotas de ${fmt(raro.montoCuota)}. El resumen dice cuota ${c.cuota.n}/${c.cuota.de} de ${fmt(c.monto)}. Corregilo en la planilla.` });
          continue;
        }
      } else {
        const ok = take((m) => tarjetaMovs(m) && m.moneda === c.moneda && m.cuotas === 1 && near(m) <= 1 && Math.abs(m.monto - c.monto) < 0.02, near);
        if (ok) { add({ ...base, kind: "mov", estado: "existe", motivo: "Ya está cargado" }); continue; }
      }
      // No está en la planilla.
      const cl = clasifica(c.ref, "Tarjeta de Crédito");
      const cuotas = c.cuota ? c.cuota.de : 1;
      const nueva = !c.cuota || c.cuota.n === 1;
      add({
        ...base, kind: "mov", estado: nueva ? "nuevo" : "revisar", selected: nueva,
        motivo: c.cuota && !nueva ? `Cuota ${c.cuota.n}/${c.cuota.de} de una compra anterior que no está en la planilla. Se cargaría con la fecha original.`
          : cl.sugerido ? "Categoría sugerida por tu historial" : "Sin categoría sugerida: elegila",
        mov: { fecha: c.fecha, desc: prettyMerchant(c.ref), cat: cl.cat, sub: cl.sub, medio: medio("Tarjeta de Crédito"), monto: cents(c.monto * cuotas), moneda: c.moneda, cuotas, estado: estadoDe("Tarjeta de Crédito") },
        sinCategoria: !cl.sugerido,
        nota: c.cuota ? `Monto estimado: ${cuotas} × ${fmt(c.monto)} (sin interés separado).` : "",
      });
    }

    for (const p of doc.pagos) add({ fuente: "visa", kind: "ignorar", estado: "ignorado", fecha: p.fecha, moneda: /USD/i.test(p.texto) ? "USD" : "ARS", texto: p.texto, monto: p.monto, motivo: "Pago del resumen anterior" });

    for (const c of doc.cargos) {
      if (esImpuesto(c.texto)) {
        const tipo = tipoImpuesto(c.texto);
        const key = (x) => [x.fecha, norm("Visa"), norm(tipo), cents(x.monto).toFixed(2)].join("|");
        const dup = model.impuestos.some((x) => key({ fecha: x.fecha, monto: x.monto }) === key(c) && norm(x.origen) === norm("Visa") && norm(x.tipo) === norm(tipo));
        add({
          fuente: "visa", kind: "impuesto", fecha: c.fecha, moneda: "ARS", texto: tipo, nota: c.texto.replace(/\s+/g, " "), monto: c.monto,
          estado: dup ? "existe" : "nuevo", selected: !dup, motivo: dup ? "Ya está cargado" : `Resumen de ${period ? periodoTexto(period) : "?"}`,
          imp: { fecha: c.fecha, origen: "Visa", tipo, monto: c.monto, resumen: period ?? c.fecha.slice(0, 7), nota: c.texto.replace(/\s+/g, " ") },
        });
      } else {
        const cl = clasifica(c.texto, "Tarjeta de Crédito");
        add({
          fuente: "visa", kind: "mov", fecha: c.fecha, moneda: "ARS", texto: c.texto, monto: c.monto, estado: "revisar",
          motivo: "Cargo del banco que no reconozco. Si lo cargás va con la fecha del cierre, que cae en el resumen siguiente.",
          mov: { fecha: c.fecha, desc: prettyMerchant(c.texto), cat: cl.cat, sub: cl.sub, medio: medio("Tarjeta de Crédito"), monto: c.monto, moneda: "ARS", cuotas: 1, estado: estadoDe("Tarjeta de Crédito") },
        });
      }
    }

    // Compras de la planilla dentro de este resumen que el resumen no trae.
    if (doc.cierreAnterior && doc.cierre) {
      const faltan = pool.filter((p) => !p.used && p.m.esTarjeta && p.m.fecha > doc.cierreAnterior && p.m.fecha <= doc.cierre);
      for (const f of faltan) {
        add({ fuente: "visa", kind: "ignorar", estado: "sobra", fecha: f.m.fecha, moneda: f.m.moneda, texto: f.m.desc, monto: f.m.monto, motivo: "Está en la planilla pero no aparece en este resumen. Revisá si está bien cargada." });
      }
    }
  }

  /* ------------------------- Caja de ahorro ------------------------- */
  function planCaja(doc) {
    const per = doc.movs.length ? `${doc.movs[0].fecha} al ${doc.movs.at(-1).fecha}` : "";
    infoDocs.push({ fuente: "caja", titulo: "Caja de ahorro", cuadra: doc.cuadra, detalle: `${doc.movs.length} movimientos · ${per}`, avisos: doc.avisos });
    if (!doc.cuadra) avisos.push("Caja de ahorro: los saldos no cierran con el extracto. Revisá antes de importar.");

    const items = doc.movs.map((m) => ({ m, d: m.desc.toUpperCase(), det: m.detalle.join(" ").replace(/\s+/g, " ").trim(), done: false }));
    const pairs = (a, b) => {
      for (const x of items.filter((i) => !i.done && a(i))) {
        const y = items.find((i) => !i.done && i !== x && b(i) && Math.abs(i.m.monto + x.m.monto) < 0.02 && dist(i.m.fecha, x.m.fecha) <= 1);
        if (y) { x.done = y.done = true; x.pair = y.pair = true; }
      }
    };
    pairs((i) => /^DEV\.?\s*COMPRA/.test(i.d), (i) => /^COMPRA DEBITO/.test(i.d));
    pairs((i) => /^ANULACION PERCEPCION/.test(i.d), (i) => /^PERCEPCION/.test(i.d));
    // Un reintegro de promoción se resta de la compra que lo originó (así lo carga la planilla: neto).
    for (const r of items.filter((x) => !x.done && /^REINTEGRO PROMOCION/.test(x.d))) {
      const tienda = norm(r.m.detalle.at(-1) ?? "");
      const ratio = (c) => r.m.monto / -c.m.monto;
      const cand = items
        .filter((c) => !c.done && !c.neto && /^COMPRA DEBITO/.test(c.d) && c.m.fecha === r.m.fecha && -c.m.monto > r.m.monto && tienda.includes(norm(c.m.detalle[0] ?? "").slice(0, 6)))
        .sort((a, b) => dev(ratio(a)) - dev(ratio(b)))[0];
      if (cand) { cand.neto = r.m.monto; r.done = true; }
    }
    for (const i of items.filter((x) => x.pair)) {
      add({ fuente: "caja", kind: "ignorar", estado: "ignorado", fecha: i.m.fecha, moneda: "ARS", texto: `${i.m.desc} ${i.m.detalle[0] ?? ""}`.trim(), monto: i.m.monto, motivo: "Se anula con otro movimiento del mismo importe" });
    }

    const haberes = new Map();
    for (const i of items.filter((x) => !x.done)) {
      const { m, d, det } = i;
      const base = { fuente: "caja", fecha: m.fecha, moneda: "ARS", monto: m.monto };
      const ign = (motivo) => add({ ...base, kind: "ignorar", estado: "ignorado", texto: `${m.desc} ${m.detalle[0] ?? ""}`.trim(), motivo });

      if (/^ACREDITAMIENTO DE HABERES/.test(d)) { const k = m.fecha.slice(0, 7); (haberes.get(k) ?? haberes.set(k, []).get(k)).push(m); continue; }
      if (/^PAGO TARJETA/.test(d)) { ign("Pago del resumen de la tarjeta"); continue; }
      if (/^COMPRA VENTA DE D/.test(d)) { ign("Compra de dólares: no es un gasto"); continue; }
      if (/^TRANSFERENCIA DE CUENTA/.test(d) && /PROPIA/.test(`${d} ${det}`)) { ign("Transferencia entre cuentas propias"); continue; }
      if (/^INTERES/.test(d)) { ign("Interés ganado de la cuenta"); continue; }

      if (/^PERCEPCION|^ANULACION PERCEPCION|LEY 25\.?413|IMP.*(DEB|CRED)|^IVA|SELLOS/.test(d)) {
        const tipo = tipoImpuesto(m.desc);
        const monto = -m.monto; // un débito de -303,91 es un impuesto de 303,91
        const dup = model.impuestos.some((x) => x.fecha === m.fecha && norm(x.origen) === norm("Caja de ahorro") && norm(x.tipo) === norm(tipo) && Math.abs(x.monto - monto) < 0.02);
        add({ ...base, kind: "impuesto", texto: tipo, nota: m.desc, monto, estado: dup ? "existe" : "nuevo", selected: !dup, motivo: dup ? "Ya está cargado" : "Impuesto de la caja de ahorro",
          imp: { fecha: m.fecha, origen: "Caja de ahorro", tipo, monto, resumen: m.fecha.slice(0, 7), nota: m.desc } });
        continue;
      }

      let comercio = m.detalle[0] ?? m.desc;
      let medioNombre = "Débito";
      let desc = prettyMerchant(comercio);
      let confiable = false;
      let monto = m.monto;
      let sugerirDe = comercio;
      let extra = "";

      if (/^COMPRA DEBITO/.test(d)) { confiable = true; }
      else if (/^PAGO DE SERVICIOS/.test(d)) { confiable = true; medioNombre = "Débito"; }
      else if (/^PAGO CON TRANSFERENCIA/.test(d)) { medioNombre = "Transferencia"; desc = prettyMerchant(comercio); }
      else if (/^TRANSFERENCIA A TERCEROS/.test(d)) { medioNombre = "Transferencia"; desc = `Transferencia a ${prettyMerchant(comercio)}`; sugerirDe = det; extra = " Transferencia a una persona: elegí si es un gasto."; }
      else if (/^REINTEGRO PROMOCION/.test(d)) { desc = `Reintegro promoción Galicia · ${m.detalle.at(-1) ?? ""}`.trim(); sugerirDe = m.detalle.at(-1) ?? ""; medioNombre = "Débito"; confiable = true; }
      else if (/^TRANSFERENCIA DE TERCEROS/.test(d)) {
        if (/BALANZ/.test(det)) {
          const dest = model.aportes.map((a) => a.destino).find((x) => /balanz/i.test(x)) ?? "Balanz";
          add({ ...base, kind: "inversion", texto: `Retiro de inversión · ${prettyMerchant(m.detalle[0] ?? "Balanz")}`, monto: -m.monto, estado: "nuevo", selected: true, motivo: "Se carga como retiro de Inversiones",
            aporte: { fecha: m.fecha, monto: -m.monto, destino: dest, nota: "Retiro (desde resumen de caja)" } });
          continue;
        }
        // Dinero que te mandó una persona: se carga en negativo para que compense el gasto.
        const dup = poolTake(m.fecha, m.monto * -1, "Transferencia");
        add({ ...base, kind: "mov", texto: `Reintegro recibido · ${prettyMerchant(comercio)}`, monto: -m.monto,
          estado: dup ? "existe" : "nuevo", selected: !dup, motivo: dup ? "Ya está cargado" : "Dinero recibido de una persona: se carga como reintegro en negativo",
          mov: { fecha: m.fecha, desc: `Reintegro recibido · ${prettyMerchant(comercio)}`, cat: catOk("Otros/Imprevistos"), sub: "Reintegro recibido", medio: medio("Transferencia"), monto: -m.monto, moneda: "ARS", cuotas: 1, estado: estadoDe("Transferencia") } });
        continue;
      }
      else { // algo desconocido
        const cl = clasifica(det || m.desc, "Débito");
        add({ ...base, kind: "mov", texto: `${m.desc} ${m.detalle[0] ?? ""}`.trim(), monto: -m.monto, estado: "revisar", motivo: "Movimiento que no reconozco",
          mov: { fecha: m.fecha, desc: `REVISAR – ${prettyMerchant(comercio)}`, cat: cl.cat, sub: cl.sub, medio: medio("Débito"), monto: -m.monto, moneda: "ARS", cuotas: 1, estado: estadoDe("Débito") } });
        continue;
      }

      if (i.neto) { monto = m.monto + i.neto; desc += " (neto reintegro)"; extra += ` Incluye el reintegro de ${fmt(i.neto)}.`; }
      // Gasto (o reintegro) de la caja: el importe de la planilla va positivo para gastos.
      const gasto = -monto;
      const existente = poolTake(m.fecha, gasto, medioNombre);
      const cl = clasifica(sugerirDe, medioNombre);
      const selected = !existente && (confiable || cl.sugerido) && !/^TRANSFERENCIA A TERCEROS/.test(d);
      add({
        ...base, kind: "mov", texto: desc, monto: gasto,
        estado: existente ? "existe" : selected ? "nuevo" : "revisar", selected,
        motivo: existente ? "Ya está cargado" : (cl.sugerido ? "Categoría sugerida por tu historial." : "Sin categoría sugerida: elegila.") + extra,
        sinCategoria: !existente && !cl.sugerido,
        mov: { fecha: m.fecha, desc, cat: cl.cat, sub: cl.sub, medio: medio(medioNombre), monto: gasto, moneda: "ARS", cuotas: 1, estado: estadoDe(medioNombre) },
      });
    }

    for (const [k, list] of haberes) {
      const total = cents(list.reduce((s, x) => s + x.monto, 0));
      const actual = model.ingresos.get(k);
      const igual = actual != null && Math.abs(actual - total) < 0.5;
      add({
        fuente: "caja", kind: "ingreso", fecha: list[0].fecha, moneda: "ARS", monto: total,
        texto: `Sueldo de ${periodoTexto(k)} (${list.length} acreditaciones)`,
        estado: igual ? "existe" : actual ? "difiere" : "nuevo", selected: !igual,
        motivo: igual ? "Ya está cargado" : actual ? `En la planilla hay ${fmt(actual)}. Se reemplazaría por la suma de las acreditaciones.` : "Se carga como ingreso del mes",
        ingreso: { period: k, fecha: list[0].fecha, monto: total },
      });
    }
  }

  function poolTake(fecha, monto, medioNombre) {
    return take((m) => !m.esTarjeta && m.moneda === "ARS" && Math.abs(m.monto - monto) < 0.02 && dist(m.fecha, fecha) <= 1, (m) => dist(m.fecha, fecha) + (m.medio === medioNombre ? 0 : 0.5));
  }

  rows.sort((a, b) => (a.fuente === b.fuente ? (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0) : a.fuente < b.fuente ? 1 : -1));
  return { rows, avisos, docs: infoDocs };
}

const dev = (r) => Math.min(...[0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5].map((x) => Math.abs(r - x)));
const fmt = (n) => "$ " + Math.round(n).toLocaleString("es-AR");

/** Convierte las filas elegidas en los pedidos que entiende el script. */
export function planToRequests(rows) {
  const sel = rows.filter((r) => r.selected && r.estado !== "existe" && r.estado !== "ignorado");
  return {
    movs: sel.filter((r) => r.kind === "mov" && r.mov).map((r) => r.mov),
    impuestos: sel.filter((r) => r.kind === "impuesto").map((r) => r.imp),
    ingresos: sel.filter((r) => r.kind === "ingreso").map((r) => r.ingreso),
    aportes: sel.filter((r) => r.kind === "inversion").map((r) => r.aporte),
  };
}
