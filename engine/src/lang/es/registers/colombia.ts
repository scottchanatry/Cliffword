/**
 * Colombian street and casual register (mostly Medellín and Bogotá), as heard in
 * Colombian reggaeton, with common vulgar terms flagged explicit. No slurs.
 */
import type { RegisterPack } from '../../types';
import { builders, CO, PR } from './entry';

const { word, casual, phrase, clipped, vulgar } = builders(CO);

export const CO_REGISTER: RegisterPack = {
  id: 'es-CO',
  region: CO,
  // Same shape as the Puerto Rico prefix measured in the proof test; not measured itself.
  scoringPrefix: 'Conversación entre parceros en Colombia, en español de la calle, con palabras como {words}:\n',
  entries: [
    // Greetings and friends
    casual('parce', 'amigo', 'buddy, mate'),
    casual('parcero', 'amigo', 'buddy, mate'),
    casual('man', 'hombre', 'guy, dude (from English "man": "ese man")', { pos: 'NOUN' }),
    phrase('qué más', 'qué tal', "how's it going?", { alsoStandard: true }),
    clipped('quiubo', 'hola', "hi, what's up? (from \"¿qué hubo?\")"),
    casual('parche', 'grupo', 'group of friends; plan, hangout'),
    casual('parchar', 'reunirse', 'to hang out'),
    casual('cucho', 'viejo', 'old man; dad'),
    casual('cucha', 'vieja', 'old woman; mom'),
    casual('chino', 'niño', 'kid (Bogotá)', { lemma: 'chino@CO', alsoStandard: true }),
    casual('sardino', 'adolescente', 'teenager', { pos: 'NOUN' }),
    // Good, bad, luck
    casual('bacano', 'genial', 'cool, great'),
    casual('berraco', 'valiente', 'tough, brave, great at something; also angry'),
    casual('berraquera', 'maravilla', 'something awesome ("¡qué berraquera!")', { pos: 'NOUN' }),
    casual('chimbo', 'falso', 'fake, low quality'),
    casual('paila', 'mala suerte', 'too bad, tough luck'),
    casual('chepa', 'suerte', 'luck, a fluke ("de chepa")'),
    casual('gomelo', 'pijo', 'posh, preppy', { pos: 'ADJ' }),
    casual('churro', 'guapo', 'hottie, good-looking person'),
    casual('mono', 'rubio', 'blond, fair-haired', { pos: 'ADJ' }),
    // Work and money
    casual('camello', 'trabajo', 'job, work'),
    casual('camellar', 'trabajar', 'to work (hard)'),
    casual('luca', 'mil', 'a thousand pesos'),
    casual('lucas', 'miles', 'thousands of pesos ("diez lucas")', { pos: 'NOUN' }),
    // Partying
    casual('rumba', 'fiesta', 'party, partying'),
    casual('rumbear', 'ir de fiesta', 'to party, go out'),
    casual('guaro', 'aguardiente', 'aguardiente (anise liquor)', { pos: 'NOUN' }),
    casual('pola', 'cerveza', 'beer'),
    casual('guayabo', 'resaca', 'hangover', { pos: 'NOUN' }),
    casual('tinto', 'café', 'small black coffee'),
    word('jincho', 'borracho', 'wasted, very drunk or high', { pos: 'ADJ' }),
    word('trabado', 'drogado', 'high (on drugs)', { pos: 'ADJ' }),
    // Expressions
    casual('pilas', 'cuidado', 'watch out! stay sharp!'),
    casual('hágale', 'adelante', 'go for it! sure, let\'s do it', { alsoStandard: true }),
    phrase('de una', 'enseguida', 'right away; for sure', { regions: [CO, PR], alsoStandard: true }),
    phrase('mamar gallo', 'bromear', 'to tease, joke around'),
    phrase('ave maría', 'vaya', 'wow! good grief!'),
    casual('fresco', 'tranquilo', 'relax, no worries', { lemma: 'fresco@CO', alsoStandard: true }),
    casual('embarrarla', 'equivocarse', 'to screw it up ("la embarré")'),
    casual('sapo', 'soplón', 'snitch; nosy person', { pos: 'NOUN' }),
    // Vulgar (explicit)
    vulgar('chimba', 'genial', 'awesome ("¡qué chimba!"); also vulgar for vagina'),
    vulgar('gonorrea', 'desgraciado', 'scumbag (strong insult)', { pos: 'NOUN' }),
    // A masculine singular noun in "el putas" (the devil, the best): "más bacano que el putas".
    vulgar('putas', 'lo máximo', 'in "el putas": the best, like hell ("más bacano que el putas")', { pos: 'NOUN' }),
    vulgar('hijueputa', 'desgraciado', 'son of a bitch; also an exclamation or intensifier', { pos: 'NOUN' }),
    vulgar('malparido', 'desgraciado', 'bastard', { pos: 'NOUN' }),
    vulgar('güevón', 'tonto', 'idiot; between friends: dude', { pos: 'NOUN' }),
  ],
};
