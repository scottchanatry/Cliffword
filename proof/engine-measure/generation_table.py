"""Tables for proof/ENGINE_REAL_MODEL.md from results/generation-<label>.json.

Usage: python3 generation_table.py before after
Prints, per label, one row per simulated learner: runs, in band (as selection judged it,
and on the learner's own pKnown), target use, distinct sentences, steps without a
sentence, chosen sentences that the current rejects refuse, reject counts by reason,
seconds per call, model calls, tokens prefilled and decoded, and an estimate of the
seconds on a phone-class CPU from the proof's speed table (4 desktop cores: prompt
processing 124 tokens/s, generation 15.4 tokens/s; scoring calls count as prompt tokens).
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).parent / "results"
PREFILL, DECODE = 124.0, 15.4
NAMES = {
    "brandNew": "brand new",
    "early": "early (~300)",
    "reader": "reader, weak speaking",
    "advanced": "advanced",
    "heritage": "heritage",
}


def main(labels):
    for label in labels:
        d = json.loads((HERE / f"generation-{label}.json").read_text())
        print(f"\n{label} ({d['meta']['date'][:16]}, load {', '.join(f'{x:.1f}' for x in d['meta']['loadavg'])}):\n")
        print("| learner | runs | in band | on own pKnown | target used | distinct | no sentence | chosen junk | rejects | s / call (mean, max) | calls (gen + score) | tokens (prompt + decode) | phone estimate |")
        print("|---|---|---|---|---|---|---|---|---|---|---|---|---|")
        for pid, s in d["summary"].items():
            rows = [r for r in d["rows"] if r["profile"] == pid]
            n = s["runs"]
            rej = ", ".join(f"{k} {v}" for k, v in sorted(s["rejects"].items(), key=lambda kv: -kv[1])) or "none"
            # Scoring calls: about 12 tokens each after a cached context.
            phone = (s["meanPromptTokens"] + 12 * s["meanScoreCalls"]) / PREFILL + s["meanDecodeTokens"] / DECODE
            print(
                f"| {NAMES.get(pid, pid)} | {n} | {round(s['inBand'] * n)}/{n} | {round(s['ownInBand'] * n)}/{n} | "
                f"{round(s['targetUse'] * n)}/{n} | {s['distinct']} | {s['noSentence']} | {s['chosenFailingNewRejects']} | {rej} | "
                f"{s['meanSeconds']}, {s['maxSeconds']} | {s['meanGenerateCalls']} + {s['meanScoreCalls']} | "
                f"{s['meanPromptTokens']} + {s['meanDecodeTokens']} | {phone:.1f} s |"
            )
        print()
        for pid in d["summary"]:
            sents = [r["sentence"] for r in d["rows"] if r["profile"] == pid]
            print(f"- {NAMES.get(pid, pid)}: " + " / ".join(f'"{x}"' if x else "(none)" for x in sents))


if __name__ == "__main__":
    main(sys.argv[1:] or ["before", "after"])
