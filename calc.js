// Portage de l'onglet « Calcul » du classeur Impact'IA (SNCF / Resilio / Wavestone).
// Les commentaires [N123] / [M123] renvoient aux cellules d'origine pour faciliter la relecture.
// Unités : kWh, kg CO₂e, L eq — sur une année de projet.
import { models, fe, mix } from "./data.js";

const YEAR_S = 365 * 24 * 3600;
const f = (k) => {
  if (!(k in fe)) throw new Error(`Facteur introuvable : ${k}`);
  return fe[k];
};

export const findModel = (name) => models.find((m) => m.name === name);

// Paramètres communs à tous les modèles (colonne M)
function project(input) {
  const prod = input.phase === "production";
  const size = input.requestTokens; // tokens de sortie par requête (phase Conception)
  const requestsYear = prod ? input.requestsPerMonth * 12 : input.users * input.requestsPerDay * 365;
  let ef; // [M210] facteur d'émission de l'électricité à l'inférence
  if (input.mixMode === "custom") ef = input.customEf;
  else if (input.mixMode === "country") ef = mix[input.country];
  else ef = f("Facteur d'émission de l'électricité consommée France");
  return {
    requestsYear,
    // ponytail: en Conception le classeur réutilise le champ caché « requêtes / mois » ; on le dérive des usages.
    requestsMonth: requestsYear / 12,
    inTokens: prod ? input.inputTokensPerMonth * 12 : input.users * input.requestsPerDay * size * 5 * 365, // [M27]
    outTokens: prod ? input.outputTokensPerMonth * 12 : input.users * input.requestsPerDay * size * 365, // [M28]
    embTokens: prod ? input.embeddingTokensPerMonth * 12 : 0, // [M127]
    ef,
  };
}

export function compute(modelName, input) {
  const m = findModel(modelName);
  if (!m) throw new Error(`Modèle inconnu : ${modelName}`);
  const p = project(input);
  const today = input.today ?? new Date();
  const T = p.outTokens;

  const gpuPerServer = f("Nombre de GPU par serveur"); // [M133]
  const batch = f("Batch"); // [M179]
  const cfAware = f("CF_Aware"); // [M238]
  const efWorld = f("Facteur d'émission de l'électricité consommée Monde"); // [M84]
  const efBat = f("Facteur d'émission du batiment et de l'environnement technique"); // [M217]
  const serverLife = f("Durée de vie du serveur") * YEAR_S; // [M223]
  const gpuLife = f("Durée de vie d'un GPU") * YEAR_S; // [M224]
  const netLife = f("Durée de vie équipements réseau") * YEAR_S; // [M229]
  const serverEmb = f("GES embarqué du serveur"); // [M225]
  const gpuEmb = f("GES embarqué d'un seul GPU"); // [M226]
  const serverPower = f("Puissance électrique d'un serveur - hors GPU"); // [M195]
  const serverGpuWu = f("WU du serveur (embarqué)") + 8 * f("WU d'un seul GPU (embarqué)"); // [M241]
  const rFw = f("Ratio d'usage pares-feux"), rRt = f("Ratio d'usage routeurs"), rSw = f("Ratio d'usage switches");
  const netPower = f("Puissance électrique des pares-feux") * rFw + f("Puissance électrique des routeurs") * rRt + f("Puissance électrique des switches") * rSw; // [N200]
  const netEmb = f("GES embarqué du pare-feu") * rFw + f("GES embarqué du routeur") * rRt + f("GES embarqué du switch") * rSw;
  const netWu = f("WU du pare-feu (FR)") * rFw + f("WU du routeur (FR)") * rRt + f("WU du switch (FR)") * rSw;
  const { pue, wue } = m;

  // ── Inférence : traitement des requêtes par le modèle (Ecologits + enrichissements) ──
  const minGpus = Math.ceil(((1.2 * m.pTotal * (f("Quantification") / 8)) / f("Mémoire GPU")) * 10) / 10; // [N168-169]
  const gpus = [1, 2, 4, 8, 16, 32, 64, 128, 256].find((n) => minGpus <= n); // [N167]
  if (!gpus) throw new Error(`${m.name} : plus de 256 GPU requis`);
  const gpuWhPerToken = T > 0 ? f("GPU_Energy_α") * Math.exp(f("GPU_Energy_β") * batch) * m.pActive + f("GPU_Energy_γ") : 0; // [N175]
  const gpuKwh = ((T * gpuWhPerToken) / 1000) * gpus; // [N173]
  const latencyPerToken = m.tps ? 1 / m.tps : f("Latence_α") * m.pActive + f("Latence_β") * batch + f("Latence_γ"); // [N183]
  const prefill = (m.coefficient * p.inTokens + 17.88 * p.requestsMonth) / 1000; // [N191]
  const latency = T * latencyPerToken + prefill; // [N181] = max(decode, decode + prefill)
  const serverKwh = T > 0 ? (latency / 3600) * serverPower * (gpus / gpuPerServer) / batch : 0; // [N193]
  const networkKwh = (gpus * netPower * (latency / 3600 / gpuPerServer)) / batch; // [N197]
  const itKwh = gpuKwh + serverKwh + networkKwh;
  const requestKwh = itKwh * pue; // [N163]
  const requestEmbodied =
    (gpus / gpuPerServer) * serverEmb * (latency / (batch * serverLife)) + // [N221]
    gpus * gpuEmb * (latency / (batch * gpuLife)) + // [N222]
    netEmb * (latency / (batch * netLife)) + // [N228]
    itKwh * efBat; // [N216]
  const requestGwp = requestKwh * p.ef + requestEmbodied; // [N205]
  const requestWater =
    (gpus / gpuPerServer) * serverGpuWu * (latency / (batch * serverLife)) + // [N240]
    netWu * (latency / (batch * netLife)) * (gpus / gpuPerServer) + // [N243]
    wue * itKwh * cfAware; // [N236]

  // ── Inférence : RAG / embedding (Production uniquement) ──
  const embModel = findModel("text-embedding-3-large");
  const embGpus = f("Nombre de GPU utilisé pour l'embedding"); // [M130]
  const embLatency = p.embTokens > 0 ? (0.022 * ((embModel.pTotal * 1e9) / 8e9) * (p.embTokens * batch) + 97.394) / 1000 : 0; // [M126]
  const embServerKwh = (embLatency / 3600) * (f("Puissance électrique d'un GPU pour l'embedding") + serverPower / gpuPerServer) * embGpus; // [M132]
  const embNetKwh = netPower * (embLatency / 3600 / gpuPerServer) * embGpus; // [M134]
  const embKwh = (embGpus * (embServerKwh + embNetKwh) * pue) / batch; // [N129]
  const embGwp =
    embKwh * p.ef + // [N137]
    (embGpus / gpuPerServer) * serverEmb * (embLatency / (batch * serverLife)) +
    embGpus * gpuEmb * (embLatency / (batch * gpuLife)) +
    (embGpus / gpuPerServer) * netEmb * (embLatency / (batch * netLife)) +
    embKwh * efBat; // [M138]
  const embWater =
    embKwh * wue * cfAware + // [N141]
    (embGpus / gpuPerServer) * serverGpuWu * (embLatency / (batch * serverLife)) +
    (embGpus / gpuPerServer) * netWu * (embLatency / (batch * netLife)); // [M142]

  // ── Inférence : front applicatif (pré & post traitements) ──
  const nodes = f("Nombre de nœuds");
  const nodeShare = T / f("Nombre de tokens de sortie annuels des requêtes traitées par un nœud pour le front");
  const nodeLife = f("Durée de vie d'un nœud 16Go") * YEAR_S;
  const frontKwh = (nodes * f("Puissance électrique d'un nœud") + (nodes / 16) * netPower) * 1.2 * 24 * 365 * nodeShare; // [N146]
  const frontGwp =
    nodeShare * ((nodes * f("GES embarqué d'un nœud 16Go") * YEAR_S) / nodeLife + (netEmb * nodes) / 16 * (YEAR_S / netLife)) +
    frontKwh * (p.ef + efBat); // [N151]
  const frontWater =
    frontKwh * 0.2 * cfAware + // [N156]
    nodeShare * ((YEAR_S / nodeLife) * nodes * f("WU d'un noeud 16Go") + (nodes / 16) * netWu * (YEAR_S / netLife)); // [N158]

  // ── Entraînement, amorti sur les tokens générés pendant la vie du modèle ──
  const cutoff = new Date(today);
  cutoff.setMonth(cutoff.getMonth() - 24);
  const iso = cutoff.toISOString().slice(0, 10);
  const activeModels = models.filter((x) => x.provider === m.provider && x.published >= iso).length; // [N119]
  // ponytail: le classeur compte les modèles du fournisseur sélectionné pour toutes les colonnes ; ici chaque modèle compte les siens.
  // Garde-fou : aucun modèle récent → 1 (le classeur renvoie #DIV/0!).
  const flops = (m.computeKw * f("Ratio d'inférence sur la compute capacity") / Math.max(activeModels, 1)) * m.flopsPerJoule * 0.85 * 0.85; // [N115-116]
  const lifetimeTokens = flops * (YEAR_S / (2 * m.pActive * 1e9)) * 1.5; // [N114] (âge du modèle : 1,5 an)
  const share = lifetimeTokens > 0 ? T / lifetimeTokens : 0;
  const days = (new Date(m.published) - new Date("2020-01-01")) / 86400000; // [N94]
  const trainFlops = 10 ** (0.0006 * days + 17.151) * (m.pTotal * 1e9) ** 0.541; // [N92]
  const trainTotalKwh = gpuKwh > 0 ? (itKwh / gpuKwh) * ((trainFlops / m.flopsPerJoule / 3600) / 1000) * pue : 0; // [N91]
  const finalKwh = trainTotalKwh * share; // [N90]
  const finalGwp = finalKwh * efWorld + (requestKwh > 0 ? (requestEmbodied / requestKwh) * finalKwh : 0); // [N96-97]
  const finalWater = finalKwh * wue * cfAware + (requestKwh > 0 ? (requestWater / requestKwh) * finalKwh : 0); // [N99-100]

  const trainTokens = trainFlops / (6 * m.pTotal * 1e9); // [N65]
  const hdds = Math.ceil(Math.ceil((trainTokens * 128) / 8 / 1024 ** 4) / 30); // [N66-67]
  const trainHours = f("Durée d'entrainement") * 24; // [M70]
  const hddLife = f("Durée de vie du HDD") * 365 * 24; // [M73]
  const storageKwh = f("Puissance électrique du HDD pour le stockage dataset de l'entrainement") * hdds * pue * f("Ratio d'usage HDD") * trainHours * share; // [N64]
  const storageGwp = (f("GES embarqué du stockage HDD de l'entrainement") / hddLife) * hdds * trainHours * share + storageKwh * efWorld; // [N72]
  const storageWater = storageKwh * wue * cfAware + (f("WU du stockage HDD de l'entrainement (WORLD)") / hddLife) * hdds * trainHours * share; // [N76]

  const steps = [
    { phase: "Entraînement", label: "Stockage de la donnée d'entraînement", kwh: storageKwh, gwp: storageGwp, water: storageWater },
    { phase: "Entraînement", label: "Expérimentations tests (R&D)", kwh: 4 * finalKwh, gwp: 4 * finalGwp, water: 4 * finalWater },
    { phase: "Entraînement", label: "Entraînement final du modèle", kwh: finalKwh, gwp: finalGwp, water: finalWater },
    { phase: "Inférence", label: "RAG / Embedding", kwh: embKwh, gwp: embGwp, water: embWater },
    { phase: "Inférence", label: "Front applicatif — pré & post traitements", kwh: frontKwh, gwp: frontGwp, water: frontWater },
    { phase: "Inférence", label: "Traitement des requêtes par le modèle", kwh: requestKwh, gwp: requestGwp, water: requestWater },
  ];
  const sum = (k, ph) => steps.filter((s) => !ph || s.phase === ph).reduce((a, s) => a + s[k], 0);
  const total = { kwh: sum("kwh"), gwp: sum("gwp"), water: sum("water") };

  return {
    model: m,
    project: p,
    gpus,
    steps,
    total,
    training: { kwh: sum("kwh", "Entraînement"), gwp: sum("gwp", "Entraînement"), water: sum("water", "Entraînement") },
    inference: { kwh: sum("kwh", "Inférence"), gwp: sum("gwp", "Inférence"), water: sum("water", "Inférence") },
    perRequest: p.requestsYear > 0 ? { kwh: total.kwh / p.requestsYear, gwp: total.gwp / p.requestsYear, water: total.water / p.requestsYear } : null,
    perToken: T > 0 ? { kwh: total.kwh / T, gwp: total.gwp / T, water: total.water / T } : null,
    // [C36-C39] répartition de l'électricité du traitement des requêtes par équipement
    equipment: [
      { label: "GPU", kwh: gpuKwh },
      { label: "Serveur (hors GPU)", kwh: serverKwh },
      { label: "Équipements réseau du centre de données", kwh: networkKwh },
      { label: "Infrastructures techniques (PUE)", kwh: requestKwh - itKwh },
    ],
    // test hooks : valeurs intermédiaires comparées aux cellules du classeur
    _cells: { gpuKwh, latency, prefill, networkKwh, requestEmbodied, requestWater, embKwh, embGwp, embWater, frontKwh, frontGwp, frontWater },
  };
}
