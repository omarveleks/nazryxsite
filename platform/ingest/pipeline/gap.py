"""Gap score = D x (1 - S), scaled to 0-100. Weights are first guesses (see HANDOFF.md).

D (demand)     = 0.5 if on the national essential list
               + 0.3 x facility-level weight (only for national-list molecules)
               + 0.2 if on the WHO essential list
S (saturation) = registrants / cap, capped at 1 (cap = 8 by default)

The handoff also multiplied by an actionability factor A (0.3 until Nazryx holds a confirmed supplier offer, then
1.0). It was removed on request: it squeezed every score into 0-30 and one confirmed offer jumped a molecule to
100. Confirmed supply is shown separately, as its own (paid) signal on the molecule page.
"""

LEVEL_WEIGHT = {"A": 1.0, "B": 1.0, "C": 0.8, "D": 0.6, "S": 0.4, "": 0.6}
LEVEL_ORDER = "ABCDS"  # A = dispensary (widest use) ... S = specialist hospitals
SATURATION_CAP = 8


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


def gap_score(d: float, s: float) -> float:
    """0-100. Clamps inputs so bad data cannot produce negative or >100 scores."""
    d = min(max(d, 0.0), 1.0)
    s = min(max(s, 0.0), 1.0)
    return round(100 * d * (1 - s), 1)


def score_molecule(on_national_list, on_who_eml, level, registrants, cap=SATURATION_CAP):
    d = demand(on_national_list, on_who_eml, level)
    s = saturation(registrants, cap)
    return {"D": d, "S": s, "gap_score": gap_score(d, s)}


def best_level(levels):
    """When a molecule appears several times, keep the lowest facility level (widest use)."""
    found = [l for l in (x.upper() for x in levels if x) if l in LEVEL_ORDER]
    return min(found, key=LEVEL_ORDER.index) if found else ""
