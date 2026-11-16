"""Tables for proof/ENGINE_REAL_MODEL.md from results/credit-lemma-<label>.json.

Usage (from proof/engine-measure/):
  python3 credit-summary.py before after

- Checks that the "before" engine (one next-word search per answer) and the "after"
  engine with the alternatives passed in and lemma credit off (lemmaWeight 0) give the
  same probability, credit and reason for every answer.
- Prints credited / full counts per set and class for the before run, the after run
  (the defaults) and every lemmaWeight x partialFloor of the sweep, and the answers
  whose credit came from lemma credit.
"""
import json
import sys
from pathlib import Path

RES = Path(__file__).parent / "results"

# Labels follow credit-lemma.ts (section 4 counts "vamos a casa" as natural, as the doc does).
RELABEL = {("Esta noche vamos a", "casa"): "natural"}


def rows_of(data, key=None):
    rows = data["rows"] if key is None else data["sweep"][key]
    out = []
    for r in rows:
        r = dict(r)
        for (opening, answer), klass in RELABEL.items():
            if r["opening"].endswith(opening) and r["answer"] == answer:
                r["klass"] = klass
        out.append(r)
    return out


def tally(rows):
    lines = []
    for s in ("section4", "lemma"):
        rs = [r for r in rows if r["set"] == s]

        def n(k):
            return sum(1 for r in rs if r["klass"] == k)

        def cred(k):
            return sum(1 for r in rs if r["klass"] == k and r["credit"] != "none")

        def full(k):
            return sum(1 for r in rs if r["klass"] == k and r["credit"] == "full")

        form_kept = sum(1 for r in rs if r["klass"] == "form" and r["reason"] == "form")
        lines.append(
            f"{s:9} natural {cred('natural')}/{n('natural')} credited ({full('natural')} full)"
            f" | wrong {cred('wrong')}/{n('wrong')} credited ({full('wrong')} full)"
            f" | form {form_kept}/{n('form')} kept 'form'"
        )
    lemma = [f"{r['answer']} via {r['lemmaMatch']['word']} ({r['klass']}, {r['credit']})" for r in rows if r.get("lemmaMatch")]
    return lines, lemma


def main():
    before_label, after_label = (sys.argv[1:3] + ["before", "after"])[:2]
    before = json.loads((RES / f"credit-lemma-{before_label}.json").read_text())
    after = json.loads((RES / f"credit-lemma-{after_label}.json").read_text())

    b = {(r["opening"], r["answer"]): r for r in rows_of(before)}
    off = rows_of(after, "w=0 floor=0.0001")
    diffs = []
    for r in off:
        o = b.get((r["opening"], r["answer"]))
        if o is None:
            continue
        same = abs(o["prob"] - r["prob"]) <= 1e-12 * max(1.0, abs(o["prob"])) and o["credit"] == r["credit"] and o["reason"] == r["reason"]
        if not same:
            diffs.append((r["answer"], o["prob"], r["prob"], o["credit"], r["credit"], o["reason"], r["reason"]))
    print(f"before vs after (alternatives passed in, lemma credit off): {len(off)} answers compared, {len(diffs)} differ")
    for d in diffs:
        print("  ", d)

    for label, rows in (("before", rows_of(before)), ("after (defaults)", rows_of(after))):
        lines, lemma = tally(rows)
        print(f"\n{label}:")
        for line in lines:
            print("  ", line)
        if lemma:
            print("   lemma credit:", "; ".join(lemma))

    print("\nsweep (after engine, alternatives passed in):")
    for key in after["sweep"]:
        lines, lemma = tally(rows_of(after, key))
        print(f"  {key}")
        for line in lines:
            print("    ", line)
        if lemma:
            print("     lemma credit:", "; ".join(lemma))

    print(f"\nmodel calls: after run {after['calls']} (memoized; {after['seconds']} s)")


if __name__ == "__main__":
    main()
