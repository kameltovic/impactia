"""Synchronise data.json avec le classeur Excel Impact'IA.

    uv run --with openpyxl scripts/extract.py [chemin.xlsx]

data.json reste la référence de l'application. Ce script n'y met à jour que les valeurs qui viennent du classeur :
- les paramètres qui ont un champ « excel » (nom de la variable dans l'onglet Bibliothèque_FE) ;
- les facteurs des dimensions listés dans « excel » de chaque dimension ;
- les mix électriques (lignes « Electricité » de Bibliothèque_FE) ;
- les tailles de requête (onglet Paramètres) et la liste des modèles (onglet Modèles_IA).
Les libellés, groupes, dimensions, fournisseurs et réglages d'affichage ne sont pas touchés.

Les valeurs lues sont celles mises en cache par Excel : recalculer et enregistrer le classeur avant de lancer le script.
"""
import json
import sys
import warnings

import openpyxl

warnings.filterwarnings("ignore")
SRC = sys.argv[1] if len(sys.argv) > 1 else "source.xlsx"
DATA = "data.json"
FLAGS = {"France": "fr", "Autre (monde)": "un", "Europe (UE27)": "eu", "USA": "us", "UK": "gb", "Allemagne": "de",
         "Irlande": "ie", "Pays Bas": "nl", "Suède": "se"}

wb = openpyxl.load_workbook(SRC, data_only=True)
data = json.load(open(DATA))


def table(sheet, name):
    ws = wb[sheet]
    rows = list(ws[ws.tables[name].ref])
    head = [(c.value or "").strip() for c in rows[0]]
    return [dict(zip(head, (c.value for c in r))) for r in rows[1:] if r[2].value is not None]


fe_rows = table("Bibliothèque_FE", "Tableau2")
fe = {r["Variable"].strip(): r["Valeur"] for r in fe_rows}
changes = []


def sync(where, old, new):
    if old != new:
        changes.append(f"{where} : {old} → {new}")
    return new


for key, p in data["parameters"].items():
    if p.get("excel"):
        if p["excel"] not in fe:
            sys.exit(f"Variable Excel introuvable pour le paramètre {key} : {p['excel']}")
        p["value"] = sync(f"paramètre {key}", p["value"], fe[p["excel"]])

for d in data["dimensions"]:
    for factor, variable in d.get("excel", {}).items():
        if variable not in fe:
            sys.exit(f"Variable Excel introuvable pour {d['key']}.{factor} : {variable}")
        d["factors"][factor] = sync(f"facteur {d['key']}.{factor}", d["factors"].get(factor), fe[variable])

# Mix électriques : facteur d'émission (dimension gwp) par pays
old_mixes = {m["name"]: m for m in data["mixes"]}
data["mixes"] = [
    {
        **old_mixes.get(r["Sous-catégorie"], {}),  # garde les champs propres au web (zone EcoLogits…)
        "name": r["Sous-catégorie"],
        "flag": old_mixes.get(r["Sous-catégorie"], {}).get("flag") or FLAGS.get(r["Sous-catégorie"], "xx"),
        "default": old_mixes.get(r["Sous-catégorie"], {}).get("default", r["Sous-catégorie"] == "France"),
        "values": {**old_mixes.get(r["Sous-catégorie"], {}).get("values", {}), "gwp": r["Valeur"]},
    }
    for r in fe_rows
    if r["Catégorie"] == "Electricité"
]

ws = wb["Paramètres"]
data["requestSizes"] = [{"label": ws.cell(r, 2).value, "tokens": ws.cell(r, 3).value} for r in range(2, 5)]

before = {m["name"]: m for m in data["models"]}
models = []
for r in table("Modèles_IA", "Tableau1"):
    name = r["Nom du modèle"].strip()
    models.append({
        **before.get(name, {}),  # garde les champs propres au web (identifiant EcoLogits…)
        "provider": r["Fournisseurs"],
        "name": name,
        "category": r["Catégorie"],
        "pTotal": r["P_total"],
        "pActive": r["P_active_moyenne"],
        "pue": r["PUE"] or 0,
        "wue": r["WUE on-site - eau utilisée directement dans le centre de donnée"] or 0,
        "tps": r["Average TPS"],
        "ttft": r["Average TTFT"],
        "flopsPerJoule": r["Energie consommée pour un FLOP"],
        "computeKw": r["Compute Capacity (kW)"] or 0,
        "published": r["Date de publication"].date().isoformat(),
    })
for m in models:
    if before.get(m["name"]) != m:
        changes.append(f"modèle {m['name']} {'mis à jour' if m['name'] in before else 'ajouté'}")
changes += [f"modèle {n} retiré" for n in before.keys() - {m["name"] for m in models}]
data["models"] = models

with open(DATA, "w") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
    f.write("\n")
print(f"{len(models)} modèles, {len(data['mixes'])} mix, {len(changes)} changement(s)")
print("\n".join(changes[:60]))
