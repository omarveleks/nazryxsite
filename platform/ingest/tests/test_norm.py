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
