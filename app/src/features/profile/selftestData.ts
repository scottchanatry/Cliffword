/**
 * Proof sentences for the model self-test (app/profile/selftest.tsx), a small subset of
 * proof/raw_qwen3-1.7b.json with their ids: each pair's two sentences and the total
 * log-probability (natural log) Qwen3-1.7B Q4_K_M gave each one on the Linux proof run
 * (llama-cpp-python, flash attention off) after the context SELF_TEST_CONTEXT. The totals are
 * that file's "neutral" condition: pairs[].neutral.c / .i and slang[].neutral.neutral / .street.
 *
 * `good` is the sentence the model should prefer (the correct one; for the slang pair the
 * neutral paraphrase, since street Spanish scores lower by design, see proof/RESULTS.md).
 * Sentences are target-language content (data), not interface text.
 */

/** The context every proof sentence was scored after (proof/score.py NEUTRAL_PREFIX). */
export const SELF_TEST_CONTEXT = 'Frase en español:\n';

/** Largest difference from the proof total, in nats, that still passes. */
export const SELF_TEST_TOLERANCE = 0.15;

/** The model the expected totals were measured with (ModelInfo.id of the device model). */
export const SELF_TEST_MODEL_ID = 'qwen3-1.7b-q4_k_m';

export interface SelfTestPair {
  /** Where it comes from in proof/raw_qwen3-1.7b.json ("pairs#11", "slang#2"). */
  id: string;
  /** The proof's rule tag. */
  rule: string;
  good: string;
  goodTotal: number;
  bad: string;
  badTotal: number;
}

export const SELF_TEST_PAIRS: readonly SelfTestPair[] = [
  { id: 'pairs#1', rule: 'ser_estar', good: "Mi hermano está enfermo hoy.", goodTotal: -22.1896, bad: "Mi hermano es enfermo hoy.", badTotal: -29.3836 },
  { id: 'pairs#11', rule: 'por_para', good: "Gracias por tu ayuda.", goodTotal: -12.4105, bad: "Gracias para tu ayuda.", badTotal: -21.5493 },
  { id: 'pairs#21', rule: 'gender', good: "La casa blanca es grande.", goodTotal: -27.0673, bad: "La casa blanco es grande.", badTotal: -33.7755 },
  { id: 'pairs#31', rule: 'number', good: "Los niños juegan en el parque.", goodTotal: -15.4902, bad: "Los niños juega en el parque.", badTotal: -25.6190 },
  { id: 'pairs#51', rule: 'subjunctive_wish', good: "Quiero que vengas a mi fiesta.", goodTotal: -21.8254, bad: "Quiero que vienes a mi fiesta.", badTotal: -26.9480 },
  { id: 'pairs#83', rule: 'pronoun_placement', good: "Lo compré ayer.", goodTotal: -19.9754, bad: "Compré lo ayer.", badTotal: -32.5661 },
  { id: 'slang#2', rule: 'street_vs_neutral', good: "Vamos a salir con los amigos esta noche.", goodTotal: -23.1501, bad: "Vamo' a janguear con el corillo esta noche.", badTotal: -74.7129 },
];
