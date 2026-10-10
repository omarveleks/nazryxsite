import pytest
from gap import demand, saturation, actionability, gap_score, score_molecule, best_level


def test_demand_weights():
    # national list (0.5) + WHO (0.2) + level A (0.3 x 1.0) = 1.0
    assert demand(True, True, "A") == 1.0
    assert demand(True, False, "A") == 0.8
    # level weights: C 0.8, D 0.6, S 0.4, unknown 0.6
    assert demand(True, False, "C") == 0.74
    assert demand(True, False, "S") == 0.62
    assert demand(True, False, "") == demand(True, False, None) == demand(True, False, "D") == 0.68
    # level only counts for national-list molecules
    assert demand(False, True, "A") == 0.2
    assert demand(False, False, "A") == 0.0


def test_saturation_capped():
    assert saturation(0) == 0.0
    assert saturation(4) == 0.5
    assert saturation(8) == 1.0
    assert saturation(30) == 1.0
    assert saturation(-3) == 0.0
    assert saturation(None) == 0.0
    assert saturation(2, cap=4) == 0.5
    with pytest.raises(ValueError):
        saturation(1, cap=0)


def test_actionability():
    assert actionability(False) == 0.3
    assert actionability(True) == 1.0


def test_gap_score_formula():
    assert gap_score(1.0, 0.0, 1.0) == 100.0
    assert gap_score(1.0, 0.0, 0.3) == 30.0
    assert gap_score(0.8, 0.5, 0.3) == 12.0
    assert gap_score(1.0, 1.0, 1.0) == 0.0          # saturated market: no gap
    assert gap_score(1.5, -1, 2) == 100.0           # inputs clamped


def test_score_molecule_ranks_open_essential_first():
    open_essential = score_molecule(True, True, "A", registrants=0)
    crowded = score_molecule(True, True, "A", registrants=12)
    specialist = score_molecule(True, False, "S", registrants=0)
    not_listed = score_molecule(False, False, "", registrants=0)
    assert open_essential["gap_score"] == 30.0
    assert crowded["gap_score"] == 0.0
    assert open_essential["gap_score"] > specialist["gap_score"] > not_listed["gap_score"] == 0.0


def test_confirmed_supply_lifts_score():
    before = score_molecule(True, True, "A", registrants=2)
    after = score_molecule(True, True, "A", registrants=2, has_confirmed_supply=True)
    assert before["A"] == 0.3 and after["A"] == 1.0
    assert after["gap_score"] == pytest.approx(before["gap_score"] / 0.3, abs=0.1)


def test_best_level_prefers_widest_use():
    assert best_level(["S", "B", ""]) == "B"
    assert best_level(["", None]) == ""
    assert best_level(["c", "d"]) == "C"
