"""Tables for proof/ENGINE_REAL_MODEL.md from results/session-calls-<label>.json.

Usage (from proof/engine-measure/):
  python3 calls-summary.py before-mock after-mock before-real after-real

Per step type: model calls (mean, min-max, by method) and seconds, measured and
"typical". On the shared machine the time per call was bimodal: 60 to 130 ms when the
server had its cores, 2 to 7 s when other jobs starved it (llama.cpp threads spinning
on oversubscribed cores), so measured seconds are upper bounds. Typical seconds are
mean scoring and next-token calls x the median time per call over the steps whose
calls averaged under FAST_MS (the unstarved mode); generate calls are left out (noted
"+ gen").
Also compares two runs step by step (result hashes): pass them as A:B to compare.
"""
import json
import statistics
import sys
from pathlib import Path

RES = Path(__file__).parent / "results"


def load(label):
    return json.loads((RES / f"session-calls-{label}.json").read_text())


FAST_MS = 500


def per_call_ms(rows):
    """Median ms per scoring / next-token call over unstarved steps without generation, and the share of starved steps."""
    plain = [r["modelMs"] / r["total"] for r in rows if r["total"] > 0 and r["calls"]["generate"] == 0]
    fast = [x for x in plain if x < FAST_MS]
    return (statistics.median(fast) if fast else 0.0), (len(plain) - len(fast), len(plain))


def table(label):
    d = load(label)
    rows = d["rows"]
    ms, (starved, steps) = per_call_ms(rows)
    print(f"\n{label} ({d['when'][:16]}, load {d['load']}): median {ms:.0f} ms per unstarved score/next call; {starved} of {steps} steps with calls starved")
    groups = {}
    for r in rows:
        k = "next (chapter flow)" if r["step"].startswith("next (") else r["step"]
        groups.setdefault(k, []).append(r)
    print(f"  {'step':26} {'n':>2} {'calls mean (min-max)':>22} {'score':>6} {'next':>6} {'gen':>4} {'s measured':>11} {'s typical':>10}")
    for k, rs in groups.items():
        tot = [r["total"] for r in rs]
        sc = statistics.mean(r["calls"]["scoreContinuation"] for r in rs)
        nx = statistics.mean(r["calls"]["nextTokens"] for r in rs)
        gn = statistics.mean(r["calls"]["generate"] for r in rs)
        measured = statistics.mean(r["ms"] for r in rs) / 1000
        typical = (sc + nx) * ms / 1000
        gen_note = " + gen" if gn else ""
        print(f"  {k:26} {len(rs):2} {statistics.mean(tot):10.1f} ({min(tot)}-{max(tot)}){'':4} {sc:6.1f} {nx:6.1f} {gn:4.1f} {measured:11.2f} {typical:9.2f}{gen_note}")


def compare(a, b):
    ra, rb = load(a)["rows"], load(b)["rows"]
    same = sum(1 for x, y in zip(ra, rb) if x["hash"] == y["hash"] and x["step"] == y["step"])
    print(f"\n{a} vs {b}: {same} of {min(len(ra), len(rb))} steps give identical results")
    for x, y in zip(ra, rb):
        if x["hash"] != y["hash"]:
            print(f"   differs: {x['step']}: {x.get('note')} | {y.get('note')}")


for arg in sys.argv[1:]:
    if ":" in arg:
        compare(*arg.split(":", 1))
    else:
        table(arg)
