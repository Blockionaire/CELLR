"""Independent check of the ratings aggregates (ratings-rehearsal.sh step 7).

A second implementation, sharing no code with ratings.ts / the domain package: for each sample unit
(wine id, vintage, count, sum in half stars, distribution) read from the database, recompute it from the raw ratings
file with plain Python (one rating per rater per unit, the latest by date then rating id) and compare. Prints counts
only. Exit 1 on any difference.

    python3 -I ratings-verify.py <ratings.csv> <sample.csv>
"""
import csv
import sys

ratings_path, sample_path = sys.argv[1], sys.argv[2]
want = {}
with open(sample_path, newline="") as f:
    for wid, vin, cnt, s, dist in csv.reader(f):
        want[(wid, vin)] = (int(cnt), int(s), [int(x) for x in dist.split()])
wines = {w for w, _ in want}
latest = {}  # (wid, vin) -> {user: (date, rid, half)}
with open(ratings_path, newline="") as f:
    r = csv.reader(f)
    next(r)
    for rid, uid, wid, vin, rating, date in r:
        if wid not in wines or (wid, vin) not in want:
            continue
        half = round(float(rating) * 2)
        unit = latest.setdefault((wid, vin), {})
        cur = unit.get(uid)
        key = (date, int(rid))
        if cur is None or key > cur[:2]:
            unit[uid] = (date, int(rid), half)
bad = 0
for k, (cnt, s, dist) in want.items():
    got = latest.get(k, {})
    d = [0] * 10
    for _, _, h in got.values():
        d[h - 1] += 1
    if len(got) != cnt or sum(h for _, _, h in got.values()) != s or d != dist:
        bad += 1
print(f"sample units {len(want)}, recomputed independently, differences {bad}")
sys.exit(1 if bad else 0)
