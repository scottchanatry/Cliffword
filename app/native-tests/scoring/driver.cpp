// Linux test driver for the Cliffword scoring core of the llama.rn patch
// (node_modules/llama.rn/cpp/jsi/CliffwordScore.cpp, from patches/llama.rn+0.13.0-rc.11.patch).
//
// Loads a GGUF with plain llama.cpp (vendor/llama.cpp of the installed llama.rn) and answers
// one JSON request per stdin line with one JSON line on stdout:
//   {"op":"score","context":"...","text":"..."}
//     -> {"tokens":[{"id","byte_start","byte_end","logprob","piece_hex"}],
//         "prefix_tokens","reused_tokens","evaluated_tokens"}
//   {"op":"next","context":"...","k":10}
//     -> {"tokens":[{"id","text","logprob"}], ...}
//   {"op":"reset"}   clears the memory (fresh evaluation for the next request)
//   {"op":"info"}    -> {"start_tokens":[...],"n_vocab","n_ctx"}
// Arguments: MODEL.gguf [threads=2] [n_ctx=2048] [n_batch=512] [flash_attn=off|on|auto].
// A logprob of -inf comes back as null. Errors come back as {"error":"..."}.
// Prints "ready" on stderr once the model is loaded. See README.md and compare.py.
#include "CliffwordScore.h"
#include "llama.h"
#include "nlohmann/json.hpp"

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <iostream>
#include <string>

using json = nlohmann::ordered_json;

static std::string hex(const std::string & bytes) {
    static const char * digits = "0123456789abcdef";
    std::string out;
    for (unsigned char c : bytes) {
        out += digits[c >> 4];
        out += digits[c & 15];
    }
    return out;
}

static json num_or_null(double x) {
    return std::isfinite(x) ? json(x) : json(nullptr);
}

int main(int argc, char ** argv) {
    if (argc < 2) {
        std::fprintf(stderr, "usage: %s MODEL.gguf [threads] [n_ctx] [n_batch] [flash_attn: off|on|auto]\n", argv[0]);
        return 2;
    }
    const int threads = argc > 2 ? std::atoi(argv[2]) : 2;
    const int n_ctx = argc > 3 ? std::atoi(argv[3]) : 2048;
    const int n_batch = argc > 4 ? std::atoi(argv[4]) : 512;
    // proof/model_server.py runs llama-cpp-python's default, flash attention off; llama.cpp's
    // own default (and llama.rn's) is auto, which turns it on for the CPU backend.
    const std::string fa = argc > 5 ? argv[5] : "off";

    llama_log_set([](ggml_log_level level, const char * text, void *) {
        if (level >= GGML_LOG_LEVEL_ERROR) std::fputs(text, stderr);
    }, nullptr);
    llama_backend_init();

    llama_model_params mp = llama_model_default_params();
    mp.n_gpu_layers = 0;
    llama_model * model = llama_model_load_from_file(argv[1], mp);
    if (model == nullptr) {
        std::fprintf(stderr, "cannot load %s\n", argv[1]);
        return 1;
    }
    // The settings the app's adapter passes to initLlama (n_ctx 2048, n_batch 512, one sequence).
    llama_context_params cp = llama_context_default_params();
    cp.n_ctx = (uint32_t) n_ctx;
    cp.n_batch = (uint32_t) n_batch;
    cp.n_ubatch = (uint32_t) n_batch;
    cp.n_seq_max = 1;
    cp.n_threads = threads;
    cp.n_threads_batch = threads;
    cp.flash_attn_type = fa == "on" ? LLAMA_FLASH_ATTN_TYPE_ENABLED
                       : fa == "auto" ? LLAMA_FLASH_ATTN_TYPE_AUTO : LLAMA_FLASH_ATTN_TYPE_DISABLED;
    llama_context * ctx = llama_init_from_model(model, cp);
    if (ctx == nullptr) {
        std::fprintf(stderr, "cannot create a context\n");
        return 1;
    }
    const llama_vocab * vocab = llama_model_get_vocab(model);
    cliffword::EvalState state;
    std::fprintf(stderr, "ready (flash_attn %s; %s)\n", fa.c_str(), llama_print_system_info());

    std::string line;
    while (std::getline(std::cin, line)) {
        if (line.empty()) continue;
        json res;
        try {
            const json req = json::parse(line);
            const std::string op = req.value("op", "");
            if (op == "score") {
                const auto toks = cliffword::score_text(ctx, state, req.value("context", ""), req.at("text").get<std::string>());
                const std::string text = req.at("text").get<std::string>();
                json arr = json::array();
                for (const auto & t : toks) {
                    arr.push_back({{"id", t.id}, {"byte_start", t.byte_start}, {"byte_end", t.byte_end},
                                   {"logprob", num_or_null(t.logprob)},
                                   {"piece_hex", hex(text.substr(t.byte_start, t.byte_end - t.byte_start))}});
                }
                res["tokens"] = arr;
            } else if (op == "next") {
                const auto toks = cliffword::next_tokens(ctx, state, req.value("context", ""), req.at("k").get<int>());
                json arr = json::array();
                for (const auto & t : toks) {
                    arr.push_back({{"id", t.id}, {"text", t.piece}, {"logprob", num_or_null(t.logprob)}});
                }
                res["tokens"] = arr;
            } else if (op == "reset") {
                llama_memory_clear(llama_get_memory(ctx), false);
                state = cliffword::EvalState{};
                res["ok"] = true;
            } else if (op == "info") {
                res["start_tokens"] = cliffword::start_tokens(vocab);
                res["n_vocab"] = llama_vocab_n_tokens(vocab);
                res["n_ctx"] = llama_n_ctx_seq(ctx);
            } else {
                res["error"] = "unknown op " + op;
            }
            if (op == "score" || op == "next") {
                const auto st = cliffword::last_eval_stats();
                res["prefix_tokens"] = st.prefix_tokens;
                res["reused_tokens"] = st.reused_tokens;
                res["evaluated_tokens"] = st.evaluated_tokens;
            }
        } catch (const std::exception & e) {
            res = json{{"error", e.what()}};
        }
        std::cout << res.dump(-1, ' ', false, json::error_handler_t::replace) << "\n" << std::flush;
    }

    llama_free(ctx);
    llama_model_free(model);
    llama_backend_free();
    return 0;
}
