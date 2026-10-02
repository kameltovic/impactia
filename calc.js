// Moteur de calcul Impact'IA : portage de l'onglet « Calcul » du classeur SNCF / Resilio / Wavestone.
//
// Principe (détaillé dans docs/METHODOLOGIE.md) :
//   1. chaque étape du cycle de vie calcule des ACTIVITÉS physiques, indépendantes des indicateurs :
//      électricité consommée, part de la durée de vie des équipements utilisée, etc. ;
//   2. chaque DIMENSION (électricité, GES, eau… définies dans data.json) convertit ces activités
//      avec ses propres facteurs : impact = Σ activité × facteur.
// Ajouter une dimension ou modifier un paramètre se fait donc dans data.json, sans toucher à ce fichier.
// Les références [N123] / [M123] renvoient aux cellules de l'onglet « Calcul » du classeur.

const YEAR_S = 365 * 24 * 3600;
const GPU_COUNTS = [1, 2, 4, 8, 16, 32, 64, 128, 256]; // [N167] nombre de GPU arrondi à la puissance de 2 supérieure

/** Clés des activités (et donc des facteurs qu'une dimension peut définir). */
export const ACTIVITIES = {
  gridInference: "Électricité consommée à l'inférence (kWh, au mix du pays d'inférence)",
  gridTraining: "Électricité consommée à l'entraînement (kWh, au mix mondial)",
  building: "Électricité des équipements informatiques soumise au facteur bâtiment (kWh)",
  onsite: "Électricité × WUE du centre de données (L d'eau prélevée sur site)",
  server: "Fraction de la durée de vie d'un serveur utilisée",
  gpu: "Fraction de la durée de vie d'un GPU utilisée",
  firewall: "Fraction de la durée de vie d'un pare-feu utilisée (pondérée par son ratio d'usage)",
  router: "Fraction de la durée de vie d'un routeur utilisée (pondérée par son ratio d'usage)",
  switch: "Fraction de la durée de vie d'un switch utilisée (pondérée par son ratio d'usage)",
  node: "Fraction de la durée de vie d'un nœud du front applicatif utilisée",
  hdd: "Fraction de la durée de vie d'un disque dur utilisée",
};
const NETWORK = ["firewall", "router", "switch"];

export const usableModels = (data) => data.models.filter((m) => m.category !== "Embedding");
export const findModel = (data, name) => data.models.find((m) => m.name === name);

/** Lit un paramètre de data.json ; une clé absente est une erreur de données, pas un zéro silencieux. */
function params(data) {
  return new Proxy(data.parameters, {
    get(target, key) {
      if (!(key in target)) throw new Error(`Paramètre manquant dans data.json : ${String(key)}`);
      return target[key].value;
    },
  });
}

/** Volumes annuels du projet (colonne M de l'onglet Calcul). */
export function project(data, input) {
  const P = params(data);
  const prod = input.phase === "production";
  const requestsYear = prod ? input.requestsPerMonth * 12 : input.users * input.requestsPerDay * 365;
  const conceptionOut = input.users * input.requestsPerDay * input.requestTokens * 365;
  return {
    requestsYear,
    // Le classeur lit en Conception le champ masqué « requêtes / mois » de la phase Production ; on le dérive des usages.
    requestsMonth: requestsYear / 12,
    inTokens: prod ? input.inputTokensPerMonth * 12 : conceptionOut * P.conceptionInputOutputRatio, // [M27]
    outTokens: prod ? input.outputTokensPerMonth * 12 : conceptionOut, // [M28]
    embTokens: prod ? input.embeddingTokensPerMonth * 12 : 0, // [M127]
  };
}

/** Facteur par kWh d'une dimension à l'inférence : valeur fixe, ou mix électrique choisi par l'utilisateur. */
export function gridInferenceFactor(data, dim, input) {
  const f = dim.factors.gridInference;
  if (f !== "mix") return f;
  if (input.mixMode === "custom") return input.customIntensity;
  const mix = input.mixMode === "country" ? data.mixes.find((m) => m.name === input.country) : data.mixes.find((m) => m.default);
  if (!mix) throw new Error(`Mix électrique introuvable : ${input.country ?? "mix par défaut"}`);
  return mix.values[dim.key] ?? 0;
}

/** Impact d'une étape pour une dimension : Σ activité × facteur. */
function impact(step, dim, gridInference) {
  let sum = 0;
  for (const key of Object.keys(ACTIVITIES)) {
    const a = step.activities[key];
    if (!a) continue;
    let factor = key === "gridInference" ? gridInference : dim.factors[key] ?? 0;
    // Le classeur multiplie l'embarqué réseau du traitement des requêtes par N_GPU / 8 pour l'eau [N243] mais pas pour le GES [N228].
    if (step.networkGpuScale && NETWORK.includes(key) && !dim.scaleRequestNetworkByGpus) factor /= step.networkGpuScale;
    sum += a * factor;
  }
  return sum;
}

const scaleActivities = (acts, k) => Object.fromEntries(Object.entries(acts).map(([key, v]) => [key, v * k]));

export function compute(data, modelName, input) {
  const m = findModel(data, modelName);
  if (!m) throw new Error(`Modèle inconnu : ${modelName}`);
  const P = params(data);
  const p = project(data, input);
  const today = input.today ?? new Date();
  const T = p.outTokens;
  const { pue, wue } = m;
  const batch = P.batchSize;
  const perServer = P.gpuPerServer;
  const serverLife = P.serverLifeYears * YEAR_S;
  const gpuLife = P.gpuLifeYears * YEAR_S;
  const netLife = P.networkLifeYears * YEAR_S;
  const usage = { firewall: P.firewallUsage, router: P.routerUsage, switch: P.switchUsage };
  const netPower = P.firewallPowerKw * P.firewallUsage + P.routerPowerKw * P.routerUsage + P.switchPowerKw * P.switchUsage; // [N200]
  const network = (fraction) => Object.fromEntries(NETWORK.map((k) => [k, usage[k] * fraction]));

  // ── Inférence : traitement des requêtes par le modèle (Ecologits + enrichissements) ──
  const minGpus = Math.ceil(((P.modelMemoryOverhead * m.pTotal * (P.quantizationBits / 8)) / P.gpuMemoryGb) * 10) / 10; // [N168-169]
  const gpus = GPU_COUNTS.find((n) => minGpus <= n);
  if (!gpus) throw new Error(`${m.name} : plus de ${GPU_COUNTS.at(-1)} GPU requis`);
  const gpuWhPerToken = T > 0 ? P.gpuEnergyAlpha * Math.exp(P.gpuEnergyBeta * batch) * m.pActive + P.gpuEnergyGamma : 0; // [N175]
  const gpuKwh = ((T * gpuWhPerToken) / 1000) * gpus; // [N173]
  const latencyPerToken = m.tps ? 1 / m.tps : P.latencyAlpha * m.pActive + P.latencyBeta * batch + P.latencyGamma; // [N183]
  const prefillCoef = P.prefillCoefRef * ((m.ttft ?? 0) / P.prefillTtftRef); // Modèles_IA colonne « Coefficient »
  const prefill = (prefillCoef * p.inTokens + P.prefillPerRequestMs * p.requestsMonth) / 1000; // [N191]
  const latency = T * latencyPerToken + prefill; // [N181] = max(decode, decode + prefill)
  const serverKwh = T > 0 ? ((latency / 3600) * P.serverPowerKw * (gpus / perServer)) / batch : 0; // [N193]
  const networkKwh = (gpus * netPower * (latency / 3600 / perServer)) / batch; // [N197]
  const itKwh = gpuKwh + serverKwh + networkKwh;
  const requestKwh = itKwh * pue; // [N163]
  const request = {
    phase: "Inférence",
    key: "request",
    label: "Traitement des requêtes par le modèle",
    icon: "cpu",
    networkGpuScale: gpus / perServer,
    activities: {
      gridInference: requestKwh, // [N208]
      building: itKwh, // [N216]
      onsite: itKwh * wue, // [N236]
      server: (gpus / perServer) * (latency / (batch * serverLife)), // [N221] [N240]
      gpu: gpus * (latency / (batch * gpuLife)), // [N222] [N240]
      ...network((latency / (batch * netLife)) * (gpus / perServer)), // [N228] [N243]
    },
  };

  // ── Inférence : RAG / embedding (Production uniquement) ──
  const embModel = findModel(data, P.embeddingModel);
  if (!embModel) throw new Error(`Modèle d'embedding introuvable : ${P.embeddingModel}`);
  const embGpus = P.embeddingGpus;
  const embLatency = p.embTokens > 0
    ? (P.embeddingLatencyCoefMs * ((embModel.pTotal * 1e9) / (P.embeddingLatencyRefParamsB * 1e9)) * (p.embTokens * batch) + P.embeddingLatencyBaseMs) / 1000
    : 0; // [M126]
  const embServerKwh = (embLatency / 3600) * (P.embeddingGpuPowerKw + P.serverPowerKw / perServer) * embGpus; // [M132]
  const embNetKwh = netPower * (embLatency / 3600 / perServer) * embGpus; // [M134]
  const embKwh = ((embServerKwh + embNetKwh) * pue) / batch; // [N129]
  const rag = {
    phase: "Inférence",
    key: "rag",
    label: "RAG / Embedding",
    icon: "layers",
    activities: {
      gridInference: embKwh, // [N137]
      building: embKwh, // [M138]
      onsite: embKwh * wue, // [N141]
      server: (embGpus / perServer) * (embLatency / (batch * serverLife)), // [M138] [M142]
      gpu: embGpus * (embLatency / (batch * gpuLife)), // [M138] [M142]
      ...network((embGpus / perServer) * (embLatency / (batch * netLife))), // [M138] [M142]
    },
  };

  // ── Inférence : front applicatif (pré et post traitements) ──
  const nodes = P.frontNodes;
  const nodeShare = T / P.frontTokensPerNode;
  const frontKwh = (nodes * P.frontNodePowerKw + (nodes / P.frontNodesPerNetworkKit) * netPower) * P.frontPue * 24 * 365 * nodeShare; // [N146]
  const front = {
    phase: "Inférence",
    key: "front",
    label: "Front applicatif — pré et post traitements",
    icon: "monitor",
    activities: {
      gridInference: frontKwh, // [N151]
      building: frontKwh, // [N151]
      onsite: frontKwh * P.frontWue, // [N156]
      node: nodeShare * nodes * (YEAR_S / (P.frontNodeLifeYears * YEAR_S)), // [N151] [N158]
      ...network(nodeShare * (nodes / P.frontNodesPerNetworkKit) * (YEAR_S / netLife)), // [N151] [N158]
    },
  };

  // ── Entraînement, amorti sur les tokens générés pendant la vie du modèle ──
  const cutoff = new Date(today);
  cutoff.setMonth(cutoff.getMonth() - P.activeModelsWindowMonths);
  const iso = cutoff.toISOString().slice(0, 10);
  // [N119] Le classeur compte les modèles du fournisseur sélectionné, y compris pour les modèles comparés ; ici chacun compte les siens.
  // Aucun modèle récent : on compte 1 (le classeur renvoie #DIV/0!).
  const activeModels = Math.max(1, data.models.filter((x) => x.provider === m.provider && x.published >= iso).length);
  const flops = ((m.computeKw * P.inferenceComputeShare) / activeModels) * m.flopsPerJoule * P.computeEfficiency; // [N115-116]
  const lifetimeTokens = flops * (YEAR_S / (2 * m.pActive * 1e9)) * P.modelLifetimeYears; // [N114]
  const share = lifetimeTokens > 0 ? T / lifetimeTokens : 0; // part des tokens du modèle produits par le projet
  const days = (new Date(m.published) - new Date(P.trainingFlopsRefDate)) / 86400000; // [N94]
  const trainFlops = 10 ** (P.trainingFlopsDailyGrowth * days + P.trainingFlopsIntercept) * (m.pTotal * 1e9) ** P.trainingFlopsExponent; // [N92]
  const trainTotalKwh = gpuKwh > 0 ? (itKwh / gpuKwh) * (trainFlops / m.flopsPerJoule / 3600 / 1000) * pue : 0; // [N91]
  const finalKwh = trainTotalKwh * share; // [N90]
  // L'embarqué de l'entraînement suit le même ratio « hors électricité du réseau / kWh » que l'inférence [N97] [N100].
  const { gridInference: _, ...requestNonGrid } = request.activities;
  const final = {
    phase: "Entraînement",
    key: "final",
    label: "Entraînement final du modèle",
    icon: "graduation-cap",
    networkGpuScale: request.networkGpuScale,
    activities: {
      ...scaleActivities(requestNonGrid, requestKwh > 0 ? finalKwh / requestKwh : 0),
      gridTraining: finalKwh, // [N96]
    },
  };
  final.activities.onsite += finalKwh * wue; // [N99]

  const trainTokens = trainFlops / (P.flopsPerTokenParam * m.pTotal * 1e9); // [N65]
  const hdds = Math.ceil(Math.ceil((trainTokens * P.bytesPerTrainingToken) / 1024 ** 4) / P.hddCapacityTb); // [N66-67]
  const trainHours = P.trainingDays * 24; // [M70]
  const storageKwh = P.hddPowerKw * hdds * pue * P.hddUsageRatio * trainHours * share; // [N64]
  const storage = {
    phase: "Entraînement",
    key: "storage",
    label: "Stockage de la donnée d'entraînement",
    icon: "database",
    activities: {
      gridTraining: storageKwh, // [N72]
      onsite: storageKwh * wue, // [N76]
      hdd: (hdds * trainHours * share) / (P.hddLifeYears * 365 * 24), // [N72] [N76]
    },
  };

  const rd = {
    phase: "Entraînement",
    key: "rd",
    label: "Expérimentations tests (R&D)",
    icon: "flask-conical",
    networkGpuScale: final.networkGpuScale,
    activities: scaleActivities(final.activities, P.rdMultiplier), // [N81] [N83] [N86]
  };

  // ── Conversion des activités en impacts pour chaque dimension ──
  const steps = [storage, rd, final, rag, front, request];
  const grid = Object.fromEntries(data.dimensions.map((d) => [d.key, gridInferenceFactor(data, d, input)]));
  for (const s of steps) s.impacts = Object.fromEntries(data.dimensions.map((d) => [d.key, impact(s, d, grid[d.key])]));
  const sum = (phase) =>
    Object.fromEntries(data.dimensions.map((d) => [d.key, steps.filter((s) => !phase || s.phase === phase).reduce((a, s) => a + s.impacts[d.key], 0)]));
  const total = sum();
  const per = (n) => (n > 0 ? Object.fromEntries(Object.entries(total).map(([k, v]) => [k, v / n])) : null);

  return {
    model: m,
    project: p,
    gpus,
    grid,
    steps,
    total,
    training: sum("Entraînement"),
    inference: sum("Inférence"),
    perRequest: per(p.requestsYear),
    perToken: per(T),
    // [C36-C39] répartition de l'électricité du traitement des requêtes par équipement
    equipment: [
      { label: "GPU", icon: "microchip", kwh: gpuKwh },
      { label: "Serveur (hors GPU)", icon: "server", kwh: serverKwh },
      { label: "Équipements réseau du centre de données", icon: "network", kwh: networkKwh },
      { label: "Infrastructures techniques (PUE)", icon: "building-2", kwh: requestKwh - itKwh },
    ],
    _cells: { gpuKwh, latency, latencyPerToken, prefill, networkKwh, embKwh, frontKwh, requestKwh, finalKwh, storageKwh },
  };
}
