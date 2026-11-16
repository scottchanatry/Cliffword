/**
 * Shared Caribbean register: clipped forms ('tá, pa', to', na', pa'lante) and words heard
 * across Puerto Rico, the Dominican Republic, Cuba and the Colombian coast. Street mode
 * must never mark these as errors.
 */
import type { RegisterPack } from '../../types';
import { builders, CARIB } from './entry';

const { casual, clipped, vulgar } = builders(CARIB);

export const CARIB_REGISTER: RegisterPack = {
  id: 'es-CARIB',
  region: CARIB,
  // Same shape as the Puerto Rico prefix measured in the proof test; not measured itself.
  scoringPrefix: 'Conversación entre panas en el Caribe, en español de la calle, con palabras como {words}:\n',
  entries: [
    // estar without its first syllable
    clipped("'tar", 'estar', 'to be (clipped "estar")'),
    clipped("'toy", 'estoy', 'I am (clipped "estoy")'),
    clipped("'tás", 'estás', 'you are (clipped "estás")'),
    clipped("'tá", 'está', 'is, you are (clipped "está")'),
    clipped("'tamos", 'estamos', 'we are (clipped "estamos")'),
    clipped("'tán", 'están', 'they are (clipped "están")'),
    clipped("'taba", 'estaba', 'was (clipped "estaba")'),
    // para
    clipped("pa'", 'para', 'for, to (clipped "para")'),
    clipped("pa'l", 'para el', 'to the, for the (clipped "para el")'),
    clipped("pa'lante", 'adelante', 'forward, onward; keep going'),
    clipped("pa'trás", 'atrás', 'back, backward'),
    clipped("pa'cá", 'acá', 'over here (clipped "para acá")'),
    clipped("pa'llá", 'allá', 'over there (clipped "para allá")'),
    // todo, nada
    clipped("to'", 'todo', 'all, everything (clipped "todo")'),
    clipped('tó', 'todo', 'all, everything (clipped "todo")'),
    clipped('toa', 'toda', 'all, the whole (clipped "toda": "toa la noche")'),
    clipped("to'a", 'toda', 'all, the whole (clipped "toda": "to\'a la noche")'),
    clipped("na'", 'nada', 'nothing (clipped "nada")'),
    clipped('ná', 'nada', 'nothing (clipped "nada")'),
    // other clipped words
    clipped("vamo'", 'vamos', "let's go; we go (clipped \"vamos\")"),
    clipped('usté', 'usted', 'you, formal (clipped "usted")'),
    clipped('verdá', 'verdad', 'true; right? (clipped "verdad")'),
    clipped("pue'", 'pues', 'well, then (clipped "pues")'),
    clipped("'mano", 'hermano', 'bro (clipped "hermano")'),
    clipped("'mana", 'hermana', 'sis (clipped "hermana")'),
    clipped('mai', 'mamá', 'mom'),
    clipped('pai', 'papá', 'dad'),
    clipped('mijo', 'hijo', 'my dear, son (from "mi hijo")'),
    clipped('mija', 'hija', 'my dear, girl (from "mi hija")'),
    // shared words
    casual('chévere', 'genial', 'cool, great'),
    casual('dale', 'adelante', "go for it! okay! let's go!", { alsoStandard: true }),
    casual('mami', 'cariño', 'babe, hot girl (term of address)'),
    casual('papi', 'cariño', 'babe, handsome (term of address)'),
    vulgar('coño', 'caramba', 'damn! (strong exclamation)'),
    vulgar('carajo', 'caramba', 'damn! hell! (exclamation)'),
    // more shared words of street talk and lyrics
    clipped("pela'o", 'pelado', 'broke, out of money (clipped "pelado")', { pos: 'ADJ' }),
    vulgar('joder', 'molestar', 'to bother, mess with ("no me jodas": don\'t mess with me); also: to screw', { pos: 'VERB' }),
    vulgar('jodío', 'jodido', 'screwed, messed up; damn (clipped "jodido")', { kind: 'clipped', pos: 'ADJ' }),
    vulgar('mierda', 'porquería', 'shit', { pos: 'NOUN' }),
    vulgar('culo', 'trasero', 'ass, butt', { pos: 'NOUN' }),
    vulgar('puta', 'prostituta', 'whore; also an insult or an intensifier', { pos: 'NOUN' }),
  ],
};
