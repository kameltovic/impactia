"""Regénère data.js depuis le classeur Impact'IA (onglets Modèles_IA et Bibliothèque_FE).

    uv run --with openpyxl scripts/extract.py [chemin.xlsx]

Lit les valeurs mises en cache par Excel : les colonnes calculées (P_total, Coefficient...)
doivent donc avoir été recalculées avant l'enregistrement du classeur.
"""
import json
import sys
import warnings

import openpyxl

warnings.filterwarnings("ignore")
src = sys.argv[1] if len(sys.argv) > 1 else "source.xlsx"
wb = openpyxl.load_workbook(src, data_only=True)


def table(sheet, name):
    ws = wb[sheet]
    rows = list(ws[ws.tables[name].ref])
    head = [c.value for c in rows[0]]
    return [dict(zip(head, (c.value for c in r))) for r in rows[1:] if r[2].value is not None]


models = [
    {
        "provider": r["Fournisseurs"],
        "name": r["Nom du modèle"].strip(),
        "category": r["Catégorie"],
        "pTotal": r["P_total"],
        "pActive": r["P_active_moyenne"],
        "pue": r["PUE"] or 0,
        "wue": r["WUE on-site - eau utilisée directement dans le centre de donnée"] or 0,
        "tps": r["Average TPS"],
        "coefficient": r["Coefficient"] or 0,
        "flopsPerJoule": r["Energie consommée pour un FLOP"],
        "published": r["Date de publication"].date().isoformat(),
        "computeKw": r["Compute Capacity (kW)"] or 0,
    }
    for r in table("Modèles_IA", "Tableau1")
]

fe = {r["Variable"].strip(): r["Valeur"] for r in table("Bibliothèque_FE", "Tableau2")}
mix = {r["Sous-catégorie"]: r["Valeur"] for r in table("Bibliothèque_FE", "Tableau2") if r["Catégorie"] == "Electricité"}

ws = wb["Paramètres"]
sizes = {ws.cell(r, 2).value: ws.cell(r, 3).value for r in range(2, 5)}

with open("data.js", "w") as f:
    f.write("// Généré par scripts/extract.py depuis le classeur Impact'IA — ne pas éditer à la main.\n")
    for k, v in {"models": models, "fe": fe, "mix": mix, "requestSizes": sizes}.items():
        f.write(f"export const {k} = {json.dumps(v, ensure_ascii=False, indent=1)};\n")
print(f"{len(models)} modèles, {len(fe)} facteurs, {len(mix)} mix électriques")
