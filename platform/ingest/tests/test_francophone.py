"""French INNs become matchable English, arp.sn flight payloads become rows, dpml.cm tables become rows, and the three
essential lists ship with the worker."""
import csv
import os

import francophone as fr

HERE = os.path.dirname(os.path.abspath(__file__))
LISTS = os.path.join(HERE, "..", "catalog", "lists")


def test_french_inn_to_english():
    cases = {
        "Amoxicilline + Acide clavulanique": "amoxicillin + clavulanic acid",
        "Chlorure de sodium": "sodium chloride",
        "Sulfate de magnésium": "magnesium sulfate",
        "Acide folique": "folic acid",
        "Paracétamol": "paracetamol",
        "Ibuprofène": "ibuprofen",
        "Gentamicine": "gentamicin",
        "Chloroquine": "chloroquine",
        "Métronidazole": "metronidazole",
        "Sulfaméthoxazole + Triméthoprime": "sulfamethoxazole + trimethoprim",
        "Artéméther/Luméfantrine": "artemether + lumefantrine",
        "Sels de réhydratation orale": "oral rehydration salts",
        "Sulfate ferreux": "ferrous sulfate",
    }
    for french, english in cases.items():
        assert fr.fr_inn(french) == english, (french, fr.fr_inn(french))


FLIGHT = '''1:"$Sreact.fragment"
42:["$","tbody",null,{"children":[["$","tr","a1",{"className":"align-top","children":[[["$","td","product_name",{"children":["$","span",null,{"children":"ACENLAND P"}]}],["$","td","dci",{"children":["$","span",null,{"children":"ACECLOFENAC + PARACETAMOL"}]}],["$","td","dosage",{"children":["$","span",null,{"children":"100 mg / 500 mg"}]}],["$","td","presentation",{"children":["$","span",null,{"children":"B/10"}]}],["$","td","dosage_form",{"children":"$L45"}],"$L46",["$","td","laboratory",{"children":["$","span",null,{"children":"INDOLAANDS"}]}],["$","td","therapeutic_class",{"children":["$","span",null,{"children":"—"}]}]],null]}]]}]
45:["$","span",null,{"children":"pelliculé"}]
46:["$","td","route",{"children":["$","span",null,{"children":"orale"}]}]
7:["$","a",null,{"href":"/bases-de-donnees/medicaments-autorises?page=299#donnees","children":"299"}]
'''


def test_arp_flight_rows_resolve_deferred_cells():
    rows = fr.sn_rows(FLIGHT)
    assert len(rows) == 1
    r = rows[0]
    assert r["product_name"] == "ACENLAND P" and r["dosage_form"] == "pelliculé" and r["route"] == "orale"
    assert fr.sn_pages(FLIGHT) == 299
    row = fr.sn_row(r)
    assert row["generic"] == "aceclofenac + paracetamol" and row["manufacturer"] == "INDOLAANDS" and row["therapeutic_class"] is None
    assert row["certificate_no"].startswith("SN-") and row["active"]


TABLE = """<table><thead><tr><th>AMM</th></tr></thead><tbody>
<tr><td>18532212</td><td>ACECLAV ENFANT, 500mg+62.5mg, Suspension orale/Oral suspension, flacon de 60ml</td>
<td>amoxicilline+acide clavulanique</td><td>BIOMATRIX HEALTHCARE PVT LTD.</td>
<td>M/S BIOMATRIX HEALTHCARE PVT. LTD. Fabrication Complète , M/S BIOMATRIX HEALTHCARE PVT. LTD.</td><td>28/10/2022</td><td>28/10/2027</td></tr>
<tr><td>10101108</td><td>ACINET, 1000/125 mg, Comprimé pelliculé/ film coated tablet, B/10</td><td>AMOXICILLINE + ACIDE CLAVULANIQUE</td>
<td>CACHET PHARMACEUTICALS PVT LTD</td><td>ALKEM LABORATORIES IND Libération de lots , ALKEM LABORATORIES</td><td>15/02/2013</td><td>17/08/2014</td></tr>
</tbody></table>"""


def test_dpml_rows_split_designation_and_expiry():
    rows = [fr.cm_row(c) for c in fr.cm_rows(TABLE)]
    assert [r["certificate_no"] for r in rows] == ["18532212", "10101108"]
    a, b = rows
    assert a["brand"] == "ACECLAV ENFANT" and a["strength"] == "500mg+62.5mg" and a["dosage_form"] == "Suspension orale"
    assert a["generic"] == "amoxicillin + clavulanic acid" and a["holder"] == "BIOMATRIX HEALTHCARE PVT LTD." and a["reg_year"] == 2022
    assert a["manufacturer"] == "M/S BIOMATRIX HEALTHCARE PVT. LTD" and a["active"] is True
    assert b["manufacturer"] == "ALKEM LABORATORIES" and b["active"] is False and b["status"] == "Expired"


def test_essential_lists_ship_for_the_three_markets():
    for cc, at_least in (("SN", 350), ("CI", 300), ("CM", 500)):
        rows = list(csv.DictReader(open(os.path.join(LISTS, f"eml_{cc}.csv"), encoding="utf-8")))
        assert len(rows) >= at_least, (cc, len(rows))
        assert {"name", "local", "atc", "level"} <= set(rows[0])
        names = {r["name"] for r in rows}
        assert "paracetamol" in names and "amoxicillin" in names, cc
