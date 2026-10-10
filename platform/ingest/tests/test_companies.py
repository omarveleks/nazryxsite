from norm import company_key
from companies import same_company, cluster_names, possible_duplicates


def test_company_key_strips_legal_words_and_punctuation():
    assert company_key("J. D. PHARMACY LTD") == company_key("J.D Pharmacy Limited") == company_key("J D Pharmacy") == "jd"
    assert company_key("PHILLIPS PHARMACEUTICALS (TANZANIA) LIMITED") == "phillips"
    assert company_key("Astra Pharma (T) Ltd") == "astra"
    assert company_key("M/S Hetero Labs Unit III") == "hetero unit iii"
    assert company_key(None) == ""


def test_same_company_rules():
    assert same_company("phillips", "philips")                    # typo
    assert same_company("generics specialities", "generics specialties")
    assert not same_company("astra", "astral")                    # short keys need an exact match
    assert not same_company("jd", "jds")
    assert not same_company("medreich unit 7", "medreich unit 8")  # different numbers never merge
    assert not same_company("", "phillips")


def test_cluster_merges_spellings_and_picks_most_common_display_name():
    names = ["PHILLIPS PHARMACEUTICALS (TANZANIA) LIMITED"] * 5 + ["Philips Pharmaceutical (Tanzania) Limited",
             "phillips pharmaceuticals Tanzania", "J. D. PHARMACY LTD", "J.D Pharmacy Limited", "J.D. Pharmacy",
             "J.D. Pharmacy", "Astra Pharma (T) Ltd", "Astral Medics Ltd"]
    n2c, display = cluster_names(names)
    assert n2c["Philips Pharmaceutical (Tanzania) Limited"] == n2c["PHILLIPS PHARMACEUTICALS (TANZANIA) LIMITED"]
    assert n2c["phillips pharmaceuticals Tanzania"] == n2c["PHILLIPS PHARMACEUTICALS (TANZANIA) LIMITED"]
    assert display[n2c["Philips Pharmaceutical (Tanzania) Limited"]] == "PHILLIPS PHARMACEUTICALS (TANZANIA) LIMITED"
    assert len({n2c[n] for n in ["J. D. PHARMACY LTD", "J.D Pharmacy Limited", "J.D. Pharmacy"]}) == 1
    assert display[n2c["J.D Pharmacy Limited"]] == "J.D. Pharmacy"   # most frequent spelling
    assert n2c["Astra Pharma (T) Ltd"] != n2c["Astral Medics Ltd"]


def test_cluster_is_order_independent():
    names = ["Philips Pharmaceutical Ltd", "Phillips Pharmaceuticals Limited", "Phillips Pharmaceuticals Limited"]
    a, _ = cluster_names(names)
    b, _ = cluster_names(list(reversed(names)))
    assert a == b


def test_known_aliases_and_keep_separate_win_over_fuzzy():
    names = ["Shelys Pharmaceuticals Ltd", "Shellys Pharma Ltd", "Sunshine Pharma", "Sunshines Pharma"]
    n2c, _ = cluster_names(names, known_aliases={"shellys": "shelys"},
                           keep_separate={frozenset(("sunshine", "sunshines"))})
    assert n2c["Shellys Pharma Ltd"] == "shelys"
    assert n2c["Sunshine Pharma"] != n2c["Sunshines Pharma"]


def test_possible_duplicates_lists_near_misses_for_review():
    pairs = possible_duplicates(["astrazeneca", "astrazeneca uk", "bayer", "zenufa"])
    assert ("astrazeneca", "astrazeneca uk", 88.0) in pairs
    assert all("zenufa" not in p for p in pairs)
