"""Turn raw_*.json files from score.py into the markdown tables used in RESULTS.md.

Usage: python analyze.py raw_a.json [raw_b.json ...] > tables.md
"""
import json, sys
from collections import defaultdict
import numpy as np


def precision_threshold(d, target=0.95):
    """Flag a sentence as wrong when a variant beats it by more than t nats.
    Each pair gives one true case (learner wrote the incorrect one; the correct
    variant beats it by d) and one innocent case (learner wrote the correct one;
    the incorrect variant beats it by -d). Return the smallest t with
    precision >= target, plus the recall at that t."""
    d = np.asarray(d)
    for t in np.arange(0, 20.01, 0.25):
        tp = (d > t).sum(); fp = (-d > t).sum()
        if tp + fp and tp / (tp + fp) >= target:
            return t, tp / len(d), tp, fp
    return None, 0, 0, 0


def pct(x):
    return f"{100 * x:.0f}%"


out = []
summary = []
for path in sys.argv[1:]:
    r = json.load(open(path))
    name = r["model"]
    out.append(f"\n## {name}\n")
    P = r["pairs"]
    # accuracy per rule and condition
    rules = sorted({p["rule"] for p in P}, key=lambda x: [p["rule"] for p in P].index(x))
    conds = ["plain", "neutral", "register"]
    out.append("### Accuracy (correct sentence scores higher)\n")
    out.append("| rule | n | no prefix | neutral prefix | street prefix | per-token mean (neutral) | localization top-1 | localization top-2 |")
    out.append("|---|---|---|---|---|---|---|---|")
    def acc(rows, c):
        return np.mean([x[c]["c"] > x[c]["i"] for x in rows])
    def acc_mean(rows):
        return np.mean([x["neutral"]["c"] / x["neutral"]["c_ntok"] > x["neutral"]["i"] / x["neutral"]["i_ntok"] for x in rows])
    def loc(rows):
        return np.mean([x["loc"]["hit"] for x in rows])
    def loc2(rows):
        hits = []
        for x in rows:
            L = x["loc"]; s = np.array([w[1] for w in L["words"]])
            hits.append(any(L["err_from"] <= int(t) <= L["err_to"] + 1 for t in np.argsort(-s)[:2]))
        return np.mean(hits)
    for ru in rules + ["ALL"]:
        rows = P if ru == "ALL" else [p for p in P if p["rule"] == ru]
        lab = f"**{ru}**" if ru == "ALL" else ru
        out.append(f"| {lab} | {len(rows)} | " + " | ".join(pct(acc(rows, c)) for c in conds)
                   + f" | {pct(acc_mean(rows))} | {pct(loc(rows))} | {pct(loc2(rows))} |")
    # margins
    out.append("\n### Margins (log P(correct) − log P(incorrect), nats, neutral prefix)\n")
    d = np.array([p["neutral"]["c"] - p["neutral"]["i"] for p in P])
    qs = np.percentile(d, [0, 10, 25, 50, 75, 90, 100])
    out.append("| min | p10 | p25 | median | p75 | p90 | max | mean |")
    out.append("|---|---|---|---|---|---|---|---|")
    out.append("| " + " | ".join(f"{q:.2f}" for q in qs) + f" | {d.mean():.2f} |")
    hist = defaultdict(int)
    for x in d:
        b = int(np.floor(x / 2) * 2); b = max(-6, min(14, b)); hist[b] += 1
    out.append("\nHistogram (2-nat bins, clipped to [−6, 16)):\n")
    out.append("```")
    for b in range(-6, 16, 2):
        out.append(f"{b:>4} .. {b + 2:<4} {'#' * hist[b]} {hist[b]}")
    out.append("```")
    out.append("\n| condition | flag threshold t (nats) for ≥95% precision | errors caught at t | true / false flags | at t=0: precision, recall |")
    out.append("|---|---|---|---|---|")
    for c in conds:
        dc = np.array([p[c]["c"] - p[c]["i"] for p in P])
        t, rec, tp, fp = precision_threshold(dc)
        p0 = (dc > 0).sum() / max(1, (dc > 0).sum() + (dc < 0).sum())
        out.append(f"| {c} | {t} | {pct(rec)} | {tp} / {fp} | {pct(p0)}, {pct((dc > 0).mean())} |")
    # per-rule threshold for the worst rules
    out.append("\nWrong-way pairs (incorrect scored higher), neutral prefix:\n")
    for p in sorted(P, key=lambda p: p["neutral"]["c"] - p["neutral"]["i"]):
        m = p["neutral"]["c"] - p["neutral"]["i"]
        if m >= 0:
            break
        out.append(f"- {m:+.2f} [{p['rule']}] {p['correct']} / *{p['incorrect']}*")
    # localization failures sample
    out.append("\nLocalization misses (neutral prefix; most surprising word vs the error):\n")
    for p in P:
        L = p["loc"]
        if not L["hit"]:
            w = L["words"]
            out.append(f"- *{p['incorrect']}*: top = '{w[L['top']][0]}' ({w[L['top']][1]:.1f}), "
                       f"error at '{w[L['err_from']][0] if L['err_from'] < len(w) else '?'}'")
    # slang
    S = r["slang"]
    out.append("\n### Slang penalty (street − neutral, mean log-prob per word, nats)\n")
    out.append("| condition | mean gap per word | median | street wins |")
    out.append("|---|---|---|---|")
    gaps = {}
    for c in conds:
        g = np.array([s[c]["street"] / s[c]["street_nw"] - s[c]["neutral"] / s[c]["neutral_nw"] for s in S])
        gaps[c] = g
        out.append(f"| {c} | {g.mean():+.2f} | {np.median(g):+.2f} | {(g > 0).sum()}/{len(g)} |")
    out.append("\nMost surprising street words (neutral prefix → street prefix, nats):\n")
    sw = []
    for s in S:
        for (w, a), (_, b) in zip(s["neutral"]["street_words"], s["register"]["street_words"]):
            sw.append((a, b, w))
    sw.sort(reverse=True)
    out.append(", ".join(f"{w} {a:.1f}→{b:.1f}" for a, b, w in sw[:15]))
    # speed
    sp = r["speed"]
    out.append("\n### Speed (4 CPU cores)\n")
    out.append(f"- prompt processing (scoring): {sp['prompt_tok_per_s']:.0f} tokens/s")
    out.append(f"- generation: {sp['gen_tok_per_s']:.1f} tokens/s")
    out.append(f"- one ten-word sentence + six variants: {sp['score_10w_plus_6_s']:.2f} s")
    out.append(f"- next-word list (beam over sub-word pieces): {sp['nextword_avg_s']:.1f} s per opening")
    # next words
    out.append("\n### Next-word lists (neutral prefix)\n")
    out.append("| opening | top ten next words (probability) | top-10 mass |")
    out.append("|---|---|---|")
    for nw in r["nextword"]:
        tops = ", ".join(f"{w} {p:.2f}" for w, p in nw["top"])
        out.append(f"| {nw['opening']} … | {tops} | {sum(p for _, p in nw['top']):.2f} |")
    dn = np.array([p["neutral"]["c"] - p["neutral"]["i"] for p in P])
    summary.append((name, acc(P, "neutral"), precision_threshold(dn), loc(P), gaps))

out.insert(0, "## Summary\n\n| model | accuracy | t for 95% precision | recall at t | localization | slang gap/word (neutral → street prefix) |\n|---|---|---|---|---|---|")
for i, (n, a, (t, rec, _, _), l, g) in enumerate(summary):
    out.insert(1 + i, f"| {n} | {pct(a)} | {t} | {pct(rec)} | {pct(l)} | {g['neutral'].mean():+.2f} → {g['register'].mean():+.2f} |")
print("\n".join(out))
