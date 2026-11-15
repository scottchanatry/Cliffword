"""Tables for proof/ENGINE_REAL_MODEL.md from the measure.ts results."""
import json
import sys
from collections import defaultdict, Counter
from pathlib import Path

R = Path(__file__).parent / 'results'
FAMILY = {
    'ser_estar': ['es.ser_estar'], 'por_para': ['es.por_para'], 'gender': ['es.gender'], 'number': ['es.number'],
    'preterite_imperfect': ['es.aspect'], 'subjunctive_wish': ['es.mood'], 'personal_a': ['es.personal_a'],
    'articles': ['es.article'],
    'pronoun_placement': ['es.pronoun_placement', 'es.pronoun_order', 'es.negative_command', 'es.se_lo'],
}
RULES = list(FAMILY)


def pct(a, b):
    return f"{100 * a / b:.0f}%" if b else "-"


def judge_tables(name='judge', label='exact'):
    d = json.load(open(R / f'{name}.json'))
    rows = d['rows']
    inc = [r for r in rows if r['kind'] == 'incorrect']
    cor = [r for r in rows if r['kind'] == 'correct']
    print(f"\n## judgeSentence {label}: {len(inc)} incorrect, {len(cor)} correct; calls {d.get('calls')}; total {d.get('totalMs', 0)/1000:.0f} s")
    print("\n| rule | n | asserted | hinted | ok | fix found | assert with right fix | flagged with right fix | right family | false assert | false hint |")
    print("|---|---|---|---|---|---|---|---|---|---|---|")
    tot = Counter()
    for rule in RULES + ['ALL']:
        I = [r for r in inc if rule == 'ALL' or r['rule'] == rule]
        C = [r for r in cor if rule == 'ALL' or r['rule'] == rule]
        a = sum(r['verdict'] == 'assert' for r in I)
        h = sum(r['verdict'] == 'hint' for r in I)
        o = sum(r['verdict'] == 'ok' for r in I)
        ff = sum(bool(r['fixFound']) for r in I)
        ar = sum(r['verdict'] == 'assert' and r['best'] == C[I.index(r)]['text'] for r in I) if C else 0
        fr = sum(r['verdict'] != 'ok' and r['best'] == C[I.index(r)]['text'] for r in I) if C else 0
        fam = sum(r['verdict'] != 'ok' and r['bestKey'] in FAMILY.get(r['rule'], []) for r in I)
        fa = sum(r['verdict'] == 'assert' for r in C)
        fh = sum(r['verdict'] == 'hint' for r in C)
        n = len(I)
        name_ = f"**{rule}**" if rule == 'ALL' else rule
        print(f"| {name_} | {n} | {a} ({pct(a,n)}) | {h} | {o} | {ff} | {ar} | {fr} ({pct(fr,n)}) | {fam} | {fa} | {fh} |")
    return d


def judge_details(name='judge'):
    d = json.load(open(R / f'{name}.json'))
    rows = d['rows']
    inc = {r['id']: r for r in rows if r['kind'] == 'incorrect'}
    cor = {r['id']: r for r in rows if r['kind'] == 'correct'}
    print("\n### incorrect sentences not asserted with the right fix")
    for i, r in inc.items():
        c = cor[i]
        if r['verdict'] == 'assert' and r['best'] == c['text']:
            continue
        print(f"- [{r['rule']}] *{r['text']}* -> {r['verdict']} best={r['best']!r} ({r['bestKey']}, m={r['margin'] if r['margin'] is None else round(r['margin'],2)}); fix found={r['fixFound']} fixMargin={None if r.get('fixMargin') is None else round(r['fixMargin'],2)} rank={r.get('fixRank')}; proof margin {r['proofMargin']:.2f}; 2nd {r['secondKey']} {None if r['secondMargin'] is None else round(r['secondMargin'],2)}")
    print("\n### correct sentences flagged")
    for i, c in cor.items():
        if c['verdict'] != 'ok':
            print(f"- [{c['rule']}] {c['text']} -> {c['verdict']} best={c['best']!r} ({c['bestKey']}, m={c['margin']:.2f}); proof margin {c['proofMargin']:.2f}")
    # Comparison with the raw pair margins.
    pm = [inc[i]['proofMargin'] for i in inc]
    print(f"\nraw proof: accuracy {sum(m>0 for m in pm)}/93, >=3: {sum(m>=3 for m in pm)}, >=1: {sum(m>=1 for m in pm)}, false>=3: {sum(-m>=3 for m in pm)}, false>=1: {sum(-m>=1 for m in pm)}")
    ms = [r['ms'] for r in rows]
    ms.sort()
    vs = [r['variants'] for r in rows]
    print(f"judge ms: median {ms[len(ms)//2]}, p90 {ms[int(len(ms)*0.9)]}, max {ms[-1]}; variants median {sorted(vs)[len(vs)//2]}, max {max(vs)}; dropped {sum(r['dropped'] for r in rows)}")


def heat_tables():
    d = json.load(open(R / 'heat.json'))
    rows = d['rows']
    inc = [r for r in rows if r['kind'] == 'incorrect']
    cor = [r for r in rows if r['kind'] == 'correct']
    print(f"\n## heat ({d['calls']})")
    print("\n| rule | n | error or next at heat>=2 | at heat>=1 | top-1 surprisal (proof method) | top-2 | correct: any heat>=2 | correct: any heat 3 |")
    print("|---|---|---|---|---|---|---|---|")
    for rule in RULES + ['ALL']:
        I = [r for r in inc if rule == 'ALL' or r['rule'] == rule]
        C = [r for r in cor if rule == 'ALL' or r['rule'] == rule]
        h2 = h1 = t1 = t2 = 0
        for r in I:
            f, t = r['span']['from'], r['span']['to']
            idx = set(range(f, max(t, f + 1) + 1))  # changed span plus the next word
            ws = r['words']
            if any(w['h'] >= 2 and i in idx for i, w in enumerate(ws)):
                h2 += 1
            if any(w['h'] >= 1 and i in idx for i, w in enumerate(ws)):
                h1 += 1
            order = sorted(range(len(ws)), key=lambda i: -ws[i]['s'])
            if order and order[0] in idx:
                t1 += 1
            if any(i in idx for i in order[:2]):
                t2 += 1
        c2 = sum(any(w['h'] >= 2 for w in r['words']) for r in C)
        c3 = sum(any(w['h'] >= 3 for w in r['words']) for r in C)
        n = len(I)
        nm = f"**{rule}**" if rule == 'ALL' else rule
        print(f"| {nm} | {n} | {h2} ({pct(h2,n)}) | {h1} ({pct(h1,n)}) | {pct(t1,n)} | {pct(t2,n)} | {c2} ({pct(c2,len(C))}) | {c3} ({pct(c3,len(C))}) |")
    # word-level heat distribution on correct sentences
    allw = [w for r in cor for w in r['words']]
    first = [r['words'][0] for r in cor if r['words']]
    rest = [w for r in cor for w in r['words'][1:]]
    dist = Counter(w['h'] for w in allw)
    print(f"\ncorrect words: {len(allw)}; heat distribution {dict(sorted(dist.items()))}; share heat>=1 {pct(sum(w['h']>=1 for w in allw), len(allw))}, >=2 {pct(sum(w['h']>=2 for w in allw), len(allw))}, 3 {pct(sum(w['h']>=3 for w in allw), len(allw))}")
    print(f"non-first words of correct sentences: >=1 {pct(sum(w['h']>=1 for w in rest), len(rest))}, >=2 {pct(sum(w['h']>=2 for w in rest), len(rest))}, 3 {pct(sum(w['h']>=3 for w in rest), len(rest))}; first words >=2 {pct(sum(w['h']>=2 for w in first), len(first))}")
    errw = []
    for r in inc:
        f, t = r['span']['from'], r['span']['to']
        for i in range(f, max(t, f + 1)):
            if i < len(r['words']):
                errw.append(r['words'][i])
    print(f"error words ({len(errw)}): heat>=1 {pct(sum(w['h']>=1 for w in errw), len(errw))}, >=2 {pct(sum(w['h']>=2 for w in errw), len(errw))}, 3 {pct(sum(w['h']>=3 for w in errw), len(errw))}")
    # threshold sweep for heat 2 (on non-first words) to see whether 9.5 is right
    import itertools
    print("\nthreshold sweep (surprisal of non-first words; first words get -2.5):")
    print("| t | correct sentences with any word >= t | error-or-next hit |")
    print("|---|---|---|")
    for t in [7, 8, 8.5, 9, 9.5, 10, 10.5, 11, 12]:
        def adj(i, w):
            return w['s'] - (2.5 if i == 0 else 0)
        c = sum(any(adj(i, w) >= t for i, w in enumerate(r['words'])) for r in cor)
        h = 0
        for r in inc:
            f, tt = r['span']['from'], r['span']['to']
            idx = set(range(f, max(tt, f + 1) + 1))
            if any(adj(i, w) >= t and i in idx for i, w in enumerate(r['words'])):
                h += 1
        print(f"| {t} | {c} ({pct(c, len(cor))}) | {h} ({pct(h, len(inc))}) |")


def street_tables():
    d = json.load(open(R / 'street.json'))
    rows = d['rows']
    print(f"\n## street ({d['calls']})")
    sv = Counter(r['street']['verdict'] for r in rows)
    nv = Counter(r['neutral']['verdict'] for r in rows)
    print(f"street register verdicts {dict(sv)}; neutral register on the same sentences {dict(nv)}")
    print(f"variants touching slang: street {sum(r['street']['touchingSlang'] for r in rows)}, neutral {sum(r['neutral']['touchingSlang'] for r in rows)}")
    print("\n| id | sentence | slang named | street verdict (best, margin) | neutral verdict (best, margin) |")
    print("|---|---|---|---|---|")
    for r in rows:
        s, n = r['street'], r['neutral']
        fmt = lambda x: f"{x['verdict']}" + (f" ({x['edit']}, {x['margin']:.1f})" if x['verdict'] != 'ok' else "")
        print(f"| {r['id']} | {r['text']} | {', '.join(r['slangNamed'])} | {fmt(s)} | {fmt(n)} |")
    sw = [w for r in rows for w in r['words'] if w['slang']]
    ow = [w for r in rows for w in r['words'] if not w['slang']]
    import statistics as st
    print(f"\nslang words: {len(sw)}; mean surprisal neutral {st.mean(w['neutralSurprisal'] for w in sw):.1f}, street prefix {st.mean(w['streetSurprisal'] for w in sw):.1f}")
    print(f"slang heat neutral {dict(Counter(w['neutralHeat'] for w in sw))}, street prefix without exemption {dict(Counter(w['streetRawHeat'] for w in sw))}, street with exemption {dict(Counter(w['streetHeat'] for w in sw))}")
    print(f"other words: {len(ow)}; mean surprisal neutral {st.mean(w['neutralSurprisal'] for w in ow):.1f}, street {st.mean(w['streetSurprisal'] for w in ow):.1f}; heat neutral {dict(Counter(w['neutralHeat'] for w in ow))}, street {dict(Counter(w['streetHeat'] for w in ow))}")
    print("\nper slang word (neutral -> street surprisal, heat neutral/street raw/street):")
    for r in rows:
        for w in r['words']:
            if w['slang']:
                print(f"  {r['id']} {w['word']}: {w['neutralSurprisal']} -> {w['streetSurprisal']}  heat {w['neutralHeat']}/{w['streetRawHeat']}/{w['streetHeat']}")
    print("\nunexempted hot words in street mode (heat>=2):")
    for r in rows:
        for w in r['words']:
            if not w['slang'] and (w['streetHeat'] or 0) >= 2:
                print(f"  {r['id']} {r['text']}: {w['word']} s={w['streetSurprisal']} heat {w['streetHeat']}")


def topn_tables(n, exact='judge'):
    d = json.load(open(R / f'topn{n}.json'))
    e = json.load(open(R / f'{exact}.json'))
    ex = {(r['id'], r['kind']): r for r in e['rows']}
    rows = d['rows']
    inc = [r for r in rows if r['kind'] == 'incorrect']
    cor = [r for r in rows if r['kind'] == 'correct']
    cortext = {r['id']: r['text'] for r in cor}
    def count(rs, key='verdict'):
        return Counter(r[key] for r in rs)
    print(f"\n## top-{n}: {len(inc)} pairs; calls {d['calls']}; total {d['totalMs']/1000:.0f} s; ms per judgement median {sorted(r['ms'] for r in rows)[len(rows)//2]}")
    ei = [ex[(r['id'], 'incorrect')] for r in inc]
    ec = [ex[(r['id'], 'correct')] for r in cor]
    def right(rs, verdicts, key='verdict'):
        return sum(r[key] in verdicts and r['best'] == cortext[r['id']] for r in rs)
    print("\n| policy | errors asserted (right fix) | errors flagged (right fix) | false asserts | false hints | judgements marked bounded |")
    print("|---|---|---|---|---|---|")
    # exact on the same subset
    print(f"| exact scores (same {len(inc)} pairs) | {sum(r['verdict']=='assert' for r in ei)} ({right(ei, ['assert'])}) | {sum(r['verdict']!='ok' for r in ei)} ({right(ei, ['assert','hint'])}) | {sum(r['verdict']=='assert' for r in ec)} | {sum(r['verdict']=='hint' for r in ec)} | - |")
    print(f"| top-{n}, no cap (before Task V) | {sum(r['noCap']=='assert' for r in inc)} ({right(inc, ['assert'], 'noCap')}) | {sum(r['noCap']!='ok' for r in inc)} ({right(inc, ['assert','hint'], 'noCap')}) | {sum(r['noCap']=='assert' for r in cor)} | {sum(r['noCap']=='hint' for r in cor)} | - |")
    print(f"| top-{n}, cap on variant-side bounds only | {sum(r['variantPolicy']=='assert' for r in inc)} ({right(inc, ['assert'], 'variantPolicy')}) | {sum(r['variantPolicy']!='ok' for r in inc)} ({right(inc, ['assert','hint'], 'variantPolicy')}) | {sum(r['variantPolicy']=='assert' for r in cor)} | {sum(r['variantPolicy']=='hint' for r in cor)} | - |")
    print(f"| top-{n}, engine (cap on either side) | {sum(r['verdict']=='assert' for r in inc)} ({right(inc, ['assert'])}) | {sum(r['verdict']!='ok' for r in inc)} ({right(inc, ['assert','hint'])}) | {sum(r['verdict']=='assert' for r in cor)} | {sum(r['verdict']=='hint' for r in cor)} | {sum(r['bounded'] for r in rows)}/{len(rows)} |")
    sides = Counter()
    for r in rows:
        s = r['bestSide']
        if s:
            sides[('V' if s['variant'] else '') + ('O' if s['original'] else '') or 'exact'] += 1
    print(f"best-variant bound side: {dict(sides)}")
    # false asserts detail under no cap
    for r in cor:
        if r['noCap'] == 'assert':
            print(f"  no-cap false assert: {r['text']} -> {r['best']} m={r['margin']:.2f} side={r['bestSide']}")
        if r['variantPolicy'] == 'assert':
            print(f"  variant-policy false assert: {r['text']} -> {r['best']} m={r['margin']:.2f} side={r['bestSide']}")


if __name__ == '__main__':
    what = sys.argv[1:] or ['judge', 'heat', 'street']
    for w in what:
        if w == 'judge':
            judge_tables()
            judge_details()
        elif w == 'heat':
            heat_tables()
        elif w == 'street':
            street_tables()
        elif w.startswith('topn'):
            topn_tables(int(w[4:]))


def credit_tables():
    d = json.load(open(R / 'credit.json'))
    rows = d['rows']
    # Relabel: "vamos a casa" (we're going home) is natural Spanish.
    for r in rows:
        if r['answer'] == 'casa' and r['opening'].endswith('vamos a'):
            r['label'] = 'natural'
    nat = [r for r in rows if r['label'] == 'natural']
    wr = [r for r in rows if r['label'] == 'wrong']
    print(f"\n## credit: {len(nat)} natural, {len(wr)} wrong answers over {len(set(r['opening'] for r in rows))} cliffs")
    print(f"natural min prob {min(r['prob'] for r in nat):.2e} ({min(nat, key=lambda r: r['prob'])['answer']}); wrong max prob {max(r['prob'] for r in wr):.2e} ({max(wr, key=lambda r: r['prob'])['answer']})")
    print("\n| partialFloor | natural answers with credit | wrong answers with credit |")
    print("|---|---|---|")
    for f in [5e-3, 2e-3, 1e-3, 5e-4, 2e-4, 1e-4, 5e-5, 2e-5, 1e-5]:
        def credited(r):
            return r['credit'] == 'full' or r['reason'] == 'form' or r['prob'] >= f
        print(f"| {f:g} | {sum(credited(r) for r in nat)}/{len(nat)} | {sum(credited(r) for r in wr)}/{len(wr)} |")
    print("\n| cliff | natural answers (probability, credit now) | wrong answers (probability) |")
    print("|---|---|---|")
    for op in dict.fromkeys(r['opening'] for r in rows):
        n = [r for r in nat if r['opening'] == op]
        w = [r for r in wr if r['opening'] == op]
        print(f"| …{op} | " + ', '.join(f"{r['answer']} {r['prob']:.1e} {r['credit']}" for r in n) + " | " + ', '.join(f"{r['answer']} {r['prob']:.0e}" for r in w) + " |")


def generate_tables(name='generate'):
    d = json.load(open(R / f'{name}.json'))
    rows = d['rows']
    print(f"\n## generation ({d['calls']})")
    print("\n| learner | vocab | sentence words | seed | time | in band | retried | accepted/candidates | rejects | sentence |")
    print("|---|---|---|---|---|---|---|---|---|---|")
    for r in rows:
        print(f"| {r['learner']} | {r['vocab']} | {r['sentenceWords']['min']:.1f}-{r['sentenceWords']['max']:.1f} | {r['seed']} | {r['ms']/1000:.1f} s | {'yes' if r['inBand'] else 'no'} | {'yes' if r['retried'] else 'no'} | {r['accepted']}/{r['candidates']} | {r['rejects']} | {r['sentence']} |")
    for r in rows:
        print(f"\n{r['learner']} seed {r['seed']} targets {r['targets']} band {r['band']}")
        for x in r['ranked']:
            print(f"   {'+' if x['accepted'] else '-'} {'IN ' if x['inBand'] else '   '} {x['share']:.3f} {x['rejected']} {x['text']!r}")
        for rd in r['rounds']:
            for raw in rd['raw']:
                print(f"     raw{' (simple)' if rd['simple'] else ''}: {raw!r}")


if __name__ == '__main__' and len(sys.argv) > 1 and sys.argv[1] in ('credit', 'generate'):
    {'credit': credit_tables, 'generate': generate_tables}[sys.argv[1]]()
