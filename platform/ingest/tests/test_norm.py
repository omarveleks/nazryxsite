from norm import molecule_key, form_of


def test_combination_order_and_separators_do_not_matter():
    k = molecule_key("Sulfamethoxazole + Trimethoprim")
    assert k == molecule_key("Trimethoprim/Sulfamethoxazole") == molecule_key("sulfamethoxazole and trimethoprim") \
        == molecule_key("Sulfamethoxazole 400mg & Trimethoprim 80 mg")


def test_salts_are_stripped_unless_the_salt_is_the_medicine():
    assert molecule_key("Ferrous Sulphate") == "ferrous"
    assert molecule_key("Metformin Hydrochloride 500mg") == "metformin"
    assert molecule_key("Sodium Chloride 0.9% w/v") == "chloride sodium"     # used to become ""
    assert molecule_key("Magnesium oxide") == "magnesium oxide"             # used to become "oxide"
    assert molecule_key("Potassium chloride") != molecule_key("Sodium chloride")


def test_ocr_typos_synonyms_and_form_words():
    assert molecule_key("Zine") == molecule_key("Zinc Sulfate") == "zinc"
    assert molecule_key("Sodium bicarbonats") == molecule_key("Sodium Bicarbonate")
    assert molecule_key("Benzhexol") == molecule_key("Trihexyphenidyl HCl")
    assert molecule_key("Epinephrine (Adrenaline)") == molecule_key("Adrenaline injection")
    assert molecule_key("Clotrimazole Clotrimazole") == "clotrimazole"
    assert molecule_key("Budesonide inhaler") == molecule_key("Ephedrine injection").replace("ephedrine", "budesonide")
    assert molecule_key("Oral") == "" and molecule_key("Extended-Release") == ""


def test_form_of():
    assert form_of("Film coated tablet") == "tablet"
    assert form_of("Powder for injection") == "injection"
    assert form_of(None) == "other"


def test_display_name_is_clean_and_consistent():
    from norm import display_name
    assert display_name("Diclofenac Sodium BP 50mg/Paracetamol BP 325mg tablets") == "Diclofenac Sodium + Paracetamol"
    assert display_name("DICLOFENAC SODIUM BP + PARACETAMOL BP") == "Diclofenac Sodium + Paracetamol"
    assert display_name("lamivudine and zidovudine") == "Lamivudine + Zidovudine"
    assert display_name("Desogestrel 150 mcg and Ethinylestradiol 30 mcg Tablets and Inert Tablets") == "Desogestrel + Ethinylestradiol"
    assert display_name("Lactulose Solution USP 3.35 gm/5 ml") == "Lactulose"
    assert display_name("S(-)-Amlodipine Besilate") == "S-Amlodipine Besilate"
    assert display_name("Dapagliflozin + Metformin HCI") == "Dapagliflozin + Metformin HCl"
    assert display_name("Glycyrrhiza Extract, Oil of Anise") == "Glycyrrhiza Extract + Oil of Anise"
    assert display_name("Vitamin B12") == "Vitamin B12"
    assert display_name("Oral Rehydration Salts") == "Oral Rehydration Salts"
    assert display_name("") == "" and display_name(None) == ""


def test_spelling_variants_merge_to_the_listed_or_commonest_spelling():
    from norm import spelling_variants
    counts = {"cetirizine": 37, "cetrizine": 6, "ciclosporin": 7, "cyclosporin": 1, "cyclosporine": 2,
              "artemether lumefantrine": 67, "artemther lumefantrine": 1, "cisatracurium": 1, "cisatricurium": 1,
              "-amlodipine": 1, "amlodipine": 61, "prednisolone": 9, "prednisone": 4, "estradiol": 3, "estriol": 2,
              "amoxicillin clavulanic acid": 20, "amoxicillin": 50}
    v = spelling_variants(counts, known={"cisatracurium"})
    assert v["cetrizine"] == "cetirizine"
    assert v["cyclosporin"] == v["cyclosporine"] == "ciclosporin"      # chains collapse to one spelling
    assert v["artemther lumefantrine"] == "artemether lumefantrine"
    assert v["cisatricurium"] == "cisatracurium"                       # tie broken by the essential list
    for k in ("-amlodipine", "amlodipine", "prednisone", "estriol", "amoxicillin", "amoxicillin clavulanic acid"):
        assert k not in v                                              # different medicines stay apart
