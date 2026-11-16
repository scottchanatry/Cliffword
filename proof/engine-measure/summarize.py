"""Summarize results/coverage-<label>.json files (coverage.ts) as the tables in proof/ENGINE_REAL_MODEL.md.
Usage: python3 summarize.py <label> [<label> ...]   (run from proof/engine-measure/)
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
COLS = ['n', 'asserted', 'assertedRightFix', 'hinted', 'flaggedRightFix', 'fixGenerated', 'rightRule', 'falseAsserts', 'falseHints']


def pair_table(s):
    fams = s['families']
    rows = []
    for f, v in fams.items():
        rows.append([f] + [v.get(c, 0) for c in COLS])
    rows.append(['all'] + [s['all'].get(c, 0) for c in COLS])
    out = ['| family | ' + ' | '.join(COLS) + ' |', '|' + '---|' * (len(COLS) + 1)]
    for r in rows:
        out.append('| ' + ' | '.join(str(x) for x in r) + ' |')
    return '\n'.join(out)


for label in sys.argv[1:]:
    d = json.loads((HERE / 'results' / f'coverage-{label}.json').read_text())
    print(f'## {label}  ({d["meta"]["when"]}, load {d["meta"]["load"]}, {d.get("totalMs", 0) / 1000:.0f} s)')
    for k in ['pairs', 'holdout', 'holdout2']:
        if k in d['summary']:
            s = d['summary'][k]
            print(f'\n### {k}\n')
            print(pair_table(s))
            if s['flagsOnCorrect']:
                print('\nflags on correct sentences:')
                for x in s['flagsOnCorrect']:
                    print('  -', x)
    for k in ['slang', 'slanghold', 'slanghold2']:
        if k in d['summary']:
            s = d['summary'][k]
            print(f'\n### {k}: n={s["n"]} verdicts={s["verdicts"]} slang words={s["slangWords"]}')
            for x in s['asserts']:
                print('  assert:', x)
            for x in s['hints']:
                print('  hint:', x)
            print('  touching slang:', s['variantsTouchingSlang'] or 'none')
            print('  slang shaded:', s['slangShaded'] or 'none')
            print('  no slang found:', s['noSlangFound'] or 'none')
    print()
