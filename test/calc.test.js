// node --test — compare le portage aux valeurs calculées par Excel (cache du classeur source,
// onglet Calcul colonnes O–R, entrées par défaut : Production, mix France).
import { test } from "node:test";
import assert from "node:assert/strict";
import { compute } from "../calc.js";

const input = {
  phase: "production",
  requestsPerMonth: 100_000,
  inputTokensPerMonth: 100_000_000,
  outputTokensPerMonth: 100_000_000,
  embeddingTokensPerMonth: 1_000_000_000,
  mixMode: "france",
};

// cellules : 173 gpuKwh, 181 latency, 191 prefill, 197 networkKwh, 213 requestEmbodied, 235 requestWater,
// 129 embKwh, 136 embGwp, 140 embWater, 146 frontKwh, 151 frontGwp, 155 frontWater
const excel = {
  "GPT-4.1-mini": [402.26273704761337, 29957370.632293075, 106624.36363636365, 10.472207413609011, 23.89824088593666, 6489.9834137073785, 76.57190244138515, 6.069520382584949, 920.9658161938466],
  "Mistral Large": [527.9893233134233, 33785744.07763023, 77878.90909090907, 11.810493115262222, 27.695491713441754, 6957.576144299631, 74.01950569333897, 5.95185489250002, 869.2950964263999],
  "Claude Sonnet 4": [1740.243907772168, 24223297.09090909, 223297.09090909094, 33.87098213539772, 76.93412685359685, 21315.316507728752, 71.14805935178704, 5.819481216154476, 915.7487172408403],
  "Gemini 2.5 flash lite": [60.93447772159374, 16879695.692307692, 96478.90909090909, 1.4751601245162258, 4.237191925069613, 960.8698268986147, 69.55281138425819, 5.745940284851397, 956.3688352876211],
};
const keys = ["gpuKwh", "latency", "prefill", "networkKwh", "requestEmbodied", "requestWater", "embKwh", "embGwp", "embWater"];
const close = (a, b, msg) => assert.ok(Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)), `${msg}: ${a} ≠ ${b}`);

for (const [model, vals] of Object.entries(excel)) {
  test(`inférence ${model} = Excel`, () => {
    const c = compute(model, input)._cells;
    keys.forEach((k, i) => {
      // [M138] Excel ajoute l'embarqué bâtiment du modèle *sélectionné* (vide dans le cache) : on l'ajoute au modèle comparé.
      const expected = k === "embGwp" ? vals[i] + c.embKwh * 0.01 : vals[i];
      close(c[k], expected, `${model} ${k}`);
    });
    close(c.frontKwh, 192.6042599586599, "frontKwh");
    close(c.frontGwp, 20.730336858680822, "frontGwp");
    close(c.frontWater, 3179.8962865384224, "frontWater");
  });
}

test("totaux cohérents et entraînement positif", () => {
  const r = compute("GPT-4o", { ...input, today: new Date("2026-10-02") });
  close(r.total.kwh, r.training.kwh + r.inference.kwh, "kwh");
  assert.ok(r.training.kwh > 0 && r.training.gwp > 0 && r.training.water > 0);
  close(r.equipment.reduce((a, e) => a + e.kwh, 0), r.steps[5].kwh, "équipements = traitement des requêtes");
});

test("conception : tokens dérivés des usages", () => {
  const r = compute("GPT-4o", { phase: "conception", users: 10, requestsPerDay: 5, requestTokens: 400, mixMode: "country", country: "USA" });
  assert.equal(r.project.outTokens, 10 * 5 * 400 * 365);
  assert.equal(r.project.inTokens, 10 * 5 * 400 * 5 * 365);
  assert.equal(r.project.embTokens, 0);
  assert.equal(r.project.ef, 0.3844);
});

// Valeurs produites en recalculant les formules du classeur (scripts/excel-reference.py), 39 modèles × 3 scénarios.
test("tous les modèles = formules Excel recalculées (inférence + entraînement)", async () => {
  const ref = JSON.parse(await import("node:fs").then((fs) => fs.readFileSync(new URL("./excel-reference.json", import.meta.url))));
  const sc = {
    prod_fr: input,
    prod_usa_noemb: { phase: "production", requestsPerMonth: 2500, inputTokensPerMonth: 3e6, outputTokensPerMonth: 7e5, embeddingTokensPerMonth: 0, mixMode: "country", country: "USA" },
    conception_custom: { phase: "conception", users: 250, requestsPerDay: 4, requestTokens: 1500, mixMode: "custom", customEf: 0.2 },
  };
  for (const [key, x] of Object.entries(ref)) {
    const [s, model] = key.split("|");
    const r = compute(model.trim(), { ...sc[s], today: new Date("2026-10-02") });
    const mine = {
      total_kwh: r.total.kwh, total_gwp: r.total.gwp, total_water: r.total.water,
      train_kwh: r.training.kwh, train_gwp: r.training.gwp, train_water: r.training.water,
      req_kwh: r.steps[5].kwh, req_gwp: r.steps[5].gwp, req_water: r.steps[5].water, gpus: r.gpus,
    };
    for (const [k, v] of Object.entries(mine)) close(v, x[k], `${key} ${k}`);
  }
});
