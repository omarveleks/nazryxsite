"""The later markets' registers become rows in the one shape: Ghana's JSON, Azerbaijan's CSV, Belarus's HTML pages, Armenia's text."""
import csv
import os

import more_markets as mm

HERE = os.path.dirname(os.path.abspath(__file__))
LISTS = os.path.join(HERE, "..", "catalog", "lists")


def test_ghana_keeps_human_drugs_only():
    payload = {"data": [
        {"product_category": "DRUG", "classification": "POM", "product_name": "ESOTIL 40 TABLETS", "generic_name": "Esomeprazole Magnesium",
         "strength": "40mg", "dosage_form_indication": "TABLETS", "manufacturer": "Neuron Pharma Pvt. Ltd, Ahmedabad, India.",
         "representative_company_local_agent_applicant": "Stereda Pharmaceuticals Ltd, Accra", "country_origin": "INDIA",
         "registration_date": "2025-09-16", "expiry_date": "2099-10-01", "status": "Valid", "registration_number": "FDA/SD.25-1234"},
        {"product_category": "Food", "classification": None, "product_name": "Zuzu Juice", "registration_number": "FDA/DK 24-128"},
        {"product_category": "DRUGS", "classification": "POM-V", "product_name": "JUMP BUDDY TABLETS", "generic_name": "Carprofen", "registration_number": "FDA/VT 1"},
        {"product_category": "Drug", "classification": "POM", "product_name": "OLD ONE", "generic_name": "Nifedipine", "dosage_form_indication": "Nifedipine",
         "expiry_date": "2020-01-01", "status": "Valid", "registration_number": "FDA/SD.19-1"},
    ]}
    rows = mm.gh_rows(payload)
    assert [r["brand"] for r in rows] == ["ESOTIL 40 TABLETS", "OLD ONE"]
    a, b = rows
    assert a["generic"] == "esomeprazole magnesium" and a["manufacturer"] == "Neuron Pharma Pvt. Ltd" and a["holder"] == "Stereda Pharmaceuticals Ltd"
    assert a["manufacturing_country"] == "INDIA" and a["reg_year"] == 2025 and a["active"] is True
    assert b["active"] is False and b["dosage_form"] is None       # expired; a form that repeats the generic is dropped


def test_azerbaijan_csv_rows():
    text = ("﻿№,Dərmanın adı,BPA  ,Köməkçi maddə,Buraxılış forması və qablaşdırma,İstehsalçı firma,Ərizəçi firma,Buraxılış qaydası,ATC ,"
            "Dərmanın tipi,Ekspertiza növü,Qeydiyyat vəsiqəsinin nömrəsi,Qeydiyyat vəsiqəsinin verilmə tarixi,Qeydiyyat müddətinin bitmə tarixi\n"
            "1,MİQ uşaqlar üçün forte ,Ibuprofen - 200 mg/5 ml         ,Sodium benzoate,\"Daxilə qəbul edilən suspenziya 100 ml flakonda,\n karton qutu\","
            "\"Berlin-Chemie AG (Menarini Group),\n Almaniya; Farmasierra, İspaniya\",Berlin-Chemie AG,Reseptsiz,M01AE01;M01AE01,Generik,Qeydiyyat,DV №22-00684,28.07.2022,28.07.2099\n"
            "2,Augmentin,Amoxicillin - 500 mg; Clavulanic acid - 125 mg,x,Tablet,\"GSK, Böyük Britaniya\",GSK,Resept,J01CR02,Original,Qeydiyyat,DV №19-1,01.01.2019,01.01.2020\n")
    rows = mm.az_rows(text)
    assert len(rows) == 2
    a, b = rows
    assert a["brand"] == "MİQ uşaqlar üçün forte" and a["generic"] == "ibuprofen" and a["strength"] == "200 mg/5 ml" and a["atc"] == "M01AE01"
    assert a["manufacturer"] == "Berlin-Chemie AG (Menarini Group)" and a["manufacturing_country"] == "Almaniya" and a["holder"] == "Berlin-Chemie AG"
    assert a["certificate_no"] == "DV №22-00684" and a["reg_year"] == 2022 and a["active"] is True and a["product_type"] == "Generik"
    assert b["generic"] == "amoxicillin + clavulanic acid" and b["active"] is False


BY_HTML = """<table><tr><th>№</th></tr>
<tr><td>&nbsp;&nbsp; 1</td><td>АДРЕНАЛИНА ТАРТРАТ инструкция пациента инструкция специалиста</td><td>Epinephrine</td>
<td>раствор для инъекций 1,8 мг/мл в ампулах 1 мл, в упаковке №10</td><td>Открытое акционерное общество &#171;Борисовский завод медицинских препаратов&#187;, Республика Беларусь</td>
<td>ОАО &#171;Борисовский завод&#187;</td><td>ЛП-№000123-РГ-BY</td><td>27.03.2026</td><td>бессрочно</td><td></td></tr>
<tr><td>2</td><td>Старый</td><td>Amoxicillin</td><td>капсулы</td><td>Фирма, Индия</td><td>Фирма</td><td>8412/09/14</td><td>01.01.2014</td><td>01.01.2019</td><td></td></tr>
</table><div>Найдено &nbsp; 7533 записей - 76 страниц</div>"""


def test_belarus_rows_and_count():
    assert mm.by_count(BY_HTML) == (7533, 76)
    rows = mm.by_rows(BY_HTML)
    assert len(rows) == 2
    a, b = rows
    assert a["brand"] == "АДРЕНАЛИНА ТАРТРАТ" and a["generic"] == "epinephrine" and a["active"] is True and a["reg_year"] == 2026
    assert a["manufacturing_country"] == "Республика Беларусь" and a["certificate_no"] == "ЛП-№000123-РГ-BY" and a["dosage_form"] == "раствор для инъекций 1"
    assert b["active"] is False and b["status"] == "Expired"


def test_armenia_text_records():
    f = ["Amoksiklav 156.25mg/5ml", "amoxicillin (amoxicillin trihydrate), clavulanic acid (potassium clavulanate)", "powder for oral suspension",
         "125mg/5ml+31,25mg/5ml; 100ml glass bottle", "Slovenia", "Lek d.d., Perzonali 47, Prevalje- bulk manufacturer", "a", "b", "c", "d", "e", "f",
         "128188", "Registered", "25.10.2019", "10.03.2020", "", "", "0", "-", "-", "J01CR02; generic", "PIC/S", "x", "31.12.2099", "31.12.2099"]
    text = "#$".join(f) + "****" + "#$".join(f[:12] + ["1", "Registered", "01.01.2010", "", "", "", "0", "-", "-", "N02BE01", "", "", "31.12.2015", "31.12.2015"])
    rows = mm.am_rows(text)
    assert len(rows) == 2
    a, b = rows
    assert a["brand"] == "Amoksiklav 156.25mg/5ml" and a["generic"] == "amoxicillin , clavulanic acid" and a["atc"] == "J01CR02"
    assert a["manufacturer"] == "Lek d.d" and a["manufacturing_country"] == "Slovenia" and a["reg_year"] == 2019 and a["active"] is True
    assert b["active"] is False


def test_essential_lists_ship():
    for cc, at_least in (("ET", 350), ("UG", 300), ("GH", 250)):
        rows = list(csv.DictReader(open(os.path.join(LISTS, f"eml_{cc}.csv"), encoding="utf-8")))
        assert len(rows) >= at_least, (cc, len(rows))
        names = {r["name"].lower() for r in rows}
        assert "paracetamol" in names and "amoxicillin" in names, cc
