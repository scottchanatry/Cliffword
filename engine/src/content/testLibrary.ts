/**
 * A small library for tests (not shipped content): two series of three short episodes
 * each and a coming-soon series. 'test.track.market' uses '{you:a|b}' variants (inside a
 * word, as a cliff word and in a translation); 'test.track.date' has a partner choice
 * ('{partner:a|b}', '{partner.name}', a cast member whose name is the choice, a cliff hint
 * with variants). Lines are short (4 or fewer) so tests run fast; validate with
 * { minLines: 3, maxLines: 6 }.
 */
import type { LibraryStory, LibraryTrack } from '../pair/types';

export const TEST_TRACKS: LibraryTrack[] = [
  {
    id: 'test.track.market',
    title: 'Market day',
    tagline: 'The fruit seller knows your business before you do.',
    city: 'Ponce',
    country: 'Puerto Rico',
    dialect: 'pr',
    cast: [
      { id: 'vendor', role: 'the fruit seller at the market', quirk: 'gives everyone a nickname', name: 'Rosa' },
      { id: 'friend', role: 'your neighbor who shops with you', quirk: 'always forgets the list', name: 'Pablo' },
    ],
    setting: 'A small-town open-air market on a hot morning.',
  },
  {
    id: 'test.track.date',
    title: 'First dates',
    tagline: 'Three dates, one dog, zero chill.',
    city: 'Buenos Aires',
    country: 'Argentina',
    dialect: 'ar',
    choices: [
      {
        key: 'partner',
        prompt: 'Who do you match with?',
        options: [
          { id: 'leo', label: 'Leo', gender: 'm' },
          { id: 'ana', label: 'Ana', gender: 'f' },
        ],
      },
    ],
    cast: [{ id: 'partner', role: 'your date', quirk: 'laughs at everything', name: '{partner.name}' }],
    setting: 'A big city with cafés and parks.',
  },
  {
    id: 'test.track.soon',
    title: 'Coming soon',
    tagline: 'Not written yet.',
    city: 'Lima',
    country: 'Peru',
    dialect: 'pe',
    cast: [],
    setting: 'A coastal capital.',
  },
];

const market = (episode: number, title: string, titleNative: string, rest: Pick<LibraryStory, 'sentences' | 'turns' | 'beats' | 'functions'>): LibraryStory => ({
  id: `test.market.e${episode}`,
  track: 'test.track.market',
  episode,
  tier: 'beginner',
  level: 0,
  title,
  titleNative,
  characters: ['Rosa', 'Pablo'],
  ...rest,
});

const date = (episode: number, title: string, titleNative: string, rest: Pick<LibraryStory, 'sentences' | 'turns' | 'beats' | 'functions'>): LibraryStory => ({
  id: `test.date.e${episode}`,
  track: 'test.track.date',
  episode,
  tier: 'beginner',
  level: 0,
  title,
  titleNative,
  characters: ['{partner.name}', 'Max'],
  ...rest,
});

export const TEST_LIBRARY: LibraryStory[] = [
  market(1, 'Hola, Rosa', 'Hi, Rosa', {
    beats: ['You arrive at the market', 'The seller introduces herself', 'Your neighbor praises her fruit', 'You hear the price'],
    functions: ['greet.hello', 'intro.name', 'shop.price'],
    sentences: [
      {
        id: 'e1.l01',
        intent: 'The seller greets you and says her name',
        function: 'intro.name',
        speaker: 'vendor',
        text: '¡Hola! Me llamo Rosa.',
        translation: 'Hi! My name is Rosa.',
        cliff: { word: 'llamo', distractors: ['como', 'tengo'], hint: 'name', concept: 'saying your name' },
      },
      {
        id: 'e1.l02',
        intent: 'The seller welcomes you to the market',
        function: 'courtesy.welcome',
        speaker: 'vendor',
        text: '¡Bienvenid{you:o|a} al mercado!',
        translation: 'Welcome to the market!',
        cliff: { word: 'mercado', distractors: ['hospital', 'teléfono'], hint: 'market', concept: 'a place' },
      },
      {
        id: 'e1.l03',
        intent: 'Your neighbor says the seller has very good fruit',
        speaker: 'friend',
        text: 'Rosa tiene fruta muy buena.',
        translation: 'Rosa has very good fruit.',
        cliff: { word: 'fruta', accept: ['comida'], distractors: ['música', 'gato'], hint: 'fruit', concept: 'a food' },
      },
      {
        id: 'e1.l04',
        intent: 'The seller says what the bananas cost',
        function: 'shop.price',
        speaker: 'vendor',
        text: 'Las bananas cuestan dos dólares.',
        translation: 'The bananas cost two dollars.',
        cliff: { word: 'dos', accept: ['tres'], distractors: ['azul', 'mesa'], hint: 'two', concept: 'the price' },
      },
    ],
    turns: [
      {
        id: 'e1.t01',
        intent: 'The seller asks if you want bananas',
        function: 'shop.want',
        after: 2,
        speaker: 'vendor',
        line: '¿Quieres bananas?',
        translation: 'Do you want bananas?',
        example: 'Sí, quiero bananas, gracias.',
      },
    ],
  }),
  market(2, 'La lista', 'The list', {
    beats: ['Your neighbor brings a long list', 'He needs rice and coffee', 'The seller points at the coffee', 'He asks if you are ready'],
    functions: ['shop.want', 'place.where'],
    sentences: [
      {
        id: 'e2.l01',
        intent: 'Your neighbor says he has a long list today',
        speaker: 'friend',
        text: 'Hoy tengo una lista larga.',
        translation: 'Today I have a long list.',
        cliff: { word: 'lista', distractors: ['playa', 'radio'], hint: 'list', concept: 'a thing' },
      },
      {
        id: 'e2.l02',
        intent: 'He says what he needs',
        function: 'shop.want',
        speaker: 'friend',
        text: 'Necesito arroz y café.',
        translation: 'I need rice and coffee.',
        cliff: { word: 'café', accept: ['leche'], distractors: ['perro', 'libro'], hint: 'coffee', concept: 'a drink' },
      },
      {
        id: 'e2.l03',
        intent: 'The seller says where the coffee is',
        function: 'place.where',
        speaker: 'vendor',
        text: 'El café está en la mesa.',
        translation: 'The coffee is on the table.',
        cliff: { word: 'mesa', distractors: ['luna', 'clase'], hint: 'table', concept: 'a place' },
      },
      {
        id: 'e2.l04',
        intent: 'The narrator says your neighbor asks if you are ready',
        text: 'Pablo pregunta si estás {you:listo|lista}.',
        translation: 'Pablo asks if you are ready.',
        cliff: { word: '{you:listo|lista}', distractors: ['verde', 'alto'], hint: 'ready', concept: 'a feeling' },
      },
    ],
  }),
  market(3, 'Adiós', 'Goodbye', {
    beats: ['The seller thanks you', 'Your neighbor plans to come back', 'Everyone says goodbye', 'You leave with bananas'],
    functions: ['greet.goodbye', 'courtesy.please'],
    sentences: [
      {
        id: 'e3.l01',
        intent: 'The seller thanks you and calls you friend',
        function: 'courtesy.please',
        speaker: 'vendor',
        text: 'Gracias, {you:amigo|amiga}.',
        translation: 'Thanks, my friend.',
        cliff: { word: '{you:amigo|amiga}', distractors: ['agua', 'noche'], hint: 'friend', concept: 'a person' },
      },
      {
        id: 'e3.l02',
        intent: 'Your neighbor says you will come back tomorrow',
        speaker: 'friend',
        text: 'Mañana volvemos al mercado.',
        translation: 'Tomorrow we come back to the market.',
        cliff: { word: 'mercado', distractors: ['gato', 'azul'], hint: 'market', concept: 'a place' },
      },
      {
        id: 'e3.l03',
        intent: 'The seller says goodbye and wishes you luck',
        function: 'greet.goodbye',
        speaker: 'vendor',
        text: 'Adiós y buena suerte.',
        translation: 'Goodbye and good luck.',
        cliff: { word: 'suerte', distractors: ['leche', 'silla'], hint: 'luck', concept: 'a wish' },
      },
    ],
  }),
  date(1, 'Primera cita', 'First date', {
    beats: ['You have a date', 'Your date compliments you', 'Your date orders coffee', 'Your date likes the place'],
    functions: ['social.flirt', 'food.order'],
    sentences: [
      {
        id: 'e1.l01',
        intent: 'The narrator says you have a date with the person you chose',
        text: 'Hoy tienes una cita con {partner.name}.',
        translation: 'Today you have a date with {partner.name}.',
        cliff: { word: 'cita', distractors: ['mesa', 'playa'], hint: 'date', concept: 'a plan' },
      },
      {
        id: 'e1.l02',
        intent: 'Your date says you look good',
        function: 'courtesy.compliment',
        speaker: 'partner',
        text: '¡Hola! Estás muy {you:guapo|guapa}.',
        translation: 'Hi! You look very {you:handsome|pretty}.',
        cliff: { word: '{you:guapo|guapa}', distractors: ['verde', 'tarde'], hint: '{you:handsome|pretty}', concept: 'a compliment' },
      },
      {
        id: 'e1.l03',
        intent: 'Your date orders a coffee with milk',
        function: 'food.order',
        text: '{partner.name} pide un café con leche.',
        translation: '{partner.name} orders a coffee with milk.',
        cliff: { word: 'leche', distractors: ['pan', 'sol'], hint: 'milk', concept: 'a drink' },
      },
      {
        id: 'e1.l04',
        intent: 'Your date says they like this restaurant',
        function: 'food.likes',
        speaker: 'partner',
        text: 'Me gusta este restaurante.',
        translation: 'I like this restaurant.',
        cliff: { word: 'restaurante', distractors: ['hospital', 'problema'], hint: 'restaurant', concept: 'a place' },
      },
    ],
    turns: [
      {
        id: 'e1.t01',
        intent: 'Your date asks if you like coffee',
        function: 'food.likes',
        after: 3,
        speaker: 'partner',
        line: '¿Te gusta el café?',
        translation: 'Do you like coffee?',
        example: 'Sí, me gusta mucho.',
      },
    ],
  }),
  date(2, 'El parque', 'The park', {
    beats: ['You go to the park', 'Your date introduces a dog', 'The dog chases a pigeon', 'Your date laughs'],
    functions: ['intro.others', 'describe.things'],
    sentences: [
      {
        id: 'e2.l01',
        intent: 'The narrator says you and your date go to the park',
        text: '{partner.name} y tú van al parque.',
        translation: '{partner.name} and you go to the park.',
        cliff: { word: 'parque', distractors: ['agua', 'libro'], hint: 'park', concept: 'a place' },
      },
      {
        id: 'e2.l02',
        intent: 'Your date introduces their dog',
        function: 'intro.others',
        speaker: 'partner',
        text: 'Mi perro se llama Max.',
        translation: 'My dog is called Max.',
        cliff: { word: 'perro', distractors: ['ventana', 'leche'], hint: 'dog', concept: 'an animal' },
      },
      {
        id: 'e2.l03',
        intent: 'The dog runs after a pigeon',
        text: 'Max corre detrás de una paloma.',
        translation: 'Max runs after a pigeon.',
        cliff: { word: 'corre', distractors: ['azul', 'tarde'], hint: 'runs', concept: 'an action' },
      },
      {
        id: 'e2.l04',
        intent: 'Your date laughs a lot',
        text: '{partner:Él|Ella} se ríe mucho.',
        translation: '{partner:He|She} laughs a lot.',
        cliff: { word: 'mucho', distractors: ['verde', 'mesa'], hint: 'a lot', concept: 'how much' },
      },
    ],
  }),
  date(3, 'La segunda cita', 'The second date', {
    beats: ['Your date asks you to dinner', 'You say yes', 'You agree on a time', 'You both smile'],
    functions: ['plan.invite', 'plan.time'],
    sentences: [
      {
        id: 'e3.l01',
        intent: 'Your date asks you to dinner tomorrow',
        function: 'plan.invite',
        speaker: 'partner',
        text: '¿Quieres cenar conmigo mañana?',
        translation: 'Do you want to have dinner with me tomorrow?',
        cliff: { word: 'cenar', accept: ['comer'], distractors: ['mesa', 'azul'], hint: 'have dinner', concept: 'an activity' },
      },
      {
        id: 'e3.l02',
        intent: 'You say yes, very happy',
        text: 'Tú dices que sí, muy {you:contento|contenta}.',
        translation: 'You say yes, very happy.',
        cliff: { word: '{you:contento|contenta}', distractors: ['verde', 'lento'], hint: 'happy', concept: 'a feeling' },
      },
      {
        id: 'e3.l03',
        intent: 'Your date names the time to meet',
        function: 'plan.time',
        speaker: 'partner',
        text: 'Perfecto, nos vemos a las ocho.',
        translation: 'Perfect, see you at eight.',
        cliff: { word: 'ocho', accept: ['nueve', 'siete'], distractors: ['mesa', 'gato'], hint: 'eight', concept: 'a time' },
      },
    ],
  }),
];

/** Validator options for the test library's short episodes. */
export const TEST_LIBRARY_VALIDATION = { minLines: 3, maxLines: 6 } as const;
