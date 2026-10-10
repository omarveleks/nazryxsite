"""Gap score = D x (1 - S) x A, scaled to 0-100. Weights are first guesses (see HANDOFF.md).

D (demand)       = 0.5 if on the national essential list
                 + 0.2 if on the WHO essential list
                 + 0.3 x facility-level weight (only for national-list molecules)
S (saturation)   = registrants / cap, capped at 1 (cap = 8 by default)
A (actionability)= 0.3 until a confirmed supplier offer exists, then 1.0
"""

LEVEL_WEIGHT = {"A": 1.0, "B": 1.0, "C": 0.8, "D": 0.6, "S": 0.4, "": 0.6}
LEVEL_ORDER = "ABCDS"  # A = dispensary (widest use) ... S = specialist hospitals
SATURATION_CAP = 8
A_DEFAULT = 0.3
A_CONFIRMED = 1.0


def demand(on_national_list: bool, on_who_eml: bool, level: str | None) -> float:
    d = 0.0
    if on_national_list:
        d += 0.5 + 0.3 * LEVEL_WEIGHT.get((level or "").upper(), LEVEL_WEIGHT[""])
    if on_who_eml:
        d += 0.2
    return round(d, 2)


def saturation(registrants: int, cap: int = SATURATION_CAP) -> float:
    if cap <= 0:
        raise ValueError("cap must be positive")
    r = max(0, int(registrants or 0))
    return round(min(r, cap) / cap, 2)


def actionability(has_confirmed_supply: bool) -> float:
    return A_CONFIRMED if has_confirmed_supply else A_DEFAULT


def gap_score(d: float, s: float, a: float) -> float:
    """0-100. Clamps inputs so bad data cannot produce negative or >100 scores."""
    d = min(max(d, 0.0), 1.0)
    s = min(max(s, 0.0), 1.0)
    a = min(max(a, 0.0), 1.0)
    return round(100 * d * (1 - s) * a, 1)


def score_molecule(on_national_list, on_who_eml, level, registrants, has_confirmed_supply=False, cap=SATURATION_CAP):
    d = demand(on_national_list, on_who_eml, level)
    s = saturation(registrants, cap)
    a = actionability(has_confirmed_supply)
    return {"D": d, "S": s, "A": a, "gap_score": gap_score(d, s, a)}


def best_level(levels):
    """When a molecule appears several times, keep the lowest facility level (widest use)."""
    found = [l for l in (x.upper() for x in levels if x) if l in LEVEL_ORDER]
    return min(found, key=LEVEL_ORDER.index) if found else ""
