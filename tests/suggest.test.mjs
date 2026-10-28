// Datos inventados. Ejecutar con: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { buildSuggester, subcategoriesByCat, tokens } from "../js/suggest.js";

const h = (desc, cat, sub, medio = "Débito") => ({ desc, cat, sub, medio });
const history = [
  h("PedidosYa Mostaza", "Alimentación", "Delivery", "Tarjeta de Crédito"),
  h("PedidosYa propina", "Alimentación", "Delivery", "Tarjeta de Crédito"),
  h("PedidosYa propina", "Alimentación", "Delivery", "Débito"),
  h("PedidosYa Plus", "Ocio y Entretenimiento", "PedidosYa Plus"),
  h("Kiosco Patio 1", "Alimentación", "Kiosco/Facultad"),
  h("Kiosco Quinto 2", "Alimentación", "Kiosco/Facultad"),
  h("MercadoPago*GymEjemplo", "Salud", "Gimnasio", "Tarjeta de Crédito"),
  h("Provincias Unidas (combustible)", "Transporte", "Combustible", "Tarjeta de Crédito"),
  h("REVISAR – Lima 1 6", "Alimentación", "Kiosco/Facultad"),
  h("Transf. sin nombre", "Otros/Imprevistos", "Sin identificar", "Transferencia"),
];
const suggest = buildSuggester(history);

test("tokens ignora pasarelas, números y palabras vacías", () => {
  assert.deepEqual(tokens("MERPAGO*PIER54 con tu Visa 6130"), ["pier54"]);
  assert.deepEqual(tokens("DLO*PedidosYa Propina"), ["pedidosya", "propina"]);
});

test("sugiere según el comercio y conserva el medio de pago más usado en esa combinación", () => {
  assert.deepEqual(suggest("PEDIDOSYA*SABORES DE BA"), { cat: "Alimentación", sub: "Delivery", medio: "Tarjeta de Crédito" });
  assert.deepEqual(suggest("Kiosco Quinto 1"), { cat: "Alimentación", sub: "Kiosco/Facultad", medio: "Débito" });
  assert.equal(suggest("MERPAGO*GYMEJEMPLO").cat, "Salud");
});

test("una palabra específica gana a una genérica", () => {
  assert.equal(suggest("PedidosYa Plus").cat, "Ocio y Entretenimiento");
  assert.equal(suggest("PedidosYa propina").sub, "Delivery");
});

test("sin coincidencias no inventa nada", () => {
  assert.equal(suggest("MERPAGO*PIER54"), null);
  assert.equal(suggest(""), null);
  assert.equal(suggest("xx"), null);
});

test("no aprende de filas sin clasificar ni de las marcadas para revisar", () => {
  assert.equal(suggest("Lima"), null);
  assert.equal(suggest("Transf sin nombre"), null);
});

test("subcategorías por categoría, de la más a la menos usada", () => {
  const s = subcategoriesByCat(history);
  assert.deepEqual(s["Alimentación"], ["Delivery", "Kiosco/Facultad"]);
  assert.equal(s["Otros/Imprevistos"], undefined);
});
