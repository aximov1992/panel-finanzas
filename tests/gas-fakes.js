// Simulación mínima de Apps Script para probar apps-script/Code.gs en Node.
// Se ejecuta dentro del mismo contexto (vm) que Code.gs, así los Date son del mismo "mundo".
// Todos los datos de prueba son inventados.

var __props = {};
var __cache = {};
var __uuid = 0;
var __book = null;

function __cellKey(r, c) { return r + ',' + c; }

function FakeSheet(name, maxRows) {
  this.name = name;
  this.maxRows = maxRows || 1000;
  this.cells = {};      // "r,c" -> valor
  this.formulas = {};   // "r,c" -> plantilla de fórmula
  this.frozen = 0;
}
FakeSheet.prototype.getName = function () { return this.name; };
FakeSheet.prototype.setFrozenRows = function (n) { this.frozen = n; };
FakeSheet.prototype.getMaxRows = function () { return this.maxRows; };
FakeSheet.prototype.insertRowsAfter = function (after, n) { this.maxRows += n; };
FakeSheet.prototype._extent = function () {
  var rows = 0, cols = 0, self = this;
  [this.cells, this.formulas].forEach(function (m) {
    Object.keys(m).forEach(function (k) {
      var p = k.split(',').map(Number);
      var empty = (m === self.cells) && (m[k] === '' || m[k] == null);
      if (!empty) { rows = Math.max(rows, p[0]); cols = Math.max(cols, p[1]); }
    });
  });
  return { rows: rows, cols: cols };
};
FakeSheet.prototype.getLastRow = function () { return this._extent().rows; };
FakeSheet.prototype.getRange = function (r, c, nr, nc) {
  var sheet = this; nr = nr || 1; nc = nc || 1;
  return {
    getValues: function () {
      var out = [];
      for (var i = 0; i < nr; i++) {
        var row = [];
        for (var j = 0; j < nc; j++) {
          var k = __cellKey(r + i, c + j);
          row.push(sheet.cells[k] !== undefined ? sheet.cells[k] : '');
        }
        out.push(row);
      }
      return out;
    },
    setValues: function (vals) {
      for (var i = 0; i < nr; i++) for (var j = 0; j < nc; j++) {
        var k = __cellKey(r + i, c + j);
        sheet.cells[k] = vals[i][j];
        delete sheet.formulas[k];
      }
    },
    setValue: function (v) {
      var k = __cellKey(r, c);
      sheet.cells[k] = v; delete sheet.formulas[k];
    },
    getFormula: function () { return sheet.formulas[__cellKey(r, c)] || ''; },
    copyTo: function (target) {
      // Copia fórmulas (y valores no vacíos) de este rango al destino, celda por celda.
      var t = target.__origin;
      for (var i = 0; i < nr; i++) for (var j = 0; j < nc; j++) {
        var from = __cellKey(r + i, c + j), to = __cellKey(t.r + i, t.c + j);
        if (sheet.formulas[from]) { sheet.formulas[to] = sheet.formulas[from]; sheet.cells[to] = ''; }
      }
    },
    __origin: { r: r, c: c }
  };
};
FakeSheet.prototype.getDataRange = function () {
  var ext = this._extent(), sheet = this;
  return { getValues: function () { return sheet.getRange(1, 1, ext.rows || 1, ext.cols || 1).getValues(); } };
};

function FakeBook() { this.sheets = {}; }
FakeBook.prototype.getSheetByName = function (n) { return this.sheets[n] || null; };
FakeBook.prototype.insertSheet = function (n) { this.sheets[n] = new FakeSheet(n, 1000); return this.sheets[n]; };
FakeBook.prototype.getSpreadsheetTimeZone = function () { return 'America/Argentina/Buenos_Aires'; };

var SpreadsheetApp = { getActive: function () { return __book; } };

var Utilities = {
  parseDate: function (iso) { return new Date(iso + 'T03:00:00Z'); }, // medianoche en UTC-3
  formatDate: function (d, tz, fmt) {
    var local = new Date(d.getTime() - 3 * 3600 * 1000).toISOString();
    return fmt === 'yyyy-MM' ? local.slice(0, 7) : local.slice(0, 10);
  },
  getUuid: function () { __uuid++; return ('0000000' + __uuid.toString(16)).slice(-8) + '-fake'; }
};

var ContentService = {
  MimeType: { JSON: 'json' },
  createTextOutput: function (s) { return { text: s, setMimeType: function () { return this; } }; }
};
var PropertiesService = { getScriptProperties: function () { return { getProperty: function (k) { return __props[k] || null; } }; } };
var CacheService = {
  getScriptCache: function () {
    return {
      get: function (k) { return __cache[k] === undefined ? null : __cache[k]; },
      put: function (k, v) { __cache[k] = v; },
      remove: function (k) { delete __cache[k]; }
    };
  }
};
var LockService = { getScriptLock: function () { return { waitLock: function () {}, releaseLock: function () {} }; } };

/* ---- armado del libro de prueba ---- */

function __d(iso) { return new Date(iso + 'T03:00:00Z'); }

function __buildBook(opts) {
  opts = opts || {};
  __cache = {}; __uuid = 0;
  __props = { PIN: 'clave-de-prueba-1', CAPTURE_KEY: 'clave-captura-1' };
  var book = new FakeBook();

  // Config con la misma disposición que la planilla real
  var cfg = book.insertSheet('Config');
  cfg.maxRows = 108;
  var cats = ['Vivienda', 'Transporte', 'Alimentación', 'Salud', 'Educación', 'Ocio y Entretenimiento',
    'Indumentaria y Cuidado Personal', 'Tecnología', 'Ahorro e Inversión', 'Otros/Imprevistos'];
  cfg.cells['4,3'] = 1000;
  cfg.cells['58,1'] = 'CATEGORÍAS'; cfg.cells['58,3'] = 'MEDIOS DE PAGO'; cfg.cells['58,5'] = 'MONEDA'; cfg.cells['58,7'] = 'ESTADO';
  cats.forEach(function (c, i) { cfg.cells[(59 + i) + ',1'] = c; });
  ['Tarjeta de Crédito', 'Débito', 'Transferencia', 'Efectivo'].forEach(function (c, i) { cfg.cells[(59 + i) + ',3'] = c; });
  ['ARS', 'USD'].forEach(function (c, i) { cfg.cells[(59 + i) + ',5'] = c; });
  ['Pendiente', 'Pagado'].forEach(function (c, i) { cfg.cells[(59 + i) + ',7'] = c; });
  cfg.cells['71,1'] = 'INGRESOS (sueldo — mini-registro por mes)';
  cfg.cells['72,1'] = 'Período (AAAA-MM)'; cfg.cells['72,2'] = 'Fecha de Cobro'; cfg.cells['72,3'] = 'Monto (ARS)';
  var months = ['2026-08', '2026-09', '2026-10', '2026-11'];
  months.forEach(function (m, i) { cfg.cells[(73 + i) + ',1'] = m; });

  // Movimientos: fórmulas precargadas hasta la fila 503
  var mov = book.insertSheet('Movimientos');
  mov.maxRows = 503;
  mov.cells['3,1'] = 'ID';
  var filled = opts.fillAll ? 500 : (opts.preloaded || 0);
  for (var r = 4; r <= 503; r++) {
    mov.formulas[r + ',1'] = '=ID(#)'; mov.cells[r + ',1'] = '';
    [11, 12, 13, 14].forEach(function (c) { mov.formulas[r + ',' + c] = '=F' + c + '(#)'; mov.cells[r + ',' + c] = ''; });
  }
  for (var i = 0; i < filled; i++) {
    var row = 4 + i;
    mov.cells[row + ',2'] = __d('2026-09-01');
    mov.cells[row + ',3'] = 'Compra de prueba ' + i; mov.cells[row + ',4'] = 'Alimentación';
    mov.cells[row + ',6'] = 'Débito'; mov.cells[row + ',7'] = 1000 + i; mov.cells[row + ',8'] = 'ARS';
    mov.cells[row + ',9'] = 1; mov.cells[row + ',15'] = 'Pagado';
  }
  if (opts.existing) {
    opts.existing.forEach(function (e, k) {
      var row = 4 + filled + k;
      mov.cells[row + ',2'] = __d(e.fecha); mov.cells[row + ',3'] = e.desc; mov.cells[row + ',4'] = e.cat;
      mov.cells[row + ',6'] = e.medio; mov.cells[row + ',7'] = e.monto; mov.cells[row + ',8'] = e.moneda;
      mov.cells[row + ',9'] = e.cuotas; mov.cells[row + ',15'] = 'Pagado';
    });
  }

  // Inversiones con una fila de ejemplo en la 4
  var inv = book.insertSheet('Inversiones');
  inv.maxRows = 83;
  inv.cells['3,1'] = 'Fecha';
  inv.cells['4,1'] = __d('2026-09-15'); inv.cells['4,2'] = 0; inv.cells['4,3'] = 'EJEMPLO';
  if (opts.invFull) for (var q = 5; q <= 83; q++) inv.cells[q + ',1'] = __d('2026-09-16');

  __book = book;
  return book;
}

function __sheetValues(name) {
  var sh = __book.getSheetByName(name);
  return sh ? sh.getDataRange().getValues().map(function (r) {
    return r.map(function (v) { return v instanceof Date ? v.toISOString().slice(0, 10) : v; });
  }) : null;
}

function __cell(name, r, c) {
  var sh = __book.getSheetByName(name);
  var v = sh.cells[r + ',' + c];
  return v instanceof Date ? v.toISOString().slice(0, 10) : (v === undefined ? '' : v);
}

function __formula(name, r, c) { return __book.getSheetByName(name).formulas[r + ',' + c] || ''; }
function __maxRows(name) { return __book.getSheetByName(name).maxRows; }

function __call(req) {
  var res = doPost({ postData: { contents: JSON.stringify(req) } });
  return res.text;
}
