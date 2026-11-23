// Importador de resúmenes en PDF: los lee en el dispositivo, muestra una vista previa y carga lo elegido.
import { send, ApiError } from "./api.js";
import { itemsToLines, parseLines } from "./pdfparse.js";
import { buildPlan, planToRequests } from "./importplan.js";
import { ars, usd, day, esc } from "./fmt.js";
import { ERRORES } from "./util.js";

let ctx = null; // { state, reload, toast }
let dlg = null;
let plan = null;
let pdfjsP = null;

export function initImporter(context) {
  ctx = context;
  dlg = document.createElement("dialog");
  dlg.id = "dlg-import";
  dlg.className = "sheet";
  dlg.setAttribute("aria-label", "Importar PDF");
  document.body.append(dlg);
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg) dlg.close();
    if (e.target.closest("[data-imp='close']")) dlg.close();
    if (e.target.closest("[data-imp='run']")) run();
  });
  dlg.addEventListener("change", onChange);
}

const KIND = { mov: "Gasto", impuesto: "Impuesto", ingreso: "Ingreso", inversion: "Inversión" };
const money = (r) => (r.moneda === "USD" ? usd(r.monto) : ars(r.monto));
const body = () => dlg.querySelector("#imp-body");

export function openImport() {
  plan = null;
  dlg.innerHTML = `
    <div class="dlg-in">
      <div class="dlg-head"><h2>Importar resumen</h2><button class="icon-btn" type="button" data-imp="close" aria-label="Cerrar">×</button></div>
      <div class="dlg-body" id="imp-body">
        <p class="hint">Elegí el PDF del resumen de la Visa y/o el extracto de la caja de ahorro del Galicia. El archivo se lee en tu dispositivo: no se sube a ningún lado. Solo se envían a tu planilla las filas que confirmes.</p>
        <div class="file-pick">
          <input id="imp-file" type="file" accept="application/pdf,.pdf" multiple aria-label="Elegir PDF">
        </div>
        <div class="error" id="imp-err" role="alert"></div>
      </div>
    </div>`;
  dlg.querySelector("#imp-file").addEventListener("change", (e) => onFiles([...e.target.files]));
  dlg.showModal();
}

async function loadPdfjs() {
  if (!pdfjsP) {
    pdfjsP = import("../vendor/pdfjs/pdf.min.mjs").then((m) => {
      m.GlobalWorkerOptions.workerSrc = new URL("../vendor/pdfjs/pdf.worker.min.mjs", import.meta.url).href;
      return m;
    });
  }
  return pdfjsP;
}

async function readLines(file) {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    lines.push(...itemsToLines((await page.getTextContent()).items));
  }
  return lines;
}

async function onFiles(files) {
  const err = dlg.querySelector("#imp-err");
  err.textContent = "";
  if (!files.length) return;
  body().insertAdjacentHTML("beforeend", `<p class="muted" id="imp-wait">Leyendo ${files.length > 1 ? "los archivos" : "el archivo"}…</p>`);
  const docs = [];
  try {
    for (const f of files) {
      let parsed;
      try {
        parsed = parseLines(await readLines(f));
      } catch (e) {
        if (e && e.name === "PasswordException") throw new Error(`“${f.name}” tiene contraseña. Abrilo y guardalo sin contraseña.`);
        throw new Error(`No pude abrir “${f.name}”.`);
      }
      if (!parsed) throw new Error(`No reconozco “${f.name}”. Funciona con el resumen de la Visa y el extracto de la caja de ahorro del Galicia.`);
      docs.push(parsed);
    }
  } catch (e) {
    dlg.querySelector("#imp-wait")?.remove();
    err.textContent = e.message;
    return;
  }
  plan = buildPlan(docs, ctx.state.model, ctx.state.suggest);
  render();
}

const importable = (r) => r.estado !== "existe" && r.estado !== "ignorado" && r.estado !== "sobra" && !!(r.mov || r.imp || r.ingreso || r.aporte);

function rowHtml(r) {
  const can = importable(r);
  const cats = ctx.state.model.categorias;
  const sel = can && r.kind === "mov" && r.mov
    ? `<select data-cat="${r.id}" aria-label="Categoría">${cats.map((c) => `<option${c === r.mov.cat ? " selected" : ""}>${esc(c)}</option>`).join("")}</select>` : "";
  const cuota = r.cuota ? ` · cuota ${r.cuota.n}/${r.cuota.de}` : "";
  return `
    <label class="imp-row">
      <input type="checkbox" data-sel="${r.id}" ${r.selected ? "checked" : ""} ${can ? "" : "disabled"}>
      <span class="imp-top"><span class="imp-t" title="${esc(r.texto)}">${esc(r.texto)}</span><span class="imp-a">${money(r)}</span></span>
      <span class="imp-m"><span class="chip-k">${r.fuente === "visa" ? "Visa" : "Caja"} · ${KIND[r.kind] ?? "Ignorado"}</span>${day(r.fecha)}${cuota} · ${esc(r.motivo)}${r.nota ? " " + esc(r.nota) : ""}</span>
      ${sel}
    </label>`;
}

function render() {
  const nuevos = plan.rows.filter((r) => importable(r));
  const revisar = plan.rows.filter((r) => (r.estado === "difiere" || r.estado === "sobra") && !importable(r));
  const resto = plan.rows.filter((r) => !importable(r) && !revisar.includes(r));
  const docs = plan.docs.map((d) => `
    <div class="imp-doc"><strong>${esc(d.titulo)}</strong><br>
      <span class="${d.cuadra ? "ok" : "no"}">${d.cuadra ? "✓ La lectura coincide con los totales del banco" : "⚠ No coincide con los totales del banco"}</span>
      · ${esc(d.detalle)}${d.avisos.map((a) => `<br><span class="no">${esc(a)}</span>`).join("")}
    </div>`).join("");
  const avisos = plan.avisos.map((a) => `<p class="error">${esc(a)}</p>`).join("");
  body().innerHTML = `
    ${docs}${avisos}
    ${nuevos.length ? `<div class="imp-sec"><h3>Para importar (${nuevos.length})</h3>${nuevos.map(rowHtml).join("")}</div>`
      : `<p class="muted">No hay nada nuevo para importar: todo lo de estos resúmenes ya está en tu planilla.</p>`}
    ${revisar.length ? `<div class="imp-sec"><h3>Para revisar en la planilla (${revisar.length})</h3>${revisar.map(rowHtml).join("")}</div>` : ""}
    ${resto.length ? `<details class="imp-more"><summary>Ya cargado o ignorado (${resto.length})</summary>${resto.map(rowHtml).join("")}</details>` : ""}
    <div class="imp-foot">
      <div class="error" id="imp-err" role="alert"></div>
      <button class="btn primary" type="button" data-imp="run" id="imp-run"></button>
      <button class="btn" type="button" data-imp="close">Cancelar</button>
    </div>`;
  updateButton();
}

function count() {
  const q = planToRequests(plan.rows);
  return q.movs.length + q.impuestos.length + q.ingresos.length + q.aportes.length;
}

function updateButton() {
  const n = count();
  const b = dlg.querySelector("#imp-run");
  if (!b) return;
  b.textContent = n ? `Importar ${n} ${n === 1 ? "fila" : "filas"}` : "Nada para importar";
  b.disabled = n === 0;
}

function onChange(e) {
  if (!plan) return;
  const sel = e.target.dataset?.sel;
  if (sel) {
    const r = plan.rows.find((x) => x.id === sel);
    if (r) r.selected = e.target.checked;
    updateButton();
    return;
  }
  const cat = e.target.dataset?.cat;
  if (cat) {
    const r = plan.rows.find((x) => x.id === cat);
    if (r?.mov) {
      r.mov.cat = e.target.value;
      r.mov.sub = ctx.state.subs[e.target.value]?.[0] ?? "Sin identificar";
    }
  }
}

const msg = (e) => (e instanceof ApiError ? ERRORES[e.code] || e.message : e?.message || "Ocurrió un error inesperado.");

async function run() {
  const btn = dlg.querySelector("#imp-run");
  const err = dlg.querySelector("#imp-err");
  err.textContent = "";
  btn.disabled = true;
  btn.textContent = "Importando…";
  const q = planToRequests(plan.rows);
  const pin = ctx.state.pin;
  const res = { ok: 0, fallas: [] };
  try {
    await send("ping", {}, pin);
  } catch (e) {
    err.textContent = e instanceof ApiError && e.code === "script_old" ? "Falta actualizar el script de la planilla." : msg(e);
    updateButton();
    return;
  }
  const paso = async (titulo, fn) => {
    try { await fn(); } catch (e) { res.fallas.push(`${titulo}: ${msg(e)}`); }
  };
  if (q.impuestos.length) {
    await paso("Impuestos", async () => {
      const r = await send("add_impuestos", { rows: q.impuestos }, pin);
      for (const x of r.results) {
        if (x.status === "added") res.ok++;
        else if (x.status !== "duplicate") res.fallas.push(`Impuesto ${q.impuestos[x.index].tipo}: ${(x.errors || []).map((c) => ERRORES[c] || c).join(", ")}`);
      }
    });
  }
  for (const i of q.ingresos) {
    await paso(`Ingreso ${i.period}`, async () => { await send("set_ingreso", i, pin); res.ok++; });
  }
  for (const a of q.aportes) {
    await paso("Retiro de inversión", async () => { await send("add_aporte", a, pin); res.ok++; });
  }
  for (let k = 0; k < q.movs.length; k += 200) {
    const chunk = q.movs.slice(k, k + 200);
    await paso("Movimientos", async () => {
      const r = await send("add_movs", { rows: chunk }, pin);
      for (const x of r.results) {
        if (x.status === "added") res.ok++;
        else res.fallas.push(`${chunk[x.index].desc}: ${(x.errors || [x.status]).map((c) => ERRORES[c] || c).join(", ")}`);
      }
    });
  }
  plan = null;
  body().innerHTML = `
    <div class="imp-res">
      <strong>${res.ok} ${res.ok === 1 ? "fila cargada" : "filas cargadas"} en tu planilla</strong>
      ${res.fallas.length ? `<span class="error">No se pudieron cargar:</span>${res.fallas.map((f) => `<span class="error">· ${esc(f)}</span>`).join("")}` : `<span class="muted">Sin errores.</span>`}
    </div>
    <button class="btn primary" type="button" data-imp="close">Listo</button>`;
  await ctx.reload({ silent: true });
}
