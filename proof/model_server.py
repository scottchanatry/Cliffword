"""Cliffword model server: a real GGUF model behind the engine's LanguageModel contract.

Usage:
    python model_server.py --model PATH.gguf [--port 8765] [--threads 4] [--ctx 2048]

The engine's HttpLanguageModel (engine/src/model/http.ts) talks to this server; the
real-model tests (engine/test/real-model.test.ts, `npm run test:real`) use it to run
the engine against the recommended model, Qwen3-1.7B Q4_K_M. See
engine/scripts/real-model.md.

Scoring follows proof/score.py exactly, so totals match proof/raw_*.json:
- start token: BOS when the model has one, else llama.cpp's end-of-text token
  (`token_eos()`; for the Qwen3 GGUFs that is <|im_end|>, id 151645, which is what the
  proof used even though its comment says <|endoftext|>);
- the context and the text are tokenized separately (no special tokens, no BOS) and
  scored as one sequence: start + context tokens + text tokens;
- logits_all=True and a natural-log softmax over the raw logits (no temperature);
- plain continuation, no chat template.
The KV cache of a prefix shared with the previous request is reused, and every
evaluation covers at least two tokens: in this llama.cpp build a one-token batch takes
another kernel path and moved logprobs by up to 0.28 nats (see ModelServer.logits),
while larger batches reproduce the proof's numbers bit for bit.

Endpoints (POST, JSON in and out; /health also answers GET):
- /score {context, text} -> {tokens: [{text, start, end, logprob}]}
    One entry per token of `text`. Byte tokens that do not end on a UTF-8 character
    boundary are merged with the following token(s) and their logprobs summed, so each
    entry covers whole characters and the texts concatenate exactly to `text`, leading
    spaces included (" ñandú" comes back as " ñ", "and", "ú"). start/end are UTF-16
    code-unit offsets, i.e. JavaScript string indices, so the engine can slice with them.
- /next {context, k} -> {tokens: [{text, logprob}]}
    The k most likely next tokens after start + context (raw softmax), most likely
    first. A token that is only part of a UTF-8 character (a lone byte such as b"\\xc3")
    is skipped and does not count towards k: the engine merges sub-word pieces as text,
    and a replacement character would be a fake word piece. Its probability is not
    lost for scoring: /score merges it into the character it starts.
- /generate {prompt, n, maxTokens, temperature, stop?, seed?, topK?, topP?, minP?}
    -> {texts: [...]}. Completion i samples with seed + i (numpy PCG64), so a request
    is reproducible. Each text excludes the prompt and is cut before the first stop
    string; generation also ends at an end-of-generation token or after maxTokens.
- /health -> {ok, model, n_vocab, n_ctx, start_token}

Prints "listening on PORT" once the model is loaded and the socket is bound.
Errors come back as JSON {error} with status 400 (bad request) or 500 (server fault).
The server handles one request at a time (the model is not thread-safe), and closes the
connection after each response (HTTP/1.0), so a client keeping a connection open
cannot block other clients.
"""
import argparse
import json
import math
import sys
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import numpy as np
from llama_cpp import Llama
import llama_cpp

# Sampling defaults for /generate. These are llama.cpp's common sampler defaults, which
# llama.rn also uses on device, so story candidates generated here look like the ones
# the app will see. As in llama.cpp, top-k, top-p and min-p filter the untempered
# distribution and the temperature is applied last.
DEFAULT_TOP_K = 40      # llama.cpp default: keep the 40 most likely tokens
DEFAULT_TOP_P = 0.95    # llama.cpp default: then the smallest set holding 95% of the mass
DEFAULT_MIN_P = 0.05    # llama.cpp default: then tokens at least 5% as likely as the best

# Smallest evaluation batch (see ModelServer.logits): a one-token batch takes another
# llama.cpp kernel path and gives different logprobs; two or more match a full batch.
MIN_BATCH = 2

# Request limits: generous for engine use, small enough that a bad request cannot pin
# the server for minutes. The engine samples at most 8 candidates of about 60 tokens.
MAX_N = 64
MAX_K = 1000


class BadRequest(Exception):
    """A client error, answered with status 400."""


def utf16_len(s):
    return len(s.encode("utf-16-le")) // 2


def is_complete_utf8(b):
    try:
        b.decode("utf-8")
        return True
    except UnicodeDecodeError:
        return False


def decode_prefix(b):
    """Decode bytes, dropping an incomplete UTF-8 sequence at the end (at most 3 bytes)."""
    for cut in range(0, 4):
        if cut > len(b):
            break
        try:
            return b[: len(b) - cut].decode("utf-8")
        except UnicodeDecodeError:
            continue
    return b.decode("utf-8", errors="replace")


def finite_or_none(x):
    """JSON has no -Infinity; the client maps null back to -Infinity."""
    return float(x) if math.isfinite(x) else None


def log_softmax_at(rows, ids):
    """log softmax(rows[i])[ids[i]] for each row, in float64."""
    r = rows.astype(np.float64)
    m = r.max(axis=1, keepdims=True)
    lse = (m + np.log(np.exp(r - m).sum(axis=1, keepdims=True)))[:, 0]
    return r[np.arange(len(ids)), ids] - lse


class ModelServer:
    def __init__(self, model_path, threads, ctx):
        self.path = model_path
        self.llm = Llama(model_path=model_path, n_ctx=ctx, n_threads=threads, n_batch=512,
                         logits_all=True, verbose=False)
        self.n_ctx = ctx
        self.n_vocab = self.llm.n_vocab()
        # Same start token as proof/score.py.
        self.start = self.llm.tokenize(b"", add_bos=True, special=False) or [self.llm.token_eos()]
        vocab = llama_cpp.llama_model_get_vocab(self.llm._model.model)
        self.eog = {i for i in range(self.n_vocab) if llama_cpp.llama_vocab_is_eog(vocab, i)}
        self._pieces = {}
        # Positions below this were computed in batches of at least MIN_BATCH tokens.
        self.clean = 0

    # ---------- tokens ----------

    def tokenize(self, s):
        if not s:
            return []
        return self.llm.tokenize(s.encode("utf-8"), add_bos=False, special=False)

    def piece(self, t):
        p = self._pieces.get(t)
        if p is None:
            p = self.llm.detokenize([t])
            self._pieces[t] = p
        return p

    # ---------- evaluation with prefix reuse ----------

    def logits(self, tokens):
        """Logit rows for every position of `tokens` (row i predicts token i + 1).

        Reuses the KV cache for the longest prefix shared with the previous request
        (llama-cpp-python keeps input_ids and, with logits_all, every row of scores),
        so scoring many sentences after the same context evaluates the context once.

        Every evaluation covers at least MIN_BATCH tokens, and only positions computed in
        such batches are reused. In this llama.cpp build a one-token batch takes another
        CPU kernel path: scoring a sentence one token at a time moved single tokens by up
        to 0.28 nats and the sentence total by 0.52 nats, while batches of 2, 3, 4, 5 or 8
        tokens gave results bit-identical to the proof's single full batch. So the
        cached split never changes a score, and repeated requests answer identically
        whatever came before them.
        """
        if len(tokens) > self.n_ctx:
            raise BadRequest(f"{len(tokens)} tokens do not fit the context of {self.n_ctx} "
                             f"(restart the server with a larger --ctx)")
        llm = self.llm
        lim = min(llm.n_tokens, self.clean, len(tokens))
        common = 0
        if lim:
            diff = np.nonzero(np.asarray(tokens[:lim], dtype=np.int64)
                              != llm.input_ids[:lim].astype(np.int64))[0]
            common = int(diff[0]) if len(diff) else lim
        if common < len(tokens):
            common = max(0, min(common, len(tokens) - MIN_BATCH))
            llm.n_tokens = common
            llm.eval(tokens[common:])
            # A one-token request (start token only) cannot be batched: do not reuse it.
            self.clean = len(tokens) if len(tokens) - common >= MIN_BATCH else common
        else:
            llm.n_tokens = len(tokens)
            self.clean = min(self.clean, len(tokens))
        return llm.scores[: len(tokens)]

    # ---------- endpoints ----------

    def score(self, context, text):
        if not text:
            return {"tokens": []}
        prefix = self.start + self.tokenize(context)
        toks = self.tokenize(text)
        allt = prefix + toks
        rows = self.logits(allt)[len(prefix) - 1: len(allt) - 1]
        lps = log_softmax_at(rows, np.asarray(toks))
        out, buf, acc = [], b"", 0.0
        pos = 0
        for t, lp in zip(toks, lps):
            buf += self.piece(t)
            acc += float(lp)
            if not is_complete_utf8(buf):
                continue  # this byte token ends inside a character: merge with the next
            s = buf.decode("utf-8")
            n = utf16_len(s)
            out.append({"text": s, "start": pos, "end": pos + n, "logprob": finite_or_none(acc)})
            pos += n
            buf, acc = b"", 0.0
        if buf:
            raise RuntimeError(f"tokens of {text!r} end inside a UTF-8 character")
        joined = "".join(o["text"] for o in out)
        if joined != text:
            raise RuntimeError(f"token texts {joined!r} do not concatenate to {text!r}")
        return {"tokens": out}

    def next(self, context, k):
        if k <= 0:
            return {"tokens": []}
        tokens = self.start + self.tokenize(context)
        row = self.logits(tokens)[-1].astype(np.float64)
        m = row.max()
        lsm = row - (m + math.log(np.exp(row - m).sum()))
        out = []
        width = min(self.n_vocab, 2 * k + 16)
        while True:
            idx = np.argpartition(-lsm, width - 1)[:width]
            idx = idx[np.argsort(-lsm[idx], kind="stable")]
            out = []
            for t in idx:
                b = self.piece(int(t))
                if not b or not is_complete_utf8(b):
                    continue  # partial UTF-8 byte or empty control-token piece: skip
                out.append({"text": b.decode("utf-8"), "logprob": finite_or_none(lsm[t])})
                if len(out) == k:
                    break
            if len(out) == k or width == self.n_vocab:
                break
            width = min(self.n_vocab, width * 4)
        return {"tokens": out}

    def generate(self, prompt, n, max_tokens, temperature, stop, seed, top_k, top_p, min_p):
        llm = self.llm
        tokens = self.start + self.tokenize(prompt)
        if len(tokens) >= self.n_ctx:
            raise BadRequest(f"prompt of {len(tokens)} tokens does not fit the context of {self.n_ctx}")
        # Evaluate the prompt through logits(): the longest prefix shared with the previous
        # request is reused from the KV cache and the rest is evaluated in batches of at
        # least MIN_BATCH tokens, which give bit-identical rows (see logits()), so identical
        # requests still give identical texts whatever came before. Story generation sends
        # rounds that differ only in the last line (engine/src/story/next.ts), and llama.rn
        # reuses a matching prompt prefix the same way.
        self.logits(tokens)
        base = len(tokens)
        # Generated tokens are evaluated one at a time; only the prompt may be reused.
        self.clean = min(self.clean, base) if base >= MIN_BATCH else 0
        texts = []
        for i in range(n):
            llm.n_tokens = base  # drop the previous completion; eval() trims the KV cache
            rng = np.random.default_rng(seed + i)
            row = llm.scores[base - 1]
            out = b""
            text = ""
            for _ in range(max_tokens):
                t = sample(row, temperature, rng, top_k, top_p, min_p)
                if t in self.eog:
                    break
                out += self.piece(t)
                text = decode_prefix(out)
                cuts = [text.find(s) for s in stop if s and s in text]
                if cuts:
                    text = text[: min(cuts)]
                    break
                if llm.n_tokens >= self.n_ctx:
                    break
                llm.eval([t])
                row = llm.scores[llm.n_tokens - 1]
            texts.append(text)
        return {"texts": texts}

    def health(self):
        return {"ok": True, "model": Path(self.path).name, "n_vocab": self.n_vocab,
                "n_ctx": self.n_ctx, "start_token": self.start}


def sample(row, temperature, rng, top_k, top_p, min_p):
    """One token from a logit row: greedy at temperature 0, else llama.cpp's default chain."""
    logits = row.astype(np.float64)
    if temperature <= 0:
        return int(np.argmax(logits))
    k = len(logits) if top_k <= 0 else min(top_k, len(logits))
    idx = np.argpartition(-logits, k - 1)[:k]
    idx = idx[np.argsort(-logits[idx], kind="stable")]
    lg = logits[idx]
    p = np.exp(lg - lg[0])
    p /= p.sum()
    if top_p < 1.0:
        keep = int(np.searchsorted(np.cumsum(p), top_p) + 1)
        idx, lg, p = idx[:keep], lg[:keep], p[:keep]
    if min_p > 0.0:
        keep = p >= min_p * p[0]
        idx, lg = idx[keep], lg[keep]
    q = np.exp((lg - lg[0]) / temperature)
    q /= q.sum()
    r = rng.random()
    j = int(np.searchsorted(np.cumsum(q), r, side="right"))
    return int(idx[min(j, len(idx) - 1)])


# ---------- request parsing ----------

def need_str(body, key, default=None):
    v = body.get(key, default)
    if not isinstance(v, str):
        raise BadRequest(f"'{key}' must be a string")
    return v


def need_int(body, key, default=None, lo=None, hi=None):
    v = body.get(key, default)
    if isinstance(v, bool) or not isinstance(v, int):
        raise BadRequest(f"'{key}' must be an integer")
    if (lo is not None and v < lo) or (hi is not None and v > hi):
        raise BadRequest(f"'{key}' must be between {lo} and {hi}")
    return v


def need_num(body, key, default=None, lo=None, hi=None):
    v = body.get(key, default)
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        raise BadRequest(f"'{key}' must be a finite number")
    if (lo is not None and v < lo) or (hi is not None and v > hi):
        raise BadRequest(f"'{key}' must be between {lo} and {hi}")
    return float(v)


def make_handler(server):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.0"

        def log_message(self, fmt, *args):  # quiet: one line per request on stderr
            sys.stderr.write("%s %s\n" % (self.command, self.path))

        def reply(self, status, obj):
            data = json.dumps(obj, ensure_ascii=False, allow_nan=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            if self.path == "/health":
                self.reply(200, server.health())
            else:
                self.reply(404, {"error": f"unknown path {self.path}"})

        def do_POST(self):
            try:
                n = int(self.headers.get("Content-Length") or 0)
                raw = self.rfile.read(n) if n else b"{}"
                try:
                    body = json.loads(raw.decode("utf-8"))
                except (UnicodeDecodeError, json.JSONDecodeError) as e:
                    raise BadRequest(f"body is not JSON: {e}")
                if not isinstance(body, dict):
                    raise BadRequest("body must be a JSON object")
                if self.path == "/score":
                    res = server.score(need_str(body, "context", ""), need_str(body, "text"))
                elif self.path == "/next":
                    res = server.next(need_str(body, "context", ""), need_int(body, "k", lo=0, hi=MAX_K))
                elif self.path == "/generate":
                    stop = body.get("stop") or []
                    if not isinstance(stop, list) or not all(isinstance(s, str) for s in stop):
                        raise BadRequest("'stop' must be a list of strings")
                    seed = body.get("seed")
                    res = server.generate(
                        need_str(body, "prompt", ""),
                        need_int(body, "n", lo=1, hi=MAX_N),
                        need_int(body, "maxTokens", lo=0, hi=server.n_ctx),
                        need_num(body, "temperature", lo=0.0),
                        stop,
                        1 if seed is None else need_int(body, "seed"),
                        need_int(body, "topK", DEFAULT_TOP_K, lo=0),
                        need_num(body, "topP", DEFAULT_TOP_P, lo=0.0, hi=1.0),
                        need_num(body, "minP", DEFAULT_MIN_P, lo=0.0, hi=1.0),
                    )
                elif self.path == "/health":
                    res = server.health()
                else:
                    self.reply(404, {"error": f"unknown path {self.path}"})
                    return
                self.reply(200, res)
            except BadRequest as e:
                self.reply(400, {"error": str(e)})
            except Exception as e:  # noqa: BLE001 - report every server fault as JSON
                self.reply(500, {"error": f"{type(e).__name__}: {e}"})

    return Handler


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--model", required=True, help="path to a GGUF file")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--threads", type=int, default=4)
    ap.add_argument("--ctx", type=int, default=2048)
    args = ap.parse_args()
    t0 = time.time()
    server = ModelServer(args.model, args.threads, args.ctx)
    httpd = HTTPServer((args.host, args.port), make_handler(server))
    print(f"model {Path(args.model).name} loaded in {time.time() - t0:.1f} s", flush=True)
    print(f"listening on {args.port}", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
