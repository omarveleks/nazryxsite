#!/usr/bin/env python3
"""Write a small synthetic registry export and reference lists for the browser tests (no real data needed).

  python make_fixture.py <out_dir>    # writes <out_dir>/raw/{Registered_Products_test.xls, tz_nemlit_ocr.txt, who_eml.txt}
"""
import os
import sys

HEADER = ["No", "Product Category", "Certificate Number", "Brand Name", "Classification", "Generic Name", "Dosage Form",
          "National ID No", "Active Pharmaceutical Ingredients", "Product Strength", "Registrant", "Registrant Country",
          "Local Technical Represenatative", "Manufacturer", "Manufacturing Country", "Registration Status"]
MOLS = ["Amoxicillin", "Paracetamol", "Metformin Hydrochloride", "Ciprofloxacin", "Omeprazole", "Amlodipine",
        "Ceftriaxone Sodium", "Ibuprofen", "Sodium Chloride", "Fluconazole", "Atenolol", "Salbutamol"]
LTRS = ["ALPHA PHARMA LIMITED", "Alpha Pharma Ltd", "Beta Distributors (T) Ltd", "GAMMA HEALTHCARE LTD", "Delta Medics Ltd"]
NEMLIT = """The National Essential Medicines List 2026 Edition
6.0 Anti-Infective Medicines
Amoxicillin Capsule 250mg A
Ciprofloxacin Tablet 250mg B
Doxycycline Capsule 100mg A
Ceftriaxone Injection 1 g vial B
Fluconazole Tablet 150mg A
13.0 Cardiovascular Medicines
Amlodipine Tablet 5mg A
Atenolol Tablet 50mg A
Digoxin Tablet 250mcg c
Hydralazine Tablet 25mg B
16.0 Medicines Used for Diabetes and Related Disorders
Metformin Tablet 500mg A
Glibenclamide Tablet 5mg A
"""
WHO = "amoxicillin                     Capsule\nciprofloxacin                   Tablet\ndoxycycline\ndigoxin\nmetformin\nhydralazine\n"


def main(out):
    raw = os.path.join(out, "raw")
    os.makedirs(raw, exist_ok=True)
    rows = []
    for i in range(160):
        rows.append([str(i + 1), "Medicines", f"TAN 2{i % 7} HM {i:04d}", f"Brand{i}", "Human Medicinal Product",
                     MOLS[i % len(MOLS)], "Tablet", "", "", "500", f"Maker {i % 9} Ltd", "INDIA", LTRS[i % len(LTRS)],
                     f"Maker {i % 9} Ltd", "INDIA", "Registered/Compliant"])
    td = lambda v: f"<td>{v}</td>"
    html = ["<table border='1'><tr><td colspan='12'><b>Registered Products</b></td></tr>",
            "<tr>" + "".join(td(h) for h in HEADER) + "</tr>"] + ["<tr>" + "".join(td(v) for v in r) + "</tr>" for r in rows] + ["</table>"]
    open(os.path.join(raw, "Registered_Products_test.xls"), "w").write("\n".join(html))
    open(os.path.join(raw, "tz_nemlit_ocr.txt"), "w").write(NEMLIT)
    open(os.path.join(raw, "who_eml.txt"), "w").write(WHO)
    print(f"fixtures written to {raw}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "fixture")
