/**
 * Illustrations: flat, friendly pictures drawn for Cliffword. The SVG sources, the style guide
 * and the render script live in assets/illustrations/ (README.md there); these are the PNGs.
 * Each value is a `require` of `<id>.png`: React Native picks the @2x or @3x file for the screen.
 *
 * How screens use them (all are decorative: pass `accessible={false}` / leave them unlabelled,
 * or label them through i18n when the picture itself carries meaning):
 * - Experience picker cards: the cover across the top of the card,
 *   `<Image source={COVERS[id]} style={{ width: '100%', aspectRatio: ILLUSTRATION_ASPECT.covers }} />`.
 * - A speaker's line: the avatar next to it, `<Image source={CAST.yari} style={{ width: 40, height: 40 }} />`.
 *   The PNG is already a disc (transparent outside the circle), so no mask or borderRadius is needed.
 *   The learner's own lines use `CAST.you`.
 * - The top of an episode: the scene, full width, `aspectRatio: ILLUSTRATION_ASPECT.scenes`.
 * - Tap a word to see its picture: `vocabImageForWord(word)` (or `VOCAB_BY_WORD` with a lowercased
 *   lemma) gives the picture or undefined; show it in the word sheet at up to 128 x 128.
 *
 * Each group is drawn so it stays sharp up to its 1x size (ILLUSTRATION_SIZE, in points).
 */
import type { ImageSourcePropType } from 'react-native';

export const COVER_IDS = ['mystery-cartagena', 'dating-buenos-aires', 'friends-mexico-city', 'food-lima', 'vlogger-costa-rica', 'living-san-juan'] as const;
export type CoverId = (typeof COVER_IDS)[number];

export const CAST_IDS = ['dona-mari', 'pancho', 'wilfredo', 'yari', 'abuelo', 'you'] as const;
export type CastId = (typeof CAST_IDS)[number];

export const SCENE_IDS = ['e1-street', 'e2-colmado', 'e3-clothes', 'e4-plans', 'e5-driving', 'e6-beach', 'e7-restaurant', 'e8-party'] as const;
export type SceneId = (typeof SCENE_IDS)[number];

export const VOCAB_IDS = [
  'mofongo',
  'alcapurria',
  'bacalaito',
  'arroz-con-gandules',
  'pernil',
  'tostones',
  'flan',
  'coco-frio',
  'pan-sobao',
  'cafe',
  'pastelillo',
  'agua',
  'chancletas',
  'sombrilla',
  'protector-solar',
  'toalla',
  'carro',
  'gasolina',
  'semaforo',
  'estacionamiento',
  'camisa',
  'vestido',
  'zapatos',
  'bolsa',
  'dinero',
  'gallo',
  'casa',
  'llave',
  'domino',
  'bizcocho',
  'regalo',
  'musica',
  'telefono',
  'mercado',
  'farmacia',
] as const;
export type VocabId = (typeof VOCAB_IDS)[number];

/** The size each group is drawn for, in points (its @1x size). */
export const ILLUSTRATION_SIZE = {
  covers: { width: 400, height: 200 },
  scenes: { width: 432, height: 180 },
  cast: { width: 96, height: 96 },
  vocab: { width: 128, height: 128 },
} as const;

/** width / height, for `aspectRatio` styles. */
export const ILLUSTRATION_ASPECT = { covers: 2, scenes: 2.4, cast: 1, vocab: 1 } as const;

/** Experience covers (2:1), for the picker cards. */
export const COVERS: Record<CoverId, ImageSourcePropType> = {
  'mystery-cartagena': require('../../assets/illustrations/covers/mystery-cartagena.png'),
  'dating-buenos-aires': require('../../assets/illustrations/covers/dating-buenos-aires.png'),
  'friends-mexico-city': require('../../assets/illustrations/covers/friends-mexico-city.png'),
  'food-lima': require('../../assets/illustrations/covers/food-lima.png'),
  'vlogger-costa-rica': require('../../assets/illustrations/covers/vlogger-costa-rica.png'),
  'living-san-juan': require('../../assets/illustrations/covers/living-san-juan.png'),
};

/** San Juan cast avatars (round, transparent outside the circle), plus `you` for the learner. */
export const CAST: Record<CastId, ImageSourcePropType> = {
  'dona-mari': require('../../assets/illustrations/cast/dona-mari.png'),
  pancho: require('../../assets/illustrations/cast/pancho.png'),
  wilfredo: require('../../assets/illustrations/cast/wilfredo.png'),
  yari: require('../../assets/illustrations/cast/yari.png'),
  abuelo: require('../../assets/illustrations/cast/abuelo.png'),
  you: require('../../assets/illustrations/cast/you.png'),
};

/** San Juan episode scenes (2.4:1), for the top of an episode. */
export const SCENES: Record<SceneId, ImageSourcePropType> = {
  'e1-street': require('../../assets/illustrations/scenes/e1-street.png'),
  'e2-colmado': require('../../assets/illustrations/scenes/e2-colmado.png'),
  'e3-clothes': require('../../assets/illustrations/scenes/e3-clothes.png'),
  'e4-plans': require('../../assets/illustrations/scenes/e4-plans.png'),
  'e5-driving': require('../../assets/illustrations/scenes/e5-driving.png'),
  'e6-beach': require('../../assets/illustrations/scenes/e6-beach.png'),
  'e7-restaurant': require('../../assets/illustrations/scenes/e7-restaurant.png'),
  'e8-party': require('../../assets/illustrations/scenes/e8-party.png'),
};

/** Vocabulary pictures (square, transparent): one object each. */
export const VOCAB: Record<VocabId, ImageSourcePropType> = {
  mofongo: require('../../assets/illustrations/vocab/mofongo.png'),
  alcapurria: require('../../assets/illustrations/vocab/alcapurria.png'),
  bacalaito: require('../../assets/illustrations/vocab/bacalaito.png'),
  'arroz-con-gandules': require('../../assets/illustrations/vocab/arroz-con-gandules.png'),
  pernil: require('../../assets/illustrations/vocab/pernil.png'),
  tostones: require('../../assets/illustrations/vocab/tostones.png'),
  flan: require('../../assets/illustrations/vocab/flan.png'),
  'coco-frio': require('../../assets/illustrations/vocab/coco-frio.png'),
  'pan-sobao': require('../../assets/illustrations/vocab/pan-sobao.png'),
  cafe: require('../../assets/illustrations/vocab/cafe.png'),
  pastelillo: require('../../assets/illustrations/vocab/pastelillo.png'),
  agua: require('../../assets/illustrations/vocab/agua.png'),
  chancletas: require('../../assets/illustrations/vocab/chancletas.png'),
  sombrilla: require('../../assets/illustrations/vocab/sombrilla.png'),
  'protector-solar': require('../../assets/illustrations/vocab/protector-solar.png'),
  toalla: require('../../assets/illustrations/vocab/toalla.png'),
  carro: require('../../assets/illustrations/vocab/carro.png'),
  gasolina: require('../../assets/illustrations/vocab/gasolina.png'),
  semaforo: require('../../assets/illustrations/vocab/semaforo.png'),
  estacionamiento: require('../../assets/illustrations/vocab/estacionamiento.png'),
  camisa: require('../../assets/illustrations/vocab/camisa.png'),
  vestido: require('../../assets/illustrations/vocab/vestido.png'),
  zapatos: require('../../assets/illustrations/vocab/zapatos.png'),
  bolsa: require('../../assets/illustrations/vocab/bolsa.png'),
  dinero: require('../../assets/illustrations/vocab/dinero.png'),
  gallo: require('../../assets/illustrations/vocab/gallo.png'),
  casa: require('../../assets/illustrations/vocab/casa.png'),
  llave: require('../../assets/illustrations/vocab/llave.png'),
  domino: require('../../assets/illustrations/vocab/domino.png'),
  bizcocho: require('../../assets/illustrations/vocab/bizcocho.png'),
  regalo: require('../../assets/illustrations/vocab/regalo.png'),
  musica: require('../../assets/illustrations/vocab/musica.png'),
  telefono: require('../../assets/illustrations/vocab/telefono.png'),
  mercado: require('../../assets/illustrations/vocab/mercado.png'),
  farmacia: require('../../assets/illustrations/vocab/farmacia.png'),
};

/**
 * Spanish lemmas and common forms (lowercase, with and without accents) to the vocab picture
 * that shows them. Multi-word entries ('coco frío', 'protector solar') are matched whole.
 */
export const VOCAB_BY_WORD: Record<string, VocabId> = {
  mofongo: 'mofongo',
  mofongos: 'mofongo',
  alcapurria: 'alcapurria',
  alcapurrias: 'alcapurria',
  bacalaito: 'bacalaito',
  bacalaitos: 'bacalaito',
  'arroz con gandules': 'arroz-con-gandules',
  arroz: 'arroz-con-gandules',
  gandules: 'arroz-con-gandules',
  gandul: 'arroz-con-gandules',
  pernil: 'pernil',
  tostón: 'tostones',
  toston: 'tostones',
  tostones: 'tostones',
  flan: 'flan',
  flanes: 'flan',
  'coco frío': 'coco-frio',
  'coco frio': 'coco-frio',
  coco: 'coco-frio',
  cocos: 'coco-frio',
  'pan sobao': 'pan-sobao',
  pan: 'pan-sobao',
  panes: 'pan-sobao',
  café: 'cafe',
  cafe: 'cafe',
  cafés: 'cafe',
  cafecito: 'cafe',
  pastelillo: 'pastelillo',
  pastelillos: 'pastelillo',
  agua: 'agua',
  aguas: 'agua',
  chancleta: 'chancletas',
  chancletas: 'chancletas',
  sombrilla: 'sombrilla',
  sombrillas: 'sombrilla',
  'protector solar': 'protector-solar',
  protector: 'protector-solar',
  bloqueador: 'protector-solar',
  'bloqueador solar': 'protector-solar',
  toalla: 'toalla',
  toallas: 'toalla',
  carro: 'carro',
  carros: 'carro',
  coche: 'carro',
  coches: 'carro',
  auto: 'carro',
  gasolina: 'gasolina',
  gasolinera: 'gasolina',
  semáforo: 'semaforo',
  semaforo: 'semaforo',
  semáforos: 'semaforo',
  estacionamiento: 'estacionamiento',
  estacionamientos: 'estacionamiento',
  estacionar: 'estacionamiento',
  parking: 'estacionamiento',
  parquear: 'estacionamiento',
  camisa: 'camisa',
  camisas: 'camisa',
  camiseta: 'camisa',
  vestido: 'vestido',
  vestidos: 'vestido',
  zapato: 'zapatos',
  zapatos: 'zapatos',
  bolsa: 'bolsa',
  bolsas: 'bolsa',
  cartera: 'bolsa',
  dinero: 'dinero',
  chavos: 'dinero',
  plata: 'dinero',
  gallo: 'gallo',
  gallos: 'gallo',
  casa: 'casa',
  casas: 'casa',
  llave: 'llave',
  llaves: 'llave',
  dominó: 'domino',
  domino: 'domino',
  dominós: 'domino',
  bizcocho: 'bizcocho',
  bizcochos: 'bizcocho',
  regalo: 'regalo',
  regalos: 'regalo',
  música: 'musica',
  musica: 'musica',
  teléfono: 'telefono',
  telefono: 'telefono',
  celular: 'telefono',
  mercado: 'mercado',
  mercados: 'mercado',
  'plaza del mercado': 'mercado',
  farmacia: 'farmacia',
  farmacias: 'farmacia',
};

const ARTICLES = /^(el|la|los|las|un|una|unos|unas|mi|mis|tu|tus|su|sus)\s+/;

/**
 * The vocab id for a word or short phrase as it appears in a sentence ("¡Las chancletas!",
 * "un coco frío"): lowercased, trimmed of punctuation and a leading article, then looked up
 * as written and without accents. Undefined when there is no picture.
 */
export function vocabIdForWord(text: string): VocabId | undefined {
  const key = text
    .toLocaleLowerCase('es')
    .normalize('NFC')
    .replace(/^[\s¡¿"'«(]+|[\s!?.,;:"'»)]+$/g, '')
    .replace(/\s+/g, ' ')
    .replace(ARTICLES, '');
  return VOCAB_BY_WORD[key] ?? VOCAB_BY_WORD[key.normalize('NFD').replace(/[̀-ͯ]/g, '')];
}

/** The picture for a word or short phrase, or undefined (see vocabIdForWord). */
export function vocabImageForWord(text: string): ImageSourcePropType | undefined {
  const id = vocabIdForWord(text);
  return id ? VOCAB[id] : undefined;
}
