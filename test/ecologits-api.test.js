// Préparation des appels à l'API EcoLogits et conversion des réponses (sans réseau).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compute } from "../calc.js";
import { annualize, ecologitsRequest } from "../ecologits.js";

const data = JSON.parse(readFileSync(new URL("../data.json", import.meta.url)));
const input = { phase: "production", requestsPerMonth: 100_000, inputTokensPerMonth: 1e8, outputTokensPerMonth: 1e8, embeddingTokensPerMonth: 0, mixMode: "default" };

test("requête moyenne envoyée à EcoLogits", () => {
  const r = compute(data, "GPT-4o", input);
  const req = ecologitsRequest(data, r, input);
  assert.equal(req.requests, 1.2e6);
  assert.deepEqual(req.body, { provider: "openai", model_name: "gpt-4o", output_token_count: 1000, request_latency: 1000 / 40.2, electricity_mix_zone: "FRA" });
  assert.equal(req.zoneNote, null);
});

test("zone électrique : pays choisi, ou zone par défaut avec une note si l'intensité est personnalisée", () => {
  const usa = { ...input, mixMode: "country", country: "USA" };
  assert.equal(ecologitsRequest(data, compute(data, "GPT-4o", usa), usa).body.electricity_mix_zone, "USA");
  const custom = { ...input, mixMode: "custom", customIntensity: 0.1 };
  const req = ecologitsRequest(data, compute(data, "GPT-4o", custom), custom);
  assert.equal(req.body.electricity_mix_zone, "FRA");
  assert.match(req.zoneNote, /personnalisée/);
});

test("modèle non couvert par EcoLogits", () => {
  const r = compute(data, "Claude Sonnet 4", input);
  assert.match(ecologitsRequest(data, r, input).unavailable, /pas couvert/);
});

test("réponse de l'API ramenée à l'année, sous-totaux ignorés", () => {
  const response = {
    impacts: {
      energy: { value: { min: 0.001, max: 0.003 }, unit: "kWh", name: "Energy" },
      gwp: { value: { min: 1e-4, max: 2e-4 }, unit: "kgCO2eq", name: "GWP" },
      usage: { energy: { value: { min: 1, max: 1 } } },
    },
  };
  const { impacts } = annualize(response, 1000);
  assert.deepEqual(Object.keys(impacts), ["energy", "gwp"]);
  assert.ok(Math.abs(impacts.energy.mid - 2) < 1e-12);
  assert.ok(Math.abs(impacts.gwp.max - 0.2) < 1e-12);
});

test("chaque modèle relié à EcoLogits a un fournisseur relié", () => {
  for (const m of data.models.filter((x) => x.ecologitsModel)) assert.ok(data.providers[m.provider]?.ecologits, m.name);
  for (const mix of data.mixes) assert.match(mix.ecologitsZone ?? "", /^[A-Z]{3}$/, mix.name);
});
