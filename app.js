/* global lucide, TomSelect */
import { compute } from "./calc.js";
import { models, mix, requestSizes } from "./data.js";

const $ = (s) => document.querySelector(s);
const form = $("#form");
const usable = models.filter((m) => m.category !== "Embedding");
const providers = [...new Set(usable.map((m) => m.provider))];
const alternatives = ["GPT-4.1-mini", "Mistral Large", "Claude Sonnet 4", "Gemini 2.5 flash lite"]; // défauts du classeur
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const options = (list, sel) => list.map((v) => `<option${v === sel ? " selected" : ""}>${esc(v)}</option>`).join("");
const ic = (name, cls = "") => `<i data-lucide="${name}" class="${cls}" aria-hidden="true"></i>`;
const icons = () => window.lucide?.createIcons();

// Logos fournisseurs (Lobe Icons) et drapeaux (flag-icons)
const LOGO = { OpenAI: "openai", Anthropic: "claude-color", "Mistral AI": "mistral-color", Google: "gemini-color" };
const logo = (p) => `<img class="logo" src="https://unpkg.com/@lobehub/icons-static-svg@1/icons/${LOGO[p]}.svg" alt="" width="18" height="18">`;
const FLAG = { France: "fr", "Autre (monde)": "un", "Europe (UE27)": "eu", USA: "us", UK: "gb", Allemagne: "de", Irlande: "ie", "Pays Bas": "nl", Suède: "se" };

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
  { k: "kwh", t: "Consommation d'électricité", c: "var(--elec)", i: "zap" },
  { k: "gwp", t: "Potentiel de réchauffement climatique", c: "var(--gwp)", i: "cloud" },
  { k: "water", t: "Utilisation d'eau", c: "var(--water)", i: "droplets" },
];
const STEP_ICON = ["database", "flask-conical", "graduation-cap", "layers", "monitor", "cpu"];
const EQUIP_ICON = ["microchip", "server", "network", "building-2"];

// ── Formulaire ──
$("#provider").innerHTML = options(providers, "OpenAI");
$("#requestTokens").innerHTML = Object.entries(requestSizes).map(([l, v]) => `<option value="${v}">${esc(l)}</option>`).join("");
$("#country").innerHTML = options(Object.keys(mix), "France");

const opt = (html) => ({ option: html, item: html });
const tsProvider = new TomSelect("#provider", { controlInput: null, render: opt((d) => `<div class="opt">${logo(d.value)}${esc(d.text)}</div>`) });
const tsModel = new TomSelect("#model", {
  maxOptions: null,
  searchField: ["text"],
  render: opt((d) => `<div class="opt">${logo(d.provider)}<span>${esc(d.text)}</span><span class="badge">${esc(d.category)}</span></div>`),
});
new TomSelect("#country", { controlInput: null, render: opt((d) => `<div class="opt"><span class="fi fi-${FLAG[d.value] ?? "xx"}"></span>${esc(d.text)}</div>`) });

function fillModels(sel) {
  const list = usable.filter((m) => m.provider === tsProvider.getValue());
  tsModel.clear(true);
  tsModel.clearOptions();
  tsModel.addOptions(list.map((m) => ({ value: m.name, text: m.name, provider: m.provider, category: m.category })));
  tsModel.setValue(sel ?? list[0].name, true);
}
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

// ── Rendu des résultats ──
const pct = (v, t) => (t > 0 ? (100 * v) / t : 0);
const bar = (v, max, c) => `<div class="bar" style="width:${pct(v, max).toFixed(2)}%;--c:${c}"></div>`;
const h2 = (i, t) => `<h2>${ic(i, "h-ic")}${t}</h2>`;

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
    kwh: [["smartphone", `${int(Math.ceil(T.kwh * 1000 * 0.1))} recharges de smartphone`], ["globe", `${int(Math.ceil(T.kwh * 1000 * 0.6))} minutes sur Internet`]],
    gwp: [["car", `${int(T.gwp * 1000 * 0.0046)} km en voiture`], ["video", `${int(T.gwp * 1000 * 0.0175)} h de visio`]],
    water: [["glass-water", `${int(T.water)} bouteilles d'eau de 1 L`], ["coffee", `${int(T.water * 4)} cafés`]],
  };
  const per = (k) =>
    [r.perRequest && `${fmt[k](r.perRequest[k])} / requête`, r.perToken && `${fmt[k](r.perToken[k])} / token de sortie`].filter(Boolean).join("<br>");

  const alert =
    T.gwp > 10000
      ? `<div class="alert">${ic("triangle-alert")}<span>Plus de 10 000 kg CO₂e/an : un plan d'action de mitigation et de mise en œuvre de bonnes pratiques doit être mis en place.</span></div>`
      : T.gwp > 1000
        ? `<div class="alert">${ic("triangle-alert")}<span>Plus de 1 000 kg CO₂e/an : le projet doit faire l'objet d'une réflexion autour de son impact environnemental.</span></div>`
        : `<div class="alert ok">${ic("circle-check")}<span>Moins de 1 000 kg CO₂e/an. Les bonnes pratiques ci-dessous restent utiles pour réduire l'empreinte.</span></div>`;

  const maxStep = Object.fromEntries(IND.map(({ k }) => [k, Math.max(...r.steps.map((s) => s[k]))]));
  const eqTotal = r.equipment.reduce((a, e) => a + e.kwh, 0);

  const alts = [...document.querySelectorAll("[data-alt]")].map((s) => s.value);
  const altNames = alts.length ? alts : alternatives;
  const cmp = [r, ...altNames.map((n) => compute(n, input))];
  const maxCmp = Object.fromEntries(IND.map(({ k }) => [k, Math.max(...cmp.map((c) => c.total[k]))]));

  $("#results").innerHTML = `
  <section class="card span-12">
    ${h2("chart-column", "Résultats annuels")}
    <p class="summary">${logo(r.model.provider)} <b>${esc(r.model.name)}</b> (${esc(r.model.provider)}, catégorie ${esc(r.model.category)}) —
      ${int(p.outTokens)} tokens de sortie, ${int(p.inTokens)} tokens d'entrée${p.embTokens ? `, ${int(p.embTokens)} tokens d'embedding` : ""} et ${int(p.requestsYear)} requêtes par an.</p>
    <div class="kpis">
      ${IND.map(({ k, t, c, i }) => `<div class="kpi" style="--c:${c}">
        <div class="t"><span class="chip">${ic(i)}</span>${t}</div>
        <div class="v">${fmt[k](T[k])} <small>/ an</small></div>
        <div class="s">${per(k)}</div>
        <ul class="eq">${eq[k].map(([ei, et], n) => `<li>${ic(ei)}${n ? "ou " : "≈ "}${et}</li>`).join("")}</ul>
      </div>`).join("")}
    </div>
    ${alert}
  </section>

  <section class="card span-5">
    ${h2("scale", "Entraînement vs inférence")}
    <div class="legend"><span><i style="--c:var(--train)"></i>Entraînement (amorti sur le projet)</span><span><i style="--c:var(--infer)"></i>Inférence</span></div>
    ${IND.map(({ k, t, i }) => {
      const a = pct(r.training[k], T[k]);
      return `<div class="split-row"><span>${ic(i, "muted")} ${t}<br><small class="ratio">entraînement ${nf(a, 2)} %</small></span><div class="split" role="img" aria-label="${t} : entraînement ${nf(a, 2)} %, inférence ${nf(100 - a, 2)} %">
        <div style="width:${a}%;background:var(--train)">${a >= 20 ? nf(a, 2) + " %" : ""}</div><div style="width:${100 - a}%;background:var(--infer)">${100 - a >= 20 ? nf(100 - a, 2) + " %" : ""}</div></div></div>`;
    }).join("")}
    <p class="hint">${ic("info")} Hébergement estimé : ${r.gpus} GPU — PUE ${nf(r.model.pue)}, WUE ${nf(r.model.wue)} L/kWh.</p>
  </section>

  <section class="card span-7">
    ${h2("server", "Électricité du traitement des requêtes, par équipement")}
    <table><tbody>${r.equipment.map((e, n) => `<tr><td>${ic(EQUIP_ICON[n], "muted")} ${e.label}</td><td class="n">${fmt.kwh(e.kwh)}</td><td class="n">${nf(pct(e.kwh, eqTotal), 2)} %</td><td class="bars" style="width:40%">${bar(e.kwh, eqTotal, "var(--elec)")}</td></tr>`).join("")}</tbody></table>
  </section>

  <section class="card span-12">
    ${h2("list-tree", "Détail par sous-étape du cycle de vie")}
    <div class="legend" style="margin-bottom:6px"><span><i style="--c:var(--train)"></i>Entraînement</span><span><i style="--c:var(--infer)"></i>Inférence</span></div>
    <div class="scroll"><table>
      <thead><tr><th>Sous-étape</th>${IND.map(({ t, i }) => `<th>${ic(i)} ${t}</th>`).join("")}</tr></thead>
      <tbody>${r.steps.map((s, n) => `<tr><td class="step" style="--c:var(${s.phase === "Entraînement" ? "--train" : "--infer"})" title="${s.phase}">${ic(STEP_ICON[n])}${esc(s.label)}</td>${IND.map(({ k, c }) => `<td class="bars"><div class="n" style="text-align:left">${fmt[k](s[k])} <span class="ratio">(${nf(pct(s[k], T[k]), 2)} %)</span></div>${bar(s[k], maxStep[k], c)}</td>`).join("")}</tr>`).join("")}</tbody>
    </table></div>
  </section>

  <section class="card span-12">
    ${h2("arrow-left-right", "Si mon projet utilisait un autre modèle")}
    <p class="hint" style="margin-top:0">Comparaison à usage constant. Choisissez de préférence un modèle de même catégorie (petit, moyen, grand).</p>
    <div class="cmp-grid">${altNames
      .map((n, i) => {
        const prov = models.find((m) => m.name === n).provider;
        return `<div><label for="alt${i}">${logo(prov)} ${esc(prov)}</label><select id="alt${i}" data-alt>${usable
          .filter((m) => m.provider === prov)
          .map((m) => `<option value="${esc(m.name)}"${m.name === n ? " selected" : ""}>${esc(m.name)} — ${esc(m.category)}</option>`)
          .join("")}</select></div>`;
      })
      .join("")}</div>
    <div class="cmp-cols">${IND.map(({ k, t, c, i }) => `<div><h3>${ic(i)} ${t} (par an)</h3><div class="scroll"><table class="cmp"><tbody>${cmp
      .map((x, n) => {
        const ratio = x.total[k] / T[k];
        const rt = n === 0 ? "modèle choisi" : ratio < 1 ? `${ic("thumbs-up")} × ${nf(ratio, 2)}` : `× ${nf(ratio, 2)}`;
        return `<tr><td>${logo(x.model.provider)} ${n === 0 ? "<strong>" : ""}${esc(x.model.name)}${n === 0 ? "</strong>" : ""}</td><td class="bars">${bar(x.total[k], maxCmp[k], c)}</td><td class="n">${fmt[k](x.total[k])}</td><td class="n ratio${ratio < 1 ? " better" : ""}">${rt}</td></tr>`;
      })
      .join("")}</tbody></table></div></div>`).join("")}</div>
  </section>`;
  icons();
}

// ── Bonnes pratiques (statiques, issues de l'onglet ♻️ du classeur) ──
const PRACTICES = [
  { t: "Usages et modèles", i: "target", c: "var(--sncf-cerulean)", items: [
    ["circle-help", "Challenger le besoin", "Questionner le recours à l'IA générative pour le projet."],
    ["crosshair", "Modèles spécialisés", "Privilégier les modèles spécialisés aux modèles généralistes."],
    ["workflow", "Le bon modèle à chaque étape", "Pour un même processus métier, cibler le modèle adapté à chaque étape."],
  ] },
  { t: "Optimiser l'infrastructure", i: "server-cog", c: "var(--sncf-menthe)", items: [
    ["leaf", "Datacenters responsables", "Exiger un hébergement en France, ou à défaut en Europe, dans un datacenter alimenté en électricité bas carbone (location based). Suivre PUE et WUE."],
  ] },
  { t: "Optimiser l'inférence", i: "gauge", c: "var(--sncf-pourpre)", items: [
    ["message-square-text", "Prompts", "Former les utilisateurs ; privilégier une architecture qui reformule et optimise les prompts."],
    ["scissors", "Tokens générés", "Limiter la verbosité du modèle et borner le nombre de tokens de réponse."],
    ["route", "Routage automatique", "Router vers le modèle optimal selon l'usage, préférer des SLM aux LLM quand c'est possible."],
    ["hard-drive", "Besoins de calcul", "Mettre en cache les réponses récurrentes ; choisir une architecture « Mixture of Experts »."],
    ["laptop", "Exécution en local", "Évaluer l'exécution de certains cas d'usage via des SLM sur le poste utilisateur."],
    ["layers", "Optimisation du RAG", "Limiter la taille et le nombre de chunks."],
    ["history", "Compression d'historique", "Résumer régulièrement l'historique pour limiter les tokens d'entrée."],
    ["activity", "Streaming de réponses", "Afficher progressivement la réponse pour limiter les tokens de sortie."],
    ["eye", "Observabilité", "Mesurer la pertinence des entrées, la qualité des réponses et la justesse du routage (ex. LLM-as-a-Judge)."],
    ["chart-line", "Piloter l'inférence", "Mesurer régulièrement l'impact pour suivre la progression et ajuster l'usage."],
  ] },
  { t: "Sensibiliser les utilisateurs", i: "users", c: "var(--sncf-carmillon)", items: [
    ["pen-line", "Construction du prompt", "Former au prompt engineering, réutiliser les prompts et templates déjà éprouvés."],
    ["image-off", "Génération d'images", "Quand le texte suffit, éviter de générer ou d'insérer images et vidéos."],
    ["combine", "Factorisation", "Regrouper plusieurs demandes en une seule requête."],
  ] },
];
const REFS = [
  "Référentiel général d'écoconception de services numériques (RGESN), 2024",
  "AFNOR Spec 2314 — Référentiel général pour l'IA frugale, 2024",
  "Université Cornell — Green LLM Techniques in Action (2026)",
  "Université Cornell — Data-Centric Green AI (2022)",
  "Gaël Lemaire — Qu'est-ce que la Green AI ? (2026)",
  "Digital League — Guide RESIL IT NR (2026)",
];
$("#practices").innerHTML = `
  <div class="section-title span-12">${ic("sprout")}<div><h2>Bonnes pratiques d'écoconception</h2><p>Leviers activables selon la maturité de votre projet.</p></div></div>
  <section class="card span-12 stats">
    <div><b>1 500 TWh</b><span>demande mondiale d'électricité de l'IA possible d'ici 2035</span></div>
    <div><b>≈ 3 ×</b><span>la consommation électrique annuelle de la France</span></div>
    <div><b>÷ 2</b><span>avec une IA frugale généralisée</span></div>
    <p class="hint">Source : Schneider Electric, « Artificial Intelligence and Electricity, A System Dynamics Approach », 2024.</p>
  </section>
  ${PRACTICES.map(({ t, i, c, items }) => `
  <section class="card practice ${items.length > 3 ? "span-12" : items.length > 1 ? "span-7" : "span-5"}" style="--c:${c}">
    <h2><span class="chip">${ic(i)}</span>${t}<span class="count">${items.length}</span></h2>
    <div class="tiles">${items.map(([ii, tt, d]) => `<article class="tile"><span class="chip sm">${ic(ii)}</span><div><h4>${tt}</h4><p>${d}</p></div></article>`).join("")}</div>
  </section>`).join("")}
  <section class="card span-5 practice" style="--c:var(--sncf-prune)">
    <h2><span class="chip">${ic("book-open")}</span>Référentiels et articles sur l'IA frugale</h2>
    <ul class="refs">${REFS.map((x) => `<li>${ic("file-text")}${x}</li>`).join("")}</ul>
  </section>`;

form.addEventListener("input", render);
form.addEventListener("change", (e) => {
  if (e.target.id === "provider") fillModels();
  render();
});
$("#results").addEventListener("change", (e) => e.target.matches("[data-alt]") && render());
render();
icons();
