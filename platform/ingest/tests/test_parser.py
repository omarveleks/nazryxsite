import textwrap
from build import parse_nemlit, parse_who, cert_year, fix_mojibake

OCR = textwrap.dedent("""\
    Some introduction
    1. The District Medical Officer (DMO) shall scrutinize the list
    The National Essential Medicines List 2026 Edition
    1.0 Anaesthetics, Preoperative Medicines and Medical Gases
    Atropine Injection 1mg (as sulfate in 1mL ampoule) A
    Clonidine Injection 500meg/mL Ss
    Labetalol Tablet 100mg, Injection 10mg/mL c
    Diazepam Tablet 5mg, Rectal 2.5mg Cc
    Calcium Acetate Oral Capsules: 667 mg
    Oral Tablets: 667 mg s
    Promethazine Injection (hydrochloride) 25mg/mL in 2mL; Syrup 5mg/SmL;
    Tablet (hydrochloride) 25mg A
    Clotrimazole Clotrimazole Vaginal cream (nitrate) 1% A
    Atropine Eye drops 1% S
    4.0 Antidotes and Other Substances Used in Poisonings
    Sodium bicarbonats Injection: 4.2% D
    Zine Tablet dispersible: 10 mg A
""")


def test_parse_nemlit_fixes_ocr(tmp_path):
    p = tmp_path / "nemlit.txt"
    p.write_text(OCR)
    d = parse_nemlit(str(p)).set_index("molecule")
    assert d.loc["Clonidine", "level"] == "S"            # "Ss" -> S
    assert d.loc["Labetalol", "level"] == "C"            # "c"  -> C
    assert d.loc["Diazepam", "level"] == "C"             # "Cc" -> C
    assert d.loc["Promethazine", "level"] == "A"         # level on the continuation line
    assert d.loc["Atropine", "level"] == "A"             # duplicate keeps the widest level
    assert "Oral" not in d.index                         # form-only line is not a molecule
    assert "Clotrimazole" in d.index                     # doubled OCR name
    assert "Sodium bicarbonate" in d.index and "Zinc" in d.index
    assert d.loc["Zinc", "category"] == "Antidotes and Other Substances Used in Poisonings"
    assert "The District Medical Officer" not in " ".join(d.category)


def test_parse_who_reads_names_on_their_own_line(tmp_path):
    p = tmp_path / "who.txt"
    p.write_text("1.2 Local anaesthetics\n bupivacaine\n       ephedrine*\n"
                 "ketamine                                Injection: 10 mg/mL\n"
                 "- thiopental\n"
                 "                                     ampoule in 8% glucose solution.\n"
                 "Therapeutic alternatives to be reviewed\n")
    names = parse_who(str(p))
    assert {"bupivacaine", "ephedrine", "ketamine", "thiopental"} <= names
    assert "glucose" not in names


def test_cert_year():
    assert cert_year("TAN 23 HM 0101") == 2023
    assert cert_year("TZ 19 H 0300") == 2019
    assert cert_year("TAN 00,050 G01A GLE") is None     # old numbering, no year
    assert cert_year("TAN 07, 0123") is None
    assert cert_year(None) is None


def test_fix_mojibake():
    assert fix_mojibake("Merck SantÃ© S.A.S") == "Merck Santé S.A.S"
    assert fix_mojibake("Laboratoires ThÃ©a") == "Laboratoires Théa"
    assert fix_mojibake("Plain Name Ltd") == "Plain Name Ltd"
    assert fix_mojibake("Santé already fine") == "Santé already fine"
    assert fix_mojibake(None) is None


def test_vet_filter_keeps_human_products_with_lookalike_words():
    from build import VET_TERMS
    assert VET_TERMS.search("Newcastle Disease Vaccine, Live")
    assert VET_TERMS.search("Mycoplasma capricolum subspecies capripneumoniae")
    assert VET_TERMS.search("Salmonella Gallinarum 9R strain")
    assert not VET_TERMS.search("Luliconazole Cream, caprylic Capric Triglyceride")   # excipient, human cream
    assert not VET_TERMS.search("Gallic acid")
