// node --test : le moteur doit reproduire le classeur Excel Impact'IA.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compute, usableModels } from "../calc.js";

const data = JSON.parse(readFileSync(new URL("../data.json", import.meta.url)));
const close = (a, b, msg, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${msg}: ${a} ≠ ${b}`);
const today = new Date("2026-10-02");

const input = {
  phase: "production",
  requestsPerMonth: 100_000,
  inputTokensPerMonth: 100_000_000,
  outputTokensPerMonth: 100_000_000,
  embeddingTokensPerMonth: 1_000_000_000,
  mixMode: "default",
  today,
};

// Valeurs en cache du classeur source (onglet Calcul, colonnes O à R, entrées par défaut, mix France).
// Ordre : 173 GPU kWh, 181 latence, 191 préremplissage, 197 réseau kWh, 213 GES embarqué requêtes, 235 eau requêtes,
//         129 RAG kWh, 136 RAG GES, 140 RAG eau.
const excel = {
  "GPT-4.1-mini": [402.26273704761337, 29957370.632293075, 106624.36363636365, 10.472207413609011, 23.89824088593666, 6489.9834137073785, 76.57190244138515, 6.069520382584949, 920.9658161938466],
  "Mistral Large": [527.9893233134233, 33785744.07763023, 77878.90909090907, 11.810493115262222, 27.695491713441754, 6957.576144299631, 74.01950569333897, 5.95185489250002, 869.2950964263999],
  "Claude Sonnet 4": [1740.243907772168, 24223297.09090909, 223297.09090909094, 33.87098213539772, 76.93412685359685, 21315.316507728752, 71.14805935178704, 5.819481216154476, 915.7487172408403],
  "Gemini 2.5 flash lite": [60.93447772159374, 16879695.692307692, 96478.90909090909, 1.4751601245162258, 4.237191925069613, 960.8698268986147, 69.55281138425819, 5.745940284851397, 956.3688352876211],
};
for (const [model, x] of Object.entries(excel)) {
  test(`inférence ${model} = cellules Excel en cache`, () => {
    const r = compute(data, model, input);
    const [rag, front, req] = r.steps.slice(3);
    close(r._cells.gpuKwh, x[0], "GPU kWh");
    close(r._cells.latency, x[1], "latence");
    close(r._cells.prefill, x[2], "préremplissage");
    close(r._cells.networkKwh, x[3], "réseau kWh");
    close(req.impacts.gwp - r._cells.requestKwh * r.grid.gwp, x[4], "GES embarqué des requêtes");
    close(req.impacts.water, x[5], "eau des requêtes");
    close(rag.impacts.kwh, x[6], "RAG kWh");
    // [M138] Le cache Excel ajoute l'embarqué bâtiment du modèle *sélectionné* (vide) : on l'ajoute ici au modèle comparé.
    close(rag.impacts.gwp, x[7] + rag.impacts.kwh * 0.01, "RAG GES");
    close(rag.impacts.water, x[8], "RAG eau");
    close(front.impacts.kwh, 192.6042599586599, "front kWh");
    close(front.impacts.gwp, 20.730336858680822, "front GES");
    close(front.impacts.water, 3179.8962865384224, "front eau");
  });
}

// Formules du classeur recalculées hors Excel (scripts/excel-reference.py) : 39 modèles × 3 scénarios.
test("tous les modèles = formules Excel recalculées (inférence + entraînement)", () => {
  const ref = JSON.parse(readFileSync(new URL("./excel-reference.json", import.meta.url)));
  const sc = {
    prod_fr: input,
    prod_usa_noemb: { phase: "production", requestsPerMonth: 2500, inputTokensPerMonth: 3e6, outputTokensPerMonth: 7e5, embeddingTokensPerMonth: 0, mixMode: "country", country: "USA" },
    conception_custom: { phase: "conception", users: 250, requestsPerDay: 4, requestTokens: 1500, mixMode: "custom", customIntensity: 0.2 },
  };
  for (const [key, x] of Object.entries(ref)) {
    const [s, model] = key.split("|");
    const r = compute(data, model.trim(), { ...sc[s], today });
    const req = r.steps[5].impacts;
    const mine = {
      total_kwh: r.total.kwh, total_gwp: r.total.gwp, total_water: r.total.water,
      train_kwh: r.training.kwh, train_gwp: r.training.gwp, train_water: r.training.water,
      req_kwh: req.kwh, req_gwp: req.gwp, req_water: req.water, gpus: r.gpus,
    };
    for (const [k, v] of Object.entries(mine)) close(v, x[k], `${key} ${k}`);
  }
});

test("cohérence : totaux, phases et équipements", () => {
  const r = compute(data, "GPT-4o", input);
  for (const d of data.dimensions) close(r.total[d.key], r.training[d.key] + r.inference[d.key], d.key);
  close(r.equipment.reduce((a, e) => a + e.kwh, 0), r.steps[5].impacts.kwh, "équipements = traitement des requêtes");
});

test("conception : tokens dérivés des usages", () => {
  const r = compute(data, "GPT-4o", { phase: "conception", users: 10, requestsPerDay: 5, requestTokens: 400, mixMode: "country", country: "USA", today });
  assert.equal(r.project.outTokens, 10 * 5 * 400 * 365);
  assert.equal(r.project.inTokens, 10 * 5 * 400 * 5 * 365);
  assert.equal(r.project.embTokens, 0);
  assert.equal(r.grid.gwp, 0.3844);
});

test("ajouter une dimension ne demande que des données", () => {
  const gwp = data.dimensions.find((d) => d.key === "gwp");
  const copy = { ...gwp, key: "copie", factors: { ...gwp.factors, gridInference: 0.0461 } };
  const half = { key: "moitie", factors: Object.fromEntries(Object.entries(copy.factors).map(([k, v]) => [k, v / 2])), scaleRequestNetworkByGpus: false };
  const r = compute({ ...data, dimensions: [...data.dimensions, copy, half] }, "Claude Sonnet 4.5", input);
  close(r.total.copie, r.total.gwp, "dimension copiée du GES");
  close(r.total.moitie, r.total.gwp / 2, "dimension à facteurs divisés par 2");
});

test("chaque modèle se calcule et donne des valeurs finies et positives", () => {
  for (const m of usableModels(data)) {
    const r = compute(data, m.name, input);
    for (const d of data.dimensions) assert.ok(Number.isFinite(r.total[d.key]) && r.total[d.key] > 0, `${m.name} ${d.key}`);
  }
});

test("data.json passe les contrôles du back-office", async () => {
  const { validate } = await import("../validate.js");
  assert.deepEqual(validate(data), []);
  const broken = structuredClone(data);
  broken.parameters.embeddingModel.value = "inconnu";
  broken.dimensions[1].factors.server = null;
  assert.equal(validate(broken).length, 2);
});
