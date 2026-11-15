/**
 * The model the app ships for: Qwen3-1.7B, Q4_K_M (chosen by the proof test, proof/RESULTS.md).
 *
 * The URL is pinned to a commit of unsloth/Qwen3-1.7B-GGUF, so the bytes behind it cannot change.
 * bytes and sha256 were computed from the file the proof test used
 * (sha256sum /home/user/models/Qwen3-1.7B-Q4_K_M.gguf, 2026-11-15) and match Hugging Face's
 * x-linked-size and x-linked-etag headers for this URL.
 */
import type { ModelDescriptor } from './types';

export const QWEN3_1_7B_Q4_K_M: ModelDescriptor = {
  id: 'qwen3-1.7b-q4_k_m',
  url: 'https://huggingface.co/unsloth/Qwen3-1.7B-GGUF/resolve/d7f544eead698dbd1f15126ef60b45a1e1933222/Qwen3-1.7B-Q4_K_M.gguf',
  fileName: 'Qwen3-1.7B-Q4_K_M.gguf',
  bytes: 1107409472,
  sha256: 'b139949c5bd74937ad8ed8c8cf3d9ffb1e99c866c823204dc42c0d91fa181897',
};

/** The model ModelManager downloads unless told otherwise. */
export const DEFAULT_MODEL: ModelDescriptor = QWEN3_1_7B_Q4_K_M;

/**
 * Free space a model download keeps beyond the bytes it still has to fetch (docs/OUTLINE.md,
 * flow F: size + 600 MB), so the phone is not left full. ExpoModelManager refuses to start below
 * it ('insufficient-storage'); the messages quote it.
 */
export const FREE_SPACE_MARGIN_BYTES = 600_000_000;
