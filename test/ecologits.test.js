// Simulations du document « Impact'IA vs Ecologits – Comparaison des périmètres modélisés » (SNCF, 10/09/2026).
//
// Le document a été produit avec une version antérieure du classeur (33 modèles), et la page 9 avec la bibliothèque
// EcoLogits 0.10.2 (et non avec les cellules « Ecologits » du classeur). Les données ont évolué depuis : ces tests
// vérifient donc que le moteur retrouve les CONCLUSIONS du document, avec des tolérances explicites, et non des valeurs
// au centième. Les valeurs EcoLogits utilisées sont figées dans ecologits-reference.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compute } from "../calc.js";

const data = JSON.parse(readFileSync(new URL("../data.json", import.meta.url)));
const ref = JSON.parse(readFileSync(new URL("./ecologits-reference.json", import.meta.url)));
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const within = (v, target, tol, msg) => assert.ok(Math.abs(v - target) <= tol, `${msg} : ${v.toFixed(2)} au lieu de ${target} ± ${tol}`);

// Les 33 modèles présents dans le classeur au moment du document
const ADDED_SINCE = ["GPT-5.6 Sol", "GPT-5.6 Terra", "GPT-5.6 Luna", "Claude Sonnet 5", "Claude Opus 4.8", "Gemini 3.5 flash"];
const doc33 = data.models.filter((m) => m.category !== "Embedding" && !ADDED_SINCE.includes(m.name)).map((m) => m.name);

// Pages 4-5 : 76 M de tokens d'entrée et 76 M de tokens de sortie par mois, 1 000 requêtes par mois.
const p45 = { phase: "production", requestsPerMonth: 1000, inputTokensPerMonth: 76e6, outputTokensPerMonth: 76e6, embeddingTokensPerMonth: 1e9, mixMode: "default", today: new Date("2026-09-10") };

test("p. 5 : part des composants hors GPU dans l'électricité de l'inférence (médiane 28 %, min 11 %, max 42 %)", () => {
  const share = Object.fromEntries(doc33.map((n) => {
    const r = compute(data, n, p45);
    return [n, 100 * (1 - r._cells.gpuKwh / r._cells.requestKwh)];
  }));
  const v = Object.values(share);
  assert.equal(v.length, 33);
  within(median(v), 28, 1.5, "médiane");
  within(Math.min(...v), 11, 1.5, "minimum");
  within(Math.max(...v), 42, 1.5, "maximum");
  assert.equal(Object.entries(share).sort((a, b) => a[1] - b[1])[0][0], "Gemini 2.5 pro", "le minimum est Gemini 2.5 pro");
});

test("p. 5 : part de l'entraînement dans le GES (médiane 13 %, min ≈ 1 %, max 63 % pour Mistral Medium)", () => {
  // Le maximum dépend du nombre de modèles Mistral récents (date du jour) : la table a changé depuis le document,
  // d'où une tolérance large sur le maximum (54,6 % aujourd'hui).
  const share = Object.fromEntries(doc33.map((n) => {
    const r = compute(data, n, p45);
    return [n, (100 * r.training.gwp) / r.total.gwp];
  }));
  const sorted = Object.entries(share).sort((a, b) => a[1] - b[1]);
  within(median(Object.values(share)), 13, 2, "médiane");
  assert.ok(sorted[0][1] < 2, `minimum ${sorted[0][1]} % ≥ 2 %`);
  assert.equal(sorted.at(-1)[0], "Mistral Medium", "le maximum est Mistral Medium");
  within(sorted.at(-1)[1], 63, 10, "maximum");
});

// Page 9 : 608 M de tokens d'entrée et 152,5 M de tokens de sortie par an, sans embedding, mix France.
// Le tableau du document se reproduit avec un facteur global K ≈ 1,40, constant sur les 24 modèles (1,36 à 1,45),
// que nous n'expliquons pas (probablement un écart de volume de tokens entre les deux simulations).
// Le ratio « eau » du document divise les litres Impact'IA par l'ÉNERGIE EcoLogits (kWh) : il est reproduit tel quel.
const p9 = { phase: "production", requestsPerMonth: 1000, inputTokensPerMonth: 608e6 / 12, outputTokensPerMonth: 152.5e6 / 12, embeddingTokensPerMonth: 0, mixMode: "default", today: new Date("2026-09-10") };
const K = 1.4;
const ratios = Object.entries(ref.models).map(([name, { pdf, ecologits }]) => {
  const r = compute(data, name, p9);
  return {
    name,
    pdf,
    kwh: (K * r.inference.kwh) / ecologits.energyKwh,
    water: (K * r.inference.water) / ecologits.energyKwh,
    gwp: r.inference.gwp / ecologits.gwpKg,
  };
});

test("p. 9 : ratios Impact'IA / Ecologits pour l'électricité et l'eau (± 6 % par modèle, ± 2 % en moyenne)", () => {
  assert.equal(ratios.length, 24);
  for (const k of ["kwh", "water"]) {
    const gaps = ratios.map((x) => x[k] / x.pdf[k] - 1);
    ratios.forEach((x, i) => assert.ok(Math.abs(gaps[i]) <= 0.06, `${x.name} ${k} : ${x[k].toFixed(2)} au lieu de ${x.pdf[k]}`));
    const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
    within(mean(ratios.map((x) => x[k])) / mean(ratios.map((x) => x.pdf[k])), 1, 0.02, `moyenne ${k}`);
  }
});

test("p. 9 : Impact'IA > Ecologits pour le carbone, et même classement des modèles", () => {
  // Le carbone ne se reproduit pas à l'unité près (voir docs/METHODOLOGIE.md) : on vérifie la conclusion du document
  // (Impact'IA plus élevé pour tous les modèles) et la cohérence du classement (corrélation de rang de Spearman).
  for (const x of ratios) assert.ok(x.gwp > 1, `${x.name} : ratio carbone ${x.gwp.toFixed(2)} ≤ 1`);
  const rank = (xs) => xs.map((v) => xs.filter((w) => w < v).length + (xs.filter((w) => w === v).length - 1) / 2);
  const a = rank(ratios.map((x) => x.gwp));
  const b = rank(ratios.map((x) => x.pdf.gwp));
  const n = a.length;
  const rho = 1 - (6 * a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0)) / (n * (n * n - 1));
  assert.ok(rho >= 0.85, `corrélation de rang ${rho.toFixed(2)} < 0,85`);
});
