/**
 * Spanish correction rules (data, not code).
 *
 * The corrections module turns each rule into variants of the learner's sentence and
 * lets the language model score them; the rule that produced a clearly more probable
 * variant supplies the explanation (PairPack.explanations[explainKey]). Nothing here
 * decides whether a sentence is wrong: rules only propose alternatives.
 *
 * Matching in swap and delete rules uses normalized forms (LanguagePack.normalize), so
 * accents are significant: "esta" (this) is not "está" (is) and is never swapped with
 * "es". Surface forms below are written lowercase with their accents.
 *
 * Object pronoun placement is covered by move rules (lo compré, quiero verte, no lo hagas)
 * and their order and the le -> se change by a move rule and a swap; see the clitic
 * section below.
 *
 * Contractions (a + el = al, de + el = del) are a contract rule: it joins "a el", and the
 * variant generator writes inserts contracted ("Voy a cine" -> "al cine", "Veo el niño"
 * -> "al niño") and lets the personal-a delete take the "a" out of "al" ("Leo al
 * periódico" -> "el periódico").
 *
 * Out of scope:
 * - Voseo ("sos" for ser) is left out because its estar partner "estás" is already the
 *   tú form; one form may appear only once per rule.
 * - Imperatives ("sé", "está") are left out of ser/estar: "sé" is also "I know" and
 *   "está" is already the indicative third person.
 * - Clitic placement does not handle clitic climbing past two verbs ("Quiero poder lo
 *   hacer"), le/les attached in front of an attached lo ("dálelo"), or slang verbs with
 *   attached pronouns.
 * - Subject-verb agreement looks only at a subject right before the verb (through no,
 *   pronouns and adverbs) or, for gustar-type verbs, a noun right after it; a subject
 *   after other verbs, or coordinated subjects, are left alone.
 */
import type { AgreeRule, ContractRule, CorrectionRule, DeleteRule, InflectRule, InsertRule, MoveRule, Pos, SwapRule } from '../types';

/** Every explainKey the Spanish rules may use. PairPacks for Spanish must define each. */
export const SPANISH_EXPLAIN_KEYS = [
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
  'es.verb_agreement',
  'es.contraction',
  'es.body_article',
  'es.pronoun_double',
] as const;

export type SpanishExplainKey = (typeof SPANISH_EXPLAIN_KEYS)[number];

/** One cell of the ser/estar paradigm: the two verbs in the same person, number, tense and mood. */
export interface SerEstarCell {
  mood: 'ind' | 'sub';
  /** "impf-se" marks the -se imperfect subjunctive, a second set of forms for "impf". */
  tense: 'pres' | 'pret' | 'impf' | 'fut' | 'cond' | 'impf-se';
  person: '1' | '2' | '3';
  number: 's' | 'p';
  ser: string;
  estar: string;
}

/** Six paradigm cells for one tense and mood, forms given in the order 1s, 2s, 3s, 1p, 2p, 3p. */
function cells(
  mood: SerEstarCell['mood'],
  tense: SerEstarCell['tense'],
  ser: readonly [string, string, string, string, string, string],
  estar: readonly [string, string, string, string, string, string],
): SerEstarCell[] {
  const slots: Array<Pick<SerEstarCell, 'person' | 'number'>> = [
    { person: '1', number: 's' },
    { person: '2', number: 's' },
    { person: '3', number: 's' },
    { person: '1', number: 'p' },
    { person: '2', number: 'p' },
    { person: '3', number: 'p' },
  ];
  return slots.map((slot, i) => ({ mood, tense, ...slot, ser: ser[i] as string, estar: estar[i] as string }));
}

/**
 * The full ser/estar paradigm, written out person by person (yo, tú, él/ella/usted,
 * nosotros, vosotros, ellos/ellas/ustedes). Several cells share a form (era is both
 * first and third person singular); the swap groups below keep each pair once.
 *
 * Preterite note: ser and ir share every preterite form (fui = "I was" and "I went"),
 * and the imperfect subjunctive too (fuera, fuese). A variant such as "Estuve a la
 * playa" from "Fui a la playa" is therefore proposed, and the model is expected to
 * reject it. "fuera" is also the adverb "outside"; the same applies.
 */
export const SER_ESTAR_PARADIGM: readonly SerEstarCell[] = [
  ...cells('ind', 'pres',
    ['soy', 'eres', 'es', 'somos', 'sois', 'son'],
    ['estoy', 'estás', 'está', 'estamos', 'estáis', 'están']),
  ...cells('ind', 'pret',
    ['fui', 'fuiste', 'fue', 'fuimos', 'fuisteis', 'fueron'],
    ['estuve', 'estuviste', 'estuvo', 'estuvimos', 'estuvisteis', 'estuvieron']),
  ...cells('ind', 'impf',
    ['era', 'eras', 'era', 'éramos', 'erais', 'eran'],
    ['estaba', 'estabas', 'estaba', 'estábamos', 'estabais', 'estaban']),
  ...cells('ind', 'fut',
    ['seré', 'serás', 'será', 'seremos', 'seréis', 'serán'],
    ['estaré', 'estarás', 'estará', 'estaremos', 'estaréis', 'estarán']),
  ...cells('ind', 'cond',
    ['sería', 'serías', 'sería', 'seríamos', 'seríais', 'serían'],
    ['estaría', 'estarías', 'estaría', 'estaríamos', 'estaríais', 'estarían']),
  ...cells('sub', 'pres',
    ['sea', 'seas', 'sea', 'seamos', 'seáis', 'sean'],
    ['esté', 'estés', 'esté', 'estemos', 'estéis', 'estén']),
  ...cells('sub', 'impf',
    ['fuera', 'fueras', 'fuera', 'fuéramos', 'fuerais', 'fueran'],
    ['estuviera', 'estuvieras', 'estuviera', 'estuviéramos', 'estuvierais', 'estuvieran']),
  ...cells('sub', 'impf-se',
    ['fuese', 'fueses', 'fuese', 'fuésemos', 'fueseis', 'fuesen'],
    ['estuviese', 'estuvieses', 'estuviese', 'estuviésemos', 'estuvieseis', 'estuviesen']),
];

/**
 * Non-finite pairs: infinitive, gerund, past participle. "ser" is also a noun
 * (un ser humano) and "estado" a noun (el estado); the model sorts those out.
 */
export const SER_ESTAR_NONFINITE: readonly (readonly [string, string])[] = [
  ['ser', 'estar'],
  ['siendo', 'estando'],
  ['sido', 'estado'],
];

/**
 * Turn the paradigm into aligned swap groups [ser form, estar form], one per distinct
 * pair, in paradigm order, followed by the non-finite pairs.
 */
export function serEstarGroups(): string[][] {
  const seen = new Set<string>();
  const groups: string[][] = [];
  const pairs: Array<readonly [string, string]> = [
    ...SER_ESTAR_PARADIGM.map((c) => [c.ser, c.estar] as const),
    ...SER_ESTAR_NONFINITE,
  ];
  for (const [ser, estar] of pairs) {
    const key = `${ser}|${estar}`;
    if (seen.has(key)) continue;
    seen.add(key);
    groups.push([ser, estar]);
  }
  return groups;
}

/**
 * ser vs estar: swap any form of one verb for the same person, number, tense and mood of
 * the other. Not before a slang predicate (through adverbs: "estuvo bien bacana"): the
 * model cannot score the slang word, and it asserted "Esa fiesta fue bacana" for the
 * correct "estuvo bacana" (both are fine; proof/ENGINE_REAL_MODEL.md).
 */
export const SER_ESTAR_RULE: SwapRule = {
  id: 'es.ser_estar',
  kind: 'swap',
  explainKey: 'es.ser_estar',
  groups: serEstarGroups(),
  notBeforeSlang: true,
  slangThroughPos: ['ADV'],
};

/** por vs para. The clipped "pa'" is a slang entry and is left alone by the generator. */
export const POR_PARA_RULE: SwapRule = {
  id: 'es.por_para',
  kind: 'swap',
  explainKey: 'es.por_para',
  groups: [['por', 'para']],
};

/**
 * Words whose agreement in gender and number the agreement rules never break: a word
 * that agrees with an adjacent noun, determiner or adjective keeps agreeing ("Esas
 * mujeres trabaja" must not become "Esa mujeres trabaja", which the real model asserted
 * at +6.4 nats because the singular verb then agreed with something).
 */
export const AGREEMENT_NEIGHBOUR_POS: readonly Pos[] = ['NOUN', 'DET', 'ADJ'];

/**
 * A determiner is re-inflected only before a word of its noun phrase. Before a verb, la,
 * las, lo, los are object pronouns: "Las compré en el mercado" was asserted as "La compré"
 * (+7.0 nats, number rule) on the real model, and "La invité a cenar" got "El invité".
 */
export const DETERMINER_NEXT_POS: Partial<Record<Pos, Pos[]>> = { DET: ['NOUN', 'ADJ', 'DET', 'NUM', 'PROPN'] };

/** Gender agreement: re-inflect adjectives and determiners as masculine or feminine. */
export const GENDER_RULE: InflectRule = {
  id: 'es.gender',
  kind: 'inflect',
  explainKey: 'es.gender',
  pos: ['ADJ', 'DET'],
  feature: 'gender',
  values: ['m', 'f'],
  keepAgreement: [...AGREEMENT_NEIGHBOUR_POS],
  nextPosFor: DETERMINER_NEXT_POS,
};

/**
 * Number agreement on adjectives, determiners and nouns. Street tolerant: Caribbean
 * speech aspirates or drops final -s ("lo' niño", "las casa"), so in street register a
 * missing plural -s is normal and not marked.
 */
export const NUMBER_RULE: InflectRule = {
  id: 'es.number',
  kind: 'inflect',
  explainKey: 'es.number',
  pos: ['ADJ', 'DET', 'NOUN'],
  feature: 'number',
  values: ['s', 'p'],
  streetTolerant: true,
  keepAgreement: [...AGREEMENT_NEIGHBOUR_POS],
  nextPosFor: DETERMINER_NEXT_POS,
};

/** Subject pronouns: they control the person and number of the verb after them. */
export const SUBJECT_PRONOUNS: readonly string[] = [
  'yo', 'tú', 'él', 'ella', 'usted', 'nosotros', 'nosotras', 'vosotros', 'vosotras', 'ellos', 'ellas', 'ustedes',
];

/**
 * Nouns of time that stand before a verb as adverbials, not subjects: "Los lunes trabajo
 * en casa", "Esta noche salimos", "Todos los días como fruta".
 */
export const TIME_NOUNS: readonly string[] = [
  'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo', 'día', 'semana', 'mes', 'año',
  'noche', 'mañana', 'tarde', 'vez', 'fin', 'verano', 'invierno', 'otoño', 'primavera', 'hora', 'minuto',
  'momento', 'rato', 'siglo',
];

/** Words that join coordinated subjects ("mi madre y mi padre trabajan", "tú y yo vamos"). */
export const COORDINATORS: readonly string[] = ['y', 'e', 'o', 'u', 'ni'];

/**
 * Verbs whose subject is the thing liked, hurting or missing, after the verb: me gustan
 * las manzanas, me duelen los pies, nos falta tiempo. Lemmas of the lexicon only
 * (fascinar, sobrar and apetecer are not in it yet).
 */
export const GUSTAR_VERBS: readonly string[] = [
  'gustar', 'encantar', 'doler', 'faltar', 'importar', 'interesar', 'molestar', 'preocupar', 'quedar',
];

/** Indirect object pronouns that come before a gustar-type verb. */
export const INDIRECT_PRONOUNS: readonly string[] = ['me', 'te', 'le', 'nos', 'os', 'les'];

/**
 * Subject-verb agreement: a finite verb takes the person and number of the subject right
 * before it, looking through no, object pronouns and adverbs ("Los niños juega" ->
 * "juegan", "Nosotros vive" -> "vivimos", "Ellos no lo quiere" -> "quieren"). A noun is
 * third person. The subject does not count after a preposition or a verb ("el libro de
 * los niños está", "cuando llegan los niños empieza la fiesta"), after y/o/ni (a
 * coordinated subject), or when it is a noun of time ("Los lunes trabajo"). Street
 * tolerant, like number agreement: Caribbean speech drops final -s on verbs too ("tú
 * tiene'").
 */
export const VERB_AGREEMENT_RULE: AgreeRule = {
  id: 'es.verb_agreement.subject',
  kind: 'agree',
  explainKey: 'es.verb_agreement',
  pos: ['VERB', 'AUX'],
  forms: ['fin'],
  features: ['person', 'number'],
  defaults: { person: '3' },
  side: 'before',
  throughWords: ['no', 'nunca', 'ya', 'también', 'tampoco', 'siempre', 'me', 'te', 'se', 'nos', 'os', 'lo', 'la', 'los', 'las', 'le', 'les'],
  throughPos: ['ADV'],
  phrasePos: ['DET', 'NUM', 'ADJ'],
  controllerPos: ['NOUN'],
  controllerWords: [...SUBJECT_PRONOUNS],
  notControllerLemmas: [...TIME_NOUNS],
  notAfterPos: ['ADP', 'VERB', 'AUX'],
  notAfterWords: [...COORDINATORS],
  streetTolerant: true,
};

/**
 * Agreement of a gustar-type verb with the noun after it, after an indirect pronoun: "Me
 * gusta las manzanas" -> "gustan", "Me duele los pies" -> "duelen". Not before a
 * coordination ("Me gusta el café y el té"). Street tolerant like the subject rule.
 */
export const VERB_AGREEMENT_GUSTAR_RULE: AgreeRule = {
  id: 'es.verb_agreement.gustar',
  kind: 'agree',
  explainKey: 'es.verb_agreement',
  pos: ['VERB'],
  forms: ['fin'],
  lemmas: [...GUSTAR_VERBS],
  afterWords: [...INDIRECT_PRONOUNS],
  features: ['number'],
  side: 'after',
  throughPos: ['ADV'],
  phrasePos: ['DET', 'NUM', 'ADJ'],
  controllerPos: ['NOUN'],
  notBeforeWords: [...COORDINATORS],
  streetTolerant: true,
};

/** Preterite vs imperfect (comí / comía) on full verbs. */
export const ASPECT_RULE: InflectRule = {
  id: 'es.aspect',
  kind: 'inflect',
  explainKey: 'es.aspect',
  pos: ['VERB'],
  feature: 'tense',
  values: ['pret', 'impf'],
};

/**
 * Words that introduce the clauses where the subjunctive lives: que (quiero que, para
 * que, antes de que, espero que...), ojalá, cuando, aunque, quizá(s), tal (vez), mientras.
 * "si" is left out: "si tienes" must not become "si tengas".
 */
export const SUBJUNCTIVE_CUES: readonly string[] = ['que', 'ojalá', 'cuando', 'aunque', 'quizás', 'quizá', 'tal', 'mientras'];

/**
 * Indicative vs subjunctive (vienes / vengas) on full verbs, keeping tense, person and
 * number. An indicative verb gets a subjunctive variant only after a subjunctive cue
 * earlier in its sentence (quiero que vienes -> vengas), so main verbs are left alone; a
 * subjunctive verb always gets the indicative (creo que vengas -> vienes).
 */
export const MOOD_RULE: InflectRule = {
  id: 'es.mood',
  kind: 'inflect',
  explainKey: 'es.mood',
  pos: ['VERB'],
  feature: 'mood',
  values: ['ind', 'sub'],
  cueWords: [...SUBJUNCTIVE_CUES],
  cueFor: ['ind'],
};

/**
 * Lemmas of nouns for people (and groups of people), the usual objects that take the
 * personal "a": Veo a mi madre, Llamo a mi amigo, Visito a la familia.
 */
export const PERSON_NOUNS: readonly string[] = [
  'madre', 'padre', 'mamá', 'papá', 'hijo', 'hermano', 'abuelo', 'nieto', 'tío', 'primo', 'sobrino',
  'esposo', 'marido', 'mujer', 'novio', 'familia', 'amigo', 'compañero', 'vecino', 'niño', 'chico',
  'muchacho', 'bebé', 'hombre', 'señor', 'persona', 'gente', 'profesor', 'maestro', 'alumno',
  'estudiante', 'médico', 'doctor', 'enfermero', 'abogado', 'jefe', 'director', 'empleado', 'cliente',
  'dueño', 'policía', 'presidente', 'rey', 'reina', 'jugador', 'artista', 'cantante', 'actor',
];

/** Pronouns for people that take the personal "a" as objects: No conozco a nadie. */
export const PERSON_PRONOUNS: readonly string[] = ['nadie', 'alguien'];

/**
 * Personal "a" missing before a person object after a verb: before a proper noun ("Veo
 * Marta" -> "Veo a Marta"; a capitalized word the pack does not know, away from a
 * sentence start, counts as one), before a person noun and its determiners ("Veo mi
 * madre" -> "Veo a mi madre"; before "el" it contracts: "Veo el niño" -> "Veo al niño"),
 * or before nadie and alguien ("No conozco nadie" -> "a nadie"). An adverb may stand
 * between the verb and the "a" ("Quiero mucho mis abuelos" -> "Quiero mucho a mis
 * abuelos"). Not after haber (hay is AUX: "No hay nadie").
 */
export const PERSONAL_A_INSERT_RULE: InsertRule = {
  id: 'es.personal_a.insert',
  kind: 'insert',
  explainKey: 'es.personal_a',
  word: 'a',
  beforePos: ['PROPN'],
  beforeLemmas: [...PERSON_NOUNS, ...PERSON_PRONOUNS],
  throughPos: ['DET'],
  afterPos: ['VERB'],
  afterThroughPos: ['ADV'],
};

/**
 * Personal "a" where none belongs: "Tengo a un perro" -> "Tengo un perro". Never before
 * a verb: "a" + infinitive is a preposition the verb requires ("empezó a llover", "vamos
 * a cenar", "Vamo' a janguear"), and deleting it was the commonest junk variant on the
 * real model (proof/ENGINE_REAL_MODEL.md: asserted "Vamo' a janguear" in neutral).
 */
export const PERSONAL_A_DELETE_RULE: DeleteRule = {
  id: 'es.personal_a.delete',
  kind: 'delete',
  explainKey: 'es.personal_a',
  words: ['a'],
  notBeforePos: ['VERB', 'AUX'],
  // "Leo al periódico" -> "Leo el periódico" ("al" is a + el).
  fromContractions: true,
};

/** The articles the article rules insert and delete. */
export const SPANISH_ARTICLES: readonly string[] = ['el', 'la', 'los', 'las', 'un', 'una'];

/**
 * Feminine nouns starting with a stressed a (or ha) that take "el" and "un" in the
 * singular: el agua, un hacha (but las aguas). "una" is also accepted before them; "la"
 * is not.
 */
export const STRESSED_A_FEMININES: readonly string[] = [
  'agua', 'alma', 'hambre', 'área', 'arma', 'águila', 'aula', 'hacha', 'ave', 'hada', 'habla',
  'ala', 'asma', 'alba', 'haba', 'ancla', 'arca', 'arpa', 'aria', 'hampa', 'ama', 'álgebra',
];

/** Contractions that already hold the article (a + el, de + el): nothing is inserted after them. */
export const ARTICLE_CONTRACTIONS: readonly string[] = ['al', 'del'];

/** a + el = al, de + el = del: [first, second, joined]. */
export const SPANISH_CONTRACTIONS: readonly (readonly [string, string, string])[] = [
  ['a', 'el', 'al'],
  ['de', 'el', 'del'],
];

/**
 * Contractions left apart: "Voy a el cine" -> "Voy al cine", "Vengo de el trabajo" ->
 * "del trabajo"; never before a name ("Voy a El Salvador"). The generator also writes
 * inserts contracted and the personal-a delete takes "a" out of "al" (see ContractRule).
 */
export const CONTRACTION_RULE: ContractRule = {
  id: 'es.contraction',
  kind: 'contract',
  explainKey: 'es.contraction',
  contractions: SPANISH_CONTRACTIONS.map((c) => [...c] as const),
};

/** The articles a sentence-opening generic subject takes: "La vida es bella", "Los perros son leales". */
export const SENTENCE_START_ARTICLES: readonly string[] = ['el', 'la', 'los', 'las'];

/**
 * Missing article: insert one before a noun that directly follows a verb or a
 * preposition ("Compro pan" -> "Compro el pan", "por comida" -> "por la comida"), and a
 * definite article before a noun that opens the sentence ("Vida es bella" -> "La vida es
 * bella"). Restricting the left neighbour avoids "la la casa"; the generator also drops
 * an inserted article whose gender or number clashes with the noun, and writes "el"
 * after "a" or "de" contracted ("Voy a cine" -> "Voy al cine"). Never after "al" or
 * "del"; "el" and "un" go before a stressed-a feminine (el agua) and "la" never does.
 */
export const ARTICLE_INSERT_RULES: readonly InsertRule[] = SPANISH_ARTICLES.map((word) => {
  const rule: InsertRule = {
    id: `es.article.insert.${word}`,
    kind: 'insert',
    explainKey: 'es.article',
    word,
    beforePos: ['NOUN'],
    afterPos: ['VERB', 'ADP'],
    notAfterWords: [...ARTICLE_CONTRACTIONS],
  };
  if (word === 'el' || word === 'un') rule.agreementExceptions = [...STRESSED_A_FEMININES];
  if (word === 'la') rule.notBeforeWords = [...STRESSED_A_FEMININES];
  if (SENTENCE_START_ARTICLES.includes(word)) rule.sentenceStart = true;
  return rule;
});

/** Clock hours that take "las": a las dos ... a las doce ("a la una" is singular). */
export const HOUR_NUMBERS: readonly string[] = ['dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce'];

/** Missing article before a clock hour: "Llegamos a ocho" -> "Llegamos a las ocho", "hasta las diez". */
export const ARTICLE_HOUR_RULE: InsertRule = {
  id: 'es.article.insert.hour',
  kind: 'insert',
  explainKey: 'es.article',
  word: 'las',
  beforeLemmas: [...HOUR_NUMBERS],
  afterWords: ['a', 'desde', 'hasta', 'entre'],
};

/**
 * Body parts and clothes (lemmas of the lexicon): with a reflexive or indirect pronoun
 * they take the article, not a possessive (me lavo las manos, me duele la cabeza, se
 * puso el abrigo).
 */
export const BODY_PARTS: readonly string[] = [
  'mano', 'pie', 'cabeza', 'pelo', 'cabello', 'diente', 'ojo', 'oreja', 'oído', 'nariz', 'boca', 'cara', 'brazo',
  'pierna', 'dedo', 'uña', 'rodilla', 'espalda', 'estómago', 'cuello', 'hombro', 'pecho', 'labio', 'lengua', 'piel',
  'frente', 'abrigo', 'camisa', 'zapato', 'sombrero', 'pantalón', 'vestido',
];

/**
 * Possessive where Spanish uses the article: before a body part or a garment, right after
 * a verb, when a reflexive or indirect pronoun earlier in the sentence already says whose
 * it is ("Me lavo mis manos" -> "Me lavo las manos", "Me duele mi cabeza" -> "Me duele la
 * cabeza"). The article agrees with the noun (mis -> los dientes, las manos).
 */
export const BODY_ARTICLE_RULE: SwapRule = {
  id: 'es.body_article',
  kind: 'swap',
  explainKey: 'es.body_article',
  groups: [
    ['mi', 'el', 'la'], ['tu', 'el', 'la'], ['su', 'el', 'la'], ['nuestro', 'el', 'la'], ['nuestra', 'el', 'la'],
    ['mis', 'los', 'las'], ['tus', 'los', 'las'], ['sus', 'los', 'las'], ['nuestros', 'los', 'las'], ['nuestras', 'los', 'las'],
  ],
  fromWords: ['mi', 'tu', 'su', 'nuestro', 'nuestra', 'mis', 'tus', 'sus', 'nuestros', 'nuestras'],
  beforeLemmas: [...BODY_PARTS],
  afterPos: ['VERB'],
  cueWords: ['me', 'te', 'se', 'nos', 'os', 'le', 'les'],
  agreeNext: true,
};

/** Unneeded article: "Me gusta la Marta" -> "Me gusta Marta". */
export const ARTICLE_DELETE_RULE: DeleteRule = {
  id: 'es.article.delete',
  kind: 'delete',
  explainKey: 'es.article',
  words: [...SPANISH_ARTICLES],
  // la/los/las before a verb are object pronouns ("La invité a cenar.", "cuando la
  // conocí"): deleting them gave the only false assert on the 93 correct proof sentences
  // (+8.7 nats on Qwen3-1.7B, proof/ENGINE_REAL_MODEL.md). An article before "que" or
  // "de" stands for a noun ("la que hay", "la de mi madre"), never a stray article. An
  // article is never followed by a preposition or a conjunction: "Invité la a cenar" has
  // the pronoun, misplaced, and deleting it was asserted (+14.4) over the move fix (+5.7).
  notBeforePos: ['VERB', 'AUX', 'ADP', 'CONJ'],
  notBeforeWords: ['que', 'de', 'del'],
};

// ---------------------------------------------------------------------------
// Object pronouns (clitics)
// ---------------------------------------------------------------------------

/**
 * The unstressed object pronouns. They stand before a finite verb as separate words and
 * attach to an infinitive, a gerund or an affirmative command. The same set as the
 * analyzer's enclitics (analyze.ts CLITICS), in paradigm order.
 */
export const SPANISH_CLITICS: readonly string[] = ['me', 'te', 'se', 'nos', 'os', 'lo', 'la', 'los', 'las', 'le', 'les'];

/**
 * Order of two or more clitics together: se first, then the second person (te, os), then
 * the first person (me, nos), then the third person, indirect before direct (le, les
 * before lo, la, los, las; "le lo" itself must be "se lo", the swap below). Te lo digo,
 * se me olvidó, dámelo.
 */
export const CLITIC_ORDER: readonly (readonly string[])[] = [
  ['se'],
  ['te', 'os'],
  ['me', 'nos'],
  ['le', 'les'],
  ['lo', 'la', 'los', 'las'],
];

/** Words that make a following command negative, so it takes the subjunctive: no lo hagas. */
export const NEGATION_WORDS: readonly string[] = ['no', 'nunca', 'jamás', 'tampoco', 'ni'];

/** Clitics that are also articles: la casa, los niños, lo bueno, lo que dices. */
export const CLITIC_HOMOGRAPHS: readonly string[] = ['lo', 'la', 'los', 'las'];

/**
 * After an article: a noun or adjective (la casa, lo bueno), a determiner or numeral (la
 * otra, las dos), a pronoun (lo mío, los cuales) or a name. A clitic homograph before one
 * of these is read as the article and never moved.
 */
export const ARTICLE_FOLLOWER_POS: readonly Pos[] = ['NOUN', 'ADJ', 'DET', 'NUM', 'PRON', 'PROPN'];

/**
 * Other words that follow the neuter article lo or an article used as a pronoun: lo que,
 * la de Juan, lo más bonito, lo bien que canta, lo mucho que te quiero, lo antes posible.
 */
export const ARTICLE_FOLLOWER_WORDS: readonly string[] = [
  'que', 'de', 'del', 'cual', 'cuales', 'más', 'menos', 'bien', 'mal', 'mucho', 'poco', 'tanto', 'antes',
];

/**
 * The neuter article "lo" goes before an adjective, determiner, numeral or pronoun (lo
 * bueno, lo mismo, lo primero, lo mío), never before a noun: "Compro lo mañana" is the
 * pronoun, misplaced. Checked against every analysis of the next word, so "lo contrario"
 * (also a noun) stays the article.
 */
export const NEUTER_LO_FOLLOWER_POS: readonly Pos[] = ['ADJ', 'DET', 'NUM', 'PRON'];

/** Shared by the clitic move rules: what moves, onto which verbs, and the article guard. */
const CLITIC_MOVE_BASE = {
  kind: 'move' as const,
  words: [...SPANISH_CLITICS],
  anchorPos: ['VERB', 'AUX'] as Pos[],
  homographs: [...CLITIC_HOMOGRAPHS],
  notBeforePos: [...ARTICLE_FOLLOWER_POS],
  notBeforeWords: [...ARTICLE_FOLLOWER_WORDS],
  homographNotBeforePos: { lo: [...NEUTER_LO_FOLLOWER_POS] },
};

/**
 * Before a finite verb (indicative or subjunctive): "Compré lo ayer" -> "Lo compré
 * ayer", "Llamó me" -> "Me llamó", "Invité la a cenar" -> "La invité a cenar", and a
 * pronoun attached to a finite verb comes off: "Compróla" -> "La compró". A pronoun
 * between a finite verb and an infinitive also gets "Te quiero ver" (both orders are
 * right; the attach rule proposes "Quiero verte").
 */
export const PRONOUN_BEFORE_FINITE_RULE: MoveRule = {
  ...CLITIC_MOVE_BASE,
  id: 'es.pronoun_placement.finite',
  explainKey: 'es.pronoun_placement',
  anchorForms: ['fin'],
  positions: ['before'],
};

/**
 * Attached to an infinitive or a gerund: "Quiero te ver" -> "Quiero verte", "Estoy lo
 * leyendo" -> "Estoy leyéndolo", "¿Puedes me ayudar?" -> "¿Puedes ayudarme?".
 */
export const PRONOUN_ATTACH_NONFINITE_RULE: MoveRule = {
  ...CLITIC_MOVE_BASE,
  id: 'es.pronoun_placement.nonfinite',
  explainKey: 'es.pronoun_placement',
  anchorForms: ['inf', 'ger'],
  positions: ['attach'],
};

/**
 * Attached to an affirmative command: "Lo haz ahora" -> "Hazlo ahora". Not after a
 * negation, where the command is a subjunctive with the pronoun before it.
 */
export const PRONOUN_ATTACH_COMMAND_RULE: MoveRule = {
  ...CLITIC_MOVE_BASE,
  id: 'es.pronoun_placement.command',
  explainKey: 'es.pronoun_placement',
  anchorForms: ['imp'],
  positions: ['attach'],
  notAfterWords: [...NEGATION_WORDS],
};

/**
 * A negative command is the present subjunctive with the pronoun before it: "No hazlo"
 * -> "No lo hagas", "No dime" -> "No me digas".
 */
export const NEGATIVE_COMMAND_RULE: MoveRule = {
  ...CLITIC_MOVE_BASE,
  id: 'es.pronoun_placement.negative_command',
  explainKey: 'es.negative_command',
  anchorForms: ['imp'],
  positions: ['before'],
  afterWords: [...NEGATION_WORDS],
  inflectAnchor: { mood: 'sub', tense: 'pres' },
};

/**
 * After a negation a subjunctive command form loses its attached pronoun too: "No
 * hágalo" -> "No lo haga". Without this rule the analyzer's acceptance of hágalo (an
 * usted command) would keep the attached form; the finite rule does not look at the
 * negation.
 */
export const NEGATIVE_FINITE_RULE: MoveRule = {
  ...CLITIC_MOVE_BASE,
  id: 'es.pronoun_placement.negative',
  explainKey: 'es.pronoun_placement',
  anchorForms: ['fin'],
  positions: ['before'],
  afterWords: [...NEGATION_WORDS],
};

/**
 * A past participle after haber takes no pronoun; it goes before haber: "He lo visto" ->
 * "Lo he visto", "Ha visto lo" -> "Lo ha visto", "Ya hemos la comprado" -> "Ya la hemos
 * comprado". The participle matches through any reading (visto is also "I dress").
 */
export const PRONOUN_PARTICIPLE_RULE: MoveRule = {
  ...CLITIC_MOVE_BASE,
  id: 'es.pronoun_placement.participle',
  explainKey: 'es.pronoun_placement',
  anchorForms: ['part'],
  positions: ['before'],
  viaAuxiliary: ['haber'],
};

/**
 * A pronoun said twice, before the conjugated verb and attached to the infinitive or
 * gerund of the same chain: "Lo estoy leyéndolo" -> "Estoy leyéndolo" or "Lo estoy
 * leyendo"; "Lo voy a comprarlo" (two words on: voy, a, comprarlo).
 */
export const PRONOUN_DOUBLE_RULE: MoveRule = {
  ...CLITIC_MOVE_BASE,
  id: 'es.pronoun_double',
  explainKey: 'es.pronoun_double',
  positions: [],
  doubledWithin: 2,
};

/** Two pronouns together in the wrong order: "Lo te digo" -> "Te lo digo", "Me se olvidó" -> "Se me olvidó". */
export const PRONOUN_ORDER_RULE: MoveRule = {
  ...CLITIC_MOVE_BASE,
  id: 'es.pronoun_order',
  explainKey: 'es.pronoun_order',
  positions: [],
  order: CLITIC_ORDER.map((g) => [...g]),
};

/**
 * le and les become se before lo, la, los, las: "Le lo di" -> "Se lo di". One way only:
 * "se lo" is never "le lo".
 */
export const SE_LO_RULE: SwapRule = {
  id: 'es.se_lo',
  kind: 'swap',
  explainKey: 'es.se_lo',
  groups: [['le', 'se'], ['les', 'se']],
  fromWords: ['le', 'les'],
  beforeWords: ['lo', 'la', 'los', 'las'],
};

/** The clitic move rules, in the order they are tried. */
export const PRONOUN_MOVE_RULES: readonly MoveRule[] = [
  PRONOUN_BEFORE_FINITE_RULE,
  PRONOUN_ATTACH_NONFINITE_RULE,
  PRONOUN_ATTACH_COMMAND_RULE,
  NEGATIVE_COMMAND_RULE,
  NEGATIVE_FINITE_RULE,
  PRONOUN_PARTICIPLE_RULE,
  PRONOUN_ORDER_RULE,
  PRONOUN_DOUBLE_RULE,
];

/**
 * All Spanish correction rules. Order matters only inside a rule kind: the variant
 * generator tries swaps and moves first, then inflections, then inserts and deletes, and
 * within each kind follows this order.
 */
export const SPANISH_RULES: CorrectionRule[] = [
  SER_ESTAR_RULE,
  POR_PARA_RULE,
  SE_LO_RULE,
  BODY_ARTICLE_RULE,
  CONTRACTION_RULE,
  ...PRONOUN_MOVE_RULES,
  GENDER_RULE,
  NUMBER_RULE,
  VERB_AGREEMENT_RULE,
  VERB_AGREEMENT_GUSTAR_RULE,
  ASPECT_RULE,
  MOOD_RULE,
  PERSONAL_A_INSERT_RULE,
  PERSONAL_A_DELETE_RULE,
  ...ARTICLE_INSERT_RULES,
  ARTICLE_HOUR_RULE,
  ARTICLE_DELETE_RULE,
];
