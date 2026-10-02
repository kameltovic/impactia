// Comparaison avec EcoLogits (https://ecologits.ai), via son API publique (data.json → meta.ecologitsApi).
// EcoLogits raisonne par requête : on lui envoie une requête « moyenne » du projet, puis on multiplie par le nombre
// de requêtes annuelles. Correspondances dans data.json : fournisseur (providers.*.ecologits), modèle (models.*.ecologitsModel),
// zone de mix (mixes.*.ecologitsZone), indicateur (dimensions.*.ecologits).

/** Prépare l'appel pour un résultat de compute() ; renvoie { body } ou { unavailable: raison }. */
export function ecologitsRequest(data, r, input) {
  const provider = data.providers?.[r.model.provider]?.ecologits;
  if (!provider || !r.model.ecologitsModel) return { unavailable: `${r.model.name} n'est pas couvert par EcoLogits.` };
  const requests = r.project.requestsYear;
  if (!(requests > 0) || !(r.project.outTokens > 0)) return { unavailable: "Renseignez un volume de requêtes et de tokens de sortie." };
  const mix = input.mixMode === "country" ? data.mixes.find((m) => m.name === input.country) : data.mixes.find((m) => m.default);
  const outputPerRequest = r.project.outTokens / requests;
  return {
    requests,
    zoneNote: input.mixMode === "custom" ? `Intensité personnalisée non transmise à EcoLogits : zone ${mix?.ecologitsZone ?? "WOR"} utilisée.` : null,
    body: {
      provider,
      model_name: r.model.ecologitsModel,
      output_token_count: Math.max(1, Math.round(outputPerRequest)),
      // Latence de génération (décodage) estimée par Impact'IA ; EcoLogits ne modélise pas le préremplissage.
      request_latency: Math.max(0.001, outputPerRequest * r._cells.latencyPerToken),
      electricity_mix_zone: mix?.ecologitsZone ?? "WOR",
    },
  };
}

/** Réponse de l'API (une requête) → impacts annuels { clé: { min, max, mid, unit, name } } et avertissements. */
export function annualize(response, requests) {
  const impacts = {};
  for (const [key, imp] of Object.entries(response.impacts ?? {})) {
    if (!imp?.value || typeof imp.value.min !== "number") continue; // ignore les sous-totaux « usage » / « embodied »
    const min = imp.value.min * requests;
    const max = imp.value.max * requests;
    impacts[key] = { min, max, mid: (min + max) / 2, unit: imp.unit, name: imp.name };
  }
  const warnings = [...(response.impacts?.warnings ?? []), ...(response.warnings ?? [])].map((w) => w.message ?? String(w));
  return { impacts, warnings };
}

const cache = new Map();
/** Appelle l'API (avec cache) ; lève une erreur lisible si l'API ne répond pas. */
export async function fetchEcologits(data, req) {
  const key = JSON.stringify(req.body);
  if (!cache.has(key)) {
    const p = fetch(`${data.meta.ecologitsApi}/estimations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: key,
    }).then(async (res) => {
      if (!res.ok) throw new Error(`EcoLogits a répondu ${res.status}`);
      return res.json();
    });
    cache.set(key, p);
    p.catch(() => cache.delete(key));
  }
  return annualize(await cache.get(key), req.requests);
}
