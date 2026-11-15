import { describe, expect, it } from 'vitest';
import { changeStem, conjugate, conjugateForm, featuresSlot, joinEnding, slotFeatures, verbClass, type Slot } from './conjugate';

const form = (lemma: string, slot: Slot): string | undefined => conjugate(lemma)?.forms.get(slot);

/** [lemma, slot, expected] spot checks across tenses, moods and irregular classes. */
const SPOT: readonly (readonly [string, Slot, string])[] = [
  // ser / ir / estar / haber
  ['estar', 'ind.pret.3s', 'estuvo'], ['estar', 'ind.pres.1s', 'estoy'], ['estar', 'sub.pres.3s', 'esté'],
  ['estar', 'sub.impf.1p', 'estuviéramos'], ['ser', 'ind.pret.3p', 'fueron'], ['ir', 'ind.pret.3p', 'fueron'],
  ['ser', 'sub.pres.3s', 'sea'], ['ser', 'ind.impf.1p', 'éramos'], ['ser', 'imp.2s', 'sé'], ['ser', 'sub.impf.3s', 'fuera'],
  ['ir', 'sub.pres.3s', 'vaya'], ['ir', 'ind.impf.1s', 'iba'], ['ir', 'imp.2s', 've'], ['ir', 'ger', 'yendo'],
  ['ir', 'ind.fut.1s', 'iré'], ['haber', 'sub.pres.3s', 'haya'], ['haber', 'sub.impf.1s', 'hubiera'],
  ['haber', 'ind.pres.3s', 'ha'], ['haber', 'ind.fut.3s', 'habrá'], ['haber', 'ind.pret.3s', 'hubo'],
  // strong preterites
  ['hacer', 'ind.pret.1s', 'hice'], ['hacer', 'ind.pret.3s', 'hizo'], ['tener', 'ind.pret.3p', 'tuvieron'],
  ['poder', 'ind.pret.1s', 'pude'], ['decir', 'ind.pret.1s', 'dije'], ['decir', 'ind.pret.3p', 'dijeron'],
  ['venir', 'ind.pret.1s', 'vine'], ['saber', 'ind.pret.1s', 'supe'], ['querer', 'ind.pret.1s', 'quise'],
  ['poner', 'ind.pret.1s', 'puse'], ['traer', 'ind.pret.3p', 'trajeron'], ['andar', 'ind.pret.3s', 'anduvo'],
  ['caber', 'ind.pret.1s', 'cupe'], ['conducir', 'ind.pret.1s', 'conduje'], ['traducir', 'ind.pret.3p', 'tradujeron'],
  ['producir', 'ind.pret.3s', 'produjo'], ['dar', 'ind.pret.3s', 'dio'], ['ver', 'ind.pret.1s', 'vi'],
  // y in preterite and gerund
  ['oír', 'ind.pret.3s', 'oyó'], ['leer', 'ind.pret.3s', 'leyó'], ['creer', 'ind.pret.3p', 'creyeron'],
  ['caer', 'ind.pret.3s', 'cayó'], ['leer', 'ger', 'leyendo'], ['caer', 'ger', 'cayendo'], ['oír', 'ger', 'oyendo'],
  ['leer', 'ind.pret.2s', 'leíste'], ['leer', 'part', 'leído'], ['oír', 'ind.pres.1p', 'oímos'],
  ['construir', 'ind.pres.1s', 'construyo'], ['construir', 'ind.pret.3s', 'construyó'], ['construir', 'part', 'construido'],
  ['huir', 'ind.pres.3p', 'huyen'],
  // -ir stem weakening
  ['dormir', 'ind.pret.3s', 'durmió'], ['pedir', 'ind.pret.3s', 'pidió'], ['seguir', 'ind.pret.3s', 'siguió'],
  ['sentir', 'sub.impf.1s', 'sintiera'], ['morir', 'ind.pret.3p', 'murieron'], ['preferir', 'ind.pret.3s', 'prefirió'],
  ['dormir', 'ger', 'durmiendo'], ['pedir', 'ger', 'pidiendo'], ['venir', 'ger', 'viniendo'], ['decir', 'ger', 'diciendo'],
  ['poder', 'ger', 'pudiendo'], ['sentir', 'sub.pres.1p', 'sintamos'], ['dormir', 'sub.pres.1p', 'durmamos'],
  // spelling changes in the preterite yo
  ['jugar', 'ind.pret.1s', 'jugué'], ['empezar', 'ind.pret.1s', 'empecé'], ['llegar', 'ind.pret.1s', 'llegué'],
  ['buscar', 'ind.pret.1s', 'busqué'], ['averiguar', 'ind.pret.1s', 'averigüé'], ['pagar', 'sub.pres.3s', 'pague'],
  // present stem changes and yo forms
  ['conocer', 'ind.pres.1s', 'conozco'], ['conducir', 'ind.pres.1s', 'conduzco'], ['conocer', 'sub.pres.2p', 'conozcáis'],
  ['pensar', 'ind.pres.1s', 'pienso'], ['pensar', 'ind.pres.1p', 'pensamos'], ['volver', 'ind.pres.3s', 'vuelve'],
  ['encontrar', 'ind.pres.3p', 'encuentran'], ['contar', 'sub.pres.1s', 'cuente'], ['jugar', 'ind.pres.1s', 'juego'],
  ['jugar', 'sub.pres.1p', 'juguemos'], ['empezar', 'sub.pres.3s', 'empiece'], ['pedir', 'ind.pres.1s', 'pido'],
  ['seguir', 'ind.pres.1s', 'sigo'], ['elegir', 'ind.pres.1s', 'elijo'], ['elegir', 'sub.pres.2p', 'elijáis'],
  ['vencer', 'ind.pres.1s', 'venzo'], ['tener', 'ind.pres.1s', 'tengo'], ['tener', 'ind.pres.2s', 'tienes'],
  ['venir', 'ind.pres.3s', 'viene'], ['salir', 'ind.pres.1s', 'salgo'], ['valer', 'ind.pres.1s', 'valgo'],
  ['oír', 'ind.pres.1s', 'oigo'], ['oír', 'ind.pres.3p', 'oyen'], ['traer', 'ind.pres.1s', 'traigo'],
  ['caer', 'ind.pres.1s', 'caigo'], ['caber', 'ind.pres.1s', 'quepo'], ['saber', 'ind.pres.1s', 'sé'],
  ['dar', 'ind.pres.1s', 'doy'], ['ver', 'ind.pres.2p', 'veis'], ['decir', 'ind.pres.3s', 'dice'],
  ['enviar', 'ind.pres.1s', 'envío'], ['continuar', 'sub.pres.3s', 'continúe'], ['reunir', 'ind.pres.3s', 'reúne'],
  // subjunctive
  ['tener', 'sub.pres.3s', 'tenga'], ['tener', 'sub.pres.1p', 'tengamos'], ['saber', 'sub.pres.1s', 'sepa'],
  ['caber', 'sub.pres.3p', 'quepan'], ['oír', 'sub.pres.1s', 'oiga'], ['dar', 'sub.pres.3s', 'dé'],
  ['dar', 'sub.pres.2p', 'deis'], ['hacer', 'sub.impf.3s', 'hiciera'], ['poder', 'sub.impf.1p', 'pudiéramos'],
  ['leer', 'sub.impf.3s', 'leyera'], ['hablar', 'sub.impf.1p', 'habláramos'], ['ir', 'sub.impf.1p', 'fuéramos'],
  // future and conditional
  ['tener', 'ind.fut.1s', 'tendré'], ['poner', 'ind.cond.3s', 'pondría'], ['salir', 'ind.fut.3p', 'saldrán'],
  ['venir', 'ind.cond.1p', 'vendríamos'], ['hacer', 'ind.fut.1s', 'haré'], ['decir', 'ind.cond.3s', 'diría'],
  ['saber', 'ind.fut.2s', 'sabrás'], ['querer', 'ind.cond.1s', 'querría'], ['poder', 'ind.fut.3s', 'podrá'],
  ['caber', 'ind.fut.1s', 'cabré'], ['valer', 'ind.cond.3s', 'valdría'], ['oír', 'ind.fut.1s', 'oiré'],
  ['hablar', 'ind.fut.2p', 'hablaréis'],
  // imperatives
  ['tener', 'imp.2s', 'ten'], ['hacer', 'imp.2s', 'haz'], ['decir', 'imp.2s', 'di'], ['poner', 'imp.2s', 'pon'],
  ['venir', 'imp.2s', 'ven'], ['salir', 'imp.2s', 'sal'], ['pensar', 'imp.2s', 'piensa'], ['dormir', 'imp.2s', 'duerme'],
  ['pedir', 'imp.2s', 'pide'], ['oír', 'imp.2s', 'oye'], ['leer', 'imp.2s', 'lee'], ['estar', 'imp.2s', 'está'],
  // participles
  ['hacer', 'part', 'hecho'], ['decir', 'part', 'dicho'], ['ver', 'part', 'visto'], ['poner', 'part', 'puesto'],
  ['volver', 'part', 'vuelto'], ['morir', 'part', 'muerto'], ['escribir', 'part', 'escrito'], ['abrir', 'part', 'abierto'],
  ['romper', 'part', 'roto'], ['devolver', 'part', 'devuelto'], ['descubrir', 'part', 'descubierto'],
  ['resolver', 'part', 'resuelto'], ['describir', 'part', 'descrito'], ['caer', 'part', 'caído'],
  // imperfect
  ['ver', 'ind.impf.1s', 'veía'], ['comer', 'ind.impf.1p', 'comíamos'], ['hablar', 'ind.impf.2p', 'hablabais'],
  // prefixed irregulars
  ['mantener', 'ind.pres.1s', 'mantengo'], ['mantener', 'imp.2s', 'mantén'], ['obtener', 'ind.pret.3s', 'obtuvo'],
  ['componer', 'part', 'compuesto'], ['prevenir', 'ind.fut.1s', 'prevendré'], ['prever', 'ind.pret.3s', 'previó'],
  ['predecir', 'imp.2s', 'predice'], ['deshacer', 'imp.2s', 'deshaz'], ['atraer', 'ind.pret.3s', 'atrajo'],
  ['sonreír', 'ind.pret.3s', 'sonrió'], ['sonreír', 'ind.pres.1s', 'sonrío'], ['satisfacer', 'ind.pret.3s', 'satisfizo'],
  ['freír', 'part', 'frito'], ['reír', 'ind.pres.3s', 'ríe'],
];

describe('conjugate spot checks', () => {
  it('has well over 60 checks', () => {
    expect(SPOT.length).toBeGreaterThan(150);
  });
  it.each(SPOT)('%s %s = %s', (lemma, slot, expected) => {
    expect(form(lemma, slot)).toBe(expected);
  });
});

describe('full regular paradigms', () => {
  const tenses = (lemma: string, tense: string) =>
    ['1s', '2s', '3s', '1p', '2p', '3p'].map((p) => form(lemma, `${tense}.${p}` as Slot)).join(' ');

  it('hablar', () => {
    expect(tenses('hablar', 'ind.pres')).toBe('hablo hablas habla hablamos habláis hablan');
    expect(tenses('hablar', 'ind.pret')).toBe('hablé hablaste habló hablamos hablasteis hablaron');
    expect(tenses('hablar', 'ind.impf')).toBe('hablaba hablabas hablaba hablábamos hablabais hablaban');
    expect(tenses('hablar', 'ind.fut')).toBe('hablaré hablarás hablará hablaremos hablaréis hablarán');
    expect(tenses('hablar', 'ind.cond')).toBe('hablaría hablarías hablaría hablaríamos hablaríais hablarían');
    expect(tenses('hablar', 'sub.pres')).toBe('hable hables hable hablemos habléis hablen');
    expect(tenses('hablar', 'sub.impf')).toBe('hablara hablaras hablara habláramos hablarais hablaran');
    expect([form('hablar', 'imp.2s'), form('hablar', 'ger'), form('hablar', 'part')]).toEqual(['habla', 'hablando', 'hablado']);
  });
  it('comer', () => {
    expect(tenses('comer', 'ind.pres')).toBe('como comes come comemos coméis comen');
    expect(tenses('comer', 'ind.pret')).toBe('comí comiste comió comimos comisteis comieron');
    expect(tenses('comer', 'sub.pres')).toBe('coma comas coma comamos comáis coman');
    expect(tenses('comer', 'sub.impf')).toBe('comiera comieras comiera comiéramos comierais comieran');
  });
  it('vivir', () => {
    expect(tenses('vivir', 'ind.pres')).toBe('vivo vives vive vivimos vivís viven');
    expect(tenses('vivir', 'ind.impf')).toBe('vivía vivías vivía vivíamos vivíais vivían');
    expect([form('vivir', 'ger'), form('vivir', 'part')]).toEqual(['viviendo', 'vivido']);
  });
  it('ser and ir share the preterite', () => {
    expect(tenses('ser', 'ind.pret')).toBe(tenses('ir', 'ind.pret'));
    expect(tenses('ser', 'ind.pres')).toBe('soy eres es somos sois son');
    expect(tenses('ir', 'ind.pres')).toBe('voy vas va vamos vais van');
  });
});

describe('every required irregular verb conjugates', () => {
  const REQUIRED = `ser estar ir haber tener hacer poder decir ver dar saber querer poner venir salir oír traer caer
    conocer conducir traducir producir leer creer caber valer andar sentir dormir morir pedir seguir elegir jugar
    empezar pensar volver encontrar contar preferir`.trim().split(/\s+/);
  it.each(REQUIRED)('%s has 46 slots, all non-empty', (lemma) => {
    const c = conjugate(lemma);
    expect(c).toBeDefined();
    expect(c?.forms.size).toBe(46);
    for (const f of c?.forms.values() ?? []) expect(f).toMatch(/^[a-záéíóúüñ]+$/);
  });
});

describe('helpers', () => {
  it('verbClass recognizes infinitives only', () => {
    expect(verbClass('hablar')).toEqual({ cls: 'ar', stem: 'habl', futBase: 'hablar' });
    expect(verbClass('oír')).toEqual({ cls: 'ir', stem: 'o', futBase: 'oir' });
    expect(verbClass('casa')).toBeUndefined();
    expect(verbClass('')).toBeUndefined();
    expect(verbClass('hello world')).toBeUndefined();
  });
  it('conjugate returns undefined for non-verbs', () => {
    expect(conjugate('mesa')).toBeUndefined();
  });
  it('changeStem changes only the last stem vowel', () => {
    expect(changeStem('prefer', 'ie', 'strong')).toBe('prefier');
    expect(changeStem('prefer', 'ie', 'weak')).toBe('prefir');
    expect(changeStem('avergonz', 'ue', 'strong')).toBe('avergüenz');
    expect(changeStem('jug', 'uue', 'strong')).toBe('jueg');
    expect(changeStem('habl', undefined, 'strong')).toBe('habl');
  });
  it('joinEnding applies spelling rules', () => {
    expect(joinEnding('busc', 'é', 'ar')).toBe('busqué');
    expect(joinEnding('cog', 'o', 'er')).toBe('cojo');
    expect(joinEnding('conoc', 'o', 'er', true)).toBe('conozco');
    expect(joinEnding('le', 'ió', 'er')).toBe('leyó');
    expect(joinEnding('le', 'imos', 'er')).toBe('leímos');
    expect(joinEnding('tiñ', 'ió', 'ir')).toBe('tiñó');
    expect(joinEnding('constru', 'a', 'ir')).toBe('construya');
    expect(joinEnding('habl', '', 'ar')).toBe('habl');
  });
  it('featuresSlot maps contract features to slots with defaults', () => {
    expect(featuresSlot({ mood: 'ind', tense: 'pret', person: '3', number: 's' })).toBe('ind.pret.3s');
    expect(featuresSlot({ form: 'inf' })).toBe('inf');
    expect(featuresSlot({ mood: 'imp' })).toBe('imp.2s');
    expect(featuresSlot({ mood: 'imp', person: '3' })).toBeUndefined();
    expect(featuresSlot({ mood: 'sub', tense: 'pret', person: '1', number: 's' })).toBeUndefined();
    expect(featuresSlot({ mood: 'ind' })).toBeUndefined();
    expect(featuresSlot({ tense: 'fut' })).toBe('ind.fut.3s');
  });
  it('slotFeatures is the inverse of featuresSlot', () => {
    for (const slot of conjugate('hablar')?.forms.keys() ?? []) expect(featuresSlot(slotFeatures(slot))).toBe(slot);
  });
  it('conjugateForm handles participle agreement and bad features', () => {
    expect(conjugateForm('hacer', { form: 'part', gender: 'f', number: 'p' })).toBe('hechas');
    expect(conjugateForm('tener', { mood: 'sub', tense: 'impf', person: '1', number: 's' })).toBe('tuviera');
    expect(conjugateForm('tener', { mood: 'sub', tense: 'fut', person: '1', number: 's' })).toBeUndefined();
    expect(conjugateForm('mesa', { form: 'inf' })).toBeUndefined();
  });
  it('alternative spellings are kept separately', () => {
    expect(conjugate('haber')?.alts.get('ind.pres.3s')).toEqual(['hay']);
    expect(conjugate('reír')?.alts.get('ind.pret.3s')).toEqual(['rió']);
  });
  it('is deterministic and cached', () => {
    expect(conjugate('tener')).toBe(conjugate('tener'));
  });
  it('accents a stressed i after a prefix vowel and h, and gives errar its ye- forms (lng-13)', () => {
    expect(form('rehacer', 'ind.pret.1s')).toBe('rehíce');
    expect(form('rehacer', 'ind.pret.3s')).toBe('rehízo');
    expect(form('rehacer', 'ind.pret.1p')).toBe('rehicimos');
    expect(form('rehacer', 'ind.pres.1s')).toBe('rehago');
    expect(form('deshacer', 'ind.pret.1s')).toBe('deshice');
    expect(form('errar', 'ind.pres.1s')).toBe('yerro');
    expect(form('errar', 'ind.pres.3p')).toBe('yerran');
    expect(form('errar', 'ind.pres.1p')).toBe('erramos');
    expect(form('errar', 'sub.pres.3s')).toBe('yerre');
    expect(form('errar', 'sub.pres.1p')).toBe('erremos');
    expect(form('errar', 'imp.2s')).toBe('yerra');
    expect(form('errar', 'ind.pret.1s')).toBe('erré');
  });

  it('has the -se imperfect subjunctive as alternative forms (lng-7)', () => {
    expect(conjugate('hablar')?.alts.get('sub.impf.1s')).toEqual(['hablase']);
    expect(conjugate('hablar')?.alts.get('sub.impf.1p')).toEqual(['hablásemos']);
    expect(conjugate('ser')?.alts.get('sub.impf.3s')).toEqual(['fuese']);
    expect(conjugate('tener')?.alts.get('sub.impf.3p')).toEqual(['tuviesen']);
    expect(conjugate('decir')?.alts.get('sub.impf.2s')).toEqual(['dijeses']);
    expect(conjugate('obtener')?.alts.get('sub.impf.1s')).toEqual(['obtuviese']);
    // The -ra form stays the canonical one.
    expect(conjugateForm('ser', { mood: 'sub', tense: 'impf', person: '3', number: 's' })).toBe('fuera');
  });
});
