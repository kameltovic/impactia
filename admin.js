// Back-office statique : édite une copie de data.json dans le navigateur (brouillon en localStorage),
// la valide en direct, puis l'exporte. Publier = remplacer data.json dans le dépôt (commit / pull request).
import { ACTIVITIES, compute, usableModels } from "./calc.js";
import { SAMPLE_INPUT, validate } from "./validate.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const ic = (n) => `<i data-lucide="${esc(n)}" aria-hidden="true"></i>`;
const icons = () => window.lucide?.createIcons();
const DRAFT_KEY = "impactia-draft";

const store = {
  get() {
    try {
      return localStorage.getItem(DRAFT_KEY);
    } catch {
      return null;
    }
  },
  set(v) {
    try {
      localStorage.setItem(DRAFT_KEY, v);
    } catch {
      /* stockage indisponible : le brouillon ne survivra pas au rechargement */
    }
  },
  clear() {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* rien à effacer */
    }
  },
};

const published = await (await fetch("data.json", { cache: "no-cache" })).json();
let data = JSON.parse(store.get() ?? "null") ?? structuredClone(published);
let tab = "models";

// ── Chemins « models.3.pTotal » → lecture / écriture dans data ──
const getPath = (path) => path.split(".").reduce((o, k) => o?.[k], data);
function setPath(path, value) {
  const keys = path.split(".");
  const last = keys.pop();
  keys.reduce((o, k) => o[k], data)[last] = value;
}
function parse(el) {
  if (el.type === "checkbox") return el.checked;
  const v = el.value.trim();
  if (el.dataset.type === "num") return v === "" ? null : Number(v.replace(",", "."));
  if (el.dataset.type === "numOrMix") return v === "mix" ? "mix" : v === "" ? null : Number(v.replace(",", "."));
  return v;
}

// ── Champs ──
const field = (path, type = "text", attrs = "") => {
  const v = getPath(path);
  const t = type === "num" || type === "numOrMix" ? "text" : type;
  return `<input type="${t}" data-path="${path}" data-type="${type}" value="${esc(v ?? "")}" ${type === "num" ? 'inputmode="decimal"' : ""} ${attrs}>`;
};
const check = (path) => `<input type="checkbox" data-path="${path}" ${getPath(path) ? "checked" : ""}>`;
const rowActions = (list, i) =>
  `<td style="white-space:nowrap"><button class="btn sm" data-dup="${list}.${i}" title="Dupliquer" type="button">${ic("copy")}</button> <button class="btn sm danger" data-del="${list}.${i}" title="Supprimer" type="button">${ic("trash-2")}</button></td>`;

// ── Onglets ──
const TABS = {
  models: { icon: "bot", label: "Modèles", render: renderModels },
  parameters: { icon: "sliders-horizontal", label: "Paramètres", render: renderParameters },
  dimensions: { icon: "layers-3", label: "Dimensions mesurées", render: renderDimensions },
  mixes: { icon: "plug-zap", label: "Mix électriques", render: renderMixes },
  providers: { icon: "building-2", label: "Fournisseurs", render: renderProviders },
  general: { icon: "settings", label: "Réglages généraux", render: renderGeneral },
  content: { icon: "file-text", label: "Contenus (JSON)", render: renderContent },
};

function renderModels() {
  const cols = [
    ["provider", "Fournisseur", "text", 'list="providers-list" style="min-width:120px"'],
    ["name", "Nom", "text", 'style="min-width:190px"'],
    ["category", "Catégorie", "text", 'list="categories-list" style="min-width:120px"'],
    ["pTotal", "Paramètres totaux (Md)", "num"],
    ["pActive", "Paramètres actifs (Md)", "num"],
    ["pue", "PUE", "num"],
    ["wue", "WUE (L/kWh)", "num"],
    ["tps", "TPS (tokens/s)", "num"],
    ["ttft", "TTFT (s)", "num"],
    ["flopsPerJoule", "FLOP par joule", "num"],
    ["computeKw", "Capacité de calcul du fournisseur (kW)", "num"],
    ["published", "Publication", "date"],
  ];
  const providers = [...new Set(data.models.map((m) => m.provider))];
  const categories = [...new Set(data.models.map((m) => m.category))];
  return `<h2>${ic("bot")} Modèles</h2>
  <p class="intro">Un modèle = une ligne. La catégorie « Embedding » sert au calcul du RAG et n'apparaît pas dans le calculateur. Laisser le TPS vide applique la formule de latence Ecologits. Dupliquer un modèle proche est le moyen le plus rapide d'en ajouter un.</p>
  <datalist id="providers-list">${providers.map((p) => `<option value="${esc(p)}">`).join("")}</datalist>
  <datalist id="categories-list">${categories.map((c) => `<option value="${esc(c)}">`).join("")}</datalist>
  <div class="card scroll"><table class="edit"><thead><tr>${cols.map((c) => `<th>${c[1]}</th>`).join("")}<th></th></tr></thead><tbody>
  ${data.models.map((m, i) => `<tr>${cols.map(([k, , t, a]) => `<td>${field(`models.${i}.${k}`, t, a)}</td>`).join("")}${rowActions("models", i)}</tr>`).join("")}
  </tbody></table></div>
  <p><button class="btn" data-add="models" type="button">${ic("plus")}Ajouter un modèle</button></p>`;
}

function renderParameters() {
  const groups = Object.groupBy(Object.entries(data.parameters), ([, p]) => p.group);
  return `<h2>${ic("sliders-horizontal")} Paramètres</h2>
  <p class="intro">Hypothèses communes à tous les modèles. La colonne « Excel » indique la variable de l'onglet Bibliothèque_FE synchronisée par <code>npm run extract</code> ; « Cellule » renvoie à la formule d'origine de l'onglet Calcul.</p>
  ${Object.entries(groups).map(([g, list]) => `<section class="card" style="margin-bottom:16px"><h3>${esc(g)}</h3><table class="edit"><thead><tr><th>Libellé</th><th>Valeur</th><th>Unité</th><th>Clé</th><th>Excel</th><th>Cellule</th></tr></thead><tbody>
    ${list.map(([k, p]) => `<tr><td>${field(`parameters.${k}.label`)}</td><td style="width:160px">${field(`parameters.${k}.value`, typeof p.value === "number" ? "num" : "text")}</td><td style="width:120px">${field(`parameters.${k}.unit`)}</td><td class="key">${k}</td><td class="help">${esc(p.excel ?? "—")}</td><td class="key">${esc(p.cell ?? "")}</td></tr>`).join("")}
  </tbody></table></section>`).join("")}`;
}

const DIM_TEMPLATE = () => ({
  key: "nouvelleDimension",
  label: "Nouvelle dimension",
  unit: "unité",
  color: "#6e1e78",
  icon: "gem",
  scale: [[1, "unité"]],
  factors: Object.fromEntries(Object.keys(ACTIVITIES).map((k) => [k, 0])),
  excel: {},
  scaleRequestNetworkByGpus: true,
  equivalences: [],
  thresholds: [],
});

function renderDimensions() {
  return `<h2>${ic("layers-3")} Dimensions mesurées</h2>
  <p class="intro">Chaque dimension convertit les activités physiques du calcul (électricité, part de vie des équipements…) en impact : impact = Σ activité × facteur. Pour ajouter un indicateur (ex. ressources abiotiques), créez une dimension et renseignez ses facteurs : aucun code à modifier. Mettre « mix » comme facteur d'électricité à l'inférence utilise le mix électrique choisi par l'utilisateur.</p>
  ${data.dimensions.map((d, i) => `<section class="card dim-card" style="margin-bottom:16px;--c:${esc(d.color)}">
    <h2><span class="swatch"></span>${esc(d.label)} <span class="key">(${esc(d.key)})</span>
      <span style="margin-left:auto"><button class="btn sm danger" data-del="dimensions.${i}" type="button">${ic("trash-2")}Supprimer</button></span></h2>
    <div class="grid2">
      <label>Clé${field(`dimensions.${i}.key`)}</label>
      <label>Libellé${field(`dimensions.${i}.label`)}</label>
      <label>Unité de calcul${field(`dimensions.${i}.unit`)}</label>
      <label>Picto Lucide ${ic(d.icon)}${field(`dimensions.${i}.icon`)}</label>
      <label>Couleur${field(`dimensions.${i}.color`, "color")}</label>
      <label>Couleur (mode sombre)${field(`dimensions.${i}.colorDark`, "color")}</label>
    </div>
    <h3>Facteurs par activité</h3>
    <table class="edit"><tbody>${Object.entries(ACTIVITIES).map(([k, help]) => `<tr><td class="key">${k}</td><td style="width:180px">${field(`dimensions.${i}.factors.${k}`, k === "gridInference" ? "numOrMix" : "num")}</td><td class="help">${esc(help)}${d.excel?.[k] ? ` — Excel : ${esc(d.excel[k])}` : ""}</td></tr>`).join("")}
      <tr><td class="key">réseau × N_GPU/8</td><td>${check(`dimensions.${i}.scaleRequestNetworkByGpus`)}</td><td class="help">Multiplier l'embarqué réseau du traitement des requêtes par le nombre de serveurs. Le classeur le fait pour l'eau, pas pour le GES.</td></tr>
    </tbody></table>
    <h3>Échelle d'affichage (seuil → unité)</h3>
    <table class="edit"><tbody>${d.scale.map((_, j) => `<tr><td>${field(`dimensions.${i}.scale.${j}.0`, "num")}</td><td>${field(`dimensions.${i}.scale.${j}.1`)}</td>${rowActions(`dimensions.${i}.scale`, j)}</tr>`).join("")}</tbody></table>
    <button class="btn sm" data-add="dimensions.${i}.scale" type="button">${ic("plus")}Ajouter une unité</button>
    <h3>Équivalences (par unité de calcul)</h3>
    <table class="edit"><tbody>${(d.equivalences ?? []).map((_, j) => `<tr><td>${field(`dimensions.${i}.equivalences.${j}.icon`)}</td><td>${field(`dimensions.${i}.equivalences.${j}.label`)}</td><td>${field(`dimensions.${i}.equivalences.${j}.perUnit`, "num")}</td>${rowActions(`dimensions.${i}.equivalences`, j)}</tr>`).join("")}</tbody></table>
    <button class="btn sm" data-add="dimensions.${i}.equivalences" type="button">${ic("plus")}Ajouter une équivalence</button>
    <h3>Seuils d'alerte (par an)</h3>
    <table class="edit"><tbody>${(d.thresholds ?? []).map((_, j) => `<tr><td style="width:140px">${field(`dimensions.${i}.thresholds.${j}.value`, "num")}</td><td>${field(`dimensions.${i}.thresholds.${j}.message`)}</td>${rowActions(`dimensions.${i}.thresholds`, j)}</tr>`).join("")}</tbody></table>
    <button class="btn sm" data-add="dimensions.${i}.thresholds" type="button">${ic("plus")}Ajouter un seuil</button>
  </section>`).join("")}
  <button class="btn" data-add="dimensions" type="button">${ic("plus")}Ajouter une dimension</button>`;
}

function renderMixes() {
  const mixDims = data.dimensions.filter((d) => d.factors.gridInference === "mix");
  return `<h2>${ic("plug-zap")} Mix électriques</h2>
  <p class="intro">Facteurs par kWh selon le pays d'inférence, pour chaque dimension dont le facteur « gridInference » vaut « mix ». Le drapeau est un code pays ISO (fr, de, us…) ; « un » affiche le drapeau des Nations unies.</p>
  <div class="card"><table class="edit"><thead><tr><th>Défaut</th><th>Pays / zone</th><th>Drapeau</th>${mixDims.map((d) => `<th>${esc(d.label)} (${esc(d.unit)}/kWh)</th>`).join("")}<th></th></tr></thead><tbody>
  ${data.mixes.map((m, i) => `<tr><td><input type="radio" name="mix-default" data-default-mix="${i}" ${m.default ? "checked" : ""}></td><td>${field(`mixes.${i}.name`)}</td><td style="white-space:nowrap"><span class="fi fi-${esc(m.flag)}"></span> ${field(`mixes.${i}.flag`, "text", 'style="width:70px"')}</td>${mixDims.map((d) => `<td>${field(`mixes.${i}.values.${d.key}`, "num")}</td>`).join("")}${rowActions("mixes", i)}</tr>`).join("")}
  </tbody></table></div>
  <p><button class="btn" data-add="mixes" type="button">${ic("plus")}Ajouter un mix</button></p>`;
}

function renderProviders() {
  for (const p of new Set(data.models.map((m) => m.provider))) data.providers[p] ??= { logo: "" };
  return `<h2>${ic("building-2")} Fournisseurs</h2>
  <p class="intro">Logo affiché à côté des modèles. Les logos disponibles sont dans <code>vendor/logos/</code> (voir <code>scripts/vendor.mjs</code>) ; sans logo, l'initiale du fournisseur s'affiche.</p>
  <div class="card"><table class="edit"><thead><tr><th>Fournisseur</th><th>Logo (chemin)</th><th>Aperçu</th></tr></thead><tbody>
  ${Object.keys(data.providers).map((p) => `<tr><td>${esc(p)}</td><td>${field(`providers.${p}.logo`)}</td><td>${data.providers[p].logo ? `<img src="${esc(data.providers[p].logo)}" alt="" width="20" height="20">` : "—"}</td></tr>`).join("")}
  </tbody></table></div>`;
}

function renderGeneral() {
  const usable = usableModels(data).map((m) => m.name);
  const sel = (path, list) => `<select data-path="${path}">${list.map((n) => `<option${n === getPath(path) ? " selected" : ""}>${esc(n)}</option>`).join("")}</select>`;
  return `<h2>${ic("settings")} Réglages généraux</h2>
  <section class="card" style="margin-bottom:16px"><div class="grid2">
    <label>Titre${field("meta.title")}</label>
    <label>Licence${field("meta.license")}</label>
    <label>Modèle sélectionné par défaut${sel("meta.defaultModel", usable)}</label>
    ${(data.meta.comparisonModels ?? []).map((_, i) => `<label>Modèle de comparaison ${i + 1}${sel(`meta.comparisonModels.${i}`, usable)}</label>`).join("")}
  </div><p class="hint">Attribution : ${esc(data.meta.attribution)}</p></section>
  <section class="card"><h3>Tailles de requête (phase Conception)</h3><table class="edit"><tbody>
    ${data.requestSizes.map((_, i) => `<tr><td>${field(`requestSizes.${i}.label`)}</td><td style="width:160px">${field(`requestSizes.${i}.tokens`, "num")}</td>${rowActions("requestSizes", i)}</tr>`).join("")}
  </tbody></table><button class="btn sm" data-add="requestSizes" type="button">${ic("plus")}Ajouter une taille</button></section>`;
}

function renderContent() {
  return `<h2>${ic("file-text")} Contenus</h2>
  <p class="intro">Bonnes pratiques, chiffres clés et références, au format JSON. Les pictos sont des noms Lucide (lucide.dev/icons).</p>
  <textarea class="json" id="content-json" spellcheck="false">${esc(JSON.stringify(data.content, null, 2))}</textarea>
  <p class="hint" id="content-status"></p>`;
}

// ── Rendu, validation, brouillon ──
function render() {
  $("#tabs").innerHTML = Object.entries(TABS).map(([k, t]) => `<button type="button" data-tab="${k}" aria-current="${k === tab}">${ic(t.icon)}${t.label}</button>`).join("");
  $("#panel").innerHTML = TABS[tab].render();
  refresh();
  icons();
}
let timer;
function refresh() {
  const issues = validate(data);
  const dirty = JSON.stringify(data) !== JSON.stringify(published);
  $("#status").innerHTML = dirty ? `${ic("circle-dot")} Modifications non exportées (gardées dans ce navigateur)` : `${ic("check")} Identique au data.json publié`;
  let sample = "";
  if (!issues.length) {
    const r = compute(data, data.meta.defaultModel, SAMPLE_INPUT);
    sample = ` Exemple, ${esc(data.meta.defaultModel)} avec les volumes par défaut : ${data.dimensions.map((d) => `${new Intl.NumberFormat("fr-FR", { maximumSignificantDigits: 3 }).format(r.total[d.key])} ${esc(d.unit)}`).join(" · ")}.`;
  }
  $("#issues").innerHTML = issues.length
    ? `<div class="issues"><b>${issues.length} problème(s) à corriger avant d'exporter :</b><ul>${issues.slice(0, 30).map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>`
    : `<div class="issues ok"><b>Données valides.</b>${sample}</div>`;
  $("#export").disabled = issues.length > 0;
  icons();
}
function save() {
  store.set(JSON.stringify(data));
  clearTimeout(timer);
  timer = setTimeout(refresh, 250);
}

$("#tabs").addEventListener("click", (e) => {
  const b = e.target.closest("[data-tab]");
  if (b) {
    tab = b.dataset.tab;
    render();
  }
});
$("#panel").addEventListener("input", (e) => {
  if (e.target.id === "content-json") {
    try {
      data.content = JSON.parse(e.target.value);
      $("#content-status").textContent = "JSON valide.";
      save();
    } catch (err) {
      $("#content-status").textContent = `JSON invalide : ${err.message}`;
    }
    return;
  }
  if (e.target.dataset.path) {
    setPath(e.target.dataset.path, parse(e.target));
    save();
  }
});
$("#panel").addEventListener("change", (e) => {
  if (e.target.dataset.path && e.target.tagName === "SELECT") {
    setPath(e.target.dataset.path, e.target.value);
    save();
  }
  if (e.target.dataset.defaultMix !== undefined) {
    data.mixes.forEach((m, i) => (m.default = i === Number(e.target.dataset.defaultMix)));
    save();
  }
  if (e.target.type === "color" || e.target.dataset.path?.endsWith(".icon") || e.target.dataset.path?.endsWith(".flag")) render();
});
$("#panel").addEventListener("click", (e) => {
  const b = e.target.closest("[data-add],[data-dup],[data-del]");
  if (!b) return;
  if (b.dataset.add) {
    const list = getPath(b.dataset.add);
    const templates = {
      models: () => ({ ...structuredClone(data.models.at(-1)), name: "Nouveau modèle" }),
      dimensions: DIM_TEMPLATE,
      mixes: () => ({ name: "Nouveau pays", flag: "xx", default: false, values: {} }),
      requestSizes: () => ({ label: "Nouvelle taille", tokens: 500 }),
    };
    const t = templates[b.dataset.add] ?? (() => (b.dataset.add.endsWith("scale") ? [1, ""] : b.dataset.add.endsWith("thresholds") ? { value: 0, message: "" } : { icon: "circle", label: "", perUnit: 1 }));
    list.push(t());
  } else {
    const path = b.dataset.dup ?? b.dataset.del;
    const i = Number(path.split(".").pop());
    const list = getPath(path.split(".").slice(0, -1).join("."));
    if (b.dataset.dup) list.splice(i + 1, 0, { ...structuredClone(list[i]), ...(list[i].name ? { name: `${list[i].name} (copie)` } : {}) });
    else if (confirm("Supprimer cet élément ?")) list.splice(i, 1);
  }
  save();
  render();
});
$("#export").addEventListener("click", () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2) + "\n"], { type: "application/json" }));
  Object.assign(document.createElement("a"), { href: url, download: "data.json" }).click();
  URL.revokeObjectURL(url);
});
$("#reset").addEventListener("click", () => {
  if (!confirm("Revenir au data.json publié et perdre les modifications de ce navigateur ?")) return;
  store.clear();
  data = structuredClone(published);
  render();
});
$("#import-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    data = JSON.parse(await file.text());
    save();
    render();
  } catch (err) {
    alert(`Fichier illisible : ${err.message}`);
  }
});
render();
