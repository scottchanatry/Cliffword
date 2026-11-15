/**
 * Regression tests for review findings, with the real Spanish pack, rules, registers and
 * pair pack (and the mock model where a model is needed). Each block names the finding
 * it guards (alg-* for algorithms, lng-* for language data).
 */
import { describe, expect, it } from 'vitest';
import {
  LearnerModel,
  PlacementTracker,
  analyzeWords,
  chooseTargets,
  cognateLexemeKeys,
  createDefaultPairPack,
  createDefaultSpanishPack,
  createMockModel,
  deriveParams,
  estimateVocabulary,
  evaluateCandidate,
  findNativeGaps,
  frequencyLexemeKeys,
  generateNextSentence,
  generateVariantSet,
  judgeSentence,
  pickCliff,
  rankOfFromPack,
  scoreCliffAnswer,
  slangLexemeKeys,
} from '../src';
import type { CliffPosition, PriorFn, Segment, SelectContext } from '../src';
import { LEXICON } from '../src/lang/es/lexicon';

const T0 = Date.UTC(2026, 10, 15, 8, 0, 0);
const pack = createDefaultSpanishPack();
const pair = createDefaultPairPack();
const model = createMockModel();

/** Texts of the variants a rule (by id prefix) makes for a sentence. */
function variantTexts(text: string, rulePrefix: string, register: 'neutral' | 'street' = 'neutral'): string[] {
  return generateVariantSet(pack, text, { register, maxVariants: 1000 })
    .variants.filter((v) => v.ruleId.startsWith(rulePrefix))
    .map((v) => v.text);
}

function allVariantTexts(text: string): string[] {
  return generateVariantSet(pack, text, { maxVariants: 1000 }).variants.map((v) => v.text);
}

function selectCtx(targets: string[]): SelectContext {
  return {
    pack,
    learner: new LearnerModel(),
    now: T0,
    targets,
    params: deriveParams({ vocab: 500 }),
    previous: [],
  };
}

/** Lexeme keys the selector gives the words of a sentence. */
function keysOf(text: string, targets: string[] = []): string[] {
  return analyzeWords(text, selectCtx(targets)).map((w) => w.key);
}

describe('alg-1: a shorter answer never earns full credit on a multi-word cliff', () => {
  it('caps the first word (or an article) alone at partial credit', async () => {
    const cases: Array<[string, string, string]> = [
      ['Ella está en', 'el', 'el mercado'],
      ['Gracias por', 'la', 'la comida'],
      ['Marta llegó tarde', 'al', 'al mercado'],
      ['Ayer fui', 'a', 'a la playa con mis amigos'],
    ];
    for (const [ctx, answer, actual] of cases) {
      const r = await scoreCliffAnswer(model, pack, ctx, answer, actual);
      expect(r.credit, `${ctx} | ${answer}`).toBe('partial');
    }
  });

  it('still gives full credit to the whole cliff', async () => {
    const r = await scoreCliffAnswer(model, pack, 'Ayer fui', 'a la playa con mis amigos', 'a la playa con mis amigos');
    expect(r.credit).toBe('full');
    expect(r.reason).toBe('actual');
  });
});

describe('alg-7: a missing accent is restored outside the top alternatives', () => {
  it('scores "reir" as "reír" when reír is not listed', async () => {
    const r = await scoreCliffAnswer(model, pack, 'Marta empezó a', 'reir', 'leer', { k: 1 });
    expect(r.alternatives.map((a) => a.norm)).not.toContain('reír');
    expect(r.scored).toBe('reír');
    const exact = await scoreCliffAnswer(model, pack, 'Marta empezó a', 'reír', 'leer', { k: 1 });
    expect(r.credit).toBe(exact.credit);
    expect(r.logprob).toBeCloseTo(exact.logprob, 9);
  });
});

describe('alg-2 / lng-2: personal a with the real pack', () => {
  it('proposes "a" before a name the pack does not know', () => {
    const cases: Array<[string, string]> = [
      ['Veo Marta.', 'Veo a Marta.'],
      ['Visito María.', 'Visito a María.'],
      ['Llamo Juan.', 'Llamo a Juan.'],
      ['Conozco Pedro.', 'Conozco a Pedro.'],
      ['Busco Ana en el parque.', 'Busco a Ana en el parque.'],
    ];
    for (const [text, fixed] of cases) expect(variantTexts(text, 'es.personal_a.insert'), text).toContain(fixed);
  });

  it('proposes "a" before a person noun with its determiner', () => {
    expect(variantTexts('Veo mi madre.', 'es.personal_a.insert')).toContain('Veo a mi madre.');
    expect(variantTexts('Llamo mi amigo.', 'es.personal_a.insert')).toContain('Llamo a mi amigo.');
    expect(variantTexts('Visito mis abuelos.', 'es.personal_a.insert')).toContain('Visito a mis abuelos.');
  });

  it('does not propose it where it does not belong or would need a contraction', () => {
    expect(variantTexts('Veo la casa.', 'es.personal_a.insert')).toEqual([]);
    expect(variantTexts('Veo a mi madre.', 'es.personal_a.insert')).toEqual([]);
    expect(variantTexts('Marta come pan.', 'es.personal_a.insert')).toEqual([]);
    expect(variantTexts('Veo el niño.', 'es.personal_a.insert')).not.toContain('Veo a el niño.');
  });

  it('flags the missing personal a with the mock model', async () => {
    for (const text of ['Veo mi madre.', 'Llamo mi amigo.']) {
      const j = await judgeSentence(model, pack, '', text);
      expect(j.verdict, text).not.toBe('ok');
      expect(j.explainKey, text).toBe('es.personal_a');
    }
  });
});

describe('lng-1: dictionary forms analyze as themselves', () => {
  it('puts the lemma itself first for every noun and adjective of the lexicon', () => {
    const wrong = LEXICON.filter(([lemma, pos]) => (pos === 'NOUN' || pos === 'ADJ') && pack.analyze(lemma)[0]?.lemma !== lemma);
    expect(wrong.map((r) => r[0])).toEqual([]);
  });

  it('keys nouns after a determiner or a verb to the noun, and counts them as targets', () => {
    const ws = analyzeWords('Me gusta la comida.', selectCtx(['es:comida']));
    expect(ws.some((w) => w.target)).toBe(true);
    expect(keysOf('Bebo vino tinto.')).toContain('es:vino');
    expect(keysOf('Tengo un trabajo nuevo.')).toContain('es:trabajo');
    expect(keysOf('Hago un viaje largo.')).toContain('es:viaje');
    expect(keysOf('Leo la nota.')).toContain('es:nota');
    expect(keysOf('Las comidas son buenas.')).toContain('es:comida');
  });

  it('keeps the verb reading where the context asks for it', () => {
    expect(keysOf('He estado en casa.')).toContain('es:estar');
    expect(keysOf('Ella ha hecho la comida.')).toEqual(['es:ella', 'es:haber', 'es:hacer', 'es:el', 'es:comida']);
    expect(keysOf('Ella vino ayer.')).toContain('es:venir');
    expect(keysOf('Vivo en Madrid.')[0]).toBe('es:vivir');
    expect(keysOf('Trabajo en casa.')[0]).toBe('es:trabajar');
    expect(keysOf('Ella me pregunta algo.')).toContain('es:preguntar');
  });
});

describe('lng-3: slang that is also standard Spanish is corrected in neutral register', () => {
  it('re-inflects standard adjectives that are also slang', () => {
    expect(variantTexts('Ella es muy guapo.', 'es.gender')).toContain('Ella es muy guapa.');
    expect(variantTexts('La casa es bajo.', 'es.gender')).toContain('La casa es baja.');
    expect(variantTexts('La leche está fresco.', 'es.gender')).toContain('La leche está fresca.');
    expect(variantTexts('La niña es loco.', 'es.gender')).toContain('La niña es loca.');
  });

  it('does not protect slang phrases made of standard words in neutral register', () => {
    expect(variantTexts('Vivo cerca de una parque.', 'es.gender')).toContain('Vivo cerca de un parque.');
  });

  it('still protects them in street register, and protects slang-only words in both', () => {
    expect(variantTexts('Ella es muy guapo.', 'es.gender', 'street')).not.toContain('Ella es muy guapa.');
    for (const register of ['neutral', 'street'] as const) {
      for (const v of generateVariantSet(pack, "El corillo ya 'tá listo pa' bailar.", { register }).variants) {
        for (const w of ['corillo', "'tá", "pa'"]) expect(v.text, v.ruleId).toContain(w);
      }
    }
  });
});

describe('lng-6: core beginner words and every cognate are in the lexicon', () => {
  it('knows weekdays, months, lápiz and tomate', () => {
    const words = [
      'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo', 'enero', 'febrero', 'marzo', 'abril',
      'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre', 'lápiz', 'tomate',
    ];
    for (const w of words) {
      expect(pack.frequencyRank(w), w).toBeDefined();
      expect(pack.analyze(w)[0]?.lemma, w).toBe(w);
      expect(pair.gloss(w), w).toBeTruthy();
    }
    expect(pack.analyze('lápices')[0]?.lemma).toBe('lápiz');
    expect(pair.toTarget('Monday')).toContain('lunes');
  });

  it('analyzes every cognate to itself', () => {
    expect([...pair.cognates].filter((c) => pack.analyze(c)[0]?.lemma !== c)).toEqual([]);
  });

  it('gives inflected cognates cognate credit for a brand-new learner', () => {
    const learner = new LearnerModel({ prior: PlacementTracker.brandNew(cognateLexemeKeys(pair)) });
    const ws = analyzeWords('Compramos pizzas, bicicletas y libros favoritos.', { ...selectCtx([]), learner });
    const p = Object.fromEntries(ws.map((w) => [w.norm, w.pKnown]));
    expect(p['pizzas']).toBe(0.5);
    expect(p['bicicletas']).toBe(0.5);
    expect(p['favoritos']).toBe(0.5);
  });
});

describe('lng-11: Spanish words that look English are not native gaps', () => {
  it('finds no gap in correct Spanish with as, do or ate', () => {
    for (const t of ['Tengo un as en la mano.', 'La nota do es la primera.', 'Quiero que ate al perro.']) {
      expect(findNativeGaps(t, pack, pair), t).toEqual([]);
    }
    expect(findNativeGaps('Fui al hardware store.', pack, pair)).toHaveLength(1);
  });
});

describe('lng-10: quotes and ordinals with the real pack', () => {
  it('segments quoted standard words and ordinals', () => {
    const words = (t: string) => pack.segment(t).filter((s) => s.kind !== 'space').map((s) => `${s.kind}:${s.text}`);
    expect(words("Dijo: 'tan bonito'.")).toEqual(['word:Dijo', 'punct::', "punct:'", 'word:tan', 'word:bonito', "punct:'", 'punct:.']);
    expect(words("Ella dijo 'eso' y se fue.")).toContain('word:eso');
    expect(words('El 2º piso')).toEqual(['word:El', 'number:2º', 'word:piso']);
    expect(words("Ellos 'tán aquí")).toContain("word:'tán");
  });
});

describe('lng-8: slang senses of standard words have their own lexemes', () => {
  it('glosses the slang sense through its own lemma', () => {
    const slang = pack.analyze('guapo').find((a) => a.lemma !== 'guapo');
    expect(slang?.lemma).toBe('guapo@DO');
    expect(pair.gloss('guapo')).toBe('good-looking');
    expect(pair.gloss('guapo@DO')).toMatch(/angry/);
    const keys = slangLexemeKeys(pack);
    expect(keys).toContain('es:guapo@DO');
    expect(keys).not.toContain('es:guapo');
  });

  it('keeps both regional senses of one slang word', () => {
    expect(pack.analyze('fajarse').map((a) => a.lemma)).toEqual(expect.arrayContaining(['fajarse', 'fajarse@CU']));
    expect(pair.gloss('fajarse')).toMatch(/work hard/);
    expect(pair.gloss('fajarse@CU')).toMatch(/fight/);
    const cu = createDefaultSpanishPack({ regions: ['CU'] });
    expect(cu.analyze('fajarse').map((a) => a.lemma)).toContain('fajarse@CU');
    expect(cu.analyze('fajarse').map((a) => a.lemma)).not.toContain('fajarse');
  });
});

describe('alg-3: a placed learner can land inside the known-word band', () => {
  const placed = (): { learner: LearnerModel; params: ReturnType<typeof deriveParams>; prior: PriorFn } => {
    const tr = new PlacementTracker();
    const answers: Array<[number, boolean]> = [
      [64, true], [256, true], [1024, true], [2048, true], [4096, true], [6000, true],
      [8192, false], [16384, false], [12000, false], [3000, true], [5000, true], [10000, false],
    ];
    for (const [rank, ok] of answers) tr.record(`es:probe${rank}`, rank, ok);
    const prior = tr.prior(rankOfFromPack(pack), cognateLexemeKeys(pair));
    const learner = new LearnerModel({ prior });
    return { learner, prior, params: deriveParams({ vocab: estimateVocabulary(learner, T0, frequencyLexemeKeys(pack)) }) };
  };

  it('lets the commonest words read as known above the band top', () => {
    const { prior, params } = placed();
    expect(prior('es:de', 'meaning')).toBeGreaterThan(params.knownBand.max);
  });

  it('counts a share a few ulps below the band edge as on the edge', () => {
    const learner = new LearnerModel({ prior: () => 0.95 });
    const text = 'Yo no sé lo que ella me dijo ayer en la casa.';
    const e = evaluateCandidate(text, 0, { pack, learner, now: T0, targets: [], params: deriveParams({ vocab: 5000 }), previous: [] });
    expect(e.bandShare).toBeLessThan(0.95); // 0.9499999999999998
    expect(e.inBand).toBe(true);
    expect(e.parts.band === 0).toBe(true);
  });

  it('selects inside the band without the retry call', async () => {
    const { learner, params } = placed();
    const cands = [
      // Common words and a few less frequent ones (firmar, contrato, ayuda, abogado).
      'Ella firmó el contrato con la ayuda de su abogado.',
      'Yo no sé lo que ella me dijo ayer en la casa.',
      'Ella vio un perro grande cerca del río.',
      'Él dijo que no lo iba a hacer con ella.',
    ];
    const stub = { id: 'stub', scoreContinuation: async () => [], nextTokens: async () => [], generate: async (_p: string, o: { n: number }) => Array.from({ length: o.n }, (_, i) => cands[i % cands.length] as string) };
    const r = await generateNextSentence(stub, { pack, learner, pair }, { story: ['Marta llegó tarde al mercado.'], targets: [], params, now: T0, seed: 1 });
    expect(r.diagnostics.retried).toBe(false);
    expect(r.diagnostics.modelCalls).toBe(1);
    expect(r.best?.inBand).toBe(true);
    expect(r.best?.bandShare).toBeGreaterThan(params.knownBand.min);
  });
});

describe('alg-4: a cognate met without trouble is not taught as new later', () => {
  it('does not fall below an untouched cognate', () => {
    const cognates = cognateLexemeKeys(pair);
    expect(cognates).toEqual(expect.arrayContaining(['es:accidente', 'es:hospital']));
    const learner = new LearnerModel({ prior: PlacementTracker.brandNew(cognates) });
    learner.applyAll([
      { type: 'heard', key: 'es:accidente', at: T0 },
      { type: 'read', key: 'es:accidente', at: T0 },
    ]);
    const later = T0 + 30 * 24 * 3_600_000;
    expect(learner.pKnown('es:accidente', 'meaning', later)).toBeGreaterThanOrEqual(learner.pKnown('es:hospital', 'meaning', later));
    const targets = chooseTargets({ learner, now: later, frequencyKeys: ['es:accidente', 'es:hospital'] });
    expect(targets.filter((t) => t.reason === 'new').map((t) => t.key)).not.toContain('es:accidente');
  });
});

describe('alg-6: every hidden word of a multi-word cliff is guessable', () => {
  const text = ' Ayer fui a ver a Marta con 3 amigos.';
  const positions = (indices: number[]): CliffPosition[] => {
    const words = pack.segment(text).filter((s) => s.kind === 'word');
    return indices.map((wordIndex) => ({ wordIndex, segment: words[wordIndex] as Segment, actualLogprob: Math.log(0.5), alternatives: [], plausibleCount: 1 }));
  };
  const ctx = { text, pack, learner: new LearnerModel(), now: T0, targets: [], params: { ...deriveParams({ vocab: 500 }), cliffWords: 2 } };

  it('never hides a name or a number after the first word', () => {
    expect(pickCliff(positions([4]), ctx)?.words).toEqual(['a']);
    expect(pickCliff(positions([6]), ctx)?.words).toEqual(['con']);
    expect(pickCliff(positions([3]), ctx)?.words).toEqual(['ver', 'a']);
  });
});

describe('lng-4: inflections use the reading chosen in context', () => {
  it('leaves the verb readings of nouns and prepositions alone', () => {
    const t = 'Voy a la casa de mi amigo a las tres para comer con la familia.';
    const set = generateVariantSet(pack, t);
    expect(set.dropped).toBe(0);
    const texts = set.variants.map((v) => v.text);
    for (const junk of ['Vaya a la', 'la case', 'pare comer']) expect(texts.some((x) => x.includes(junk)), junk).toBe(false);
    expect(allVariantTexts('Bebo agua fría.')).not.toContain('Bebo agua fríe.');
    expect(allVariantTexts('Bebo vino con mi amigo.').some((x) => x.includes('venía'))).toBe(false);
    const entre = allVariantTexts('El libro está sobre la mesa entre las flores.');
    expect(entre.some((x) => x.includes('entro') || x.includes('entra '))).toBe(false);
    expect(variantTexts('Voy a la casa para comer.', 'es.mood')).toEqual([]);
  });

  it('keeps real aspect and mood variants', () => {
    expect(variantTexts('Ella vino ayer.', 'es.aspect')).toContain('Ella venía ayer.');
    expect(variantTexts('Quiero que vienes.', 'es.mood')).toEqual(['Quiero que vengas.']);
    expect(variantTexts('Creo que vengas.', 'es.mood')).toContain('Creo que vienes.');
  });
});

describe('lng-5: article inserts are grammatical and agree', () => {
  it('inserts nothing after the contractions al and del, or after the article una', () => {
    expect(variantTexts('Vengo del mercado.', 'es.article.insert')).toEqual([]);
    expect(variantTexts('Voy al cine con mi amigo.', 'es.article.insert')).toEqual([]);
    const una = variantTexts('Vivo cerca de una parque.', 'es.article.insert');
    expect(una).toEqual([]);
  });

  it('puts el and un, never la, before a feminine noun with a stressed a', () => {
    const agua = variantTexts('Bebo agua fría.', 'es.article.insert');
    expect(agua).toContain('Bebo el agua fría.');
    expect(agua).toContain('Bebo un agua fría.');
    expect(agua).not.toContain('Bebo la agua fría.');
    expect(variantTexts('Compro comida.', 'es.article.insert')).toEqual(['Compro la comida.', 'Compro una comida.']);
  });
});

describe('lng-12: every rule category with the real pack, without the corpus doing the work', () => {
  it('makes the expected variant for each category and no junk', () => {
    const expected: Array<[string, string, string]> = [
      ['es.ser_estar', 'Soy cansado.', 'Estoy cansado.'],
      ['es.por_para', 'Gracias para el regalo.', 'Gracias por el regalo.'],
      ['es.gender', 'La mesa blanco.', 'La mesa blanca.'],
      ['es.number', 'Los libro nuevos.', 'Los libros nuevos.'],
      ['es.aspect', 'Ayer comía en casa.', 'Ayer comí en casa.'],
      ['es.mood', 'Espero que estás bien.', 'Espero que estés bien.'],
      ['es.personal_a.insert', 'Veo Marta.', 'Veo a Marta.'],
      ['es.personal_a.delete', 'Tengo a un perro.', 'Tengo un perro.'],
      ['es.article.insert', 'Compro pan.', 'Compro el pan.'],
      ['es.article.delete', 'Me gusta la Marta.', 'Me gusta Marta.'],
    ];
    for (const [rule, text, fixed] of expected) expect(variantTexts(text, rule), `${rule}: ${text}`).toContain(fixed);
    const junk = ['del el', 'al el', 'la case', 'pare comer', 'de una el'];
    for (const t of ['Vengo del mercado.', 'Voy al cine.', 'Voy a la casa para comer.', 'Vivo cerca de una parque.']) {
      for (const v of allVariantTexts(t)) for (const j of junk) expect(v.includes(j), `${t} -> ${v}`).toBe(false);
    }
  });

  it('asserts fixes whose corrected sentence is not in the mock corpus', async () => {
    const cases: Array<[string, string, string]> = [
      ['Visito mi madre.', 'Visito a mi madre.', 'es.personal_a'],
      ['Visito mi abuelo.', 'Visito a mi abuelo.', 'es.personal_a'],
      ['Gracias para el regalo.', 'Gracias por el regalo.', 'es.por_para'],
      ['Mi madre es contenta.', 'Mi madre está contenta.', 'es.ser_estar'],
    ];
    for (const [text, fixed, key] of cases) {
      const j = await judgeSentence(model, pack, '', text);
      expect(j.verdict, text).toBe('assert');
      expect(j.best?.text, text).toBe(fixed);
      expect(j.explainKey, text).toBe(key);
    }
  });
});
