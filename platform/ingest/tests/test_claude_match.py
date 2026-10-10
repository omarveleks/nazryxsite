import json
from claude_match import build_prompt, parse_matches

ITEMS = [{"id": 1, "name": "Benzhexol", "category": "Anti-Parkinsonism", "candidates": ["Trihexyphenidyl", "Benztropine"]},
         {"id": 2, "name": "Calamine", "category": "Dermatological", "candidates": ["Calamine + Zinc Oxide"]}]


def test_prompt_lists_candidates():
    p = build_prompt(ITEMS)
    assert "id 1: Benzhexol" in p and "Trihexyphenidyl | Benztropine" in p


def test_parse_keeps_only_offered_candidates():
    text = json.dumps({"matches": [
        {"id": 1, "match": "Trihexyphenidyl", "confidence": 0.95, "reason": "same INN"},
        {"id": 2, "match": "Something invented", "confidence": 0.9, "reason": "x"},
        {"id": 3, "match": "Trihexyphenidyl", "confidence": 0.9, "reason": "unknown id"},
        {"id": 2, "match": None, "confidence": 0.2, "reason": "different product"}]})
    out = parse_matches(text, ITEMS)
    assert out == [{"id": 1, "match": "Trihexyphenidyl", "confidence": 0.95, "reason": "same INN"}]
