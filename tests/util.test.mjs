// Datos inventados. Ejecutar con: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { parseAmount, prettyMerchant, findSimilar, resumenDeImpuesto, estadoInicial } from "../js/util.js";

test("parseAmount entiende los formatos argentinos", () => {
  assert.equal(parseAmount("6.200"), 6200);
  assert.equal(parseAmount("6200"), 6200);
  assert.equal(parseAmount("3.285,84"), 3285.84);
  assert.equal(parseAmount("1.234.567,89"), 1234567.89);
  assert.equal(parseAmount("$ 500"), 500);
  assert.equal(parseAmount("12,5"), 12.5);
  assert.equal(parseAmount("6.20"), 6.2);
  assert.equal(parseAmount("-72.000"), -72000);
  assert.ok(Number.isNaN(parseAmount("")));
  assert.ok(Number.isNaN(parseAmount("abc")));
});

test("prettyMerchant solo toca los nombres todo en mayúsculas", () => {
  assert.equal(prettyMerchant("PEDIDOSYA*SABORES DE BA"), "Pedidosya*Sabores De Ba");
  assert.equal(prettyMerchant("KIOSCO EJEMPLO 1"), "Kiosco Ejemplo 1");
  assert.equal(prettyMerchant("MercadoPago*Gym"), "MercadoPago*Gym");
  assert.equal(prettyMerchant("  "), "");
});

test("findSimilar detecta la misma compra por monto o monto de cuota", () => {
  const movs = [
    { fecha: "2026-10-19", monto: 1500, moneda: "ARS", cuotas: 1, desc: "Igual" },
    { fecha: "2026-06-23", monto: 99000, moneda: "ARS", cuotas: 6, desc: "En cuotas" },
    { fecha: "2026-10-19", monto: 20, moneda: "USD", cuotas: 1, desc: "Dólares" },
  ];
  assert.equal(findSimilar(movs, { fecha: "2026-10-20", monto: 1500, moneda: "ARS" }).desc, "Igual");
  assert.equal(findSimilar(movs, { fecha: "2026-10-22", monto: 1500, moneda: "ARS" }), null);
  assert.equal(findSimilar(movs, { fecha: "2026-06-23", monto: 16500, moneda: "ARS" }).desc, "En cuotas");
  assert.equal(findSimilar(movs, { fecha: "2026-10-19", monto: 1500, moneda: "USD" }), null);
});

test("resumenDeImpuesto toma el resumen que cierra ese día o después", () => {
  const cycles = [
    { period: "2026-09", cierre: "2026-09-10" },
    { period: "2026-10", cierre: "2026-10-08" },
    { period: "2026-11", cierre: "2026-11-08" },
  ];
  assert.equal(resumenDeImpuesto("2026-10-08", cycles), "2026-10");
  assert.equal(resumenDeImpuesto("2026-10-09", cycles), "2026-11");
  assert.equal(resumenDeImpuesto("2027-05-01", cycles), "2027-05");
});

test("estadoInicial", () => {
  assert.equal(estadoInicial("Tarjeta de Crédito"), "Pendiente");
  assert.equal(estadoInicial("Débito"), "Pagado");
});
