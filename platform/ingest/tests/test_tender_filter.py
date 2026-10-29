"""Public tenders: medicines in, works and services out, whatever the buyer is called."""
import collect


def test_works_at_a_medical_buyer_are_not_medicine_tenders():
    assert not collect.is_pharma_tender("Construction of a Wall Fence at Tanzania Vaccine Institute (TVI)", [])
    assert not collect.is_pharma_tender("Supply of office furniture to the Medical Stores Department", [])
    assert not collect.is_pharma_tender("Ukarabati wa jengo la Bohari ya Dawa", [])
    assert not collect.is_pharma_tender("Ремонт здания аптечного склада", [])
    assert not collect.is_pharma_tender("Travaux de construction de la pharmacie régionale", [])


def test_medicine_tenders_stay():
    assert collect.is_pharma_tender("Supply of Pharmaceuticals and Medical Supplies", [])
    assert collect.is_pharma_tender("Поставка лекарственных средств", [])
    assert collect.is_pharma_tender("Fourniture de médicaments essentiels", [])
    assert collect.is_pharma_tender("Supply of Amoxicillin 500 mg capsules", [12])
    # a molecule match wins even over a works word ("paint" in "Paracetamol" never matches, but a mixed lot does)
    assert collect.is_pharma_tender("Construction set and amoxicillin", [12])
