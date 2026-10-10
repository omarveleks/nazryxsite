"""Company de-duplication ("merge duplicate distributors").

Names in the registry are typed by hand: "J. D. PHARMACY LTD", "J.D Pharmacy Limited", "J.D. Pharmacy".
We normalise each name to a company key (norm.company_key) and then cluster keys:

* identical keys always merge;
* different keys merge when token_sort_ratio >= THRESHOLD and both keys are long enough
  (short keys like "jd" or "abc" only merge on an exact match, otherwise "ABC" would swallow "ABCO");
* keys that contain different numbers never merge ("Pharma 1" vs "Pharma 2");
* known aliases (from the database, i.e. earlier uploads and team decisions) win over fuzzy matching,
  and pairs the team marked as "keep separate" never merge.

The most frequent spelling in a cluster becomes the display name; the cluster key is the key of the
most frequent spelling, so it stays stable when new spellings appear in later uploads.
"""
import re
from collections import Counter
from rapidfuzz import fuzz
from norm import company_key

THRESHOLD = 92
MIN_FUZZY_LEN = 6


def _numbers(k):
    return set(re.findall(r"\d+", k))


def same_company(a: str, b: str, threshold: int = THRESHOLD) -> bool:
    """Decide whether two *company keys* name the same company."""
    if not a or not b:
        return False
    if a == b:
        return True
    if min(len(a), len(b)) < MIN_FUZZY_LEN:
        return False
    if _numbers(a) != _numbers(b):
        return False
    return fuzz.token_sort_ratio(a, b) >= threshold


def cluster_names(names, known_aliases=None, keep_separate=None, threshold=THRESHOLD):
    """names: iterable of raw names (repeats allowed; frequency decides the display name).
    known_aliases: {raw_name_or_key: cluster_key} from earlier runs.
    keep_separate: set of frozenset({key_a, key_b}) pairs that must not merge.
    Returns {raw_name: cluster_key}, {cluster_key: display_name}."""
    known_aliases = known_aliases or {}
    keep_separate = keep_separate or set()
    counts = Counter(n for n in names if isinstance(n, str) and n.strip())
    key_counts = Counter()
    for n, c in counts.items():
        k = company_key(n)
        if k:
            key_counts[k] += c
    # most frequent keys first, so the canonical key is the most common spelling
    order = sorted(key_counts, key=lambda k: (-key_counts[k], k))
    canon = {}
    clusters = []
    for k in order:
        if k in known_aliases:
            canon[k] = known_aliases[k]
            if known_aliases[k] not in clusters:
                clusters.append(known_aliases[k])
            continue
        hit = None
        for c in clusters:
            if frozenset((k, c)) in keep_separate:
                continue
            if same_company(k, c, threshold):
                hit = c
                break
        canon[k] = hit or k
        if not hit:
            clusters.append(k)
    name_to_cluster = {}
    for n in counts:
        if n in known_aliases:
            name_to_cluster[n] = known_aliases[n]
        else:
            k = company_key(n)
            if k:
                name_to_cluster[n] = canon[k]
    display = {}
    by_cluster = {}
    for n, c in name_to_cluster.items():
        by_cluster.setdefault(c, Counter())[n] += counts[n]
    for c, cnt in by_cluster.items():
        display[c] = sorted(cnt.items(), key=lambda x: (-x[1], x[0]))[0][0]
    return name_to_cluster, display


def possible_duplicates(cluster_keys, low=85, high=THRESHOLD):
    """Pairs of clusters that are close but were not merged automatically: the team reviews these."""
    keys = sorted(cluster_keys)
    out = []
    for i, a in enumerate(keys):
        for b in keys[i + 1:]:
            if abs(len(a) - len(b)) > 6 or min(len(a), len(b)) < 4:
                continue
            s = fuzz.token_sort_ratio(a, b)
            if low <= s < high or (s >= high and not same_company(a, b)):
                out.append((a, b, round(s, 1)))
    return out
