// Contrôles de cohérence de data.json, partagés par le back-office (affichage en direct) et les tests.
import { ACTIVITIES, compute, usableModels } from "./calc.js";

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
export const SAMPLE_INPUT = {
  phase: "production",
  requestsPerMonth: 100_000,
  inputTokensPerMonth: 100_000_000,
  outputTokensPerMonth: 100_000_000,
  embeddingTokensPerMonth: 1_000_000_000,
  mixMode: "default",
};

/** Renvoie la liste des problèmes (chaînes) ; une liste vide signifie des données utilisables. */
export function validate(data) {
  const issues = [];
  const usable = usableModels(data);
  const names = new Set();

  for (const [i, m] of data.models.entries()) {
    const id = m.name || `ligne ${i + 1}`;
    if (!m.name) issues.push(`Modèle ligne ${i + 1} : nom manquant.`);
    if (names.has(m.name)) issues.push(`Modèle « ${m.name} » en double.`);
    names.add(m.name);
    if (!m.provider) issues.push(`Modèle « ${id} » : fournisseur manquant.`);
    if (!(isNum(m.pTotal) && m.pTotal > 0)) issues.push(`Modèle « ${id} » : pTotal doit être un nombre positif.`);
    if (m.category === "Embedding") continue; // seul le nombre de paramètres sert au calcul du RAG
    for (const k of ["pActive", "flopsPerJoule"]) if (!(isNum(m[k]) && m[k] > 0)) issues.push(`Modèle « ${id} » : ${k} doit être un nombre positif.`);
    if (!(isNum(m.pue) && m.pue >= 1)) issues.push(`Modèle « ${id} » : le PUE doit être ≥ 1.`);
    for (const k of ["wue", "computeKw"]) if (!(isNum(m[k]) && m[k] >= 0)) issues.push(`Modèle « ${id} » : ${k} doit être un nombre ≥ 0.`);
    if (m.tps != null && !(isNum(m.tps) && m.tps > 0)) issues.push(`Modèle « ${id} » : le TPS doit être positif (ou vide pour la formule Ecologits).`);
    if (Number.isNaN(Date.parse(m.published))) issues.push(`Modèle « ${id} » : date de publication invalide.`);
  }
  if (!usable.some((m) => m.name === data.meta?.defaultModel)) issues.push(`Modèle par défaut introuvable : ${data.meta?.defaultModel}.`);
  for (const n of data.meta?.comparisonModels ?? []) if (!usable.some((m) => m.name === n)) issues.push(`Modèle de comparaison introuvable : ${n}.`);

  for (const [k, p] of Object.entries(data.parameters)) {
    if (p.value === null || p.value === "" || (typeof p.value === "number" && !Number.isFinite(p.value))) issues.push(`Paramètre « ${p.label} » (${k}) : valeur manquante.`);
  }
  if (!data.models.some((m) => m.name === data.parameters.embeddingModel?.value)) issues.push(`Le modèle d'embedding « ${data.parameters.embeddingModel?.value} » n'existe pas dans la liste des modèles.`);

  const keys = new Set();
  for (const d of data.dimensions) {
    if (!/^[a-z][a-zA-Z0-9_]*$/.test(d.key ?? "")) issues.push(`Dimension « ${d.label} » : clé invalide (lettres et chiffres, commence par une minuscule).`);
    if (keys.has(d.key)) issues.push(`Dimension « ${d.key} » en double.`);
    keys.add(d.key);
    for (const a of Object.keys(ACTIVITIES)) {
      const f = d.factors?.[a];
      if (!(isNum(f) || (a === "gridInference" && f === "mix"))) issues.push(`Dimension « ${d.label} » : facteur « ${a} » manquant ou non numérique.`);
    }
    if (!d.scale?.length || d.scale.some(([f, u]) => !isNum(f) || !u)) issues.push(`Dimension « ${d.label} » : échelle d'unités invalide.`);
    if (d.factors?.gridInference === "mix") {
      for (const m of data.mixes) if (!isNum(m.values?.[d.key])) issues.push(`Mix « ${m.name} » : valeur manquante pour la dimension « ${d.label} ».`);
    }
  }
  if (data.mixes.filter((m) => m.default).length !== 1) issues.push("Il faut exactement un mix électrique par défaut.");

  if (!issues.length) {
    for (const m of usable) {
      try {
        const r = compute(data, m.name, SAMPLE_INPUT);
        for (const d of data.dimensions) if (!isNum(r.total[d.key])) issues.push(`Calcul de « ${m.name} » : résultat non numérique pour « ${d.label} ».`);
      } catch (e) {
        issues.push(`Calcul de « ${m.name} » impossible : ${e.message}`);
      }
    }
  }
  return issues;
}
