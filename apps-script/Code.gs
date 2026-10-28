/**
 * Backend del panel de finanzas (Google Apps Script, versión 2).
 * Vive dentro de la planilla Finanzas_Personales_Ian y se publica como aplicación web.
 *
 * Propiedades del script (Configuración del proyecto > Propiedades de la secuencia de comandos):
 *   PIN          clave del panel. Da acceso a leer y escribir.
 *   CAPTURE_KEY  clave del atajo del celular. Solo puede anotar en la hoja "Bandeja", no lee nada.
 *
 * Reglas de seguridad:
 *   - Solo agrega filas. Nunca borra ni pisa filas existentes.
 *   - Escribe únicamente las columnas que se cargan a mano; las fórmulas no se tocan.
 *   - Tras 10 intentos fallidos en 10 minutos, se bloquea 15 minutos.
 */

var VERSION = '2.0.0';

var TABS_READ = ['Movimientos', 'Config', 'Historico_Mensual', 'Inversiones', 'Presupuesto',
  'Dashboard', 'Impuestos', 'Bandeja', 'Panel_Config'];

var MOV_FIRST_ROW = 4;       // Movimientos: encabezados en la fila 3, datos desde la 4
var FORMULA_LAST_ROW = 503;  // las fórmulas de Dashboard y Cuotas_Flujo llegan hasta acá
var INV_FIRST_ROW = 4;       // Inversiones: datos desde la fila 4 (las fórmulas suman hasta la 83)
var INV_LAST_ROW = 83;
var MAX_CUOTAS = 60;
var MAX_ROWS_PER_CALL = 200;
var MAX_BANDEJA_PENDIENTES = 500;

var SETTINGS_ALLOWED = ['fondo_meta_meses', 'fondo_meta_monto', 'fondo_destino'];
var IMPUESTOS_HEADER = ['Fecha', 'Origen', 'Tipo', 'Monto (ARS)', 'Resumen (AAAA-MM)', 'Nota'];
var BANDEJA_HEADER = ['ID', 'Recibido', 'Texto original', 'Monto', 'Comercio', 'Medio', 'Tarjeta',
  'Hora', 'Estado', 'Clave', 'Nota'];
var SETTINGS_HEADER = ['Clave', 'Valor', 'Actualizado'];

/* =============================== Puntos de entrada =============================== */

function doPost(e) {
  try {
    var req = JSON.parse(e.postData.contents);
    if (req.action === 'capture') return out(handleCapture(req));

    var auth = authenticate('pin', req.pin, 'PIN');
    if (!auth.ok) return out(auth);

    var res;
    switch (req.action) {
      case 'ping':           res = { ok: true, version: VERSION }; break;
      case 'read':           res = handleRead(req); break;
      case 'add_movs':       res = withLock(function () { return handleAddMovs(req); }); break;
      case 'add_impuestos':  res = withLock(function () { return handleAddImpuestos(req); }); break;
      case 'add_aporte':     res = withLock(function () { return handleAddAporte(req); }); break;
      case 'set_ingreso':    res = withLock(function () { return handleSetIngreso(req); }); break;
      case 'add_categoria':  res = withLock(function () { return handleAddCategoria(req); }); break;
      case 'set_setting':    res = withLock(function () { return handleSetSetting(req); }); break;
      case 'bandeja_resolve': res = withLock(function () { return handleBandejaResolve(req); }); break;
      default:               res = { ok: false, error: 'unknown_action' };
    }
    return out(res);
  } catch (err) {
    return out({ ok: false, error: 'exception', message: String(err && err.message ? err.message : err) });
  }
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function withLock(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try { return fn(); } finally { lock.releaseLock(); }
}

/* ================================== Autenticación ================================ */

function safeEqual(a, b) {
  a = String(a == null ? '' : a); b = String(b == null ? '' : b);
  var diff = a.length ^ b.length;
  var n = Math.max(a.length, b.length);
  for (var i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

function authenticate(bucket, given, propName) {
  var cache = CacheService.getScriptCache();
  var failKey = 'fails_' + bucket;
  var lockKey = 'locked_' + bucket;
  if (cache.get(lockKey)) return { ok: false, error: 'locked' };

  var secret = PropertiesService.getScriptProperties().getProperty(propName);
  if (secret && given != null && safeEqual(given, secret)) {
    cache.remove(failKey);
    return { ok: true };
  }
  var fails = Number(cache.get(failKey) || 0) + 1;
  if (fails >= 10) {
    cache.put(lockKey, '1', 900);
    cache.remove(failKey);
  } else {
    cache.put(failKey, String(fails), 600);
  }
  return { ok: false, error: 'unauthorized' };
}

/* =================================== Lectura ===================================== */

function handleRead(req) {
  if (TABS_READ.indexOf(req.tab) === -1) return { ok: false, error: 'tab_not_allowed' };
  var sh = SpreadsheetApp.getActive().getSheetByName(req.tab);
  if (!sh) {
    // Hojas que el panel crea bajo demanda: se leen como vacías hasta que existan.
    if (req.tab === 'Impuestos' || req.tab === 'Bandeja' || req.tab === 'Panel_Config') {
      return { ok: true, tab: req.tab, values: [] };
    }
    return { ok: false, error: 'tab_not_found' };
  }
  return { ok: true, tab: req.tab, values: sh.getDataRange().getValues() };
}

/* ================================ Validaciones puras ============================= */

function isIsoDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  var p = s.split('-').map(Number);
  var d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  return d.getUTCFullYear() === p[0] && d.getUTCMonth() === p[1] - 1 && d.getUTCDate() === p[2]
    && p[0] >= 2020 && p[0] <= 2100;
}

function cleanText(s, max) {
  return String(s == null ? '' : s).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max || 120);
}

// Evita que un texto cargado desde el panel se interprete como fórmula en la planilla.
function safeCell(s) {
  s = cleanText(s, 120);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function toNumber(v) {
  if (typeof v === 'number') return isFinite(v) ? v : NaN;
  if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v);
  return NaN;
}

/** Lee las listas válidas (categorías, medios, monedas, estados) de los valores de Config. */
function readLists(configValues) {
  var h = -1;
  for (var i = 0; i < configValues.length; i++) {
    if (configValues[i][0] === 'CATEGORÍAS') { h = i; break; }
  }
  var lists = { categorias: [], extras: [], medios: [], monedas: [], estados: [] };
  if (h < 0) return lists;
  function col(c, dest) {
    for (var r = h + 1; r < configValues.length; r++) {
      var v = configValues[r][c];
      if (v === '' || v == null) break;
      dest.push(String(v));
    }
  }
  col(0, lists.categorias); col(2, lists.medios); col(4, lists.monedas); col(6, lists.estados);
  col(8, lists.extras);
  lists.todasCategorias = lists.categorias.concat(lists.extras);
  lists.headerRow = h + 1; // fila (1-based) del encabezado
  return lists;
}

function validateMov(m, lists) {
  var errors = [];
  if (!m || typeof m !== 'object') return ['fila_invalida'];
  if (!isIsoDate(m.fecha)) errors.push('fecha');
  var monto = toNumber(m.monto);
  if (isNaN(monto) || monto === 0) errors.push('monto');
  if (!cleanText(m.desc, 120)) errors.push('descripcion');
  if (lists.todasCategorias.indexOf(m.cat) === -1) errors.push('categoria');
  if (lists.medios.indexOf(m.medio) === -1) errors.push('medio');
  if (lists.monedas.indexOf(m.moneda) === -1) errors.push('moneda');
  if (lists.estados.indexOf(m.estado) === -1) errors.push('estado');
  var cuotas = toNumber(m.cuotas == null ? 1 : m.cuotas);
  if (isNaN(cuotas) || cuotas < 1 || cuotas > MAX_CUOTAS || Math.floor(cuotas) !== cuotas) errors.push('cuotas');
  if (m.cuotas > 1 && m.medio !== 'Tarjeta de Crédito') errors.push('cuotas_sin_tarjeta');
  if (m.cft !== undefined && m.cft !== '' && m.cft !== null) {
    var cft = toNumber(m.cft);
    if (isNaN(cft) || cft < 0 || cft > 20) errors.push('cft');
  }
  return errors;
}

function normName(s) {
  return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

function dayDiff(a, b) {
  return Math.abs(Date.UTC.apply(null, a.split('-').map(function (x, i) { return i === 1 ? Number(x) - 1 : Number(x); })) -
    Date.UTC.apply(null, b.split('-').map(function (x, i) { return i === 1 ? Number(x) - 1 : Number(x); }))) / 86400000;
}

/**
 * Busca en las filas ya cargadas una compra equivalente: mismo monto (o monto por cuota),
 * misma moneda y fecha a no más de un día. Devuelve el número de fila o 0.
 */
function findDuplicate(existing, m) {
  for (var i = 0; i < existing.length; i++) {
    var e = existing[i];
    if (e.moneda !== m.moneda) continue;
    if (dayDiff(e.fecha, m.fecha) > 1) continue;
    var perCuota = e.cuotas > 1 ? e.monto / e.cuotas : e.monto;
    var mPer = m.cuotas > 1 ? m.monto / m.cuotas : m.monto;
    if (Math.abs(e.monto - m.monto) < 0.02 || Math.abs(perCuota - m.monto) < 0.02 ||
      Math.abs(e.monto - mPer) < 0.02) return e.row;
  }
  return 0;
}

/* ==================================== Fechas ===================================== */

function toIso(v, tz) {
  if (v instanceof Date) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  return '';
}

function parseIso(iso, tz) {
  return Utilities.parseDate(iso, tz, 'yyyy-MM-dd');
}

/* ================================ Movimientos ==================================== */

function getConfigValues() {
  var sh = SpreadsheetApp.getActive().getSheetByName('Config');
  return sh.getDataRange().getValues();
}

function readExistingMovs(sh, tz) {
  var last = sh.getLastRow();
  if (last < MOV_FIRST_ROW) return [];
  var vals = sh.getRange(MOV_FIRST_ROW, 1, last - MOV_FIRST_ROW + 1, 15).getValues();
  var out = [];
  for (var i = 0; i < vals.length; i++) {
    var iso = toIso(vals[i][1], tz);
    if (!iso) continue;
    out.push({ row: MOV_FIRST_ROW + i, fecha: iso, monto: Number(vals[i][6]) || 0,
      moneda: String(vals[i][7] || 'ARS'), cuotas: Number(vals[i][8]) || 1 });
  }
  return out;
}

/** Primera fila libre de Movimientos (columna Fecha vacía). Si no hay, devuelve la siguiente al final. */
function firstFreeRow(sh) {
  var last = Math.max(sh.getLastRow(), MOV_FIRST_ROW);
  var vals = sh.getRange(MOV_FIRST_ROW, 2, last - MOV_FIRST_ROW + 1, 1).getValues();
  for (var i = 0; i < vals.length; i++) {
    if (vals[i][0] === '' || vals[i][0] == null) return MOV_FIRST_ROW + i;
  }
  return last + 1;
}

/** Si la fila no existe o no tiene fórmulas, las copia de la fila anterior (ID y columnas K a N). */
function ensureFormulas(sh, row) {
  if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), row - sh.getMaxRows());
  var hasId = sh.getRange(row, 1).getFormula();
  if (!hasId && row > MOV_FIRST_ROW) {
    sh.getRange(row - 1, 1).copyTo(sh.getRange(row, 1));
    sh.getRange(row - 1, 11, 1, 4).copyTo(sh.getRange(row, 11, 1, 4));
    return true;
  }
  return false;
}

function writeMov(sh, row, m, tz) {
  var cuotas = m.cuotas == null ? 1 : Number(m.cuotas);
  var cft = (m.cft === undefined || m.cft === null || m.cft === '') ? '' : Number(m.cft);
  sh.getRange(row, 2, 1, 9).setValues([[
    parseIso(m.fecha, tz), safeCell(m.desc), m.cat, safeCell(m.sub || ''), m.medio,
    Number(m.monto), m.moneda, cuotas, cft
  ]]);
  sh.getRange(row, 15).setValue(m.estado);
}

function handleAddMovs(req) {
  var rows = req.rows;
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > MAX_ROWS_PER_CALL) {
    return { ok: false, error: 'rows_invalid' };
  }
  var ss = SpreadsheetApp.getActive();
  var tz = ss.getSpreadsheetTimeZone();
  var sh = ss.getSheetByName('Movimientos');
  var lists = readLists(getConfigValues());
  var existing = readExistingMovs(sh, tz);
  var dry = req.dryRun === true;
  var skipDup = req.skipDuplicates === true;

  var results = [];
  var next = firstFreeRow(sh);
  var extended = false;
  var okRows = 0;
  for (var i = 0; i < rows.length; i++) {
    var m = rows[i];
    var errs = validateMov(m, lists);
    if (errs.length) { results.push({ index: i, status: 'invalid', errors: errs }); continue; }
    var dupRow = findDuplicate(existing, { fecha: m.fecha, monto: Number(m.monto),
      moneda: m.moneda, cuotas: Number(m.cuotas || 1) });
    if (dupRow && skipDup) { results.push({ index: i, status: 'duplicate', matchRow: dupRow }); continue; }
    if (dry) {
      results.push({ index: i, status: dupRow ? 'would_add_possible_duplicate' : 'would_add',
        matchRow: dupRow || undefined });
      continue;
    }
    if (ensureFormulas(sh, next)) extended = true;
    writeMov(sh, next, m, tz);
    existing.push({ row: next, fecha: m.fecha, monto: Number(m.monto), moneda: m.moneda,
      cuotas: Number(m.cuotas || 1) });
    results.push({ index: i, status: 'added', row: next, possibleDuplicateOf: dupRow || undefined });
    next++; okRows++;
  }
  var res = { ok: true, results: results, added: okRows, dryRun: dry, extendedFormulas: extended };
  if (!dry && next - 1 > FORMULA_LAST_ROW) res.warning = 'beyond_formula_range';
  return res;
}

/* ================================== Impuestos ==================================== */

function getOrCreateSheet(name, header) {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, header.length).setValues([header]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function handleAddImpuestos(req) {
  var rows = req.rows;
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > MAX_ROWS_PER_CALL) {
    return { ok: false, error: 'rows_invalid' };
  }
  var ss = SpreadsheetApp.getActive();
  var tz = ss.getSpreadsheetTimeZone();
  var sh = getOrCreateSheet('Impuestos', IMPUESTOS_HEADER);
  var last = sh.getLastRow();
  var existing = last > 1 ? sh.getRange(2, 1, last - 1, 6).getValues() : [];
  var keys = {};
  existing.forEach(function (r) {
    keys[[toIso(r[0], tz), normName(r[1]), normName(r[2]), Number(r[3]).toFixed(2)].join('|')] = true;
  });
  var results = [], toWrite = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var monto = toNumber(r && r.monto);
    var errs = [];
    if (!r || !isIsoDate(r.fecha)) errs.push('fecha');
    if (isNaN(monto) || monto === 0) errs.push('monto');
    if (!cleanText(r && r.tipo, 60)) errs.push('tipo');
    if (!cleanText(r && r.origen, 40)) errs.push('origen');
    if (!r || !/^\d{4}-\d{2}$/.test(String(r.resumen || ''))) errs.push('resumen');
    if (errs.length) { results.push({ index: i, status: 'invalid', errors: errs }); continue; }
    var key = [r.fecha, normName(r.origen), normName(r.tipo), monto.toFixed(2)].join('|');
    if (keys[key]) { results.push({ index: i, status: 'duplicate' }); continue; }
    keys[key] = true;
    if (req.dryRun === true) { results.push({ index: i, status: 'would_add' }); continue; }
    toWrite.push([parseIso(r.fecha, tz), safeCell(r.origen), safeCell(r.tipo), monto, r.resumen, safeCell(r.nota || '')]);
    results.push({ index: i, status: 'added' });
  }
  if (toWrite.length) sh.getRange(sh.getLastRow() + 1, 1, toWrite.length, 6).setValues(toWrite);
  return { ok: true, results: results, added: toWrite.length, dryRun: req.dryRun === true };
}

/* ================================== Inversiones ================================== */

function handleAddAporte(req) {
  var ss = SpreadsheetApp.getActive();
  var tz = ss.getSpreadsheetTimeZone();
  var monto = toNumber(req.monto);
  if (!isIsoDate(req.fecha)) return { ok: false, error: 'fecha' };
  if (isNaN(monto) || monto === 0) return { ok: false, error: 'monto' };
  var destino = cleanText(req.destino, 60);
  if (!destino) return { ok: false, error: 'destino' };
  var sh = ss.getSheetByName('Inversiones');
  var vals = sh.getRange(INV_FIRST_ROW, 1, INV_LAST_ROW - INV_FIRST_ROW + 1, 1).getValues();
  var row = 0;
  for (var i = 0; i < vals.length; i++) {
    if (vals[i][0] === '' || vals[i][0] == null) { row = INV_FIRST_ROW + i; break; }
  }
  if (!row) return { ok: false, error: 'inversiones_full' };
  sh.getRange(row, 1, 1, 4).setValues([[parseIso(req.fecha, tz), monto, safeCell(destino), safeCell(req.nota || '')]]);
  return { ok: true, row: row };
}

/* ==================================== Config ===================================== */

function handleSetIngreso(req) {
  var ss = SpreadsheetApp.getActive();
  var tz = ss.getSpreadsheetTimeZone();
  var monto = toNumber(req.monto);
  if (!/^\d{4}-\d{2}$/.test(String(req.period || ''))) return { ok: false, error: 'period' };
  if (!isIsoDate(req.fecha)) return { ok: false, error: 'fecha' };
  if (isNaN(monto) || monto <= 0) return { ok: false, error: 'monto' };
  var sh = ss.getSheetByName('Config');
  var vals = sh.getDataRange().getValues();
  var h = -1;
  for (var i = 0; i < vals.length; i++) if (String(vals[i][0]).indexOf('INGRESOS') === 0) { h = i; break; }
  if (h < 0) return { ok: false, error: 'ingresos_no_encontrado' };
  for (var r = h + 2; r < vals.length; r++) {
    var p = vals[r][0] instanceof Date ? Utilities.formatDate(vals[r][0], tz, 'yyyy-MM') : String(vals[r][0]);
    if (p === req.period) {
      sh.getRange(r + 1, 2, 1, 2).setValues([[parseIso(req.fecha, tz), monto]]);
      return { ok: true, row: r + 1 };
    }
  }
  return { ok: false, error: 'period_not_listed' };
}

function handleAddCategoria(req) {
  var name = cleanText(req.nombre, 40);
  if (!name || /^[=+\-@]/.test(name)) return { ok: false, error: 'nombre' };
  var sh = SpreadsheetApp.getActive().getSheetByName('Config');
  var vals = sh.getDataRange().getValues();
  var lists = readLists(vals);
  if (!lists.headerRow) return { ok: false, error: 'config_sin_listas' };
  var exists = lists.todasCategorias.some(function (c) { return normName(c) === normName(name); });
  if (exists) return { ok: false, error: 'ya_existe' };
  var headerRow = lists.headerRow;
  // Las categorías nuevas van en la columna I, debajo del encabezado, para no pisar el bloque de ingresos.
  var row = headerRow + 1 + lists.extras.length;
  if (lists.extras.length === 0) sh.getRange(headerRow, 9).setValue('CATEGORÍAS NUEVAS (panel)');
  sh.getRange(row, 9).setValue(name);
  return { ok: true, row: row };
}

function handleSetSetting(req) {
  if (SETTINGS_ALLOWED.indexOf(req.key) === -1) return { ok: false, error: 'key_not_allowed' };
  var value = req.value === null ? '' : req.value;
  if (typeof value === 'string') value = cleanText(value, 80);
  else if (typeof value !== 'number' || !isFinite(value) || value < 0) return { ok: false, error: 'value' };
  var sh = getOrCreateSheet('Panel_Config', SETTINGS_HEADER);
  var vals = sh.getDataRange().getValues();
  for (var i = 1; i < vals.length; i++) {
    if (vals[i][0] === req.key) {
      sh.getRange(i + 1, 2, 1, 2).setValues([[value, new Date()]]);
      return { ok: true };
    }
  }
  sh.getRange(sh.getLastRow() + 1, 1, 1, 3).setValues([[req.key, value, new Date()]]);
  return { ok: true };
}

/* =================================== Captura ===================================== */

/**
 * Lee el texto de una notificación del banco. Ejemplos:
 *   "Pagaste $6.200 A KIOSCO EJEMPLO con tu Visa Crédito: 1111 a las 18:04"
 *   "Pagaste: $3.285,84 A COMERCIO EJEMPLO con tu Visa Débito 2222 a las 09:49"
 */
function parseNotification(text) {
  var t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  var m = t.match(/Pagaste:?\s*\$\s*([\d.]+(?:,\d{1,2})?)\s+A\s+(.+?)\s+con tu Visa\s+(Cr[eé]dito|D[eé]bito)\s*:?\s*(\d{4})(?:\s+a las\s+(\d{1,2}):(\d{2}))?/i);
  if (!m) return null;
  var monto = Number(m[1].replace(/\./g, '').replace(',', '.'));
  if (!isFinite(monto) || monto <= 0) return null;
  return {
    monto: monto,
    comercio: cleanText(m[2], 80),
    medio: /^cr/i.test(m[3]) ? 'Tarjeta de Crédito' : 'Débito',
    tarjeta: m[4],
    hora: m[5] ? ('0' + m[5]).slice(-2) + ':' + m[6] : ''
  };
}

function handleCapture(req) {
  var auth = authenticate('capture', req.key, 'CAPTURE_KEY');
  if (!auth.ok) return auth;
  var text = String(req.texto == null ? '' : req.texto);
  if (!text.trim() || text.length > 1000) return { ok: false, error: 'texto' };

  return withLock(function () {
    var ss = SpreadsheetApp.getActive();
    var tz = ss.getSpreadsheetTimeZone();
    var sh = getOrCreateSheet('Bandeja', BANDEJA_HEADER);
    var last = sh.getLastRow();
    var rows = last > 1 ? sh.getRange(2, 1, last - 1, 11).getValues() : [];
    var pending = rows.filter(function (r) { return r[8] === 'pendiente' || r[8] === 'sin_parsear'; }).length;
    if (pending >= MAX_BANDEJA_PENDIENTES) return { ok: false, error: 'bandeja_llena' };

    var received = req.recibido ? new Date(req.recibido) : new Date();
    if (isNaN(received.getTime())) received = new Date();
    var day = Utilities.formatDate(received, tz, 'yyyy-MM-dd');
    var p = parseNotification(text);
    var key = p ? [day, p.monto.toFixed(2), normName(p.comercio), p.tarjeta, p.hora].join('|')
      : 'raw|' + normName(text).slice(0, 80) + '|' + day;
    for (var i = 0; i < rows.length; i++) if (rows[i][9] === key) return { ok: true, status: 'duplicate' };

    var id = Utilities.getUuid().slice(0, 8);
    sh.getRange(last + 1, 1, 1, 11).setValues([[
      id, received, cleanText(text, 300), p ? p.monto : '', p ? p.comercio : '', p ? p.medio : '',
      p ? p.tarjeta : '', p ? p.hora : '', p ? 'pendiente' : 'sin_parsear', key, ''
    ]]);
    return { ok: true, status: p ? 'queued' : 'queued_unparsed', id: id };
  });
}

function handleBandejaResolve(req) {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName('Bandeja');
  if (!sh) return { ok: false, error: 'bandeja_vacia' };
  var vals = sh.getDataRange().getValues();
  var rowIdx = -1;
  for (var i = 1; i < vals.length; i++) if (vals[i][0] === req.id) { rowIdx = i; break; }
  if (rowIdx < 0) return { ok: false, error: 'id_no_encontrado' };
  var estado = vals[rowIdx][8];
  if (estado === 'resuelto' || estado === 'descartado') return { ok: false, error: 'ya_resuelto' };

  if (req.accion === 'descartar') {
    sh.getRange(rowIdx + 1, 9).setValue('descartado');
    return { ok: true, status: 'descartado' };
  }
  if (req.accion !== 'confirmar') return { ok: false, error: 'accion' };

  var added = handleAddMovs({ rows: [req.row], skipDuplicates: false });
  if (!added.ok || added.added !== 1) return { ok: false, error: 'no_se_pudo_cargar', detail: added.results };
  sh.getRange(rowIdx + 1, 9).setValue('resuelto');
  sh.getRange(rowIdx + 1, 11).setValue('Movimientos fila ' + added.results[0].row);
  return { ok: true, status: 'resuelto', row: added.results[0].row };
}
