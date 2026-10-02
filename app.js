import { compute } from "./calc.js";
import { models, mix, requestSizes } from "./data.js";

const $ = (s) => document.querySelector(s);
const form = $("#form");
const usable = models.filter((m) => m.category !== "Embedding");
const providers = [...new Set(usable.map((m) => m.provider))];
const alternatives = ["GPT-4.1-mini", "Mistral Large", "Claude Sonnet 4", "Gemini 2.5 flash lite"]; // défauts du classeur
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const options = (list, sel) => list.map((v) => `<option${v === sel ? " selected" : ""}>${esc(v)}</option>`).join("");

// ── Formatage ──
const nf = (v, d = 3) => new Intl.NumberFormat("fr-FR", { maximumSignificantDigits: d }).format(v);
const int = (v) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(v);
const scale = (v, units) => {
  const [div, u] = units.find(([d]) => Math.abs(v) >= d) ?? units.at(-1);
  return `${nf(v / div)} ${u}`;
};
const fmt = {
  kwh: (v) => scale(v, [[1000, "MWh"], [1, "kWh"], [1e-3, "Wh"], [1e-6, "mWh"]]),
  gwp: (v) => scale(v, [[1000, "t CO₂e"], [1, "kg CO₂e"], [1e-3, "g CO₂e"], [1e-6, "mg CO₂e"]]),
  water: (v) => scale(v, [[1000, "m³"], [1, "L"], [1e-3, "mL"]]),
};
const IND = [
  { k: "kwh", t: "Consommation d'électricité", c: "var(--elec)" },
  { k: "gwp", t: "Potentiel de réchauffement climatique", c: "var(--gwp)" },
  { k: "water", t: "Utilisation d'eau", c: "var(--water)" },
];

// ── Formulaire ──
$("#provider").innerHTML = options(providers, "OpenAI");
$("#requestTokens").innerHTML = Object.entries(requestSizes).map(([l, v]) => `<option value="${v}">${esc(l)}</option>`).join("");
$("#country").innerHTML = options(Object.keys(mix), "France");
const fillModels = (sel) => {
  $("#model").innerHTML = options(usable.filter((m) => m.provider === $("#provider").value).map((m) => m.name), sel);
};
fillModels("GPT-4o");

function readInput() {
  const d = Object.fromEntries(new FormData(form));
  const num = (k) => Math.max(0, Number(d[k]) || 0);
  return {
    model: d.model,
    phase: d.phase,
    requestsPerMonth: num("requestsPerMonth"),
    inputTokensPerMonth: num("inputTokensPerMonth"),
    outputTokensPerMonth: num("outputTokensPerMonth"),
    embeddingTokensPerMonth: num("embeddingTokensPerMonth"),
    users: num("users"),
    requestsPerDay: num("requestsPerDay"),
    requestTokens: num("requestTokens"),
    mixMode: d.mixMode,
    country: d.country,
    customEf: num("customEf"),
  };
}

// ── Rendu ──
const pct = (v, t) => (t > 0 ? (100 * v) / t : 0);
const bar = (v, max, c) => `<div class="bar" style="width:${pct(v, max).toFixed(2)}%;--c:${c}"></div>`;

function render() {
  const input = readInput();
  for (const el of document.querySelectorAll("[data-phase]")) el.hidden = el.dataset.phase !== input.phase;
  for (const el of document.querySelectorAll("[data-mix]")) el.hidden = el.dataset.mix !== input.mixMode;

  let r;
  try {
    r = compute(input.model, input);
  } catch (e) {
    $("#results").innerHTML = `<div class="card span-12"><p>Calcul impossible : ${esc(e.message)}</p></div>`;
    return;
  }
  $("#ef-hint").textContent = `Facteur retenu : ${nf(r.project.ef)} kg CO₂e / kWh (entraînement : mix mondial 0,458).`;
  const p = r.project;
  const T = r.total;
  const eq = {
    kwh: `≈ ${int(Math.ceil(T.kwh * 1000 * 0.1))} recharges de smartphone ou ${int(Math.ceil(T.kwh * 1000 * 0.6))} minutes sur Internet`,
    gwp: `≈ ${int(T.gwp * 1000 * 0.0046)} km en voiture ou ${int(T.gwp * 1000 * 0.0175)} h de visio`,
    water: `≈ ${int(T.water)} bouteilles d'eau de 1 L ou ${int(T.water * 4)} cafés`,
  };
  const per = (k) =>
    [r.perRequest && `${fmt[k](r.perRequest[k])} / requête`, r.perToken && `${fmt[k](r.perToken[k])} / token de sortie`].filter(Boolean).join("<br>");

  const alert =
    T.gwp > 10000
      ? `<div class="alert">Plus de 10 000 kg CO₂e/an : un plan d'action de mitigation et de mise en œuvre de bonnes pratiques doit être mis en place.</div>`
      : T.gwp > 1000
        ? `<div class="alert">Plus de 1 000 kg CO₂e/an : le projet doit faire l'objet d'une réflexion autour de son impact environnemental.</div>`
        : `<div class="alert ok">Moins de 1 000 kg CO₂e/an. Les bonnes pratiques ci-dessous restent utiles pour réduire l'empreinte.</div>`;

  const maxStep = Object.fromEntries(IND.map(({ k }) => [k, Math.max(...r.steps.map((s) => s[k]))]));
  const eqTotal = r.equipment.reduce((a, e) => a + e.kwh, 0);

  const alts = [...document.querySelectorAll("[data-alt]")].map((s) => s.value);
  const altNames = alts.length ? alts : alternatives;
  const cmp = [r, ...altNames.map((n) => compute(n, input))];
  const maxCmp = Object.fromEntries(IND.map(({ k }) => [k, Math.max(...cmp.map((c) => c.total[k]))]));

  $("#results").innerHTML = `
  <section class="card span-12">
    <h2>Résultats annuels</h2>
    <p class="summary"><b>${esc(r.model.name)}</b> (${esc(r.model.provider)}, catégorie ${esc(r.model.category)}) —
      ${int(p.outTokens)} tokens de sortie, ${int(p.inTokens)} tokens d'entrée${p.embTokens ? `, ${int(p.embTokens)} tokens d'embedding` : ""} et ${int(p.requestsYear)} requêtes par an.</p>
    <div class="kpis">
      ${IND.map(({ k, t, c }) => `<div class="kpi" style="--c:${c}"><div class="t">${t}</div><div class="v">${fmt[k](T[k])} <small>/ an</small></div><div class="s">${per(k)}</div><div class="eq">${eq[k]}</div></div>`).join("")}
    </div>
    ${alert}
  </section>

  <section class="card span-5">
    <h2>Entraînement vs inférence</h2>
    <div class="legend"><span><i style="--c:var(--train)"></i>Entraînement (amorti sur le projet)</span><span><i style="--c:var(--infer)"></i>Inférence</span></div>
    ${IND.map(({ k, t }) => {
      const a = pct(r.training[k], T[k]);
      return `<div class="split-row"><span>${t}<br><small class="ratio">entraînement ${nf(a, 2)} %</small></span><div class="split" role="img" aria-label="${t} : entraînement ${nf(a, 2)} %, inférence ${nf(100 - a, 2)} %">
        <div style="width:${a}%;background:var(--train)">${a >= 20 ? nf(a, 2) + " %" : ""}</div><div style="width:${100 - a}%;background:var(--infer)">${100 - a >= 20 ? nf(100 - a, 2) + " %" : ""}</div></div></div>`;
    }).join("")}
    <p class="hint">Hébergement estimé : ${r.gpus} GPU — PUE ${nf(r.model.pue)}, WUE ${nf(r.model.wue)} L/kWh.</p>
  </section>

  <section class="card span-7">
    <h2>Électricité du traitement des requêtes, par équipement</h2>
    <table><tbody>${r.equipment.map((e) => `<tr><td>${e.label}</td><td class="n">${fmt.kwh(e.kwh)}</td><td class="n">${nf(pct(e.kwh, eqTotal), 2)} %</td><td class="bars" style="width:40%">${bar(e.kwh, eqTotal, "var(--elec)")}</td></tr>`).join("")}</tbody></table>
  </section>

  <section class="card span-12">
    <h2>Détail par sous-étape du cycle de vie</h2>
    <div class="legend" style="margin-bottom:6px"><span><i style="--c:var(--train)"></i>Entraînement</span><span><i style="--c:var(--infer)"></i>Inférence</span></div>
    <div class="scroll"><table>
      <thead><tr><th>Sous-étape</th>${IND.map(({ t }) => `<th>${t}</th>`).join("")}</tr></thead>
      <tbody>${r.steps.map((s) => `<tr><td><span class="legend" style="display:inline"><i style="--c:var(${s.phase === "Entraînement" ? "--train" : "--infer"})" title="${s.phase}"></i></span>${esc(s.label)}</td>${IND.map(({ k, c }) => `<td class="bars"><div class="n" style="text-align:left">${fmt[k](s[k])} <span class="ratio">(${nf(pct(s[k], T[k]), 2)} %)</span></div>${bar(s[k], maxStep[k], c)}</td>`).join("")}</tr>`).join("")}</tbody>
    </table></div>
  </section>

  <section class="card span-12">
    <h2>Si mon projet utilisait un autre modèle</h2>
    <p class="hint" style="margin-top:0">Comparaison à usage constant. Choisissez de préférence un modèle de même catégorie (petit, moyen, grand).</p>
    <div class="cmp-grid">${altNames
      .map((n, i) => {
        const prov = models.find((m) => m.name === n).provider;
        return `<div><label for="alt${i}">${esc(prov)}</label><select id="alt${i}" data-alt>${usable
          .filter((m) => m.provider === prov)
          .map((m) => `<option value="${esc(m.name)}"${m.name === n ? " selected" : ""}>${esc(m.name)} — ${esc(m.category)}</option>`)
          .join("")}</select></div>`;
      })
      .join("")}</div>
    <div class="cmp-cols">${IND.map(({ k, t, c }) => `<div><h3>${t} (par an)</h3><div class="scroll"><table class="cmp"><tbody>${cmp
      .map((x, i) => {
        const ratio = x.total[k] / T[k];
        const rt = i === 0 ? "modèle choisi" : ratio < 1 ? `👍 × ${nf(ratio, 2)}` : `× ${nf(ratio, 2)}`;
        return `<tr><td>${i === 0 ? "<strong>" : ""}${esc(x.model.name)}${i === 0 ? "</strong>" : ""}</td><td class="bars">${bar(x.total[k], maxCmp[k], c)}</td><td class="n">${fmt[k](x.total[k])}</td><td class="n ratio${ratio < 1 ? " better" : ""}">${rt}</td></tr>`;
      })
      .join("")}</tbody></table></div></div>`).join("")}</div>
  </section>

  <section class="card span-12">
    <h2>Bonnes pratiques d'écoconception</h2>
    <p class="hint" style="margin-top:0">La demande mondiale d'électricité de l'IA pourrait atteindre 1 500 TWh d'ici 2035 (≈ 3 fois la consommation annuelle de la France). Une IA frugale généralisée pourrait diviser par deux cette projection (Schneider Electric, 2024).</p>
    <div class="bp">
    <div style="--c:var(--sncf-cerulean)"><h4>Usages et modèles</h4><ul>
      <li>Challenger le besoin en IA générative du projet.</li>
      <li>Privilégier les modèles spécialisés aux modèles généralistes.</li>
      <li>Pour un même processus métier, cibler le modèle adapté à chaque étape.</li></ul></div>
    <div style="--c:var(--sncf-pourpre)"><h4>Optimiser l'inférence</h4><ul>
      <li><b>Prompts</b> : former les utilisateurs ; privilégier une architecture qui reformule et optimise les prompts.</li>
      <li><b>Tokens générés</b> : limiter la verbosité du modèle et borner le nombre de tokens de réponse.</li>
      <li><b>Routage automatique</b> : router vers le modèle optimal selon l'usage, préférer des SLM aux LLM quand c'est possible.</li>
      <li><b>Besoins de calcul</b> : mettre en cache les réponses récurrentes ; choisir une architecture « Mixture of Experts ».</li>
      <li><b>Exécution en local</b> : évaluer l'exécution de cas d'usage via des SLM sur le poste utilisateur.</li>
      <li><b>Optimisation du RAG</b> : limiter la taille et le nombre de chunks.</li>
      <li><b>Compression d'historique</b> : résumer régulièrement l'historique pour limiter les tokens d'entrée.</li>
      <li><b>Streaming de réponses</b> : afficher progressivement la réponse pour limiter les tokens de sortie.</li>
      <li><b>Observabilité</b> : mesurer la pertinence des entrées, la qualité des réponses et la justesse du routage (ex. LLM-as-a-Judge).</li>
      <li><b>Piloter l'inférence</b> : mesurer régulièrement l'impact pour suivre la progression et ajuster l'usage.</li></ul></div>
    <div style="--c:var(--sncf-menthe)"><h4>Optimiser l'infrastructure</h4><ul>
      <li><b>Datacenters responsables</b> : exiger un hébergement en France ou à défaut en Europe, dans un datacenter alimenté en électricité bas carbone (méthode location based ; PUE et WUE comme indicateurs d'efficacité).</li></ul></div>
    <div style="--c:var(--sncf-carmillon)"><h4>Sensibiliser les utilisateurs</h4><ul>
      <li><b>Construction du prompt</b> : former au prompt engineering, réutiliser les prompts et templates déjà éprouvés.</li>
      <li><b>Génération d'images</b> : quand le texte suffit, éviter de générer ou d'insérer images et vidéos.</li>
      <li><b>Factorisation</b> : regrouper plusieurs demandes en une seule requête.</li></ul></div>
    <div style="--c:var(--sncf-prune)"><h4>Référentiels et articles sur l'IA frugale</h4><ul>
      <li>Référentiel général d'écoconception de services numériques (RGESN), 2024</li>
      <li>AFNOR Spec 2314 — Référentiel général pour l'IA frugale, 2024</li>
      <li>Université Cornell — Green LLM Techniques in Action (2026) ; Data-Centric Green AI (2022)</li>
      <li>Gaël Lemaire — Qu'est-ce que la Green AI ? (2026)</li>
      <li>Digital League — Guide RESIL IT NR (2026)</li></ul></div>
    </div>
  </section>`;
}

form.addEventListener("input", (e) => {
  if (e.target.id === "provider") fillModels();
  render();
});
$("#results").addEventListener("change", (e) => e.target.matches("[data-alt]") && render());
render();
