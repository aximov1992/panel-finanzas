import { readAll, ApiError } from "./api.js";
import { buildModel, semaforo, shiftPeriod, todayYMD } from "./model.js";
import { buildSuggester, subcategoriesByCat } from "./suggest.js";
import { initForms, openNew, openBandeja, openAjustes } from "./forms.js";
import { ars, usd, dec, day, periodLong, periodShort, esc, nfPct } from "./fmt.js";

const app = document.getElementById("app");
const state = { pin: null, model: null, period: null, showAll: false, suggest: () => null, subs: {}, scriptOld: false };

function toast(msg) {
  document.querySelectorAll(".toast").forEach((t) => t.remove());
  const t = document.createElement("div");
  t.className = "toast"; t.setAttribute("role", "status"); t.textContent = msg;
  document.body.append(t);
  setTimeout(() => t.remove(), 3200);
}

function lock() { clearPin(); state.model = null; renderLogin(); }

/* ---------- PIN ---------- */
const KEY = "finanzas_pin";
function loadPin() {
  try { return localStorage.getItem(KEY) || sessionStorage.getItem(KEY); } catch { return null; }
}
function savePin(pin, remember) {
  try {
    (remember ? localStorage : sessionStorage).setItem(KEY, pin);
    (remember ? sessionStorage : localStorage).removeItem(KEY);
  } catch { /* sin almacenamiento: la PIN se pide de nuevo */ }
}
function clearPin() {
  try { localStorage.removeItem(KEY); sessionStorage.removeItem(KEY); } catch { /* nada */ }
  state.pin = null;
}

/* ---------- pantallas ---------- */
function renderLogin(error) {
  app.innerHTML = `
    <div class="center">
      <form class="login" id="login" autocomplete="on">
        <h1>Finanzas</h1>
        <p class="muted">Ingresá tu PIN para ver tu planilla.</p>
        <input id="pin" name="pin" type="password" autocomplete="current-password" aria-label="PIN" required autofocus>
        <label class="check"><input id="remember" type="checkbox"> Recordar en este dispositivo</label>
        <div class="error" role="alert">${esc(error || "")}</div>
        <button class="btn primary" type="submit">Entrar</button>
      </form>
    </div>`;
}

function renderLoading() {
  app.innerHTML = `
    <div class="page" style="padding-top:24px">
      <div class="skeleton"></div><div class="skeleton"></div><div class="skeleton" style="height:220px"></div>
    </div>`;
}

function renderError(message) {
  app.innerHTML = `
    <div class="center">
      <div class="login">
        <h1>No se pudo cargar</h1>
        <p class="error">${esc(message)}</p>
        <button class="btn primary" data-act="refresh">Reintentar</button>
        <button class="btn" data-act="lock">Cambiar PIN</button>
      </div>
    </div>`;
}

function periodOptions(model) {
  const first = model.firstPeriod;
  const last = shiftPeriod(model.today.slice(0, 7), 12);
  const out = [];
  for (let p = first; p <= last; p = shiftPeriod(p, 1)) out.push(p);
  return out;
}

function barRow({ name, amount, pct, cls = "", meta = "", first = false }) {
  return `
    <div class="bar-row${first ? " first" : ""}">
      <span class="name" title="${esc(name)}">${esc(name)}</span>
      <span class="amt">${amount}</span>
      <div class="track"><div class="fill ${cls}" style="width:${Math.max(0, Math.min(100, pct)).toFixed(1)}%"></div></div>
      ${meta ? `<span class="meta">${meta}</span>` : ""}
    </div>`;
}

function renderDashboard() {
  const m = state.model;
  const p = state.period;
  const s = m.monthSummary(p);
  const due = m.nextDue;
  const sema = semaforo(due ? due.ars : 0, s.ingreso);
  const semaCls = { ok: "good", warn: "warn", bad: "bad", none: "muted" }[sema.nivel];
  const balance = s.ingreso > 0 ? s.ingreso - s.gasto : null;

  // KPIs
  const kpis = `
    <div class="kpis">
      <div class="kpi">
        <span class="label">Gasto de ${periodLong(p).toLowerCase()}</span>
        <span class="value">${ars(s.gasto)}</span>
        <span class="sub">${ars(s.cashTotal)} sin tarjeta · ${ars(s.cardTotal)} resumen de tarjeta</span>
      </div>
      <div class="kpi">
        <span class="label">Ingreso del mes</span>
        <span class="value">${s.ingreso > 0 ? ars(s.ingreso) : "Sin cargar"}</span>
        <span class="sub ${balance == null ? "" : balance >= 0 ? "good" : "bad"}">${balance == null ? "Se carga en Config de la planilla" : `${balance >= 0 ? "Te queda" : "Te pasaste por"} ${ars(Math.abs(balance))}`}</span>
      </div>
      <div class="kpi">
        <span class="label">Tarjeta · próximo vencimiento</span>
        <span class="value">${due ? ars(due.ars) : "—"}</span>
        <span class="sub">${due ? `Vence el ${day(due.vto)} (${due.dias === 0 ? "hoy" : due.dias === 1 ? "mañana" : `en ${due.dias} días`}) · cierre ${day(due.cierre)}${due.usd > 0 ? ` · + ${usd(due.usd)}` : ""}` : "Sin ciclos cargados"}</span>
        <span class="chip ${semaCls}">${esc(sema.texto)}${sema.ratio != null ? ` · ${nfPct.format(sema.ratio)} del ingreso` : ""}</span>
      </div>
      <div class="kpi">
        <span class="label">Tasa de ahorro</span>
        <span class="value">${s.tasaAhorro == null ? "—" : nfPct.format(s.tasaAhorro)}</span>
        <span class="sub">${s.ingreso > 0 ? `Aporte a inversión: ${ars(s.aporte)}` : "Sin ingreso cargado para este mes"}</span>
      </div>
    </div>`;

  // Compromiso de tarjeta por resumen
  let lastWithDebt = -1;
  m.forecast.forEach((f, i) => { if (f.ars > 0 || f.usd > 0) lastWithDebt = i; });
  const fc = m.forecast.slice(0, Math.max(3, lastWithDebt + 1));
  const maxF = Math.max(1, ...fc.map((f) => f.ars));
  const forecast = `
    <section class="panel">
      <h2>Compromiso de tarjeta por resumen</h2>
      <p class="hint">Cuotas y compras de cada resumen, según su fecha de vencimiento.</p>
      <div class="rows">
        ${fc.map((f, i) => barRow({
          name: `Vence ${day(f.vto)}`,
          amount: ars(f.ars),
          pct: (f.ars / maxF) * 100,
          first: i === 0,
          meta: f.usd > 0 ? `+ ${usd(f.usd)} en dólares` : "",
        })).join("")}
      </div>
    </section>`;

  // Categorías
  const cats = s.byCat.filter((c) => c.real > 0 || c.presupuesto > 0).sort((a, b) => b.real - a.real);
  const maxC = Math.max(1, ...cats.map((c) => c.real));
  const desvio = s.presupuestoTotal > 0 ? s.gasto - s.presupuestoTotal : null;
  const categorias = `
    <section class="panel">
      <h2>Gasto por categoría</h2>
      <div class="rows">
        ${cats.length ? cats.map((c) => {
          const hasB = c.presupuesto > 0;
          const ratio = hasB ? c.real / c.presupuesto : 0;
          return barRow({
            name: c.cat,
            amount: ars(c.real),
            pct: hasB ? Math.min(ratio, 1) * 100 : (c.real / maxC) * 100,
            cls: hasB && ratio > 1 ? "over" : "",
            meta: hasB ? `${nfPct.format(ratio)} de ${ars(c.presupuesto)} presupuestado` : (s.gasto > 0 ? `${nfPct.format(c.real / s.gasto)} del gasto · sin presupuesto` : ""),
          });
        }).join("") : `<p class="muted">Sin gastos este mes.</p>`}
      </div>
      ${desvio == null ? "" : `<p class="hint">Presupuesto total ${ars(s.presupuestoTotal)} · desvío <span class="${desvio > 0 ? "bad" : "good"}">${desvio > 0 ? "+" : "−"}${ars(Math.abs(desvio))}</span></p>`}
    </section>`;

  // Evolución (6 meses)
  const periods = [];
  for (let i = 5; i >= 0; i--) {
    const q = shiftPeriod(p, -i);
    if (q > m.firstPeriod) periods.push(q); // el primer mes del historial está incompleto
  }
  const sums = periods.map((q) => m.monthSummary(q));
  const maxE = Math.max(1, ...sums.flatMap((x) => [x.gasto, x.ingreso]));
  const evolucion = `
    <section class="panel">
      <h2>Últimos meses</h2>
      <div class="legend"><span><i style="background:var(--accent)"></i>Gasto</span><span><i style="background:var(--good)"></i>Ingreso</span></div>
      <div class="evo">
        ${sums.map((x) => `
          <span class="muted">${periodShort(x.period)}</span>
          <div class="bars">
            <div class="b g" style="width:${((x.gasto / maxE) * 100).toFixed(1)}%"></div>
            ${x.ingreso > 0 ? `<div class="b i" style="width:${((x.ingreso / maxE) * 100).toFixed(1)}%"></div>` : ""}
          </div>
          <span class="num">${ars(x.gasto)}</span>`).join("")}
      </div>
    </section>`;

  // Fondo de emergencia
  const f = m.fondo;
  const fondo = `
    <section class="panel">
      <h2>Fondo de emergencia</h2>
      <div class="meter" aria-hidden="true"><div style="width:${f.avance == null ? 0 : Math.min(100, f.avance * 100).toFixed(1)}%"></div></div>
      <p><span class="value num">${ars(f.saldo)}</span> <span class="muted">ahorrado</span></p>
      <p class="hint">${f.objetivo > 0
        ? `Meta: ${ars(f.objetivo)}${f.metaMonto > 0 ? "" : ` (${dec(f.metaMeses)} meses de gasto)`} · avance ${nfPct.format(f.avance)}`
        : "Meta sin definir. Podés fijarla en Ajustes."}${f.cobertura != null ? ` · cubre ${dec(f.cobertura)} meses de tu gasto promedio` : ""}</p>
    </section>`;

  // Impuestos del mes
  const tipos = s.impuestosPorTipo;
  const maxT = Math.max(1, ...tipos.map((t) => t.monto));
  const impuestos = `
    <section class="panel">
      <h2>Impuestos de ${periodLong(p).toLowerCase()}</h2>
      ${tipos.length ? `
        <p class="tax-total">${ars(s.impuestos)}</p>
        <div class="rows">${tipos.map((t) => barRow({ name: t.tipo, amount: ars(t.monto), pct: (t.monto / maxT) * 100 })).join("")}</div>
        <p class="hint">Ya están incluidos en el gasto del mes.</p>`
      : `<p class="muted">Sin impuestos cargados para este mes.</p>`}
    </section>`;

  // Movimientos
  const movs = m.movsByPeriod(p);
  const shown = state.showAll ? movs : movs.slice(0, 12);
  const movimientos = `
    <section class="panel">
      <h2>Movimientos de ${periodLong(p).toLowerCase()} · ${movs.length}</h2>
      <div class="list">
        ${shown.length ? shown.map((x) => `
          <div class="mov">
            <span class="d" title="${esc(x.desc)}">${esc(x.desc || "Sin descripción")}${x.cuotas > 1 ? `<span class="badge">${x.cuotas} cuotas</span>` : ""}${x.estado === "Pendiente" ? `<span class="badge pend">Pendiente</span>` : ""}</span>
            <span class="a">${x.moneda === "USD" ? usd(x.monto) : ars(x.monto)}</span>
            <span class="m">${day(x.fecha)} · ${esc(x.cat)}${x.sub ? ` · ${esc(x.sub)}` : ""} · ${esc(x.medio)}</span>
            <span class="s">${x.moneda === "USD" ? `≈ ${ars(x.ars)}` : x.cuotas > 1 ? `${ars(x.montoCuota)} por cuota` : ""}</span>
          </div>`).join("") : `<p class="muted">No hay movimientos este mes.</p>`}
      </div>
      ${movs.length > 12 ? `<button class="btn" data-act="toggle-movs">${state.showAll ? "Ver menos" : `Ver los ${movs.length}`}</button>` : ""}
    </section>`;

  const opts = periodOptions(m).map((q) => `<option value="${q}"${q === p ? " selected" : ""}>${periodLong(q)}</option>`).join("");

  app.innerHTML = `
    <header class="top">
      <span class="brand">Finanzas</span>
      <nav class="months" aria-label="Mes">
        <button class="icon-btn" data-act="prev" aria-label="Mes anterior">‹</button>
        <select id="period" aria-label="Elegir mes">${opts}</select>
        <button class="icon-btn" data-act="next" aria-label="Mes siguiente">›</button>
      </nav>
      <div class="actions">
        <button class="btn" data-act="bandeja">Por revisar${m.bandeja.length ? `<span class="badge-n">${m.bandeja.length}</span>` : ""}</button>
        <button class="btn" data-act="refresh">Actualizar</button>
        <button class="btn" data-act="ajustes">Ajustes</button>
      </div>
    </header>
    <main class="page">
      ${kpis}
      <div class="grid2">
        <div style="display:flex;flex-direction:column;gap:16px;min-width:0">${forecast}${evolucion}${fondo}${impuestos}</div>
        <div style="display:flex;flex-direction:column;gap:16px;min-width:0">${categorias}${movimientos}</div>
      </div>
      <div class="foot">
        <span>USD/ARS oficial (de tu planilla): <span class="num">${ars(m.cot)}</span></span>
      </div>
    </main>
    <button class="fab" data-act="nuevo" aria-label="Cargar movimiento">+</button>`;
}

/* ---------- carga ---------- */
async function load({ silent = false } = {}) {
  if (!silent) renderLoading();
  try {
    const raw = await readAll(state.pin);
    state.model = buildModel(raw);
    state.suggest = buildSuggester(state.model.movs);
    state.subs = subcategoriesByCat(state.model.movs);
    if (!state.period) state.period = todayYMD().slice(0, 7);
    renderDashboard();
  } catch (e) {
    if (silent && !(e instanceof ApiError && e.code === "unauthorized")) {
      toast("No se pudo actualizar. Tocá Actualizar.");
      return;
    }
    if (e instanceof ApiError && e.code === "unauthorized") {
      clearPin();
      renderLogin("PIN incorrecta.");
    } else {
      renderError(e instanceof ApiError ? e.message : "Ocurrió un error inesperado al armar el panel.");
      console.error(e);
    }
  }
}

/* ---------- eventos ---------- */
app.addEventListener("submit", (ev) => {
  if (ev.target.id !== "login") return;
  ev.preventDefault();
  const pin = document.getElementById("pin").value.trim();
  if (!pin) return;
  state.pin = pin;
  savePin(pin, document.getElementById("remember").checked);
  load();
});

app.addEventListener("click", (ev) => {
  const btn = ev.target.closest("[data-act]");
  if (!btn) return;
  const act = btn.dataset.act;
  if (act === "prev" || act === "next") {
    const next = shiftPeriod(state.period, act === "prev" ? -1 : 1);
    if (next >= state.model.firstPeriod && next <= shiftPeriod(todayYMD().slice(0, 7), 12)) {
      state.period = next; state.showAll = false; renderDashboard();
    }
  } else if (act === "refresh") {
    load();
  } else if (act === "lock") {
    lock();
  } else if (act === "nuevo") {
    openNew("gasto");
  } else if (act === "bandeja") {
    openBandeja();
  } else if (act === "ajustes") {
    openAjustes();
  } else if (act === "toggle-movs") {
    state.showAll = !state.showAll; renderDashboard();
  }
});

app.addEventListener("change", (ev) => {
  if (ev.target.id === "period") { state.period = ev.target.value; state.showAll = false; renderDashboard(); }
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => { /* la app funciona igual sin instalarse */ });
}

initForms({ state, reload: load, toast, lock });

state.pin = loadPin();
if (state.pin) load(); else renderLogin();
