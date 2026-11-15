"""Compare the llama.rn scoring patch's native core with proof/model_server.py.

Usage (from app/, with the driver built by build.sh and the server running):

    /path/to/venv/bin/python proof/model_server.py --model MODEL.gguf --port 8799   # repo root
    python3 native-tests/scoring/compare.py --driver BUILD_DIR/cliffword-score-driver \
        --model MODEL.gguf [--server http://127.0.0.1:8799] [--fixture-out PATH]

For each case it scores the text with the driver (CliffwordScore.cpp on llama.rn's vendored
llama.cpp) and with the server (llama-cpp-python), merges the driver's byte tokens into whole
characters with UTF-16 offsets exactly as model_server.py does, and checks:
- the merged token texts and offsets are identical;
- sentence totals agree within --tol nats (default 0.05);
- the driver gives the same numbers fresh (memory cleared) and with a reused prefix;
- the top-k next-token lists hold the same tokens in the same order (a swap of two
  neighbours closer than --swap-tol nats is reported, not failed).
--fixture-out writes a few cases (raw driver tokens and their merged form) as JSON for the
app's Jest test of the byte-to-UTF-16 conversion. Only the Python standard library is used.
Exit status 0 when every check passes.
"""
import argparse
import json
import math
import subprocess
import sys
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
PREFIX = "Frase en español:\n"


def post(server, path, body):
    req = urllib.request.Request(server + path, data=json.dumps(body).encode("utf-8"),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.loads(r.read().decode("utf-8"))


class Driver:
    def __init__(self, path, model, threads, fa):
        self.p = subprocess.Popen([path, model, str(threads), "2048", "512", fa],
                                  stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                  text=True, encoding="utf-8")
        while True:
            line = self.p.stderr.readline()
            if not line:
                raise RuntimeError("driver exited before it was ready")
            if line.startswith("ready"):
                self.banner = line.strip()
                break

    def ask(self, req):
        self.p.stdin.write(json.dumps(req, ensure_ascii=False) + "\n")
        self.p.stdin.flush()
        res = json.loads(self.p.stdout.readline())
        if "error" in res:
            raise RuntimeError(f"driver: {res['error']} for {req}")
        return res

    def close(self):
        self.p.stdin.close()
        self.p.wait(timeout=30)


def lp(x):
    return -math.inf if x is None else float(x)


def utf16_len(s):
    return len(s.encode("utf-16-le")) // 2


def merge(text, raw):
    """model_server.py's rule: byte tokens that end inside a character join the next."""
    b = text.encode("utf-8")
    out, buf, acc, pos = [], b"", 0.0, 0
    for t in raw:
        buf += b[t["byte_start"]:t["byte_end"]]
        acc += lp(t["logprob"])
        try:
            s = buf.decode("utf-8")
        except UnicodeDecodeError:
            continue
        n = utf16_len(s)
        out.append({"text": s, "start": pos, "end": pos + n, "logprob": acc})
        pos += n
        buf, acc = b"", 0.0
    assert not buf, f"tokens of {text!r} end inside a character"
    assert "".join(o["text"] for o in out) == text
    return out


def cases():
    pairs = [json.loads(l) for l in open(REPO / "proof" / "pairs.jsonl", encoding="utf-8")]
    slang = [json.loads(l) for l in open(REPO / "proof" / "slang.jsonl", encoding="utf-8")]
    out = []
    # Every fifth pair, so each rule family shows up; correct and incorrect sentence.
    for p in pairs[::5][:10]:
        out.append((PREFIX, p["correct"], f"pair {p['id']} correct"))
        out.append((PREFIX, p["incorrect"], f"pair {p['id']} incorrect"))
    for s in slang[:4]:
        out.append((PREFIX, s["street"], f"slang {s['id']} street"))
        out.append((PREFIX, s["neutral"], f"slang {s['id']} neutral"))
    # The engine's own shapes: a continuation that starts with a space, accents, ñ, ¿¡, emoji.
    out += [
        (PREFIX + "Marta llegó tarde al", " mercado", "leading space"),
        (PREFIX + "Ayer fui al mercado y compré", " un ñandú de peluche para mi niña.", "leading space, ñ"),
        (PREFIX + "Mi abuela", " está cansadísima, ¿verdad?", "leading space, accents, ¿"),
        (PREFIX, "¡Qué día tan bonito! 🌞 Vamos a la playa.", "emoji, ¡"),
        (PREFIX, "Él comió pingüinos en Logroño… ¿sí?", "ü, ñ, ellipsis"),
        ("", "El niño está en la casa.", "empty context"),
        (PREFIX, "Llegué a Tōkyō y vi 東京タワー.", "split UTF-8 tokens"),
    ]
    return out


def compare_scores(drv, server, tol, report):
    ok = True
    rows = []
    fixture = []
    for context, text, label in cases():
        srv = post(server, "/score", {"context": context, "text": text})["tokens"]
        cached = drv.ask({"op": "score", "context": context, "text": text})
        drv.ask({"op": "reset"})
        fresh = drv.ask({"op": "score", "context": context, "text": text})
        m = merge(text, cached["tokens"])
        mf = merge(text, fresh["tokens"])
        seg_ok = [(o["text"], o["start"], o["end"]) for o in m] == [(o["text"], o["start"], o["end"]) for o in srv]
        tot_d = sum(o["logprob"] for o in m)
        tot_s = sum(lp(o["logprob"]) for o in srv)
        diff = abs(tot_d - tot_s)
        tok_diff = max(abs(a["logprob"] - lp(b["logprob"])) for a, b in zip(m, srv)) if seg_ok else math.inf
        cache_diff = max(abs(a["logprob"] - b["logprob"]) for a, b in zip(m, mf))
        good = seg_ok and diff <= tol and cache_diff <= 1e-9
        ok &= good
        rows.append((label, len(cached["tokens"]), len(m), tot_s, tot_d, diff, tok_diff, cache_diff,
                     cached["reused_tokens"], good))
        split = len(cached["tokens"]) != len(m)
        if split or label in ("leading space", "leading space, ñ", "emoji, ¡", "empty context"):
            fixture.append({"label": label, "context": context, "text": text,
                            "raw": [{k: t[k] for k in ("id", "byte_start", "byte_end", "logprob")}
                                    for t in cached["tokens"]],
                            "expected": m,
                            "server": [{**o, "logprob": lp(o["logprob"])} for o in srv]})
    report("\n## scoreText vs /score (totals in nats)\n")
    report("| case | tokens | merged | server total | driver total | diff | max token diff | fresh vs reused | reused prefix | ok |")
    report("|---|---|---|---|---|---|---|---|---|---|")
    for r in rows:
        report(f"| {r[0]} | {r[1]} | {r[2]} | {r[3]:.4f} | {r[4]:.4f} | {r[5]:.5f} | {r[6]:.5f} | {r[7]:.1e} | {r[8]} | {'yes' if r[9] else 'NO'} |")
    worst = max(r[5] for r in rows)
    worst_tok = max(r[6] for r in rows)
    report(f"\n{len(rows)} sentences; largest total difference {worst:.5f} nats, largest token difference {worst_tok:.5f} nats.")
    return ok, fixture, rows


def compare_next(drv, server, k, swap_tol, report):
    ok = True
    openings = [PREFIX + "El niño", PREFIX + "Ayer fui al mercado y compré", PREFIX + "Me gusta mucho",
                PREFIX + "Cuando llegué a casa, mi madre", PREFIX + "Esa vaina 'tá", PREFIX + "¿Qué es la que",
                PREFIX, ""]
    report("\n## nextTokens vs /next\n")
    report(f"| context | same order (k={k}) | max logprob diff | note |")
    report("|---|---|---|---|")
    for c in openings:
        s = post(server, "/next", {"context": c, "k": k})["tokens"]
        d = drv.ask({"op": "next", "context": c, "k": k})["tokens"]
        st = [t["text"] for t in s]
        dt = [t["text"] for t in d]
        maxd = max(abs(lp(a["logprob"]) - lp(b["logprob"])) for a, b in zip(s, d)) if len(s) == len(d) else math.inf
        note = ""
        same = st == dt
        if not same and sorted(st) == sorted(dt):
            # Allowed: neighbours swapped because their logprobs are nearly equal.
            swaps = [i for i in range(len(st)) if st[i] != dt[i]]
            sd = {t["text"]: lp(t["logprob"]) for t in s}
            close = all(abs(sd[st[i]] - sd[dt[i]]) <= swap_tol for i in swaps)
            note = f"swapped {[st[i] for i in swaps]}" + (" (near tie)" if close else "")
            same = close
        if len(s) == len(d) and same:
            dd = {t["text"]: lp(t["logprob"]) for t in d}
            maxd = max(abs(lp(t["logprob"]) - dd[t["text"]]) for t in s)
        good = same and maxd <= 0.01
        ok &= good
        report(f"| {json.dumps(c[-28:], ensure_ascii=False)} | {'yes' if same else 'NO'} | {maxd:.5f} | {note} |")
    return ok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--driver", required=True)
    ap.add_argument("--model", required=True)
    ap.add_argument("--server", default="http://127.0.0.1:8799")
    ap.add_argument("--threads", type=int, default=2)
    ap.add_argument("--flash-attn", default="off", choices=["off", "on", "auto"])
    ap.add_argument("--k", type=int, default=10)
    ap.add_argument("--tol", type=float, default=0.05)
    ap.add_argument("--swap-tol", type=float, default=1e-3)
    ap.add_argument("--fixture-out")
    args = ap.parse_args()

    health = post(args.server, "/health", {})
    drv = Driver(args.driver, args.model, args.threads, args.flash_attn)
    info = drv.ask({"op": "info"})
    lines = []

    def report(s):
        print(s, flush=True)
        lines.append(s)

    report(f"driver: {drv.banner}")
    report(f"server: {health['model']}, start token {health['start_token']}; driver start token {info['start_tokens']}")
    ok = health["start_token"] == info["start_tokens"]
    s_ok, fixture, _ = compare_scores(drv, args.server, args.tol, report)
    n_ok = compare_next(drv, args.server, args.k, args.swap_tol, report)
    drv.close()
    ok = ok and s_ok and n_ok
    if args.fixture_out:
        Path(args.fixture_out).write_text(json.dumps({
            "about": "Generated by app/native-tests/scoring/compare.py: raw per-token output of the "
                     "llama.rn scoring patch's native core (Qwen3-1.7B-Q4_K_M, byte offsets into the UTF-8 "
                     "of text) and the same tokens merged into whole characters with UTF-16 offsets "
                     "(model_server.py's rule). 'server' is proof/model_server.py's answer.",
            "cases": fixture}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        report(f"\nwrote {len(fixture)} fixture cases to {args.fixture_out}")
    report("\nRESULT: " + ("PASS" if ok else "FAIL"))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
