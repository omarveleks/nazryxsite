import pricing


def test_pack_counts_units_and_strengths():
    assert pricing.units_in("АЗИТРАЛ Капсулы 500 мг блистеры №3(1x3)") == 3
    assert pricing.units_in("Нурофен 200 мг таблетки №10x2") == 20
    assert pricing.units_in("Amoxil 500mg capsules 2 x 10 caps") == 20
    assert pricing.units_in("Panadol 500mg tablets pack of 24") == 24
    assert pricing.units_in("Augmentin 625mg tabs 14s") == 14
    assert pricing.units_in("Paracetamol tablets") is None          # a counted pack that does not say how many
    assert pricing.units_in("Ceftriaxone 1g vial") == 1 and pricing.units_in("Jetix Сироп 125г флаконы") == 1
    assert pricing.unit_of("Раствор для инъекций 2 мл ампулы №10") == "ampoule or vial"
    assert pricing.unit_of("Amoxicillin 250mg/5ml suspension 100ml") == "pack"
    assert pricing.unit_of("БЕНЗИЛПЕНИЦИЛЛИНА натриевая соль 1г №1 фл.") == "ampoule or vial"
    assert pricing.strength_of("Rocephin 1Gm vial") == "1000 mg"
    assert pricing.strength_of("Цефтриаксон 1 г") == pricing.strength_of("Ceftriaxone 1000mg") == "1000 mg"
    assert pricing.strength_of("Oxytocin 10 IU/ml") == "10 IU"


def test_french_salt_names():
    assert pricing.french_base("FUMARATE DE QUÉTIAPINE") == "QUÉTIAPINE"
    assert pricing.french_base("MALÉATE D'ÉNALAPRIL") == "ÉNALAPRIL"
    assert pricing.french_base("ÉNOXAPARINE SODIQUE ") == "ÉNOXAPARINE"


def test_one_family_for_every_spelling():
    assert pricing.family("Xylometazoline hydrochloride") == pricing.family("Ksilometazolin")
    assert pricing.family("Bromhexine") == pricing.family("Bromgeksin")
    assert pricing.family("Dapagliflozin Propanediol") == pricing.family("Dapagliflozin")
    assert pricing.family("Paracetamol + Caffeine") == pricing.family("Caffeine/Paracetamol")
    assert pricing.family("Amoxicillin + Clavulanic acid") == pricing.family("Amoxicillin Trihydrate + Potassium Clavulanate")
    assert pricing.family("Cetirizine") == pricing.family("Setirizin")
    assert pricing.family("Metformin") != pricing.family("Metronidazole")
    assert pricing.units_in("Safcor 2.5mg Tablet · 1× 14’s") == 14


def test_messy_registry_names_resolve_only_when_sure():
    singles = [pricing.family(x) for x in ["telmisartan", "sildenafil", "moxifloxacin", "clobetasol", "gentamicin", "sulfadoxine",
                                           "pyrimethamine", "paracetamol", "diclofenac", "prednisone", "esomeprazole"]]
    assert pricing.ingredients("Telmirsatan", singles) == pricing.family("telmisartan")
    assert pricing.ingredients("Moxifloxacin Hydrohloride", singles) == pricing.family("moxifloxacin")
    assert pricing.ingredients("Each Film Tablet Contains: Sildenafil Citrat …", singles) == pricing.family("sildenafil")
    assert pricing.ingredients("Clobetasol Proprionate Gentamycin Sulphate", singles) == pricing.family("clobetasol + gentamicin")
    assert pricing.ingredients("Sulfadoxine Pyrimethamine", singles) == pricing.family("sulfadoxine + pyrimethamine")
    assert pricing.ingredients("Paracetamol Diclofenac Serratiopeptidase", singles) is None     # one ingredient unknown
    assert pricing.ingredients("Prednisolone", singles) is None                               # not prednisone
    assert pricing.ingredients("Omeprazole", singles) is None                                 # not esomeprazole
