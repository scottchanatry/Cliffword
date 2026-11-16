/**
 * Correction coverage round (proof/ENGINE_REAL_MODEL.md, "Correction coverage and slang
 * data"): the new rule kinds and rule fields, the new Spanish rules and slang entries, and
 * regressions for the fixes the last real-model round never generated. Real Spanish pack,
 * rules and registers; the n-gram mock model where a judgement is needed.
 *
 * The held-out sets (proof/pairs_holdout.jsonl, proof/slang_holdout.jsonl) are deliberately
 * not used here: they measure the rules, so no rule may be fitted to them.
 */
import { describe, expect, it } from 'vitest';
import raw17 from '../../proof/raw_qwen3-1.7b.json';
import {
  createDefaultSpanishPack,
  createMockModel,
  findSlang,
  generateVariantSet,
  generateVariants,
  judgeSentence,
  slangExemption,
  slangIn,
} from '../src';
import type { AgreeRule, ContractRule, CorrectionRule, LanguagePack, Register, Variant } from '../src';
import { createSpanishPack } from '../src/lang/es/index';
import { SPANISH_REGISTERS } from '../src/lang/es/registers/index';
import { SPANISH_RULES } from '../src/lang/es/rules';

const pack = createDefaultSpanishPack();
const all = (text: string, register: Register = 'neutral'): Variant[] =>
  generateVariantSet(pack, text, { register, maxVariants: 1000 }).variants;
const texts = (text: string, register: Register = 'neutral') => all(text, register).map((v) => v.text);
const byRule = (text: string, prefix: string, register: Register = 'neutral') =>
  all(text, register)
    .filter((v) => v.ruleId.startsWith(prefix))
    .map((v) => v.text);

/** Every variant rebuilds from its span. */
function wellFormed(text: string, vs: readonly Variant[]): void {
  for (const v of vs) {
    expect(text.slice(v.start, v.end)).toBe(v.original);
    expect(text.slice(0, v.start) + v.replacement + text.slice(v.end)).toBe(v.text);
  }
}

describe('subject-verb agreement (es.verb_agreement)', () => {
  it('makes the verb agree with a noun or pronoun subject right before it', () => {
    expect(byRule('Los niños juega en el parque.', 'es.verb_agreement')).toEqual(['Los niños juegan en el parque.']);
    expect(byRule('Nosotros vive en Madrid.', 'es.verb_agreement')).toEqual(['Nosotros vivimos en Madrid.']);
    expect(byRule('Ellos quiere comer ahora.', 'es.verb_agreement')).toEqual(['Ellos quieren comer ahora.']);
    expect(byRule('Los libros está en la mesa.', 'es.verb_agreement')).toEqual(['Los libros están en la mesa.']);
    expect(byRule('Esas mujeres trabaja mucho.', 'es.verb_agreement')).toEqual(['Esas mujeres trabajan mucho.']);
    // Through no, object pronouns and adverbs.
    expect(byRule('Ellos no lo quiere.', 'es.verb_agreement')).toEqual(['Ellos no lo quieren.']);
    expect(byRule('Los niños siempre juega.', 'es.verb_agreement')).toEqual(['Los niños siempre juegan.']);
    for (const t of ['Los niños juega en el parque.', 'Nosotros vive en Madrid.']) wellFormed(t, all(t));
  });

  it('makes a gustar-type verb agree with the noun after it', () => {
    expect(byRule('Me gusta las manzanas.', 'es.verb_agreement')).toEqual(['Me gustan las manzanas.']);
    expect(byRule('Me duele los pies.', 'es.verb_agreement')).toEqual(['Me duelen los pies.']);
    expect(byRule('Me gustan el café.', 'es.verb_agreement')).toEqual(['Me gusta el café.']);
    expect(byRule('Me gusta mucho las películas.', 'es.verb_agreement')).toEqual(['Me gustan mucho las películas.']);
  });

  it('leaves agreeing verbs and subjects that are not subjects alone', () => {
    for (const t of [
      'Los niños juegan en el parque.',
      'Yo era feliz.',
      'El libro de los niños está aquí.',
      'Mi madre y mi padre trabajan.',
      'Tú y yo vamos.',
      'Los lunes trabajo en casa.',
      'Todos los días salimos.',
      'Cuando llegan los niños empieza la fiesta.',
      'A los niños les gusta el parque.',
      'Me gusta el café y el té.',
      'Me gusta cocinar.',
      'Me gustan las manzanas.',
      'La gente que conozco es amable.',
    ]) {
      expect(byRule(t, 'es.verb_agreement'), t).toEqual([]);
    }
  });

  it('is street tolerant (Caribbean final -s)', () => {
    expect(byRule('Los niños juega en el parque.', 'es.verb_agreement', 'street')).toEqual([]);
    expect(byRule('Me gusta las manzanas.', 'es.verb_agreement', 'street')).toEqual([]);
  });
});

describe('agreement that holds is never broken (InflectRule.keepAgreement)', () => {
  it('does not change a determiner or noun away from its partner', () => {
    // Real model, last round: "Esa mujeres trabaja mucho." asserted at +6.4 nats.
    expect(texts('Esas mujeres trabaja mucho.')).not.toContain('Esa mujeres trabaja mucho.');
    expect(texts('Esas mujeres trabaja mucho.')).not.toContain('Esas mujer trabaja mucho.');
    expect(texts('Los niños juega en el parque.')).not.toContain('Los niño juega en el parque.');
    expect(texts('La casa blanca es grande.')).not.toContain('La casa blancas es grande.');
  });

  it('still fixes a word that disagrees with its partner', () => {
    expect(byRule('Tengo dos perro negros.', 'es.number')).toContain('Tengo dos perros negros.');
    expect(byRule('Hay muchas persona aquí.', 'es.number')).toContain('Hay muchas personas aquí.');
    expect(byRule('La problema es difícil.', 'es.gender')).toContain('El problema es difícil.');
    expect(byRule('La casa blanco es grande.', 'es.gender')).toContain('La casa blanca es grande.');
  });

  it('leaves the word next to a slang word alone (its gender comes from the neutral equivalent)', () => {
    expect(byRule('Se fue la guagua.', 'es.gender', 'street')).toEqual([]);
    expect(byRule('Esa rumba estuvo una chimba.', 'es.gender', 'street')).toEqual([]);
  });
});

describe('object pronouns that look like articles stay pronouns', () => {
  it('re-inflects a determiner only before its noun phrase (InflectRule.nextPosFor)', () => {
    // "La invité a cenar" got "El invité" and "Las invité"; "Las vi" got "La vi" and "Los vi".
    for (const t of ['La invité a cenar.', 'Las vi ayer.', 'Lo compré ayer.']) {
      expect(all(t).filter((v) => v.ruleId === 'es.gender' || v.ruleId === 'es.number').map((v) => v.text), t).toEqual([]);
    }
    expect(byRule('Las casa es grande.', 'es.number')).toContain('La casa es grande.');
  });

  it('never deletes an "article" before a preposition or a conjunction', () => {
    // Real model, last round: "Invité la a cenar." asserted "Invité a cenar." (+14.4).
    expect(texts('Invité la a cenar.')).not.toContain('Invité a cenar.');
    expect(texts('Invité la a cenar.')).toContain('La invité a cenar.');
    expect(byRule('Compré el pan.', 'es.article.delete')).toEqual(['Compré pan.']);
  });
});

describe('contractions (es.contraction and contracted inserts and deletes)', () => {
  it('joins a + el and de + el, but not before a name', () => {
    expect(byRule('Vamos a el parque.', 'es.contraction')).toEqual(['Vamos al parque.']);
    expect(byRule('Vengo de el trabajo.', 'es.contraction')).toEqual(['Vengo del trabajo.']);
    expect(byRule('Voy a El Salvador.', 'es.contraction')).toEqual([]);
    expect(byRule('A el niño le gusta.', 'es.contraction')).toEqual(['Al niño le gusta.']);
    wellFormed('Vamos a el parque.', all('Vamos a el parque.'));
  });

  it('writes an inserted article or personal a contracted', () => {
    expect(texts('Voy a cine los sábados.')).toContain('Voy al cine los sábados.');
    expect(texts('Salgo de trabajo a las cinco.')).toContain('Salgo del trabajo a las cinco.');
    expect(byRule('Veo el niño.', 'es.personal_a')).toEqual(['Veo al niño.']);
    for (const t of ['Voy a cine los sábados.', 'Veo el niño.', 'Llamé el médico.']) {
      for (const v of texts(t)) expect(v, t).not.toMatch(/\b(a|de) el\b/u);
    }
  });

  it('takes the personal a out of "al", not the article, and never before a verb', () => {
    expect(byRule('Leo al periódico cada día.', 'es.personal_a')).toEqual(['Leo el periódico cada día.']);
    expect(byRule('Voy al cine.', 'es.article')).not.toContain('Voy a cine.');
    expect(byRule('Al llegar me llamó.', 'es.personal_a')).toEqual([]);
  });

  it('works for any language pack with a contract rule (language-neutral)', () => {
    const rule: ContractRule = { id: 't.contract', kind: 'contract', explainKey: 't.c', contractions: [['de', 'el', 'del']] };
    const toy = createSpanishPack({ rules: [rule] });
    expect(generateVariants(toy, 'DE EL CAMPO.').map((v) => v.text)).toEqual(['DEL CAMPO.']);
    expect(generateVariants(toy, 'De el campo.').map((v) => v.text)).toEqual(['Del campo.']);
  });
});

describe('articles: sentence start and clock hours', () => {
  it('puts a definite article before a generic subject that opens the sentence, moving the capital', () => {
    const atStart = (t: string) => all(t).filter((v) => v.ruleId.startsWith('es.article.insert') && v.start === 0).map((v) => v.text);
    expect(atStart('Vida es bella.')).toEqual(['La vida es bella.']);
    expect(atStart('Perros son leales.')).toEqual(['Los perros son leales.']);
    // Not before a name, an interjection or a verb.
    expect(atStart('Madrid está en España.')).toEqual([]);
    expect(atStart('Gracias por todo.')).toEqual([]);
    expect(atStart('Trabajo en casa.')).toEqual([]);
  });

  it('puts "las" before a clock hour after a, desde, hasta, entre', () => {
    expect(byRule('Llegamos a ocho.', 'es.article.insert.hour')).toEqual(['Llegamos a las ocho.']);
    expect(byRule('Trabajo hasta diez.', 'es.article.insert.hour')).toEqual(['Trabajo hasta las diez.']);
    expect(byRule('Llegamos a las ocho.', 'es.article.insert.hour')).toEqual([]);
    expect(byRule('Tengo dos perros.', 'es.article.insert.hour')).toEqual([]);
  });
});

describe('possessive to article with body parts and clothes (es.body_article)', () => {
  it('swaps the possessive for the agreeing article after a verb with a reflexive or indirect pronoun', () => {
    expect(byRule('Me lavo mis manos.', 'es.body_article')).toEqual(['Me lavo las manos.']);
    expect(byRule('Me duele mi cabeza.', 'es.body_article')).toEqual(['Me duele la cabeza.']);
    expect(byRule('Se puso su abrigo.', 'es.body_article')).toEqual(['Se puso el abrigo.']);
    expect(byRule('Te duelen tus pies.', 'es.body_article')).toEqual(['Te duelen los pies.']);
  });

  it('keeps the possessive without the pronoun, away from the verb, or before other nouns', () => {
    for (const t of ['Mis manos están frías.', 'Lavo mis manos.', 'Te quiero con todo mi corazón.', 'Me gusta mi casa.']) {
      expect(byRule(t, 'es.body_article'), t).toEqual([]);
    }
  });
});

describe('personal a across an adverb and before nadie / alguien', () => {
  it('inserts it', () => {
    expect(byRule('Quiero mucho mis abuelos.', 'es.personal_a')).toContain('Quiero mucho a mis abuelos.');
    expect(byRule('No conozco nadie aquí.', 'es.personal_a')).toEqual(['No conozco a nadie aquí.']);
    expect(byRule('Conozco muy bien tu hermano.', 'es.personal_a')).toEqual(['Conozco muy bien a tu hermano.']);
  });

  it('does not insert it after haber or where it already stands', () => {
    expect(byRule('No hay nadie.', 'es.personal_a')).toEqual([]);
    expect(byRule('Quiero mucho a mis abuelos.', 'es.personal_a.insert')).toEqual([]);
  });
});

describe('object pronouns: lo before a noun, participles, doubled pronouns', () => {
  it('moves "lo" before a noun, which is never the neuter article there', () => {
    expect(byRule('Compro lo mañana.', 'es.pronoun')).toEqual(['Lo compro mañana.']);
    for (const t of ['Es lo contrario.', 'Lo bueno es eso.', 'Es lo que quiero.', 'Hice lo mejor.']) {
      expect(byRule(t, 'es.pronoun'), t).toEqual([]);
    }
  });

  it('moves a pronoun next to a participle before haber', () => {
    expect(byRule('He lo visto.', 'es.pronoun_placement')).toContain('Lo he visto.');
    expect(byRule('Ha visto lo.', 'es.pronoun_placement')).toEqual(['Lo ha visto.']);
    expect(byRule('Hemos la comprado.', 'es.pronoun_placement')).toContain('La hemos comprado.');
    for (const t of ['Lo he visto.', 'Me ha llamado.', 'Ya lo hemos comprado.']) expect(byRule(t, 'es.pronoun'), t).toEqual([]);
    wellFormed('Ha visto lo.', all('Ha visto lo.'));
  });

  it('removes either copy of a doubled pronoun', () => {
    expect(byRule('Lo estoy leyéndolo.', 'es.pronoun_double')).toEqual(['Estoy leyéndolo.', 'Lo estoy leyendo.']);
    expect(byRule('Lo voy a comprarlo mañana.', 'es.pronoun_double')).toEqual([
      'Voy a comprarlo mañana.',
      'Lo voy a comprar mañana.',
    ]);
    expect(byRule('Te lo quiero decirlo.', 'es.pronoun_double')).toEqual(['Te quiero decirlo.', 'Te lo quiero decir.']);
    for (const t of ['Lo estoy leyendo.', 'Estoy leyéndolo.', 'Lo voy a comprar.']) expect(byRule(t, 'es.pronoun_double'), t).toEqual([]);
    wellFormed('Lo estoy leyéndolo.', all('Lo estoy leyéndolo.'));
  });
});

describe('mood after que with a noun/verb homograph', () => {
  it('reads "que estudio" as the verb and offers the subjunctive', () => {
    expect(byRule('Mis padres quieren que estudio medicina.', 'es.mood')).toEqual(['Mis padres quieren que estudie medicina.']);
  });
});

describe('slang in corrections and heat', () => {
  it('ser/estar leaves a slang predicate alone, through adverbs, in both registers', () => {
    for (const reg of ['street', 'neutral'] as const) {
      expect(byRule('Esa fiesta estuvo bacana.', 'es.ser_estar', reg), reg).toEqual([]);
      expect(byRule('Esa fiesta estuvo bien bacana.', 'es.ser_estar', reg), reg).toEqual([]);
      expect(byRule('Ese tipo es un tíguere.', 'es.ser_estar', reg), reg).toEqual([]);
    }
    expect(byRule('Esa fiesta estuvo aburrida.', 'es.ser_estar')).toEqual(['Esa fiesta fue aburrida.']);
  });

  it('protects inflected slang (bacana, panas) and exempts it from heat', () => {
    const exempt = slangExemption(pack, []);
    for (const t of ['Estoy con mis panas.', 'Esa fiesta estuvo bacana.']) {
      const segs = pack.segment(t).filter((s) => s.kind === 'word');
      const slang = segs.filter((s) => s.norm === 'panas' || s.norm === 'bacana');
      expect(slang.length, t).toBe(1);
      for (const s of slang) expect(exempt(s), s.norm).toBe(true);
      for (const v of all(t, 'street')) for (const s of slang) expect(v.start < s.end && s.start < Math.max(v.end, v.start + 1), v.text).toBe(false);
    }
    // A standard word stays shaded.
    expect(exempt(pack.segment('mesa')[0]!)).toBe(false);
  });

  it('has the PR phrase "qué es la que hay" and the DO phrase "un chin"', () => {
    expect(findSlang('qué es la que hay').map((e) => [e.regions, e.kind])).toEqual([[['PR'], 'phrase']]);
    expect(findSlang('un chin').map((e) => [e.regions, e.kind])).toEqual([[['DO'], 'phrase']]);
    expect(slangIn(pack, '¿Qué es la que hay, mano?', ['PR'])).toContain('qué es la que hay');
    expect(all('¿Qué es la que hay, mano?', 'street')).toEqual([]);
    for (const v of all('Tengo un chin de hambre.', 'street')) expect(v.original.toLowerCase(), v.text).not.toContain('un');
  });

  it('has common explicit Caribbean words, flagged explicit with their regions', () => {
    const expected: Record<string, string[]> = {
      joder: ['CARIB'], 'jodío': ['CARIB'], mierda: ['CARIB'], culo: ['CARIB'], puta: ['CARIB'],
      cabrona: ['PR', 'DO', 'CU'], bellaquear: ['PR'], chingar: ['PR'], mamabicho: ['PR'],
      'güevo': ['DO', 'PR'], totito: ['DO', 'PR'],
      cojones: ['CU'], templar: ['CU'], bollo: ['CU'], singao: ['CU'],
      putas: ['CO'], hijueputa: ['CO'], malparido: ['CO'], 'güevón': ['CO'],
    };
    for (const [form, regions] of Object.entries(expected)) {
      const e = findSlang(form, undefined, { loose: false })[0];
      expect(e, form).toBeDefined();
      expect(e?.explicit, form).toBe(true);
      expect(e?.formality, form).toBe('vulgar');
      expect(e?.regions, form).toEqual(regions);
    }
    // Not explicit: the everyday additions.
    for (const form of ["pela'o", 'janguiar', 'qué es la que hay', 'un chin']) {
      expect(findSlang(form, undefined, { loose: false })[0]?.explicit, form).toBe(false);
    }
  });

  it('protects the new words in street sentences: inflected verbs and "el putas"', () => {
    const exempt = slangExemption(pack, ['PR', 'CARIB']);
    const jodas = pack.segment('No me jodas.').find((s) => s.norm === 'jodas');
    expect(jodas && exempt(jodas)).toBe(true);
    expect(pack.segment("Estoy pela'o.").some((s) => s.norm === "pela'o" && exempt(s))).toBe(true);
    expect(pack.segment('Estamos janguiando.').some((s) => s.norm === 'janguiando' && exempt(s))).toBe(true);
    // Last round: "que el putas" got an article delete in street register (+3.5 nats).
    const t = 'Ese man es más bacano que el putas.';
    for (const v of all(t, 'street')) expect(v.end <= t.indexOf('el putas') || v.start >= t.length - 1, v.text).toBe(true);
  });

  it('knows "man" (CO) and exempts slang listed for a region from another pack ("vaina" for PR)', () => {
    expect(findSlang('man', ['CO']).map((e) => e.neutral)).toEqual(['hombre']);
    expect(all('Ese man es más bacano que el putas.', 'street')).toEqual([]);
    const pr = slangExemption(pack, ['PR', 'CARIB']);
    const vaina = pack.segment('Esa vaina está brutal.').find((x) => x.norm === 'vaina');
    expect(vaina && pr(vaina)).toBe(true);
  });

  it('never touches a slang word of the 26 proof street sentences in street register', () => {
    const slang = (raw17 as unknown as { slang: { street: string; region: string }[] }).slang;
    for (const s of slang) {
      const region = s.region === 'DR' ? 'DO' : s.region;
      const forms = slangIn(pack, s.street, [region, 'CARIB']);
      const segs = pack.segment(s.street).filter((x) => x.kind === 'word');
      const marked = new Set<number>();
      for (const f of forms) {
        const fw = pack.segment(f).filter((x) => x.kind === 'word').map((x) => x.norm);
        for (let i = 0; i + fw.length <= segs.length; i++) {
          if (fw.every((w, k) => segs[i + k]?.norm === w)) for (let k = 0; k < fw.length; k++) marked.add(segs[i + k]!.start);
        }
      }
      for (const v of all(s.street, 'street')) {
        for (const x of segs) {
          if (!marked.has(x.start)) continue;
          expect(v.start < x.end && x.start < Math.max(v.end, v.start + 1), `${s.street} :: ${v.text}`).toBe(false);
        }
      }
    }
  });
});

/** The fixes the last real-model round never generated (proof/ENGINE_REAL_MODEL.md, section 1). */
const NEVER_GENERATED: ReadonlyArray<[string, string]> = [
  ['Los niños juega en el parque.', 'Los niños juegan en el parque.'],
  ['Nosotros vive en Madrid.', 'Nosotros vivimos en Madrid.'],
  ['Ellos quiere comer ahora.', 'Ellos quieren comer ahora.'],
  ['Los libros está en la mesa.', 'Los libros están en la mesa.'],
  ['Esas mujeres trabaja mucho.', 'Esas mujeres trabajan mucho.'],
  ['Me gusta las manzanas.', 'Me gustan las manzanas.'],
  ['Vida es bella.', 'La vida es bella.'],
  ['Voy a cine los sábados.', 'Voy al cine los sábados.'],
  ['Me lavo mis manos.', 'Me lavo las manos.'],
  ['Llegamos a ocho.', 'Llegamos a las ocho.'],
  ['Perros son leales.', 'Los perros son leales.'],
  ['Me duele mi cabeza.', 'Me duele la cabeza.'],
  ['Quiero mucho mis abuelos.', 'Quiero mucho a mis abuelos.'],
  ['No conozco nadie aquí.', 'No conozco a nadie aquí.'],
  ['Leo al periódico cada día.', 'Leo el periódico cada día.'],
  ['Mis padres quieren que estudio medicina.', 'Mis padres quieren que estudie medicina.'],
];

describe('regressions: fixes the last round never generated are among the scored variants', () => {
  const model = createMockModel();
  for (const [wrong, right] of NEVER_GENERATED) {
    it(`"${wrong}" -> "${right}"`, async () => {
      // judgeSentence with the defaults scores at most 16 variants: the fix must survive the cap.
      const j = await judgeSentence(model, pack, '', wrong);
      expect(j.variants.map((v) => v.text)).toContain(right);
    });
  }

  it('makes few variants on the correct proof sentences, and none from the new rules on most', () => {
    const pairs = (raw17 as { pairs: { correct: string }[] }).pairs;
    const NEW = ['es.verb_agreement', 'es.contraction', 'es.body_article', 'es.pronoun_double', 'es.article.insert.hour', 'es.pronoun_placement.participle'];
    let fromNew = 0;
    let max = 0;
    for (const p of pairs) {
      const set = generateVariantSet(pack, p.correct, { maxVariants: 1000 });
      max = Math.max(max, set.generated);
      fromNew += set.variants.filter((v) => NEW.some((k) => v.ruleId.startsWith(k))).length;
    }
    expect(max).toBeLessThanOrEqual(16);
    expect(fromNew).toBeLessThanOrEqual(3);
  });
});

describe('rule kinds are data: an agree rule on a toy setup (language-neutral)', () => {
  it('copies features from a controller found through listed words', () => {
    const rule: AgreeRule = {
      id: 't.agree',
      kind: 'agree',
      explainKey: 't.a',
      pos: ['VERB'],
      features: ['number'],
      side: 'before',
      throughWords: ['no'],
      controllerPos: ['NOUN'],
    };
    const toy: LanguagePack = createSpanishPack({ rules: [rule as CorrectionRule] });
    expect(generateVariants(toy, 'Los perros no come.').map((v) => v.text)).toEqual(['Los perros no comen.']);
    expect(generateVariants(toy, 'Los perros comen.').map((v) => v.text)).toEqual([]);
  });
});

describe('register packs stay consistent', () => {
  it('lists every new entry once, in its pack', () => {
    const norms = SPANISH_REGISTERS.flatMap((p) => p.entries.map((e) => `${p.region}:${e.norm}`));
    for (const n of ['PR:qué es la que hay', 'PR:janguiar', 'DO:un chin', 'CARIB:pela\'o', 'CO:putas']) {
      expect(norms.filter((x) => x === n), n).toHaveLength(1);
    }
    expect(SPANISH_RULES.length).toBeGreaterThan(0);
  });
});
