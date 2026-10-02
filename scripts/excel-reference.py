"""Recalcule les vraies formules du classeur (onglet Calcul) avec la lib `formulas`, pour 3 scénarios x tous les modèles.
Sert à produire les valeurs de référence comparées au moteur JS. Le fichier brut produit garde toutes les cellules ;
test/excel-reference.json n'en conserve qu'un extrait.

    uv run --with openpyxl --with formulas scripts/excel-reference.py /tmp/excel.json

Pré-traitement : références structurées -> plages, TODAY() figé au 2026-10-02, formules dynamiques (FILTER/UNIQUE) -> valeurs.
Scénario Conception : le champ masqué « requêtes / mois » (D36) est aligné sur les usages, comme dans calc.js."""
import json, re, sys, warnings
import openpyxl, formulas
from openpyxl.worksheet.formula import ArrayFormula

warnings.filterwarnings("ignore")
SRC = "source.xlsx"
OUT = sys.argv[1]
src = openpyxl.load_workbook(SRC)
val = openpyxl.load_workbook(SRC, data_only=True)

def cols(ws, tname):
    t = ws.tables[tname]
    a, b = t.ref.split(":")
    c0 = openpyxl.utils.column_index_from_string(re.match(r"[A-Z]+", a).group())
    r1 = int(re.search(r"\d+", b).group())
    names = [c.name for c in t.tableColumns]
    return {n.strip(): openpyxl.utils.get_column_letter(c0 + i) for i, n in enumerate(names)}, r1, names

T = {}
for sheet, tname in [("Modèles_IA", "Tableau1"), ("Bibliothèque_FE", "Tableau2")]:
    m, r1, names = cols(src[sheet], tname)
    T[tname] = (sheet, m, r1, names)

def rng(tname, c1, c2=None, rows=None):
    sheet, m, r1, names = T[tname]
    a, b = m[c1.strip()], m[(c2 or c1).strip()]
    lo, hi = rows or (2, r1)
    return f"'{sheet}'!${a}${lo}:${b}${hi}"

def rewrite(f, row):
    f = f.replace("TODAY()", "DATE(2026,10,2)").replace("📓Notice!", "'📓Notice'!").replace("📊Résultats!", "'📊Résultats'!")
    def sub(mo):
        t, inner = mo.group(1), mo.group(2)
        sheet, m, r1, names = T[t]
        if inner == "":
            return rng(t, names[0], names[-1])
        if inner == "#Headers":
            return rng(t, names[0], names[-1], (1, 1))
        if inner == "#All":
            return rng(t, names[0], names[-1], (1, r1))
        parts = re.findall(r"\[([^\]]*)\]", inner)
        if parts and parts[0] == "#This Row":
            return f"'{sheet}'!${m[parts[1].strip()]}{row}"
        if len(parts) == 2:
            return rng(t, parts[0], parts[1])
        return rng(t, inner)
    return re.sub(r"(Tableau[12])\[((?:\[[^\]]*\]|[^\]\[])*)\]", sub, f)

out = openpyxl.Workbook()
out.remove(out.active)
FORMULA_SHEETS = {"Calcul", "Modèles_IA", "Bibliothèque_FE"}
for ws in src.worksheets:
    o = out.create_sheet(ws.title)
    for row in ws.iter_rows():
        for c in row:
            v = c.value
            if isinstance(v, ArrayFormula):
                v = v.text
            if isinstance(v, str) and v.startswith("=") and ws.title in FORMULA_SHEETS and "FILTER" not in v and "UNIQUE" not in v:
                o[c.coordinate] = rewrite(v, c.row)
            elif v is not None:
                cached = val[ws.title][c.coordinate].value if isinstance(v, str) and v.startswith("=") else v
                if cached is not None and not (isinstance(cached, str) and cached.startswith("#")):
                    o[c.coordinate] = cached
D = out["⚙️Données"]
for k, v in {"F26": "OpenAI", "J26": "GPT-4o", "B43": 2, "H44": "France", "K44": 0.1, "D33": "Echange court (≈ 400 tokens)"}.items():
    D[k] = v
tmp = OUT + ".xlsx"
out.save(tmp)

xl = formulas.ExcelModel().loads(tmp).finish()
book = "[" + tmp.split("/")[-1] + "]"
def ref(sheet, cell):
    return f"'{book}{sheet.upper()}'!{cell}"

CELLS = {"total_kwh": "N33", "total_gwp": "N37", "total_water": "N41", "train_kwh": "N53", "train_gwp": "N56", "train_water": "N59",
         "storage_kwh": "N64", "storage_gwp": "N72", "storage_water": "N76", "final_kwh": "N90", "final_gwp": "N96", "final_water": "N99",
         "emb_kwh": "N129", "emb_gwp": "N136", "emb_water": "N140", "front_kwh": "N146", "front_gwp": "N151", "front_water": "N155",
         "req_kwh": "N163", "req_gwp": "N205", "req_water": "N235", "gpus": "N167", "active": "N119", "lifetime_tokens": "N114",
         "per_request_kwh": "N34", "per_token_kwh": "N35"}
models = [r[2].value for r in val["Modèles_IA"].iter_rows(min_row=2, max_row=41) if r[3].value != "Embedding"]
prov = {r[2].value: r[1].value for r in val["Modèles_IA"].iter_rows(min_row=2, max_row=41)}
scenarios = {
    "prod_fr": {"H19": "Production", "D36": 100000, "H36": 1e8, "K36": 1e8, "H38": 1e9, "B43": 2},
    "prod_usa_noemb": {"H19": "Production", "D36": 2500, "H36": 3e6, "K36": 7e5, "H38": 0, "B43": 1, "H44": "USA"},
    "conception_custom": {"H19": "Conception", "D36": 250*4*365/12, "H33": 250, "L33": 4, "D33": "Analyse longue (≈ 1500 tokens)", "B43": 3, "K44": 0.2, "H36": 1e8, "K36": 1e8, "H38": 1e9},
}
res = {}
for sname, sc in scenarios.items():
    for mname in models:
        inputs = {ref("⚙️Données", k): v for k, v in {**sc, "J26": mname, "F26": prov[mname]}.items()}
        sol = xl.calculate(inputs=inputs, outputs=[ref("Calcul", c) for c in CELLS.values()])
        row = {}
        for k, c in CELLS.items():
            v = sol[ref("Calcul", c)].value
            v = v.ravel()[0] if hasattr(v, "ravel") else v
            row[k] = float(v) if isinstance(v, (int, float)) or hasattr(v, "__float__") and not isinstance(v, str) else str(v)
        res[f"{sname}|{mname}"] = row
    print(sname, "ok", flush=True)
json.dump(res, open(OUT, "w"), indent=0, default=str)
