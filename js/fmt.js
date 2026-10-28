// Formatos de presentación (es-AR).
const nfARS = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const nfUSD = new Intl.NumberFormat("es-AR", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
export const nfPct = new Intl.NumberFormat("es-AR", { style: "percent", maximumFractionDigits: 0 });
const nfDec = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 });

export const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
export const MES_LARGO = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

export const ars = (v) => nfARS.format(Math.round(v || 0));
export const usd = (v) => nfUSD.format(v || 0);
export const dec = (v) => nfDec.format(v || 0);
export const day = (ymd) => (ymd ? `${Number(ymd.slice(8, 10))} ${MES[Number(ymd.slice(5, 7)) - 1]}` : "");
export const periodLong = (p) => `${MES_LARGO[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`;
export const periodShort = (p) => `${MES[Number(p.slice(5, 7)) - 1]} ${p.slice(2, 4)}`;
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
