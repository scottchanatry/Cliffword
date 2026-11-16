/**
 * Cuban street and casual register: everyday slang, reparto and timba vocabulary, and
 * common vulgar terms (flagged explicit). No slurs.
 */
import type { RegisterPack } from '../../types';
import { builders, CU, PR } from './entry';

const { word, casual, phrase, vulgar } = builders(CU);

export const CU_REGISTER: RegisterPack = {
  id: 'es-CU',
  region: CU,
  // Same shape as the Puerto Rico prefix measured in the proof test; not measured itself.
  scoringPrefix: 'Conversación entre amigos en Cuba, en español de la calle, con palabras como {words}:\n',
  entries: [
    // Greetings and friends
    phrase('qué bolá', 'qué tal', "what's up?"),
    casual('asere', 'amigo', 'buddy, mate'),
    casual('ecobio', 'amigo', 'close friend, brother'),
    casual('consorte', 'amigo', 'buddy, partner'),
    casual('socio', 'amigo', 'buddy, pal'),
    casual('pipo', 'papá', 'dad; also a friendly "man"'),
    casual('pura', 'madre', 'mom, my old lady', { alsoStandard: true }),
    casual('puro', 'padre', 'dad, my old man', { lemma: 'puro@CU', alsoStandard: true }),
    casual('chama', 'niño', 'kid'),
    casual('pepilla', 'muchacha', 'teenage girl'),
    casual('mangón', 'guapo', 'hottie, very attractive person'),
    // People
    casual('yuma', 'extranjero', 'foreigner (especially American); the United States'),
    casual('guajiro', 'campesino', 'country person', { pos: 'NOUN' }),
    word('jinetero', 'buscavidas', 'hustler who targets tourists', { pos: 'NOUN' }),
    word('jinetera', 'prostituta', 'woman who sells sex to tourists', { pos: 'NOUN', explicit: true }),
    word('chivatón', 'soplón', 'snitch, informer', { pos: 'NOUN' }),
    // Work, money, food, home
    casual('pincha', 'trabajo', 'job'),
    casual('pinchar', 'trabajar', 'to work'),
    casual('bisne', 'negocio', 'business, deal (often under the table)'),
    casual('fula', 'dólar', 'US dollars; also: bad, lousy', { pos: 'NOUN' }),
    casual('baro', 'peso', 'a peso; money'),
    casual('jama', 'comida', 'food'),
    casual('jamar', 'comer', 'to eat'),
    casual('gao', 'casa', 'home, house'),
    phrase('en la lucha', 'luchando', 'hustling, getting by day to day', { alsoStandard: true }),
    // Getting around
    casual('almendrón', 'taxi', 'old American car used as a shared taxi', { pos: 'NOUN' }),
    casual('botella', 'aventón', 'a ride, a lift ("pedir botella")', { lemma: 'botella@CU', pos: 'NOUN', alsoStandard: true }),
    // Good, rhythm, conflict
    casual('bárbaro', 'excelente', 'awesome, great'),
    casual('tumbao', 'ritmo', 'swing, groove; swagger', { regions: [CU, PR] }),
    casual('fajarse', 'pelear', 'to get into a fight', { lemma: 'fajarse@CU', pos: 'VERB' }),
    // Vulgar and sexual (explicit)
    vulgar('pinga', 'pene', 'penis; as an exclamation: damn!', { pos: 'NOUN' }),
    vulgar('singar', 'tener sexo', 'to have sex'),
    vulgar('comemierda', 'idiota', 'jerk, idiot; snob', { pos: 'NOUN' }),
    vulgar('cojones', 'testículos', 'balls; as an exclamation: damn!; "de cojones": awesome', { pos: 'NOUN' }),
    vulgar('templar', 'tener sexo', 'to have sex', { pos: 'VERB' }),
    vulgar('bollo', 'vagina', 'pussy', { pos: 'NOUN' }),
    vulgar('singao', 'desgraciado', 'bastard, jerk (from "singado")', { pos: 'NOUN' }),
  ],
};
