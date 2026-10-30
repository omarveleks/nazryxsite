"""Gap score = D x (1 - S), scaled to 0-100.

D (demand), 0 to 1, graded from every signal we hold for the molecule in the market:
  national essential list    0.35, plus 0.15 x the facility-level weight (level A: every dispensary; S: specialist only)
  WHO essential list         0.10
  public tenders, 24 months  up to 0.25  (0.08 x ln(1 + tenders): one tender 0.06, three 0.11, ten 0.19)
  registered products        up to 0.15  (0.05 x ln(1 + registrations): proven sales, whoever makes them)
  shelf listings read        up to 0.10  (0.04 x ln(1 + listings): pharmacies stock it)
A listed, widely used, WHO molecule with no tenders and nobody selling it scores 0.60; the same molecule with ten
tenders and twenty registrations scores 1.0. An earlier model gave 1.0 to every level-A WHO molecule, which told
the user nothing.
S (saturation) = registrants / cap, capped at 1 (cap = 8 by default)

The handoff also multiplied by an actionability factor A (0.3 until Nazryx holds a confirmed supplier offer, then
1.0). It was removed on request: it squeezed every score into 0-30 and one confirmed offer jumped a molecule to
100. Confirmed supply is shown separately, as its own (paid) signal on the molecule page.
"""
import math

LEVEL_WEIGHT = {"A": 1.0, "B": 1.0, "C": 0.8, "D": 0.6, "S": 0.4, "": 0.6}
LEVEL_ORDER = "ABCDS"  # A = dispensary (widest use) ... S = specialist hospitals
SATURATION_CAP = 8


def demand(on_national_list: bool, on_who_eml: bool, level: str | None, tenders: int = 0, registrations: int = 0, listings: int = 0) -> float:
    d = 0.0
    if on_national_list:
        d += 0.35 + 0.15 * LEVEL_WEIGHT.get((level or "").upper(), LEVEL_WEIGHT[""])
    if on_who_eml:
        d += 0.10
    d += min(0.25, 0.08 * math.log1p(max(0, int(tenders or 0))))
    d += min(0.15, 0.05 * math.log1p(max(0, int(registrations or 0))))
    d += min(0.10, 0.04 * math.log1p(max(0, int(listings or 0))))
    return round(min(d, 1.0), 2)


def demand_label(d):
    """The word for a demand value, the same on every screen: very high, high, some, low, or not scored."""
    if d is None:
        return "not scored"
    d = float(d)
    return "very high" if d >= 0.7 else "high" if d >= 0.5 else "some" if d >= 0.3 else "low"


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


def score_molecule(on_national_list, on_who_eml, level, registrants, cap=SATURATION_CAP, tenders=0, registrations=0, listings=0):
    d = demand(on_national_list, on_who_eml, level, tenders, registrations, listings)
    s = saturation(registrants, cap)
    return {"D": d, "S": s, "gap_score": gap_score(d, s)}


def best_level(levels):
    """When a molecule appears several times, keep the lowest facility level (widest use)."""
    found = [l for l in (x.upper() for x in levels if x) if l in LEVEL_ORDER]
    return min(found, key=LEVEL_ORDER.index) if found else ""
