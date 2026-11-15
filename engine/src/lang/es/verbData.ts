/**
 * Data for Spanish verb conjugation: stem-change classes, accent-on-weak-vowel verbs,
 * irregular participles and irregular verb specifications. conjugate.ts holds the
 * method; this file holds only data, so new verbs are added here.
 */

/** Slot keys: mood.tense.personNumber, plus imperative and non-finite forms. */
export type PersonNumber = '1s' | '2s' | '3s' | '1p' | '2p' | '3p';
export const PERSONS: readonly PersonNumber[] = ['1s', '2s', '3s', '1p', '2p', '3p'];
export type FiniteTense = 'ind.pres' | 'ind.pret' | 'ind.impf' | 'ind.fut' | 'ind.cond' | 'sub.pres' | 'sub.impf';
export const FINITE_TENSES: readonly FiniteTense[] = [
  'ind.pres', 'ind.pret', 'ind.impf', 'ind.fut', 'ind.cond', 'sub.pres', 'sub.impf',
];
export type Slot = `${FiniteTense}.${PersonNumber}` | 'imp.2s' | 'inf' | 'ger' | 'part';

/**
 * Stem change in stressed forms. ie: e>ie (pensar), ue: o>ue (volver), i: e>i (pedir),
 * uue: u>ue (jugar), iie: i>ie (adquirir). For -ir verbs ie and ue also weaken e>i, o>u
 * in the preterite 3rd persons, subjunctive and gerund.
 */
export type StemChange = 'ie' | 'ue' | 'i' | 'uue' | 'iie';

const list = (s: string): string[] => s.trim().split(/\s+/);

export const STEM_CHANGES: ReadonlyMap<string, StemChange> = new Map<string, StemChange>([
  ...list(`pensar empezar comenzar cerrar entender perder querer sentir preferir mentir despertar
    sentar negar recomendar defender encender atender extender tender convertir divertir sugerir
    advertir referir herir hervir invertir consentir presentir nevar gobernar calentar confesar
    apretar temblar tropezar regar fregar quebrar acertar atravesar manifestar merendar sembrar
    enterrar ascender descender requerir inferir digerir arrepentir entretener tener venir
    pretender desconcertar renegar plegar desplegar despertarse sentarse divertirse transferir
    diferir conferir interferir`).map((v) => [v, 'ie'] as [string, StemChange]),
  ...list(`volver encontrar contar poder dormir morir mostrar recordar costar mover llover devolver
    resolver soler doler sonar soñar probar aprobar comprobar almorzar acostar acordar colgar rogar
    demostrar renovar volar tostar morder torcer cocer promover envolver revolver disolver absolver
    conmover forzar esforzar reforzar volcar poblar consolar apostar descontar recontar remover
    encontrarse acostarse moverse resonar tronar avergonzar degollar`).map((v) => [v, 'ue'] as [string, StemChange]),
  ...list(`pedir servir repetir seguir conseguir perseguir proseguir elegir vestir medir competir
    despedir impedir corregir gemir rendir teñir ceñir reñir concebir expedir investir derretir
    decir bendecir maldecir predecir contradecir reelegir desvestir`).map((v) => [v, 'i'] as [string, StemChange]),
  ['jugar', 'uue'],
  ['adquirir', 'iie'],
  ['inquirir', 'iie'],
]);

/** Verbs whose stem i or u is stressed and written with an accent: envío, continúo, reúno. */
export const ACCENTED_WEAK_STEM: ReadonlySet<string> = new Set(list(`enviar confiar guiar criar
  esquiar variar desviar fiar vaciar ampliar continuar actuar graduar situar evaluar insinuar
  acentuar efectuar reunir prohibir rehusar aislar fotografiar resfriar enfriar espiar liar
  desafiar habituar perpetuar devaluar adecuar contrariar averiar extraviar`));

/** -cer/-cir verbs after a vowel that do NOT take -zc- (they are irregular or take -z-). */
export const NOT_ZC: ReadonlySet<string> = new Set(list(`hacer deshacer rehacer satisfacer cocer
  recocer escocer mecer decir bendecir maldecir predecir contradecir desdecir`));

/** Irregular participles by exact lemma. */
export const IRREGULAR_PARTICIPLES: ReadonlyMap<string, string> = new Map([
  ['romper', 'roto'], ['morir', 'muerto'], ['imprimir', 'impreso'], ['proveer', 'provisto'],
  ['pudrir', 'podrido'], ['ver', 'visto'], ['satisfacer', 'satisfecho'],
]);

/** Irregular participles by lemma ending (longest first wins): devolver -> devuelto. */
export const PARTICIPLE_SUFFIXES: readonly (readonly [string, string])[] = [
  ['volver', 'vuelto'], ['solver', 'suelto'], ['scribir', 'scrito'], ['cubrir', 'cubierto'],
  ['abrir', 'abierto'],
];

/**
 * Irregular verb specification. Anything left out is formed regularly (with stem
 * changes and spelling rules applied).
 */
export interface VerbSpec {
  /** Irregular 1st person singular present (tengo); subjunctive present is built from it. */
  pres1s?: string;
  /** Subjunctive present stem when pres1s does not end in -o (sé -> sep-). */
  subStem?: string;
  /** Strong preterite stem (tuv-, pud-, dij-). */
  pretStem?: string;
  /** Future and conditional stem (tendr-). */
  futStem?: string;
  /** Affirmative tú imperative. */
  imp?: string;
  ger?: string;
  part?: string;
  /** Exact forms that override anything computed. */
  overrides?: Partial<Record<Slot, string>>;
  /** Extra spellings recognized by analysis but never produced by inflect. */
  alts?: Partial<Record<Slot, readonly string[]>>;
}

const six = (slot: FiniteTense, forms: string): Partial<Record<Slot, string>> => {
  const out: Partial<Record<Slot, string>> = {};
  list(forms).forEach((f, i) => {
    out[`${slot}.${PERSONS[i] as PersonNumber}` as Slot] = f;
  });
  return out;
};

/** Fully or partly irregular verbs. Prefixed relatives (mantener, componer) derive from these. */
export const IRREGULAR_VERBS: ReadonlyMap<string, VerbSpec> = new Map<string, VerbSpec>([
  ['ser', {
    imp: 'sé',
    overrides: {
      ...six('ind.pres', 'soy eres es somos sois son'),
      ...six('ind.pret', 'fui fuiste fue fuimos fuisteis fueron'),
      ...six('ind.impf', 'era eras era éramos erais eran'),
      ...six('sub.pres', 'sea seas sea seamos seáis sean'),
    },
  }],
  ['ir', {
    imp: 've', ger: 'yendo',
    overrides: {
      ...six('ind.pres', 'voy vas va vamos vais van'),
      ...six('ind.pret', 'fui fuiste fue fuimos fuisteis fueron'),
      ...six('ind.impf', 'iba ibas iba íbamos ibais iban'),
      ...six('sub.pres', 'vaya vayas vaya vayamos vayáis vayan'),
    },
  }],
  // Peninsular standard: the stressed e of errar becomes ye- (yerro, yerre, yerra).
  ['errar', {
    overrides: {
      ...six('ind.pres', 'yerro yerras yerra erramos erráis yerran'),
      ...six('sub.pres', 'yerre yerres yerre erremos erréis yerren'),
    },
  }],
  ['estar', {
    pretStem: 'estuv',
    overrides: {
      ...six('ind.pres', 'estoy estás está estamos estáis están'),
      ...six('sub.pres', 'esté estés esté estemos estéis estén'),
    },
  }],
  ['haber', {
    pretStem: 'hub', futStem: 'habr', imp: 'he',
    overrides: {
      ...six('ind.pres', 'he has ha hemos habéis han'),
      ...six('sub.pres', 'haya hayas haya hayamos hayáis hayan'),
    },
    alts: { 'ind.pres.3s': ['hay'] },
  }],
  ['dar', {
    overrides: {
      ...six('ind.pres', 'doy das da damos dais dan'),
      ...six('ind.pret', 'di diste dio dimos disteis dieron'),
      ...six('sub.pres', 'dé des dé demos deis den'),
    },
  }],
  ['ver', {
    part: 'visto',
    overrides: {
      ...six('ind.pres', 'veo ves ve vemos veis ven'),
      ...six('ind.pret', 'vi viste vio vimos visteis vieron'),
      ...six('ind.impf', 'veía veías veía veíamos veíais veían'),
      ...six('sub.pres', 'vea veas vea veamos veáis vean'),
    },
  }],
  ['saber', { pres1s: 'sé', subStem: 'sep', pretStem: 'sup', futStem: 'sabr' }],
  ['caber', { pres1s: 'quepo', pretStem: 'cup', futStem: 'cabr' }],
  ['tener', { pres1s: 'tengo', pretStem: 'tuv', futStem: 'tendr', imp: 'ten' }],
  ['venir', { pres1s: 'vengo', pretStem: 'vin', futStem: 'vendr', imp: 'ven' }],
  ['poner', { pres1s: 'pongo', pretStem: 'pus', futStem: 'pondr', imp: 'pon', part: 'puesto' }],
  ['salir', { pres1s: 'salgo', futStem: 'saldr', imp: 'sal' }],
  ['valer', { pres1s: 'valgo', futStem: 'valdr' }],
  ['hacer', {
    pres1s: 'hago', pretStem: 'hic', futStem: 'har', imp: 'haz', part: 'hecho',
    overrides: { 'ind.pret.3s': 'hizo' },
  }],
  ['satisfacer', {
    pres1s: 'satisfago', pretStem: 'satisfic', futStem: 'satisfar', part: 'satisfecho',
    overrides: { 'ind.pret.3s': 'satisfizo' },
  }],
  ['decir', { pres1s: 'digo', pretStem: 'dij', futStem: 'dir', imp: 'di', part: 'dicho' }],
  ['traer', { pres1s: 'traigo', pretStem: 'traj' }],
  ['caer', { pres1s: 'caigo' }],
  ['oír', {
    imp: 'oye',
    overrides: six('ind.pres', 'oigo oyes oye oímos oís oyen'),
    alts: { 'ind.pres.1p': ['oimos'] },
  }],
  ['poder', { pretStem: 'pud', futStem: 'podr', ger: 'pudiendo' }],
  ['querer', { pretStem: 'quis', futStem: 'querr' }],
  ['andar', { pretStem: 'anduv' }],
  ['oler', {
    overrides: {
      ...six('ind.pres', 'huelo hueles huele olemos oléis huelen'),
      ...six('sub.pres', 'huela huelas huela olamos oláis huelan'),
    },
    imp: 'huele',
  }],
  ['reír', {
    ger: 'riendo', part: 'reído', imp: 'ríe',
    overrides: {
      ...six('ind.pres', 'río ríes ríe reímos reís ríen'),
      ...six('ind.pret', 'reí reíste rio reímos reísteis rieron'),
      ...six('sub.pres', 'ría rías ría riamos riais rían'),
    },
    alts: { 'ind.pret.3s': ['rió'], 'sub.pres.2p': ['riáis'] },
  }],
  ['freír', {
    ger: 'friendo', part: 'frito', imp: 'fríe',
    overrides: {
      ...six('ind.pres', 'frío fríes fríe freímos freís fríen'),
      ...six('ind.pret', 'freí freíste frio freímos freísteis frieron'),
      ...six('sub.pres', 'fría frías fría friamos friais frían'),
    },
    alts: { 'ind.pret.3s': ['frió'], part: ['freído'] },
  }],
  ['bendecir', { pres1s: 'bendigo', pretStem: 'bendij', imp: 'bendice', part: 'bendecido' }],
  ['maldecir', { pres1s: 'maldigo', pretStem: 'maldij', imp: 'maldice', part: 'maldecido' }],
  ['huir', { alts: { 'ind.pret.1s': ['hui'] } }],
]);

/**
 * Irregular verbs that also appear with prefixes (obtener, componer, prevenir, deshacer,
 * predecir, atraer, decaer, sobresalir, equivaler, desoír, sonreír). Each entry lists the
 * prefixes accepted for that base; an empty list means any prefix.
 */
export const PREFIXABLE_BASES: ReadonlyMap<string, readonly string[]> = new Map<string, readonly string[]>([
  ['tener', []], ['poner', []], ['venir', []], ['hacer', ['des', 're', 'contra']],
  ['decir', ['pre', 'contra', 'des']], ['traer', []], ['caer', ['de', 're']],
  ['salir', ['sobre']], ['valer', ['equi', 'pre']], ['oír', ['des']], ['reír', ['son']],
  ['ver', ['pre', 're', 'entre']],
]);
