/**
 * The six experiences of the en-es picker, in picker order (docs/STORY-FORMAT.md). A track
 * with no episode in EN_ES_LIBRARY is shown as "Coming soon" and cannot be started; in
 * this build only Living in San Juan is written, so it comes first.
 *
 * The five unwritten tracks already carry their cast and setting (the language-neutral
 * layer), so their writers start from the same plan. Each series: 8 comedy episodes,
 * a running gag per series, the learner as "you" in the scene.
 */
import type { LibraryTrack } from '../../types';
import { LIVING_TRACK } from './living';

export const MYSTERY_TRACK: LibraryTrack = {
  id: 'en-es.track.mystery',
  title: 'Mystery in Cartagena',
  tagline: "The town's famous parrot has vanished, and it was the only one who knew the truth.",
  city: 'Cartagena',
  country: 'Colombia',
  dialect: 'co',
  setting: 'A hot Caribbean port city with an old walled town, colorful balconies and street vendors on every corner.',
  cast: [
    { id: 'detective', role: 'a retired detective who now runs a juice stand', quirk: 'solves every case by the taste of the fruit', name: 'Don Aurelio' },
    { id: 'owner', role: 'the hotel owner whose parrot is missing', quirk: 'treats the parrot like a movie star', name: 'Doña Beatriz' },
    { id: 'vendor', role: 'a street vendor who sees everything', quirk: 'answers every question with a sales pitch', name: 'Kevin' },
    { id: 'parrot', role: 'the missing parrot', quirk: 'repeats the last thing it heard, at the worst moment', name: 'Coronel' },
  ],
};

export const DATING_TRACK: LibraryTrack = {
  id: 'en-es.track.dating',
  title: 'Dating in Buenos Aires',
  tagline: 'Your date is perfect. Their mother, their ex and their therapist all agree.',
  city: 'Buenos Aires',
  country: 'Argentina',
  dialect: 'ar',
  choices: [
    {
      key: 'partner',
      prompt: 'Who do you match with?',
      options: [
        { id: 'mateo', label: 'Mateo', gender: 'm' },
        { id: 'valentina', label: 'Valentina', gender: 'f' },
      ],
    },
  ],
  setting: 'A huge, elegant capital of cafés, late dinners, dance halls and endless debates about football.',
  cast: [
    { id: 'partner', role: 'your date', quirk: 'analyzes every date afterwards with their therapist', name: '{partner.name}' },
    { id: 'roommate', role: 'your roommate', quirk: 'gives terrible love advice with total confidence', name: 'Lucho' },
    { id: 'mother', role: "your date's mother", quirk: 'calls during every date', name: 'Graciela' },
    { id: 'waiter', role: 'a waiter at the corner café', quirk: 'has strong opinions about your love life', name: 'Ernesto' },
  ],
};

export const FRIENDS_TRACK: LibraryTrack = {
  id: 'en-es.track.friends',
  title: 'Making friends in Mexico City',
  tagline: 'Twenty-two million people, and one of them has decided you are her best friend.',
  city: 'Mexico City',
  country: 'Mexico',
  dialect: 'mx',
  setting: 'An enormous high-altitude capital of street food stands, markets, parks and traffic that never ends.',
  cast: [
    { id: 'bestie', role: 'your self-appointed best friend', quirk: 'has a cousin for every problem', name: 'Lupita' },
    { id: 'cousin', role: 'her cousin, who knows a guy for everything', quirk: 'turns every plan into a family event', name: 'Beto' },
    { id: 'vendor', role: 'a taco stand owner', quirk: 'judges people by the sauce they choose', name: 'Don Chuy' },
  ],
};

export const FOOD_TRACK: LibraryTrack = {
  id: 'en-es.track.food',
  title: 'Food lover in Lima',
  tagline: 'The best food on the continent, and a cooking teacher who thinks you have no taste.',
  city: 'Lima',
  country: 'Peru',
  dialect: 'pe',
  setting: 'A big coastal capital under grey skies, famous for its markets, its seafood and its very serious cooks.',
  cast: [
    { id: 'chef', role: 'your cooking teacher', quirk: 'judges every dish by smelling it once', name: 'Señora Rosa' },
    { id: 'classmate', role: 'a fellow student', quirk: 'eats everything before it is finished', name: 'Pato' },
    { id: 'vendor', role: 'a market stall owner', quirk: 'gives you free fruit and his whole life story', name: 'Don Félix' },
  ],
};

export const TRAVEL_TRACK: LibraryTrack = {
  id: 'en-es.track.travel',
  title: 'Travel vlogger in Costa Rica',
  tagline: 'Twelve followers, one camera, and a sloth that steals every shot.',
  city: 'San José',
  country: 'Costa Rica',
  dialect: 'cr',
  setting: 'A small green country of volcanoes, rainforest, beaches and bumpy roads, where everyone says everything is fine.',
  cast: [
    { id: 'guide', role: 'your local guide', quirk: 'answers every disaster with the national motto for "all good"', name: 'Andrés' },
    { id: 'driver', role: 'a bus driver', quirk: 'stops for every animal on the road', name: 'Don Memo' },
    { id: 'sloth', role: 'a sloth', quirk: 'appears in every video, very slowly', name: 'Lento' },
  ],
};

/** All six experiences in picker order (the playable one first). */
export const EN_ES_TRACKS: readonly LibraryTrack[] = [LIVING_TRACK, MYSTERY_TRACK, DATING_TRACK, FRIENDS_TRACK, FOOD_TRACK, TRAVEL_TRACK];
