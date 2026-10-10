import pytest
from gap import demand, saturation, gap_score, score_molecule, best_level


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


def test_gap_score_formula():
    assert gap_score(1.0, 0.0) == 100.0     # wide demand, nobody registered
    assert gap_score(0.8, 0.5) == 40.0
    assert gap_score(1.0, 1.0) == 0.0       # saturated market: no gap
    assert gap_score(1.5, -1) == 100.0      # inputs clamped


def test_score_uses_the_full_0_to_100_range():
    open_essential = score_molecule(True, True, "A", registrants=0)
    crowded = score_molecule(True, True, "A", registrants=12)
    specialist = score_molecule(True, False, "S", registrants=0)
    not_listed = score_molecule(False, False, "", registrants=0)
    assert open_essential["gap_score"] == 100.0
    assert crowded["gap_score"] == 0.0
    assert specialist["gap_score"] == 62.0
    assert not_listed["gap_score"] == 0.0
    assert open_essential["gap_score"] > specialist["gap_score"] > not_listed["gap_score"]
    assert set(open_essential) == {"D", "S", "gap_score"}   # no actionability factor


def test_best_level_prefers_widest_use():
    assert best_level(["S", "B", ""]) == "B"
    assert best_level(["", None]) == ""
    assert best_level(["c", "d"]) == "C"
