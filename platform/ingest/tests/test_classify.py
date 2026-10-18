import pytest

import classify
from pricing import family

OPH, PAIN = "Ophthalmological Preparations", "Medicines for Pain and Palliative Care"


@pytest.fixture(scope="module")
def index():
    codes = classify.atc_codes()
    return codes, set(codes)


def decide(index, name, route, current=None):
    return classify.decide(name, route, current, *index)


def test_eye_only_medicines_are_ophthalmological_whatever_a_list_said(index):
    assert decide(index, "Bromfenac", "eye", PAIN) == OPH
    assert decide(index, "Bromfenac", None, PAIN) == OPH          # no readable form: its only use still decides
    assert decide(index, "Nepafenac", None, PAIN) == OPH
    assert decide(index, "Dorzolamide", "eye", PAIN) == OPH


def test_route_picks_the_use(index):
    assert decide(index, "Timolol", "eye", "Cardiovascular Medicines") == OPH
    assert decide(index, "Diclofenac", "systemic", PAIN) == PAIN
    assert decide(index, "Diclofenac", "eye") == OPH
    assert decide(index, "Dexamethasone", "systemic") == "Hormones and Antihormones"
    assert decide(index, "Salmon Calcitonin", "nose") == "Hormones and Antihormones"   # a hormone sprayed in the nose


def test_a_fair_class_is_kept(index):
    assert decide(index, "Aspirin", "systemic", "Medicines Affecting the Blood") == "Medicines Affecting the Blood"
    assert decide(index, "Mometasone Furoate", "skin", "Dermatological Medicines") == "Dermatological Medicines"
    assert decide(index, "Camphor", "skin", PAIN) == PAIN                    # the index lists only a heart use
    assert decide(index, "Unknownium", "systemic", PAIN) == PAIN


def test_combinations_take_the_shared_class(index):
    assert decide(index, "Celecoxib + Paracetamol", "systemic") == PAIN
    assert decide(index, "Glycopyrrolate + Formoterol Fumarate", "systemic") == "Medicines Acting on the Respiratory Tract"
    assert decide(index, "Moxifloxacin HCl + Dexamethasone Sodium Phosphate", "eye") == OPH
    assert decide(index, "Caffeine + Paracetamol + Phenylephrine", "systemic") == PAIN      # caffeine does not decide


def test_classes_that_were_lumped_together(index):
    assert decide(index, "Tamsulosin Hydrochloride", "systemic", "Hormones and Antihormones") == "Urological Medicines"
    assert decide(index, "Oxytocin", "systemic", "Hormones and Antihormones") == "Oxytocics and Anti-oxytocics"
    assert decide(index, "Allopurinol", "systemic", PAIN) == "Medicines for Diseases of Joints"
    assert decide(index, "Cabergoline", "systemic", "Oxytocics and Anti-oxytocics") == "Anti-Parkinsonism and Anti-prolactinoma Medicines"


def test_route_of_registered_forms():
    assert classify.route_of("eye drops") == "eye"
    assert classify.route_of("Kapli dlya glaz i nosa") == "eye"
    assert classify.route_of("ear drops") == "ear"
    assert classify.route_of("Sprey dlya rotovoy polosti") == "mouth"
    assert classify.route_of("Film-Coated Tablet") == "systemic"
    assert classify.route_of("gel dlya priema vnutr") == "systemic"
    assert classify.route_of("Cream") == "skin"
    assert classify.route_of("Net dannykh") is None


def test_codes_follow_the_form(index):
    codes, _ = index
    assert classify.pick_code(codes[family("ciprofloxacin")], "systemic").startswith("J01")
    assert classify.pick_code(codes[family("ciprofloxacin")], "eye").startswith("S01")
    assert classify.pick_code(codes[family("dexamethasone")], None) == "H02AB02"
