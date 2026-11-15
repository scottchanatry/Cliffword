/**
 * Dominican Republic street and casual register: everyday slang, dembow vocabulary, and
 * common vulgar terms (flagged explicit). No slurs.
 */
import type { RegisterPack } from '../../types';
import { builders, CO, DO, PR } from './entry';

const { word, casual, phrase, clipped, vulgar } = builders(DO);

export const DO_REGISTER: RegisterPack = {
  id: 'es-DO',
  region: DO,
  entries: [
    // Greetings and address
    phrase('qué lo que', 'qué tal', "what's up?", { alsoStandard: true }),
    clipped('klk', 'qué tal', "what's up? (written short for \"qué lo que\")"),
    casual('dímelo', 'hola', "what's up? (greeting, literally \"tell me\")", { alsoStandard: true }),
    clipped('manito', 'hermano', 'bro, buddy (from "hermanito")'),
    clipped('ombe', 'hombre', 'man! come on! (from "hombre")'),
    casual('loco', 'amigo', 'dude, man (as a form of address)', { lemma: 'loco@DO', alsoStandard: true }),
    casual('tíguere', 'pícaro', 'street-smart guy, hustler', { pos: 'NOUN' }),
    // Amounts and money
    casual('chin', 'poco', 'a little bit ("un chin")'),
    casual('chinchín', 'poquito', 'a tiny bit', { pos: 'NOUN' }),
    casual('pila', 'mucho', 'a lot, loads ("una pila de gente")'),
    casual('cuartos', 'dinero', 'money', { alsoStandard: true }),
    // Good, bad, okay
    casual('jevi', 'genial', 'cool, great (from English "heavy")'),
    clipped('tató', 'bien', 'okay, all good, deal (from "está todo")'),
    casual('vaina', 'cosa', 'thing, stuff; situation', { regions: [DO, PR, CO], lemma: 'vaina@DO', alsoStandard: true }),
    casual('guapo', 'enojado', 'angry, mad ("estoy guapo")', { lemma: 'guapo@DO', alsoStandard: true }),
    casual('jarto', 'harto', 'fed up; stuffed', { pos: 'ADJ' }),
    casual('jartura', 'hartura', 'stuffed feeling after a big meal', { pos: 'NOUN' }),
    casual('bajo', 'olor', 'bad smell, stink', { lemma: 'bajo@DO', alsoStandard: true }),
    // People
    casual('pariguayo', 'tonto', 'loser, uncool person'),
    casual('jablador', 'mentiroso', 'big talker, liar', { pos: 'NOUN' }),
    casual('averiguao', 'entrometido', 'nosy person', { pos: 'ADJ' }),
    casual('jevito', 'pijo', 'posh kid, preppy', { pos: 'NOUN' }),
    word('chapiadora', 'interesada', 'gold digger'),
    casual('carajito', 'niño', 'little kid'),
    // Fun and talk
    casual('coro', 'fiesta', 'hangout, party; group of friends ("vamos de coro")'),
    casual('bonche', 'fiesta', 'party, get-together'),
    casual('chercha', 'charla', 'fun chat, joking around'),
    casual('tripear', 'bromear', 'to joke around, have fun', { pos: 'VERB' }),
    casual('bufear', 'bromear', 'to mess around, make fun', { pos: 'VERB' }),
    // Trouble
    casual('boche', 'regaño', 'a telling-off, scolding', { pos: 'NOUN' }),
    casual('yeyo', 'desmayo', 'sudden fainting spell, fit', { pos: 'NOUN' }),
    casual('mangar', 'agarrar', 'to catch, grab'),
    // Things and places
    casual('colmado', 'tienda', 'corner store'),
    casual('concho', 'taxi', 'shared route taxi', { pos: 'NOUN' }),
    casual('motoconcho', 'mototaxi', 'motorcycle taxi', { pos: 'NOUN' }),
    casual('jeepeta', 'camioneta', 'SUV', { pos: 'NOUN' }),
    // Vulgar and sexual (explicit)
    vulgar('toto', 'vagina', 'vagina', { pos: 'NOUN', regions: [DO, PR] }),
    vulgar('ripio', 'pene', 'penis', { pos: 'NOUN' }),
    vulgar('rapar', 'tener sexo', 'to have sex'),
    vulgar('mamagüevo', 'desgraciado', 'asshole (very strong insult)', { pos: 'NOUN' }),
  ],
};
