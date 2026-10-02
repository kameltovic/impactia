/* global lucide, TomSelect */
// Interface du calculateur. Tout ce qui est métier (modèles, paramètres, dimensions, mix, contenus) vient de data.json :
// ce fichier ne contient ni valeur de calcul ni nom de modèle.
import { compute, usableModels } from "./calc.js";
import { ecologitsRequest, fetchEcologits } from "./ecologits.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const ic = (name, cls = "") => `<i data-lucide="${esc(name)}" class="${cls}" aria-hidden="true"></i>`;
const icons = () => window.lucide?.createIcons();

// ── Données : data.json, ou le brouillon du back-office en mode aperçu (?apercu) ──
const DRAFT_KEY = "impactia-draft";
async function loadData() {
  if (new URLSearchParams(location.search).has("apercu")) {
    try {
      const draft = localStorage.getItem(DRAFT_KEY);
      if (draft) {
        $("#draft-banner").hidden = false;
        return JSON.parse(draft);
      }
    } catch {
      /* stockage indisponible : on retombe sur data.json */
    }
  }
  return (await fetch("data.json", { cache: "no-cache" })).json();
}
const data = await loadData();
const usable = usableModels(data);
const providers = [...new Set(usable.map((m) => m.provider))];
const dims = data.dimensions;
const mixDim = dims.find((d) => d.factors.gridInference === "mix");
const dark = matchMedia("(prefers-color-scheme: dark)").matches;
const color = (d) => (dark && d.colorDark) || d.color;

const logo = (provider) => {
  const src = data.providers?.[provider]?.logo;
  return src
    ? `<img class="logo" src="${esc(src)}" alt="" width="18" height="18">`
    : `<span class="logo initial" aria-hidden="true">${esc(String(provider).charAt(0))}</span>`;
};

// ── Formatage ──
const nf = (v, d = 3) => new Intl.NumberFormat("fr-FR", { maximumSignificantDigits: d }).format(v);
const int = (v) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(v);
/** Valeur dans l'unité adaptée de la dimension ; `ref` fixe l'unité (utile pendant une animation). */
const fmt = (dim, v, ref = v) => {
  const [div, u] = dim.scale.find(([d]) => Math.abs(ref) >= d) ?? dim.scale.at(-1);
  return `${nf(v / div)} ${u}`;
};

// ── Formulaire ──
const opt = (html) => ({ option: html, item: html });
const defaultModel = usable.find((m) => m.name === data.meta.defaultModel) ?? usable[0];
const defaultMix = data.mixes.find((m) => m.default) ?? data.mixes[0];

$("#provider").innerHTML = providers.map((p) => `<option${p === defaultModel.provider ? " selected" : ""}>${esc(p)}</option>`).join("");
$("#requestTokens").innerHTML = data.requestSizes.map((s) => `<option value="${s.tokens}">${esc(s.label)}</option>`).join("");
$("#country").innerHTML = data.mixes.map((m) => `<option${m === defaultMix ? " selected" : ""}>${esc(m.name)}</option>`).join("");
$("#mix-default-label").textContent = defaultMix?.name ?? "Défaut";
if (mixDim) $("#custom-unit").textContent = `${mixDim.unit}/kWh`;
else document.querySelector("[data-mix-section]").hidden = true;

const tsProvider = new TomSelect("#provider", { controlInput: null, render: opt((d) => `<div class="opt">${logo(d.value)}${esc(d.text)}</div>`) });
const tsModel = new TomSelect("#model", {
  maxOptions: null,
  searchField: ["text"],
  render: opt((d) => `<div class="opt">${logo(d.provider)}<span>${esc(d.text)}</span><span class="badge">${esc(d.category)}</span></div>`),
});
new TomSelect("#requestTokens", { controlInput: null });
const flagOf = (name) => data.mixes.find((m) => m.name === name)?.flag ?? "xx";
new TomSelect("#country", { controlInput: null, render: opt((d) => `<div class="opt"><span class="fi fi-${esc(flagOf(d.value))}"></span>${esc(d.text)}</div>`) });

function fillModels(sel) {
  const list = usable.filter((m) => m.provider === tsProvider.getValue());
  tsModel.clear(true);
  tsModel.clearOptions();
  tsModel.addOptions(list.map((m) => ({ value: m.name, text: m.name, provider: m.provider, category: m.category })));
  tsModel.setValue(sel ?? list[0].name, true);
}
fillModels(defaultModel.name);

// Modèles de comparaison par défaut : ceux de data.json (meta.comparisonModels), sinon un par fournisseur,
// de même catégorie que le modèle par défaut si possible.
const alternatives = (data.meta.comparisonModels ?? []).filter((n) => usable.some((m) => m.name === n));
if (!alternatives.length) alternatives.push(...providers.slice(0, data.meta.comparisonSlots ?? 4).map((p) => {
  const own = usable.filter((m) => m.provider === p && m.name !== defaultModel.name);
  return (own.find((m) => m.category === defaultModel.category) ?? own[0] ?? usable[0]).name;
}));

function readInput() {
  const d = Object.fromEntries(new FormData($("#form")));
  const num = (k) => Math.max(0, Number(String(d[k] ?? "").replace(/[\s ]/g, "").replace(",", ".")) || 0);
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
    customIntensity: num("customIntensity"),
  };
}

// ── Rendu des résultats ──
const pct = (v, t) => (t > 0 ? (100 * v) / t : 0);
const bar = (v, max, c) => `<div class="bar" data-w="${pct(v, max).toFixed(2)}" style="--c:${c}"></div>`;
const h2 = (i, t) => `<h2>${ic(i, "h-ic")}${t}</h2>`;

function alertFor(r) {
  return dims
    .filter((d) => d.thresholds?.length)
    .map((d) => {
      const hit = [...d.thresholds].sort((a, b) => b.value - a.value).find((t) => r.total[d.key] > t.value);
      if (hit) return `<div class="alert">${ic("triangle-alert")}<span>${esc(hit.message)}</span></div>`;
      return d.belowThresholds ? `<div class="alert ok">${ic("circle-check")}<span>${esc(d.belowThresholds)}</span></div>` : "";
    })
    .join("");
}

function render() {
  const input = readInput();
  for (const el of document.querySelectorAll("[data-phase]")) el.hidden = el.dataset.phase !== input.phase;
  for (const el of document.querySelectorAll("[data-mix]")) el.hidden = el.dataset.mix !== input.mixMode;

  let r, cmp;
  try {
    r = compute(data, input.model, input);
    cmp = [r, ...alternatives.map((n) => compute(data, n, input))];
  } catch (e) {
    $("#results").innerHTML = `<div class="card span-12"><p>${ic("triangle-alert")} Calcul impossible : ${esc(e.message)}</p></div>`;
    icons();
    return;
  }
  if (mixDim) {
    $("#ef-hint").innerHTML = `Facteur retenu : <b>${nf(r.grid[mixDim.key])} ${esc(mixDim.unit)}/kWh</b><br>Entraînement : ${nf(mixDim.factors.gridTraining)} ${esc(mixDim.unit)}/kWh (mix mondial)`;
  }
  const p = r.project;
  const T = r.total;
  const maxStep = Object.fromEntries(dims.map((d) => [d.key, Math.max(...r.steps.map((s) => s.impacts[d.key]))]));
  const maxCmp = Object.fromEntries(dims.map((d) => [d.key, Math.max(...cmp.map((c) => c.total[d.key]))]));
  const eqTotal = r.equipment.reduce((a, e) => a + e.kwh, 0);
  const modelOptions = (sel) =>
    providers
      .map((pr) => `<optgroup label="${esc(pr)}">${usable.filter((m) => m.provider === pr).map((m) => `<option value="${esc(m.name)}"${m.name === sel ? " selected" : ""}>${esc(m.name)} — ${esc(m.category)}</option>`).join("")}</optgroup>`)
      .join("");

  last = { r, input };
  $("#results").innerHTML = `
  <section class="card span-12">
    <div class="res-head">${h2("chart-column", "Résultats annuels")}${data.meta.ecologitsApi ? resultTabs() : ""}</div>
    <p class="summary">${logo(r.model.provider)} <b>${esc(r.model.name)}</b> (${esc(r.model.provider)}, catégorie ${esc(r.model.category)}) —
      ${int(p.outTokens)} tokens de sortie, ${int(p.inTokens)} tokens d'entrée${p.embTokens ? `, ${int(p.embTokens)} tokens d'embedding` : ""} et ${int(p.requestsYear)} requêtes par an.</p>
    <div id="kpi-area"></div>
  </section>

  <section class="card span-5">
    ${h2("scale", "Entraînement vs inférence")}
    <div class="legend"><span><i style="--c:var(--train)"></i>Entraînement (amorti sur le projet)</span><span><i style="--c:var(--infer)"></i>Inférence</span></div>
    ${dims.map((d) => {
      const a = pct(r.training[d.key], T[d.key]);
      return `<div class="split-row"><span>${ic(d.icon, "muted")} ${esc(d.label)}<br><small class="ratio">entraînement ${nf(a, 2)} %</small></span><div class="split" role="img" aria-label="${esc(d.label)} : entraînement ${nf(a, 2)} %, inférence ${nf(100 - a, 2)} %">
        <div data-w="${a}" style="background:var(--train)">${a >= 20 ? nf(a, 2) + " %" : ""}</div><div data-w="${100 - a}" style="background:var(--infer)">${100 - a >= 20 ? nf(100 - a, 2) + " %" : ""}</div></div></div>`;
    }).join("")}
    <p class="hint">${ic("info")} Hébergement estimé : ${r.gpus} GPU — PUE ${nf(r.model.pue)}, WUE ${nf(r.model.wue)} L/kWh.</p>
  </section>

  <section class="card span-7">
    ${h2("server", "Électricité du traitement des requêtes, par équipement")}
    <table><tbody>${r.equipment.map((e) => `<tr><td>${ic(e.icon, "muted")} ${esc(e.label)}</td><td class="n">${nf(e.kwh)} kWh</td><td class="n">${nf(pct(e.kwh, eqTotal), 2)} %</td><td class="bars" style="width:40%">${bar(e.kwh, eqTotal, "var(--sncf-safran)")}</td></tr>`).join("")}</tbody></table>
  </section>

  <section class="card span-12">
    ${h2("list-tree", "Détail par sous-étape du cycle de vie")}
    <div class="legend" style="margin-bottom:6px"><span><i style="--c:var(--train)"></i>Entraînement</span><span><i style="--c:var(--infer)"></i>Inférence</span></div>
    <div class="scroll"><table>
      <thead><tr><th>Sous-étape</th>${dims.map((d) => `<th>${ic(d.icon)} ${esc(d.label)}</th>`).join("")}</tr></thead>
      <tbody>${r.steps.map((s) => `<tr><td class="step" style="--c:var(${s.phase === "Entraînement" ? "--train" : "--infer"})" title="${s.phase}">${ic(s.icon)}${esc(s.label)}</td>${dims.map((d) => `<td class="bars"><div class="n" style="text-align:left">${fmt(d, s.impacts[d.key])} <span class="ratio">(${nf(pct(s.impacts[d.key], T[d.key]), 2)} %)</span></div>${bar(s.impacts[d.key], maxStep[d.key], color(d))}</td>`).join("")}</tr>`).join("")}</tbody>
    </table></div>
  </section>

  <section class="card span-12">
    ${h2("arrow-left-right", "Si mon projet utilisait un autre modèle")}
    <p class="hint" style="margin-top:0">Comparaison à usage constant. Choisissez de préférence un modèle de même catégorie (petit, moyen, grand).</p>
    <div class="cmp-grid">${alternatives.map((n, i) => `<div><label for="alt${i}" class="lbl">Modèle ${i + 1}</label><select id="alt${i}" data-alt="${i}">${modelOptions(n)}</select></div>`).join("")}</div>
    <div class="cmp-cols">${dims.map((d) => `<div><h3>${ic(d.icon)} ${esc(d.label)} (par an)</h3><div class="scroll"><table class="cmp"><tbody>${cmp
      .map((x, n) => {
        const ratio = x.total[d.key] / T[d.key];
        const rt = n === 0 ? "modèle choisi" : ratio < 1 ? `${ic("thumbs-up")} × ${nf(ratio, 2)}` : `× ${nf(ratio, 2)}`;
        return `<tr><td>${logo(x.model.provider)} ${n === 0 ? "<strong>" : ""}${esc(x.model.name)}${n === 0 ? "</strong>" : ""}</td><td class="bars">${bar(x.total[d.key], maxCmp[d.key], color(d))}</td><td class="n">${fmt(d, x.total[d.key])}</td><td class="n ratio${ratio < 1 ? " better" : ""}">${rt}</td></tr>`;
      })
      .join("")}</tbody></table></div></div>`).join("")}</div>
  </section>`;
  renderKpis();
  icons();
  animate();
}

// ── Indicateurs annuels : onglets Impact'IA / EcoLogits, même carte pour les deux ──
let last = null; // dernier { r, input } calculé
let resultTab = "impactia";
let ecoSeq = 0;
let ecoTimer;
const ecoResults = new Map();
const ECO_EXTRA = { adpe: { label: "Ressources abiotiques (ADPe)", icon: "gem" }, pe: { label: "Énergie primaire", icon: "flame" } };

const resultTabs = () => `<div class="seg res-tabs" role="tablist" aria-label="Méthode d'estimation">
  ${[["impactia", "Impact'IA", "leaf"], ["ecologits", "EcoLogits", "scale-3d"]]
    .map(([k, l, i]) => `<button type="button" role="tab" data-rtab="${k}" aria-selected="${resultTab === k}">${ic(i)}${l}</button>`)
    .join("")}</div>`;

/** Carte d'indicateur commune aux deux onglets. */
const kpiCard = ({ c, icon, label, count, value, sub = "", eq = [], foot = "" }) => `<div class="kpi" style="--c:${c}">
  <div class="t"><span class="chip">${ic(icon)}</span>${esc(label)}</div>
  <div class="v"><span${count ? ` data-count="${count.key}" data-v="${count.v}"` : ""}>${value}</span> <small>/ an</small></div>
  <div class="s">${sub}</div>
  ${eq.length ? `<ul class="eq">${eq.map((e, n) => `<li>${ic(e.icon)}${n ? "ou " : "≈ "}${e.text}</li>`).join("")}</ul>` : ""}
  ${foot}
</div>`;
const equivalences = (d, v) => (d.equivalences ?? []).map((e) => ({ icon: e.icon, text: `${int(Math.ceil(v * e.perUnit))} ${esc(e.label)}` }));
const perLines = (d, v, requests, tokens) =>
  [requests > 0 && `${fmt(d, v / requests)} / requête`, tokens > 0 && `${fmt(d, v / tokens)} / token de sortie`].filter(Boolean).join("<br>");

function impactKpis(r) {
  const p = r.project;
  return `<div class="kpis">${dims
    .map((d) => kpiCard({ c: color(d), icon: d.icon, label: d.label, count: { key: d.key, v: r.total[d.key] }, value: fmt(d, r.total[d.key]), sub: perLines(d, r.total[d.key], p.requestsYear, p.outTokens), eq: equivalences(d, r.total[d.key]) }))
    .join("")}</div>${alertFor(r)}`;
}

const ecoDims = () => dims.filter((d) => d.ecologits);
const ECO_NOTE = `Périmètre EcoLogits : inférence seule (GPU et serveur), sans entraînement, RAG, front applicatif ni traitement des tokens d'entrée. Les ratios comparent donc à l'<b>inférence</b> d'Impact'IA ; l'eau d'Impact'IA est en outre pondérée par sa rareté locale (AWARE). Un ratio supérieur à 1 est attendu.`;

function ecoKpis(r, eco, req) {
  const p = r.project;
  const cards = ecoDims()
    .filter((d) => eco.impacts[d.ecologits])
    .map((d) => {
      const x = eco.impacts[d.ecologits];
      return kpiCard({
        c: color(d), icon: d.icon, label: d.label, count: { key: d.key, v: x.mid }, value: fmt(d, x.mid),
        sub: `Fourchette ${fmt(d, x.min)} – ${fmt(d, x.max)}<br>${perLines(d, x.mid, p.requestsYear, p.outTokens)}`,
        eq: equivalences(d, x.mid),
        foot: `<div class="kpi-cmp"><span class="kpi-cmp-t">La différence avec nous</span>${ic("leaf")} Impact'IA, inférence : <b>${fmt(d, r.inference[d.key])}</b><span class="ratio-badge" title="Impact'IA / EcoLogits">× ${nf(r.inference[d.key] / x.mid, 2)}</span></div>`,
      });
    });
  // Indicateurs qu'EcoLogits calcule mais pas Impact'IA : des étiquettes sous les cartes, pour garder les mêmes cartes dans les deux onglets.
  const extra = Object.entries(eco.impacts).filter(([k]) => ECO_EXTRA[k] && !dims.some((d) => d.ecologits === k));
  const meta = [
    ["Modèle EcoLogits", `<code>${esc(req.body.model_name)}</code>`],
    ["Zone électrique", esc(req.body.electricity_mix_zone)],
    ["Requête moyenne", `${int(req.body.output_token_count)} tokens · ${nf(req.body.request_latency)} s`],
    ["Requêtes par an", int(req.requests)],
    ["Valeur affichée", "milieu de la fourchette"],
  ];
  return `<div class="kpis">${cards.join("")}</div>
    ${extra.length ? `<div class="eco-extra"><span class="eco-extra-t">EcoLogits estime aussi</span>${extra
      .map(([k, x]) => `<span class="pill">${ic(ECO_EXTRA[k].icon)}<span>${ECO_EXTRA[k].label}</span><b>${nf(x.mid)} ${esc(x.unit)}</b><small>/ an</small></span>`)
      .join("")}<span class="eco-extra-n">Sans équivalent dans Impact'IA</span></div>` : ""}
    <div class="eco-info">
      <p>${ic("info")}<span>${ECO_NOTE}</span></p>
      <div class="eco-meta">${meta.map(([l, v]) => `<span><small>${l}</small>${v}</span>`).join("")}</div>
      ${req.zoneNote ? `<p>${ic("triangle-alert")}<span>${esc(req.zoneNote)}</span></p>` : ""}
      ${eco.warnings.length ? `<p class="warn">${ic("triangle-alert")}<span>Avertissement EcoLogits : ${eco.warnings.map(esc).join(" ")}</span></p>` : ""}
      <p class="sent">Données envoyées à <a href="https://ecologits.ai" target="_blank" rel="noopener">api.ecologits.ai</a> : fournisseur, modèle, tokens et latence d'une requête moyenne, zone électrique.</p>
    </div>`;
}

const ecoLoading = () =>
  `<div class="kpis">${ecoDims().map((d) => kpiCard({ c: color(d), icon: d.icon, label: d.label, value: "…", sub: `${ic("loader")} Interrogation d'EcoLogits…` })).join("")}</div><div class="eco-info"><p>${ic("info")}<span>${ECO_NOTE}</span></p></div>`;

function renderKpis() {
  const area = $("#kpi-area");
  if (!area || !last) return;
  const { r, input } = last;
  clearTimeout(ecoTimer);
  const seq = ++ecoSeq; // une réponse plus ancienne encore en vol sera ignorée
  if (resultTab === "impactia") return void (area.innerHTML = impactKpis(r));
  const req = ecologitsRequest(data, r, input);
  if (req.unavailable) return void (area.innerHTML = `<div class="alert">${ic("info")}<span>${esc(req.unavailable)}</span></div>`);
  const key = JSON.stringify([req.body, req.requests]);
  if (ecoResults.has(key)) return void (area.innerHTML = ecoKpis(r, ecoResults.get(key), req));
  if (area.querySelector(".kpi-cmp")) area.classList.add("loading");
  else area.innerHTML = ecoLoading();
  ecoTimer = setTimeout(async () => {
    let html;
    try {
      const eco = await fetchEcologits(data, req);
      ecoResults.set(key, eco);
      html = ecoKpis(r, eco, req);
    } catch (e) {
      html = `<div class="alert">${ic("cloud-off")}<span>EcoLogits est indisponible pour le moment (${esc(e.message)}). Le calcul Impact'IA n'est pas affecté.</span></div>`;
    }
    if (seq !== ecoSeq) return;
    area.classList.remove("loading");
    area.innerHTML = html;
    icons();
    animate();
  }, 300);
}
$("#results").addEventListener("click", (e) => {
  const b = e.target.closest("[data-rtab]");
  if (!b || b.dataset.rtab === resultTab) return;
  resultTab = b.dataset.rtab;
  for (const t of document.querySelectorAll("[data-rtab]")) t.setAttribute("aria-selected", t.dataset.rtab === resultTab);
  renderKpis();
  icons();
  animate();
});

// ── Animations : jauges qui se remplissent (depuis leur valeur précédente) et compteurs ──
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const prevW = new Map();
const prevV = {};
const grow = (el) => (el.style.width = `${el.dataset.w}%`);
const seen = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && (grow(e.target), seen.unobserve(e.target))), { threshold: 0.3 });
function animate() {
  document.querySelectorAll("#results [data-w]").forEach((el, n) => {
    const from = prevW.get(n);
    prevW.set(n, el.dataset.w);
    el.style.width = `${reduceMotion ? el.dataset.w : (from ?? 0)}%`;
    if (reduceMotion) return;
    if (from === undefined) seen.observe(el); // première apparition : se remplit quand la jauge devient visible
    else requestAnimationFrame(() => requestAnimationFrame(() => grow(el)));
  });
  document.querySelectorAll("#results [data-count]").forEach((el) => {
    const dim = dims.find((d) => d.key === el.dataset.count);
    const to = Number(el.dataset.v);
    const from = prevV[dim.key] ?? 0;
    prevV[dim.key] = to;
    if (reduceMotion || from === to) return;
    el.textContent = fmt(dim, from, to);
    const t0 = performance.now();
    const dur = from ? 500 : 1200;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      el.textContent = fmt(dim, from + (to - from) * (1 - (1 - k) ** 3), to);
      if (k < 1 && el.isConnected) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

// ── Bonnes pratiques et références (data.json → content) ──
const c = data.content ?? {};
const practices = c.practices ?? [];
const span = (n) => (n > 3 ? "span-12" : n > 1 ? "span-7" : "span-5");
$("#practices").innerHTML = `
  <div class="section-title span-12"><div><span class="eyebrow">Écoconception</span><h2>Bonnes pratiques</h2><p>Leviers activables selon la maturité de votre projet.</p></div></div>
  ${c.stats?.length ? `<section class="card span-12 stats">${c.stats.map((s) => `<div><b>${esc(s.value)}</b><span>${esc(s.text)}</span></div>`).join("")}<p class="hint">${esc(c.statsSource)}</p></section>` : ""}
  ${practices.map((g, n) => `
  <section class="card practice ${span(g.items.length)}" style="--c:${esc(g.color)}">
    <div class="ph"><span class="num">${String(n + 1).padStart(2, "0")}</span><h2>${esc(g.title)}</h2></div>
    <div class="tiles">${g.items.map((it) => `<article class="tile">${ic(it.icon, "bg-ic")}<h4>${esc(it.title)}</h4><p>${esc(it.text)}</p></article>`).join("")}</div>
  </section>`).join("")}
  ${c.references?.length ? `<section class="card span-5 practice" style="--c:var(--sncf-prune)">
    <div class="ph"><span class="num">${String(practices.length + 1).padStart(2, "0")}</span><h2>Référentiels et articles</h2></div>
    <ul class="refs">${c.references.map((ref) => `<li><a href="${esc(ref.url)}" target="_blank" rel="noopener"><span>${esc(ref.title)}</span><small>${esc(ref.year)} · ${esc(new URL(ref.url).hostname.replace(/^www\./, ""))}</small></a>${ic("arrow-up-right")}</li>`).join("")}</ul>
  </section>` : ""}`;

// ── Événements ──
// Séparateurs de milliers pendant la saisie, curseur conservé
const grp = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
$("#form").addEventListener("input", (e) => {
  const el = e.target;
  if (el.classList?.contains("num")) {
    const digitsBefore = el.value.slice(0, el.selectionStart).replace(/\D/g, "").length;
    const digits = el.value.replace(/\D/g, "");
    el.value = digits ? grp.format(Number(digits)).replace(/ /g, " ") : "";
    let pos = 0;
    for (let n = 0; pos < el.value.length && n < digitsBefore; pos++) if (/\d/.test(el.value[pos])) n++;
    el.setSelectionRange(pos, pos);
  }
  render();
});
$("#form").addEventListener("change", (e) => {
  if (e.target.id === "provider") fillModels();
  render();
});
$("#results").addEventListener("change", (e) => {
  if (!e.target.matches("[data-alt]")) return;
  alternatives[Number(e.target.dataset.alt)] = e.target.value;
  render();
});
render();
icons();
