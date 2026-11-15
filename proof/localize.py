"""Localization with a frequency baseline.

Raw surprisal points at rare words (Colombia, Ponce) and at the first word after the
prefix instead of the error. This script subtracts each word's baseline surprisal
(the same word scored on its own after the neutral prefix) and checks how often the
top word is the error word or the word right after it.

Usage: python localize.py MODEL.gguf raw_MODEL.json   (adds a "loc2" block in place)
"""
import json, sys
from pathlib import Path
import numpy as np

sys.argv = [sys.argv[0], sys.argv[1], "/dev/null", sys.argv[2]]
RAW = sys.argv[3]
# reuse the scoring helpers without running the full test
src = (Path(__file__).parent / "score.py").read_text().split("res = {")[0]
exec(compile(src, "score.py", "exec"))

r = json.load(open(RAW))
cache = {}
def base(w, first):
    w = w if first else w.lower()
    if w not in cache:
        cache[w] = -score(w, NEUTRAL_PREFIX)["total"]
    return cache[w]

for p in r["pairs"]:
    L = p["loc"]
    words = L["words"]
    s = np.array([x[1] for x in words])
    b = np.array([base(w, k == 0) for k, (w, _) in enumerate(words)])
    out = {}
    for lam in (0.0, 0.5, 1.0):
        top = int(np.argmax(s - lam * b))
        out[str(lam)] = {"top": top, "hit": L["err_from"] <= top <= L["err_to"] + 1}
    # top-2 with lambda 1
    top2 = list(np.argsort(-(s - b))[:2])
    out["top2_hit"] = any(L["err_from"] <= int(t) <= L["err_to"] + 1 for t in top2)
    p["loc2"] = out

rules = []
for p in r["pairs"]:
    if p["rule"] not in rules:
        rules.append(p["rule"])
print("| rule | raw surprisal | minus 0.5×baseline | minus baseline | minus baseline, top-2 |")
print("|---|---|---|---|---|")
for ru in rules + ["ALL"]:
    rows = [p for p in r["pairs"] if ru == "ALL" or p["rule"] == ru]
    cells = [np.mean([p["loc2"][l]["hit"] for p in rows]) for l in ("0.0", "0.5", "1.0")]
    cells.append(np.mean([p["loc2"]["top2_hit"] for p in rows]))
    lab = f"**{ru}**" if ru == "ALL" else ru
    print(f"| {lab} | " + " | ".join(f"{100 * c:.0f}%" for c in cells) + " |")
json.dump(r, open(RAW, "w"), ensure_ascii=False, indent=1)
