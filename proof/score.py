"""Cliffword proof test: probability scoring of Spanish with a small GGUF model.

Usage: python score.py MODEL.gguf OUT.json

Scores every sentence in pairs.jsonl and slang.jsonl by total log-probability
(natural log), measures word-level surprisal, speed, and next-word lists.
Raw text is scored as plain continuation (no chat template).
"""
import json, math, re, sys, time
from pathlib import Path
import numpy as np
from llama_cpp import Llama

HERE = Path(__file__).parent
MODEL, OUT = sys.argv[1], sys.argv[2]

REGISTER_PREFIX = ("Conversación entre panas en Puerto Rico, en español de la calle, "
                   "con palabras como janguear, corillo, vaina, 'tá y pa':\n")
NEUTRAL_PREFIX = "Frase en español:\n"

llm = Llama(model_path=MODEL, n_ctx=512, n_threads=4, n_batch=512,
            logits_all=True, verbose=False)
VOCAB = llm.n_vocab()

# Start-of-text context: BOS when the model uses one, else the end-of-text token
# (Qwen has no BOS; <|endoftext|> separates documents in its training data).
START = llm.tokenize(b"", add_bos=True, special=False) or [llm.token_eos()]

WORD_RE = re.compile(r"[\w'’]+", re.UNICODE)


def log_softmax(x):
    x = x.astype(np.float64)
    m = x.max(-1, keepdims=True)
    return x - m - np.log(np.exp(x - m).sum(-1, keepdims=True))


def run(tokens):
    llm.reset()
    llm.eval(tokens)
    return np.array(llm.scores[: len(tokens)])


def ctx_tokens(prefix):
    if not prefix:
        return list(START)
    return list(START) + llm.tokenize(prefix.encode(), add_bos=False, special=False)


def score(text, prefix=""):
    """Return total logprob, per-token logprobs and per-word surprisal of `text`."""
    ctx = ctx_tokens(prefix)
    toks = llm.tokenize(text.encode(), add_bos=False, special=False)
    allt = ctx + toks
    lp = log_softmax(run(allt))
    tok_lp = [float(lp[len(ctx) + i - 1, t]) for i, t in enumerate(toks)]
    # map tokens to words by byte offset of their first non-space byte
    tb = text.encode()
    spans = []
    for m in WORD_RE.finditer(text):
        b0 = len(text[: m.start()].encode()); b1 = len(text[: m.end()].encode())
        spans.append([m.group(), b0, b1, 0.0])
    off = 0
    punct = 0.0
    for t, l in zip(toks, tok_lp):
        piece = llm.detokenize([t])
        lead = len(piece) - len(piece.lstrip(b" "))
        pos = off + lead
        for s in spans:
            if s[1] <= pos < s[2]:
                s[3] += -l
                break
        else:
            punct += -l
        off += len(piece)
    assert off == len(tb), (text, off, len(tb))
    return {"total": sum(tok_lp), "ntok": len(toks),
            "words": [(s[0], s[3]) for s in spans], "punct": punct}


def diff_span(cw, iw):
    """First differing word index in the incorrect sentence, and end of the differing span."""
    i = 0
    while i < min(len(cw), len(iw)) and cw[i] == iw[i]:
        i += 1
    j = 0
    while j < min(len(cw), len(iw)) - i and cw[-1 - j] == iw[-1 - j]:
        j += 1
    end = len(iw) - j - 1  # last differing index in incorrect (may be < i for omissions)
    return i, max(i, end)


res = {"model": Path(MODEL).name, "pairs": [], "slang": [], "speed": {}, "nextword": []}

# ---------------- minimal pairs ----------------
pairs = [json.loads(l) for l in open(HERE / "pairs.jsonl")]
for p in pairs:
    row = dict(p)
    for tag, pre in (("plain", ""), ("neutral", NEUTRAL_PREFIX), ("register", REGISTER_PREFIX)):
        c = score(p["correct"], pre); w = score(p["incorrect"], pre)
        row[tag] = {"c": c["total"], "i": w["total"], "c_ntok": c["ntok"], "i_ntok": w["ntok"]}
        if tag == "neutral":
            cw = [x[0] for x in c["words"]]; iw = [x[0] for x in w["words"]]
            a, b = diff_span(cw, iw)
            surp = [x[1] for x in w["words"]]
            top = int(np.argmax(surp))
            row["loc"] = {"words": w["words"], "err_from": a, "err_to": b, "top": top,
                          "hit": a <= top <= b + 1}
            # same check on the plain (no prefix) run, first word unconditioned
    res["pairs"].append(row)
    print(p["id"], p["rule"], round(row["plain"]["c"] - row["plain"]["i"], 2), flush=True)

# ---------------- slang ----------------
for s in [json.loads(l) for l in open(HERE / "slang.jsonl")]:
    row = dict(s)
    for tag, pre in (("plain", ""), ("neutral", NEUTRAL_PREFIX), ("register", REGISTER_PREFIX)):
        a = score(s["street"], pre); b = score(s["neutral"], pre)
        row[tag] = {"street": a["total"], "neutral": b["total"],
                    "street_words": a["words"], "neutral_words": b["words"],
                    "street_nw": len(a["words"]), "neutral_nw": len(b["words"])}
    res["slang"].append(row)

# ---------------- speed ----------------
sent = "Ayer mi hermano y yo fuimos al mercado a comprar fruta."
variants = [sent, sent.replace("fuimos", "íbamos"), sent.replace("al", "a el"),
            sent.replace("a comprar", "para comprar"), sent.replace("fruta", "frutas"),
            sent.replace("mi hermano y yo", "mi hermana y yo"), sent.replace("Ayer", "Mañana")]
score(sent)  # warm up
t0 = time.time()
for v in variants:
    score(v, NEUTRAL_PREFIX)
res["speed"]["score_10w_plus_6_s"] = time.time() - t0
long = " ".join(json.loads(l)["correct"] for l in open(HERE / "pairs.jsonl"))[:1200]
lt = list(START) + llm.tokenize(long.encode(), add_bos=False)
lt = lt[:400]
t0 = time.time(); run(lt); dt = time.time() - t0
res["speed"]["prompt_tok_per_s"] = len(lt) / dt
llm.reset()
t0 = time.time()
out = llm.create_completion("Había una vez, en un pueblo cerca del mar,", max_tokens=48,
                            temperature=0.0)
dt = time.time() - t0
res["speed"]["gen_tok_per_s"] = out["usage"]["completion_tokens"] / dt
res["speed"]["gen_sample"] = out["choices"][0]["text"]
print(res["speed"], flush=True)

# ---------------- next-word lists ----------------
# Classify each vocabulary piece once: does it start a new word (leading space,
# punctuation, newline, end of text) or continue the current one?
pieces = [llm.detokenize([i]) for i in range(VOCAB)]
def is_cont(b):
    if not b:
        return False
    c = b[0]
    return c >= 0x80 or chr(c).isalnum() or c in b"'-"
CONT = np.array([is_cont(b) for b in pieces])
WORDSTART = np.array([b[:1] == b" " and len(b) > 1 and is_cont(b[1:]) for b in pieces])
BOUNDARY = ~CONT  # anything that is not a continuation ends the word

openings = [
    "Ayer fui al mercado y compré", "Cuando llegué a casa, mi madre", "Me gusta mucho",
    "El perro corrió hacia la", "No puedo salir hoy porque", "Mi hermano siempre",
    "Quiero que mañana", "La niña abrió la puerta y", "Esta noche vamos a",
    "En la playa hacía mucho", "Mano, vamo' a janguear con el", "Esa vaina 'tá",
    "¿Qué es la que", "Tengo que terminar esto para", "Había una vez un",
]

def next_words(opening, k_first=60, k_cont=12, min_p=1e-3, max_states=30, depth=4):
    base = ctx_tokens(NEUTRAL_PREFIX) + llm.tokenize(opening.encode(), add_bos=False)
    p0 = np.exp(log_softmax(run(base)[-1]))
    cand = np.argsort(-p0 * WORDSTART)[:k_first]
    states = [([int(t)], float(p0[t])) for t in cand if p0[t] > min_p]
    words = {}
    for d in range(depth):
        states.sort(key=lambda s: -s[1])
        states = states[:max_states]
        new = []
        for toks, p in states:
            text = b"".join(pieces[t] for t in toks).decode("utf-8", "replace").strip()
            if d == depth - 1:
                words[text] = words.get(text, 0) + p  # depth limit: count remaining mass
                continue
            q = np.exp(log_softmax(run(base + toks)[-1]))
            words[text] = words.get(text, 0) + p * float(q[BOUNDARY].sum())
            cq = q * CONT
            for t in np.argsort(-cq)[:k_cont]:
                if p * q[t] > min_p:
                    new.append((toks + [int(t)], p * float(q[t])))
        states = new
        if not states:
            break
    top = sorted(words.items(), key=lambda x: -x[1])[:10]
    return {"opening": opening, "top": top, "first_piece_space_mass": float((p0 * WORDSTART).sum())}

t0 = time.time()
for o in openings:
    r = next_words(o)
    res["nextword"].append(r)
    print(o, [(w, round(p, 3)) for w, p in r["top"][:5]], flush=True)
res["speed"]["nextword_avg_s"] = (time.time() - t0) / len(openings)

json.dump(res, open(OUT, "w"), ensure_ascii=False, indent=1)
print("saved", OUT)
