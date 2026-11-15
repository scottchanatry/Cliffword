/**
 * Puerto Rico street and casual register. Everyday slang, reggaeton and trap vocabulary,
 * and common vulgar terms (flagged explicit). No slurs.
 */
import type { RegisterPack } from '../../types';
import { builders, CU, DO, PR } from './entry';

const { word, casual, phrase, clipped, vulgar } = builders(PR);

export const PR_REGISTER: RegisterPack = {
  id: 'es-PR',
  region: PR,
  // The prefix measured in the proof test.
  scoringPrefix: 'Conversación entre panas en Puerto Rico, en español de la calle, con palabras como {words}:\n',
  entries: [
    // Going out and friends
    casual('janguear', 'salir', 'to hang out, go out'),
    casual('jangueo', 'salida', 'a night out, hanging out'),
    casual('corillo', 'grupo', 'group of friends, crew'),
    casual('pana', 'amigo', 'buddy, friend', { regions: [PR, DO] }),
    casual('jevo', 'novio', 'boyfriend; guy'),
    casual('jeva', 'novia', 'girlfriend; girl, woman', { regions: [PR, DO, CU] }),
    casual('parisear', 'ir de fiesta', 'to party'),
    casual('gufear', 'bromear', 'to goof around, have fun', { pos: 'VERB' }),
    casual('vacilar', 'divertirse', 'to have fun, enjoy yourself', { regions: [PR, DO] }),
    casual('pon', 'aventón', 'a ride, a lift ("dame pon")', { pos: 'NOUN', alsoStandard: true }),
    casual('titi', 'tía', 'auntie'),
    casual('boricua', 'puertorriqueño', 'Puerto Rican', { pos: 'ADJ' }),
    casual('jíbaro', 'campesino', 'country person from the Puerto Rican highlands', { pos: 'NOUN' }),
    // Money, work, dealing with things
    casual('chavos', 'dinero', 'money, cash'),
    casual('bregar', 'manejar', 'to deal with, handle; to work at something'),
    casual('fajarse', 'esforzarse', 'to work hard, give it everything'),
    word('bichote', 'jefe', 'big shot, drug boss (from English "big shot")'),
    // Good, bad, easy
    casual('brutal', 'excelente', 'awesome, amazing', { lemma: 'brutal@PR', alsoStandard: true }),
    casual('nítido', 'excelente', 'great, cool'),
    word('a fuego', 'excelente', 'on fire, awesome', { kind: 'phrase', alsoStandard: true }),
    casual('mamey', 'fácil', 'easy, a piece of cake ("eso está mamey")'),
    casual('charro', 'cursi', 'tacky, corny', { pos: 'ADJ' }),
    casual('revolú', 'desorden', 'mess, chaos, commotion', { pos: 'NOUN' }),
    phrase('al garete', 'descontrolado', 'out of control, adrift'),
    // Moods and states
    casual('enchismao', 'enojado', 'angry, pissed off'),
    casual('esmayao', 'hambriento', 'starving, very hungry', { pos: 'ADJ' }),
    casual('jartera', 'hartura', 'stuffed feeling after eating too much', { pos: 'NOUN' }),
    casual('jumo', 'borracho', 'drunk', { pos: 'ADJ' }),
    word('guillao', 'presumido', 'stuck-up, acting cocky', { pos: 'ADJ' }),
    word('frontear', 'presumir', 'to show off, act tough', { pos: 'VERB' }),
    word('pichear', 'ignorar', 'to ignore someone, blow someone off', { pos: 'VERB' }),
    casual('ñangotarse', 'agacharse', 'to squat, crouch; to give in', { pos: 'VERB' }),
    casual('pela', 'paliza', 'a beating, a spanking', { pos: 'NOUN', regions: [PR, DO] }),
    casual('bochinche', 'chisme', 'gossip', { pos: 'NOUN' }),
    casual('bochinchero', 'chismoso', 'gossip (a person who gossips)', { pos: 'NOUN' }),
    // Things and places
    casual('guagua', 'autobús', 'bus', { regions: [PR, DO, CU] }),
    casual('zafacón', 'basurero', 'trash can', { pos: 'NOUN', regions: [PR, DO] }),
    casual('mahones', 'vaqueros', 'jeans', { pos: 'NOUN' }),
    casual('china', 'naranja', 'orange (the fruit)', { alsoStandard: true }),
    casual('chiringa', 'cometa', 'kite'),
    // Music and dancing
    word('perreo', 'baile', 'reggaeton grinding dance'),
    word('perrear', 'bailar', 'to dance perreo, grind'),
    word('tiraera', 'ataque', 'diss track, lyrical attack on another artist'),
    word('yal', 'chica', 'girl (reggaeton, from Jamaican "gyal")'),
    // Interjections
    casual('wepa', 'bravo', 'woo-hoo! yay!'),
    phrase('ay bendito', 'qué pena', 'oh dear! poor thing! (sympathy)'),
    clipped('acho', 'muchacho', 'man! geez! (from "muchacho")'),
    clipped('chacho', 'muchacho', 'man! wow! (from "muchacho")'),
    casual('diache', 'diablo', 'damn! wow! (mild)', { pos: 'INTJ' }),
    casual('mera', 'mira', 'hey! look! (from "mira")'),
    // Vulgar and sexual (explicit)
    vulgar('bellaco', 'excitado', 'horny (man)', { pos: 'ADJ' }),
    vulgar('bellaca', 'excitada', 'horny (woman)', { pos: 'ADJ' }),
    vulgar('bellaqueo', 'excitación', 'horny making out, sexual dancing', { pos: 'NOUN' }),
    vulgar('bicho', 'pene', 'penis', { pos: 'NOUN' }),
    vulgar('chocha', 'vagina', 'vagina', { pos: 'NOUN' }),
    vulgar('chichar', 'tener sexo', 'to have sex'),
    vulgar('puñeta', 'maldición', 'damn! (strong exclamation)', { pos: 'INTJ' }),
    vulgar('cabrón', 'desgraciado', 'bastard; as praise: badass, intense', { pos: 'NOUN', regions: [PR, DO, CU] }),
    vulgar('pendejo', 'tonto', 'idiot, jerk; coward', { regions: [PR, DO] }),
    vulgar('mamao', 'tonto', 'idiot, sucker'),
  ],
};
