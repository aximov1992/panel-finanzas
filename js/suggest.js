// Sugerencia de categoría, subcategoría y medio de pago a partir de lo ya cargado.
// Funciones puras, sin DOM.

const STOP = new Set([
  "mercadopago", "merpago", "mp", "dlo", "www", "com", "ar", "compra", "pago", "pagos",
  "con", "tu", "visa", "a", "de", "la", "el", "los", "las", "y", "en", "del",
]);

export function norm(s) {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Palabras que identifican al comercio: sin prefijos de pasarela ni números sueltos.
export function tokens(s) {
  return norm(s)
    .split(" ")
    .filter((t) => t.length >= 3 && !STOP.has(t) && !/^\d+$/.test(t));
}

/**
 * Arma un índice por comercio a partir de los movimientos. Cada entrada cuenta cuántas veces
 * una palabra apareció con cada combinación de categoría, subcategoría y medio.
 */
export function buildSuggester(movs) {
  const byToken = new Map();
  for (const m of movs) {
    if (!m.cat || /^revisar/i.test(m.desc) || m.sub === "Sin identificar" || m.sub === "Sin clasificar") continue;
    const key = `${m.cat}\u0001${m.sub}\u0001${m.medio}`;
    for (const t of new Set(tokens(m.desc))) {
      if (!byToken.has(t)) byToken.set(t, new Map());
      const inner = byToken.get(t);
      inner.set(key, (inner.get(key) ?? 0) + 1);
    }
  }

  return function suggest(text) {
    const toks = [...new Set(tokens(text))];
    if (!toks.length) return null;
    const score = new Map();
    for (const t of toks) {
      const inner = byToken.get(t);
      if (!inner) continue;
      // Una palabra rara pesa más que una común: se reparte por la cantidad de combinaciones distintas.
      const total = [...inner.values()].reduce((a, b) => a + b, 0);
      for (const [key, n] of inner) score.set(key, (score.get(key) ?? 0) + n / total + n * 0.01);
    }
    if (!score.size) return null;
    const [best] = [...score.entries()].sort((a, b) => b[1] - a[1]);
    const [cat, sub, medio] = best[0].split("\u0001");
    return { cat, sub, medio };
  };
}

/** Subcategorías ya usadas por categoría, ordenadas de la más a la menos frecuente. */
export function subcategoriesByCat(movs) {
  const count = new Map();
  for (const m of movs) {
    if (!m.cat || !m.sub || m.sub === "Sin identificar" || m.sub === "Sin clasificar") continue;
    if (!count.has(m.cat)) count.set(m.cat, new Map());
    const inner = count.get(m.cat);
    inner.set(m.sub, (inner.get(m.sub) ?? 0) + 1);
  }
  const out = {};
  for (const [cat, inner] of count) out[cat] = [...inner.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s);
  return out;
}
