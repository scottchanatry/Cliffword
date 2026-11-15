/**
 * Plain-English explanations shown with a correction, keyed by CorrectionRule.explainKey.
 * The model only scores variants; the winning rule's key picks the explanation here.
 * One or two sentences each, with an example.
 */

/** Every explanation key the Spanish correction rules use. */
export const EXPLANATION_KEYS = [
  'es.ser_estar',
  'es.por_para',
  'es.gender',
  'es.number',
  'es.aspect',
  'es.mood',
  'es.personal_a',
  'es.article',
  'es.pronoun_placement',
  'es.negative_command',
  'es.pronoun_order',
  'es.se_lo',
] as const;

export type ExplanationKey = (typeof EXPLANATION_KEYS)[number];

export const EXPLANATIONS: Readonly<Record<ExplanationKey, string>> = {
  'es.ser_estar':
    'Use ser for what something is (who, what, where from, what it is like) and estar for where it is or how it is right now. Soy de Puerto Rico, pero hoy estoy cansado.',
  'es.por_para':
    'Para points to a goal or a receiver (for whom, in order to); por gives the cause, the route or the exchange (because of, through, in return for). Es para ti, y gracias por todo.',
  'es.gender':
    'Every noun is masculine or feminine, and the words around it match: el and -o for masculine, la and -a for feminine. La casa blanca, el coche rojo.',
  'es.number':
    'If the noun is plural, its article and adjectives are plural too. Las flores amarillas, not las flor amarilla.',
  'es.aspect':
    'Use the preterite for a finished event and the imperfect for background, habits or what was going on. Ayer fui a la playa; de niño iba todos los días.',
  'es.mood':
    'After wanting, hoping, asking or feeling something about what someone else does, the next verb goes in the subjunctive. Quiero que vengas; espero que estés bien.',
  'es.personal_a':
    'Put a before a direct object that is a specific person or a pet. Veo a mi madre, but veo la casa.',
  'es.article':
    'Spanish uses el or la where English often has no article, as with likes and things in general (me gusta el café), but leaves out un or una before a job after ser (soy profesor).',
  'es.pronoun_placement':
    'Object pronouns like me, te, lo and se go right before a conjugated verb, but join the end of an infinitive, a gerund or a positive command. Lo compré, but quiero comprarlo.',
  'es.negative_command':
    'A command with no uses the subjunctive form, and its pronoun goes before the verb instead of on the end. No lo hagas.',
  'es.pronoun_order':
    'With two object pronouns, se comes first and lo, la, los or las come last, with me, te or nos in between. Te lo digo.',
  'es.se_lo':
    'Le and les change to se right before lo, la, los or las. Se lo di a mi hermana.',
};
