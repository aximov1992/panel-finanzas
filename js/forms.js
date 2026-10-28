// Formularios del panel: carga rápida, bandeja "Por revisar" y ajustes.
import { send, ApiError } from "./api.js";
import { parseAmount, prettyMerchant, findSimilar, resumenDeImpuesto, estadoInicial, ERRORES } from "./util.js";
import { todayYMD } from "./model.js";
import { ars, usd, day, periodLong, esc } from "./fmt.js";

let ctx = null;   // { state, reload, toast, lock }
let dlg = null;
let scriptCheck = null;
const form = { tab: "gasto", touched: {} };

const TIPOS_IMPUESTO = ["IIBB percepción CABA", "IVA RG 4240", "Percepción RG 5617", "Impuesto a los débitos y créditos", "Sellos", "Otro"];
const ORIGENES = ["Visa", "Caja de ahorro", "Otro"];

export function initForms(context) {
  ctx = context;
  dlg = document.createElement("dialog");
  dlg.id = "dlg";
  dlg.setAttribute("aria-label", "Formulario");
  document.body.append(dlg);
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener("submit", onSubmit);
  dlg.addEventListener("input", onInput);
  dlg.addEventListener("change", onChange);
  dlg.addEventListener("click", onClick);
}

/* ---------- helpers ---------- */
const m = () => ctx.state.model;
const options = (list, selected) => list.map((x) => `<option value="${esc(x)}"${x === selected ? " selected" : ""}>${esc(x)}</option>`).join("");
const $ = (id) => dlg.querySelector("#" + id);
const val = (id) => ($(id)?.value ?? "").trim();

function show(html) {
  dlg.innerHTML = `<div class="dlg-in">${html}</div>`;
  if (!dlg.open) dlg.showModal();
}

function closeBtn() {
  return `<button class="icon-btn" type="button" data-dlg="close" aria-label="Cerrar">×</button>`;
}

function errorText(e) {
  if (e instanceof ApiError) return ERRORES[e.code] || e.message;
  return "Ocurrió un error inesperado.";
}

function resultErrors(errors) {
  return (errors || []).map((c) => ERRORES[c] || c).join(" ");
}

/** Verifica una sola vez por sesión que el script de la planilla sea la versión nueva. */
function checkScript() {
  if (!scriptCheck) {
    scriptCheck = send("ping", {}, ctx.state.pin)
      .then((r) => ({ ok: true, version: r.version }))
      .catch((e) => ({ ok: false, old: e instanceof ApiError && e.code === "script_old", error: errorText(e) }));
  }
  return scriptCheck;
}

async function scriptBanner() {
  const s = await checkScript();
  if (s.ok) return "";
  return `<p class="error" role="alert">${esc(s.old ? "Falta actualizar el script de la planilla para poder cargar desde el panel. Los pasos están en el README del repositorio." : s.error)}</p>`;
}

async function guard(btn, fn) {
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = "Guardando…";
  try { return await fn(); } finally { btn.disabled = false; btn.textContent = label; }
}

/* ---------- carga rápida ---------- */
export async function openNew(tab = "gasto") {
  form.tab = tab;
  form.touched = {};
  show(`<div class="dlg-head"><h2>Nuevo</h2>${closeBtn()}</div><div class="dlg-body" id="dlg-body"></div>`);
  await renderNew();
}

async function renderNew() {
  const banner = await scriptBanner();
  const tabs = [["gasto", "Gasto"], ["impuesto", "Impuesto"], ["inversion", "Inversión"]]
    .map(([k, l]) => `<button type="button" class="seg-b${form.tab === k ? " on" : ""}" data-tab="${k}" aria-pressed="${form.tab === k}">${l}</button>`).join("");
  const body = form.tab === "gasto" ? gastoForm() : form.tab === "impuesto" ? impuestoForm() : inversionForm();
  $("dlg-body").innerHTML = `<div class="seg">${tabs}</div>${banner}${body}`;
  if (form.tab === "gasto") syncGasto();
  if (form.tab === "impuesto") syncImpuesto();
  $(form.tab === "gasto" ? "f-monto" : form.tab === "impuesto" ? "f-monto" : "f-monto")?.focus();
}

function gastoForm() {
  const model = m();
  const medio = model.medios.includes("Débito") ? "Débito" : model.medios[0];
  return `
  <form id="f-gasto" class="form" novalidate>
    <div class="row2">
      <label class="field"><span>Monto</span><input id="f-monto" inputmode="decimal" autocomplete="off" placeholder="0" required></label>
      <label class="field"><span>Moneda</span><select id="f-moneda">${options(model.monedas, "ARS")}</select></label>
    </div>
    <label class="field"><span>Comercio o descripción</span><input id="f-desc" autocomplete="off" required></label>
    <p class="hint" id="f-sugg" hidden></p>
    <div class="row2">
      <label class="field"><span>Fecha</span><input id="f-fecha" type="date" value="${todayYMD()}" required></label>
      <label class="field"><span>Medio de pago</span><select id="f-medio">${options(model.medios, medio)}</select></label>
    </div>
    <div class="row2">
      <label class="field"><span>Categoría</span><select id="f-cat">${options(model.categorias, model.categorias[0])}</select></label>
      <label class="field"><span>Subcategoría</span><input id="f-sub" list="f-sub-list" autocomplete="off"><datalist id="f-sub-list"></datalist></label>
    </div>
    <div class="row2">
      <label class="field" id="f-cuotas-wrap" hidden><span>Cuotas</span><input id="f-cuotas" type="number" min="1" max="60" step="1" value="1" inputmode="numeric"></label>
      <label class="field"><span>Estado</span><select id="f-estado">${options(model.estados, estadoInicial(medio))}</select></label>
    </div>
    <div class="error" id="f-err" role="alert"></div>
    <div class="warn-box" id="f-warn" hidden></div>
    <button class="btn primary" type="submit">Guardar</button>
  </form>`;
}

function syncGasto() {
  const cat = val("f-cat");
  $("f-sub-list").innerHTML = (ctx.state.subs[cat] ?? []).map((s) => `<option value="${esc(s)}">`).join("");
  $("f-cuotas-wrap").hidden = val("f-medio") !== "Tarjeta de Crédito";
}

function impuestoForm() {
  const model = m();
  const tipos = [...new Set([...model.impuestos.map((x) => x.tipo), ...TIPOS_IMPUESTO])];
  const fecha = todayYMD();
  return `
  <form id="f-impuesto" class="form" novalidate>
    <div class="row2">
      <label class="field"><span>Monto (ARS)</span><input id="f-monto" inputmode="decimal" autocomplete="off" placeholder="0" required></label>
      <label class="field"><span>Fecha</span><input id="f-fecha" type="date" value="${fecha}" required></label>
    </div>
    <div class="row2">
      <label class="field"><span>Origen</span><select id="f-origen">${options(ORIGENES, "Visa")}</select></label>
      <label class="field"><span>Resumen (mes)</span><input id="f-resumen" type="month" value="${resumenDeImpuesto(fecha, model.cycles)}" required></label>
    </div>
    <label class="field"><span>Tipo de impuesto</span><input id="f-tipo" list="f-tipos" autocomplete="off" required><datalist id="f-tipos">${tipos.map((t) => `<option value="${esc(t)}">`).join("")}</datalist></label>
    <label class="field"><span>Nota (opcional)</span><input id="f-nota" autocomplete="off"></label>
    <p class="hint">El resumen es el mes del resumen de tarjeta al que pertenece el cargo. En la caja de ahorro, el mes de la fecha.</p>
    <div class="error" id="f-err" role="alert"></div>
    <button class="btn primary" type="submit">Guardar</button>
  </form>`;
}

function syncImpuesto() {
  if (form.touched.resumen) return;
  const fecha = val("f-fecha");
  if (!fecha) return;
  $("f-resumen").value = val("f-origen") === "Visa" ? resumenDeImpuesto(fecha, m().cycles) : fecha.slice(0, 7);
}

function inversionForm() {
  const destinos = [...new Set([m().fondo.destino, ...m().aportes.map((a) => a.destino).filter(Boolean)])];
  return `
  <form id="f-inversion" class="form" novalidate>
    <div class="row2">
      <label class="field"><span>Tipo</span><select id="f-tipo-mov"><option value="aporte">Aporte</option><option value="retiro">Retiro</option></select></label>
      <label class="field"><span>Fecha</span><input id="f-fecha" type="date" value="${todayYMD()}" required></label>
    </div>
    <label class="field"><span>Monto (ARS)</span><input id="f-monto" inputmode="decimal" autocomplete="off" placeholder="0" required></label>
    <label class="field"><span>Destino</span><input id="f-destino" list="f-destinos" autocomplete="off" required><datalist id="f-destinos">${destinos.map((t) => `<option value="${esc(t)}">`).join("")}</datalist></label>
    <label class="field"><span>Nota (opcional)</span><input id="f-nota" autocomplete="off"></label>
    <p class="hint">Un retiro se guarda en negativo. Los aportes al fondo de emergencia se anotan con el destino “${esc(m().fondo.destino)}”.</p>
    <div class="error" id="f-err" role="alert"></div>
    <button class="btn primary" type="submit">Guardar</button>
  </form>`;
}

/* ---------- eventos ---------- */
function onInput(e) {
  if (e.target.id === "f-desc" && form.tab === "gasto") {
    const s = ctx.state.suggest(e.target.value);
    const hint = $("f-sugg");
    if (!s) { hint.hidden = true; return; }
    if (!form.touched.cat && m().categorias.includes(s.cat)) $("f-cat").value = s.cat;
    if (!form.touched.sub) $("f-sub").value = s.sub;
    if (!form.touched.medio && m().medios.includes(s.medio)) {
      $("f-medio").value = s.medio;
      if (!form.touched.estado) $("f-estado").value = estadoInicial(s.medio);
    }
    syncGasto();
    hint.hidden = false;
    hint.textContent = `Sugerido por tu historial: ${s.cat} · ${s.sub}`;
  }
}

function onChange(e) {
  const id = e.target.id;
  if (e.target.dataset?.f === "cat") {
    const box = e.target.closest(".b-item");
    const sub = box.querySelector("[data-f=sub]");
    sub.value = "";
    box.querySelector("datalist").innerHTML = (ctx.state.subs[e.target.value] ?? []).map((x) => `<option value="${esc(x)}">`).join("");
    return;
  }
  if (id === "f-cat") { form.touched.cat = true; $("f-sub").value = ""; syncGasto(); }
  else if (id === "f-sub") form.touched.sub = true;
  else if (id === "f-estado") form.touched.estado = true;
  else if (id === "f-medio") {
    form.touched.medio = true;
    if (!form.touched.estado) $("f-estado").value = estadoInicial(val("f-medio"));
    syncGasto();
  } else if (id === "f-resumen") form.touched.resumen = true;
  else if ((id === "f-fecha" || id === "f-origen") && form.tab === "impuesto") syncImpuesto();
}

function onClick(e) {
  const b = e.target.closest("[data-dlg], [data-tab], [data-bandeja]");
  if (!b) return;
  if (b.dataset.dlg === "close") dlg.close();
  else if (b.dataset.tab) { form.tab = b.dataset.tab; form.touched = {}; renderNew(); }
  else if (b.dataset.bandeja) bandejaAction(b);
}

async function onSubmit(e) {
  e.preventDefault();
  const f = e.target;
  const btn = f.querySelector("button[type=submit]");
  const err = f.querySelector("#f-err") || f.querySelector(".error");
  if (err) err.textContent = "";
  const s = await checkScript();
  if (!s.ok) { if (err) err.textContent = s.old ? "Falta actualizar el script de la planilla." : s.error; return; }
  try {
    if (f.id === "f-gasto") await guard(btn, () => submitGasto(err));
    else if (f.id === "f-impuesto") await guard(btn, () => submitImpuesto(err));
    else if (f.id === "f-inversion") await guard(btn, () => submitInversion(err));
    else if (f.id === "f-ingreso") await guard(btn, () => submitIngreso(err));
    else if (f.id === "f-categoria") await guard(btn, () => submitCategoria(err));
    else if (f.id === "f-fondo") await guard(btn, () => submitFondo(err));
  } catch (ex) {
    if (err) err.textContent = errorText(ex);
  }
}

async function done(msg) {
  ctx.toast(msg);
  dlg.close();
  await ctx.reload({ silent: true });
}

/* ---------- envíos ---------- */
let dupConfirmed = false;

async function submitGasto(err) {
  const monto = parseAmount(val("f-monto"));
  const medio = val("f-medio");
  const row = {
    fecha: val("f-fecha"), desc: prettyMerchant(val("f-desc")), cat: val("f-cat"), sub: val("f-sub"),
    medio, monto, moneda: val("f-moneda"), cuotas: medio === "Tarjeta de Crédito" ? Number(val("f-cuotas") || 1) : 1,
    estado: val("f-estado"),
  };
  if (!(monto > 0)) { err.textContent = ERRORES.monto; return; }
  if (!row.desc) { err.textContent = ERRORES.descripcion; return; }
  const similar = findSimilar(m().movs, row);
  if (similar && !dupConfirmed) {
    const w = $("f-warn");
    w.hidden = false;
    w.textContent = `Ya hay un movimiento parecido el ${day(similar.fecha)}: “${similar.desc}”. Tocá Guardar de nuevo si es otro gasto.`;
    dupConfirmed = true;
    return;
  }
  dupConfirmed = false;
  const res = await send("add_movs", { rows: [row] }, ctx.state.pin);
  const r = res.results[0];
  if (r.status !== "added") { err.textContent = resultErrors(r.errors) || "No se pudo guardar."; return; }
  await done(`Guardado en la fila ${r.row}`);
}

async function submitImpuesto(err) {
  const monto = parseAmount(val("f-monto"));
  if (!(monto > 0)) { err.textContent = ERRORES.monto; return; }
  const row = { fecha: val("f-fecha"), origen: val("f-origen"), tipo: val("f-tipo"), monto, resumen: val("f-resumen"), nota: val("f-nota") };
  const res = await send("add_impuestos", { rows: [row] }, ctx.state.pin);
  const r = res.results[0];
  if (r.status === "duplicate") { err.textContent = "Ese impuesto ya está cargado."; return; }
  if (r.status !== "added") { err.textContent = resultErrors(r.errors) || "No se pudo guardar."; return; }
  await done("Impuesto guardado");
}

async function submitInversion(err) {
  const base = parseAmount(val("f-monto"));
  if (!(base > 0)) { err.textContent = ERRORES.monto; return; }
  const monto = val("f-tipo-mov") === "retiro" ? -base : base;
  await send("add_aporte", { fecha: val("f-fecha"), monto, destino: val("f-destino"), nota: val("f-nota") }, ctx.state.pin);
  await done(monto < 0 ? "Retiro guardado" : "Aporte guardado");
}

/* ---------- ajustes ---------- */
export async function openAjustes() {
  const model = m();
  const p = ctx.state.period;
  const s = model.monthSummary(p);
  const f = model.fondo;
  const banner = await scriptBanner();
  const check = await checkScript();
  show(`
    <div class="dlg-head"><h2>Ajustes</h2>${closeBtn()}</div>
    <div class="dlg-body">
      ${banner}
      <form id="f-ingreso" class="form sect" novalidate>
        <h3>Ingreso de ${esc(periodLong(p))}</h3>
        <p class="hint">${s.ingreso > 0 ? `Cargado: ${ars(s.ingreso)}.` : "Todavía no está cargado."} Se guarda en la lista de ingresos de Config.</p>
        <div class="row2">
          <label class="field"><span>Monto (ARS)</span><input id="f-monto" inputmode="decimal" autocomplete="off" placeholder="0" required></label>
          <label class="field"><span>Fecha de cobro</span><input id="f-fecha" type="date" value="${p}-05" required></label>
        </div>
        <div class="error" id="f-err" role="alert"></div>
        <button class="btn" type="submit">Guardar ingreso</button>
      </form>

      <form id="f-categoria" class="form sect" novalidate>
        <h3>Categoría nueva</h3>
        <p class="hint">Aparece en el panel y en los formularios. En la planilla se guarda al lado de tus categorías, en Config.</p>
        <label class="field"><span>Nombre</span><input id="f-nombre" autocomplete="off" required></label>
        <div class="error" id="f-err" role="alert"></div>
        <button class="btn" type="submit">Agregar categoría</button>
      </form>

      <form id="f-fondo" class="form sect" novalidate>
        <h3>Fondo de emergencia</h3>
        <p class="hint">Poné la meta en meses de gasto o en un monto fijo. Si dejás los dos vacíos, queda sin definir. Con meses se usa tu gasto promedio de los últimos 3 meses cerrados${f.gastoPromedio ? ` (${ars(f.gastoPromedio)})` : ""}.</p>
        <div class="row2">
          <label class="field"><span>Meta en meses</span><input id="f-meses" inputmode="decimal" autocomplete="off" value="${f.metaMeses || ""}" placeholder="Sin definir"></label>
          <label class="field"><span>Meta en monto (ARS)</span><input id="f-meta-monto" inputmode="decimal" autocomplete="off" value="${f.metaMonto || ""}" placeholder="Sin definir"></label>
        </div>
        <label class="field"><span>Destino de los aportes</span><input id="f-destino" autocomplete="off" value="${esc(f.destino)}"></label>
        <div class="error" id="f-err" role="alert"></div>
        <button class="btn" type="submit">Guardar fondo</button>
      </form>

      <div class="sect">
        <h3>Sesión</h3>
        <p class="hint">Script de la planilla: ${check.ok ? `versión ${esc(check.version)}` : "desactualizado o sin conexión"}.</p>
        <button class="btn" type="button" data-dlg="lock">Bloquear</button>
      </div>
    </div>`);
}

async function submitIngreso(err) {
  const monto = parseAmount(val("f-monto"));
  if (!(monto > 0)) { err.textContent = ERRORES.monto; return; }
  await send("set_ingreso", { period: ctx.state.period, fecha: val("f-fecha"), monto }, ctx.state.pin);
  await done("Ingreso guardado");
}

async function submitCategoria(err) {
  await send("add_categoria", { nombre: val("f-nombre") }, ctx.state.pin);
  await done("Categoría agregada");
}

async function submitFondo(err) {
  const num = (id) => {
    const t = val(id);
    if (!t) return null;
    const n = parseAmount(t);
    return n >= 0 ? n : NaN;
  };
  const meses = num("f-meses"), monto = num("f-meta-monto");
  if (Number.isNaN(meses) || Number.isNaN(monto)) { err.textContent = ERRORES.value; return; }
  const destino = val("f-destino") || "Fondo de emergencia";
  await send("set_setting", { key: "fondo_meta_meses", value: meses }, ctx.state.pin);
  await send("set_setting", { key: "fondo_meta_monto", value: monto }, ctx.state.pin);
  await send("set_setting", { key: "fondo_destino", value: destino }, ctx.state.pin);
  await done("Fondo guardado");
}

dlgLockHook();
function dlgLockHook() {
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-dlg='lock']");
    if (b && ctx) { dlg.close(); ctx.lock(); }
  });
}

/* ---------- bandeja ---------- */
export async function openBandeja() {
  const banner = await scriptBanner();
  show(`<div class="dlg-head"><h2>Por revisar</h2>${closeBtn()}</div><div class="dlg-body" id="dlg-body">${banner}<div id="bandeja-list"></div></div>`);
  renderBandeja();
}

function renderBandeja() {
  const items = m().bandeja;
  const box = $("bandeja-list");
  if (!box) return;
  if (!items.length) {
    box.innerHTML = `<p class="muted">No hay nada por revisar.</p>`;
    return;
  }
  box.innerHTML = items.map((it) => {
    if (it.estado === "sin_parsear") {
      return `
      <div class="b-item" data-id="${esc(it.id)}">
        <p class="b-text">${esc(it.texto)}</p>
        <p class="hint">No pude leer este aviso. Descartalo y cargalo a mano con el botón +.</p>
        <div class="b-actions"><button class="btn" type="button" data-bandeja="descartar">Descartar</button></div>
      </div>`;
    }
    const sug = ctx.state.suggest(it.comercio);
    const cat = sug && m().categorias.includes(sug.cat) ? sug.cat : "";
    const esCredito = it.medio === "Tarjeta de Crédito";
    return `
    <div class="b-item" data-id="${esc(it.id)}">
      <div class="b-top"><strong>${esc(prettyMerchant(it.comercio))}</strong><span class="num">${ars(it.monto)}</span></div>
      <p class="hint">${esc(day(it.fecha))}${it.hora ? ` · ${esc(it.hora)}` : ""} · ${esc(it.medio)} ${esc(it.tarjeta)}</p>
      <div class="row2">
        <label class="field"><span>Categoría</span><select data-f="cat"><option value="">Elegí…</option>${options(m().categorias, cat)}</select></label>
        <label class="field"><span>Subcategoría</span><input data-f="sub" list="sl-${esc(it.id)}" value="${esc(sug?.sub ?? "")}" autocomplete="off"><datalist id="sl-${esc(it.id)}">${(ctx.state.subs[cat] ?? []).map((x) => `<option value="${esc(x)}">`).join("")}</datalist></label>
      </div>
      ${esCredito ? `<label class="field"><span>Cuotas</span><input data-f="cuotas" type="number" min="1" max="60" value="1" inputmode="numeric"></label>` : ""}
      <div class="error" data-f="err" role="alert"></div>
      <div class="b-actions">
        <button class="btn primary" type="button" data-bandeja="confirmar">Confirmar</button>
        <button class="btn" type="button" data-bandeja="descartar">Descartar</button>
      </div>
    </div>`;
  }).join("");
}

async function bandejaAction(btn) {
  const box = btn.closest(".b-item");
  const id = box.dataset.id;
  const item = m().bandeja.find((x) => x.id === id);
  const err = box.querySelector("[data-f=err]");
  if (err) err.textContent = "";
  const s = await checkScript();
  if (!s.ok) { if (err) err.textContent = "Falta actualizar el script de la planilla."; return; }
  const accion = btn.dataset.bandeja;
  try {
    await guard(btn, async () => {
      if (accion === "descartar") {
        await send("bandeja_resolve", { id, accion }, ctx.state.pin);
      } else {
        const cat = box.querySelector("[data-f=cat]").value;
        if (!cat) { err.textContent = ERRORES.categoria; throw new Error("silent"); }
        const row = {
          fecha: item.fecha, desc: prettyMerchant(item.comercio), cat,
          sub: box.querySelector("[data-f=sub]").value.trim(), medio: item.medio, monto: item.monto, moneda: "ARS",
          cuotas: Number(box.querySelector("[data-f=cuotas]")?.value || 1), estado: estadoInicial(item.medio),
        };
        await send("bandeja_resolve", { id, accion, row }, ctx.state.pin);
      }
    });
  } catch (ex) {
    if (ex.message !== "silent" && err) err.textContent = errorText(ex);
    return;
  }
  ctx.toast(accion === "descartar" ? "Descartado" : "Movimiento cargado");
  await ctx.reload({ silent: true });
  renderBandeja();
  if (!m().bandeja.length) dlg.close();
}
