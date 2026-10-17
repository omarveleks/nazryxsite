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
    assert pricing.strength_of("Цефтриаксон 1 г") == pricing.strength_of("Ceftriaxone 1000mg") == "1000 mg"
    assert pricing.strength_of("Oxytocin 10 IU/ml") == "10 IU"
