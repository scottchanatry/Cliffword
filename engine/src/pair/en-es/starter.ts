/**
 * The canned first story for English speakers learning Spanish (PairPack.starter): what a
 * zero-knowledge learner hears first, what the session plays before the model is
 * downloaded and loaded (canned mode), and the placement ladder used without a model.
 *
 * Data only. The session module (engine/src/session) reads it through the PairPack
 * contract; nothing here is code.
 *
 * - sentences: a short scene built from cognates of the pair pack (artista, guitarra,
 *   importante, concierto, parque, piano, música, momento, perfecto, restaurante,
 *   familia) and the taught function words. Every cliff word is a cognate, so a learner
 *   with no Spanish can pick it among spoken options. Distractors are cognates too (the
 *   learner recognizes every option) but are not natural continuations: wrong meaning,
 *   and mostly a part of speech or gender that cannot follow.
 * - taught: the function words the scene needs beyond cognates. They appear with a gloss
 *   the first time (the session shows a gloss for every word the learner does not know).
 * - probes: the placement ladder. Cliff words climb the frequency list in factor-of-two
 *   bands (PlacementTracker bands 3 to 10: ranks 8-15 up to 1024-2047 in the shipped
 *   lexicon), two or three per band, inside sentences of common words, so the cliff
 *   word is what is being tested. Ranks are the pack's, not listed here.
 * - prompts: questions the main character asks in a learner turn, answerable with the
 *   scene's words.
 */
import type { StarterStory } from '../types';

export const EN_ES_STARTER: StarterStory = {
  id: 'en-es.starter.1',
  title: 'El concierto',
  character: 'Marta',
  taught: ['el', 'un', 'ser', 'y', 'en', 'de', 'muy', 'no', 'con', 'tener', 'su', 'para'],
  sentences: [
    {
      text: 'Marta es una artista.',
      answer: 'artista',
      distractors: ['hospital', 'rápido'],
      translation: 'Marta is an artist.',
    },
    {
      text: 'Ella tiene una guitarra.',
      answer: 'guitarra',
      distractors: ['planeta', 'océano'],
      translation: 'She has a guitar.',
    },
    {
      text: 'La guitarra es muy importante para Marta.',
      answer: 'importante',
      distractors: ['hotel', 'taxi'],
      accept: ['especial'],
      translation: 'The guitar is very important to Marta.',
    },
    {
      text: 'Hoy Marta tiene un concierto en el parque.',
      answer: 'parque',
      distractors: ['chocolate', 'elefante'],
      accept: ['restaurante', 'hotel', 'centro'],
      translation: 'Today Marta has a concert in the park.',
    },
    {
      text: 'Marta toca la guitarra y el piano.',
      answer: 'piano',
      distractors: ['taxi', 'banana'],
      translation: 'Marta plays the guitar and the piano.',
    },
    {
      text: 'La música es fantástica.',
      answer: 'fantástica',
      distractors: ['mapa', 'sofá'],
      accept: ['popular', 'perfecta', 'especial'],
      translation: 'The music is fantastic.',
    },
    {
      text: 'Es un momento perfecto.',
      answer: 'perfecto',
      distractors: ['piano', 'taxi'],
      accept: ['especial', 'fantástico', 'importante'],
      translation: 'It is a perfect moment.',
    },
    {
      text: 'Después, Marta va a un restaurante con su familia.',
      answer: 'familia',
      distractors: ['planeta', 'guitarra'],
      translation: 'Afterwards, Marta goes to a restaurant with her family.',
    },
  ],
  probes: [
    // Band 3 (ranks 8-15): con 13, para 15.
    { text: 'Marta va al parque con su familia.', answer: 'con', distractors: ['mesa', 'azul'], translation: 'Marta goes to the park with her family.' },
    { text: 'Este regalo es para Marta.', answer: 'para', distractors: ['comer', 'verde'], translation: 'This gift is for Marta.' },
    // Band 4 (16-31): estar 17, tener 18, poder 26.
    { text: 'Mi familia tiene una casa grande.', answer: 'tiene', distractors: ['azul', 'ventana'], translation: 'My family has a big house.' },
    { text: 'Hoy mi madre está en el hospital.', answer: 'está', distractors: ['silla', 'rojo'], translation: 'Today my mother is in the hospital.' },
    { text: 'Marta no puede dormir.', answer: 'puede', distractors: ['mesa', 'verde'], translation: 'Marta cannot sleep.' },
    // Band 5 (32-63): ver 35, querer 55, grande 60.
    { text: 'Desde la ventana, Marta puede ver el mar.', answer: 'ver', distractors: ['mesa', 'feliz'], translation: 'From the window, Marta can see the sea.' },
    { text: 'Marta quiere un café.', answer: 'quiere', distractors: ['ventana', 'azul'], accept: ['toma', 'compra', 'pide'], translation: 'Marta wants a coffee.' },
    { text: 'La ciudad es muy grande.', answer: 'grande', distractors: ['comer', 'ventana'], accept: ['bonita', 'pequeña'], translation: 'The city is very big.' },
    // Band 6 (64-127): llegar 64, hablar 90, volver 108.
    { text: 'El tren va a llegar tarde.', answer: 'llegar', distractors: ['azul', 'mesa'], accept: ['salir'], translation: 'The train is going to arrive late.' },
    { text: 'Marta quiere hablar con el doctor.', answer: 'hablar', distractors: ['pan', 'verde'], translation: 'Marta wants to talk to the doctor.' },
    { text: 'Después del trabajo, Marta vuelve a casa.', answer: 'vuelve', distractors: ['mesa', 'rojo'], accept: ['va', 'regresa', 'llega'], translation: 'After work, Marta goes back home.' },
    // Band 7 (128-255): casa 135, agua 182.
    { text: 'Marta vive en una casa pequeña.', answer: 'casa', distractors: ['comer', 'azul'], accept: ['ciudad'], translation: 'Marta lives in a small house.' },
    { text: 'Tengo sed y quiero un vaso de agua.', answer: 'agua', distractors: ['cantar', 'noche'], accept: ['leche'], translation: 'I am thirsty and I want a glass of water.' },
    // Band 8 (256-511): dormir 332, libro 357, llorar 439.
    { text: 'Estoy muy cansada y quiero dormir.', answer: 'dormir', distractors: ['mesa', 'azul'], accept: ['descansar'], translation: 'I am very tired and I want to sleep.' },
    { text: 'Marta lee un libro en el parque.', answer: 'libro', distractors: ['frío', 'vender'], translation: 'Marta reads a book in the park.' },
    { text: 'La película es triste y Marta empieza a llorar.', answer: 'llorar', distractors: ['mesa', 'verde'], translation: 'The film is sad and Marta starts to cry.' },
    // Band 9 (512-1023): cama 544, llave 1006.
    { text: 'Es tarde y los niños van a la cama.', answer: 'cama', distractors: ['rojo', 'cantar'], translation: 'It is late and the children go to bed.' },
    { text: 'No puedo abrir la puerta sin la llave.', answer: 'llave', distractors: ['feliz', 'correr'], translation: 'I cannot open the door without the key.' },
    // Band 10 (1024-2047): abrigo 1326, cuchara 1388, sombrero 1561.
    { text: 'Hace frío y Marta lleva un abrigo.', answer: 'abrigo', distractors: ['dormir', 'verde'], translation: 'It is cold and Marta wears a coat.' },
    { text: 'Para comer la sopa, necesito una cuchara.', answer: 'cuchara', distractors: ['cantar', 'azul'], translation: 'To eat the soup, I need a spoon.' },
    { text: 'En la playa, Marta usa un sombrero contra el sol.', answer: 'sombrero', distractors: ['llorar', 'frío'], translation: 'At the beach, Marta wears a hat against the sun.' },
  ],
  prompts: [
    { line: '¿Y tú? ¿Tienes una guitarra?' },
    { line: '¿Te gusta la música?' },
    { line: '¿Y tú? ¿Qué hiciste ayer?' },
    { line: '¿Qué hay en tu ciudad?' },
  ],
};
