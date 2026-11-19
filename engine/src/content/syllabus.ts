/**
 * The shared functional syllabus: what a learner can DO with the language, as stable,
 * language-neutral ids ('greet.hello', 'shop.price'). Every pair's stories name the
 * functions they teach (LibraryStory.functions, LibrarySentence.function,
 * LibraryTurn.function) with these ids, so a series ported to another pair keeps its
 * teaching plan while its wording changes (docs/STORY-FORMAT.md).
 *
 * Rules for this file:
 * - Descriptions are plain English and say what the learner does, never how one language
 *   says it (no target-language words, no grammar terms of one language).
 * - `order` is a suggested teaching order (lower first); several ids may share a number.
 *   `stage` is where the function usually first appears (beginner = learner levels 0-1,
 *   intermediate = 2-3, advanced = 4-5).
 * - Ids are 'area.name', lowercase, with camelCase names. Never rename or remove an id
 *   that stories use; add new ones (re-read the file first: other writers add too).
 */

export type SyllabusStage = 'beginner' | 'intermediate' | 'advanced';

export interface SyllabusEntry {
  /** Stable id: 'area.name'. */
  id: string;
  /** What the learner does, in plain English. */
  description: string;
  /** Suggested teaching order (lower first). */
  order: number;
  stage: SyllabusStage;
}

export const SYLLABUS: readonly SyllabusEntry[] = [
  // Greetings and social glue
  { id: 'greet.hello', description: 'Say hello and greet someone at different times of day', order: 1, stage: 'beginner' },
  { id: 'greet.howareyou', description: 'Ask how someone is and answer', order: 2, stage: 'beginner' },
  { id: 'greet.goodbye', description: 'Say goodbye and see you later', order: 3, stage: 'beginner' },
  { id: 'courtesy.please', description: 'Say please and thank you, and answer thanks', order: 4, stage: 'beginner' },
  { id: 'courtesy.sorry', description: 'Apologize, excuse yourself and get someone\'s attention', order: 6, stage: 'beginner' },
  { id: 'courtesy.welcome', description: 'Welcome someone and offer them something', order: 12, stage: 'beginner' },
  { id: 'courtesy.compliment', description: 'Pay a compliment and accept one', order: 28, stage: 'beginner' },

  // Introductions
  { id: 'intro.name', description: 'Say your name and ask someone\'s name', order: 5, stage: 'beginner' },
  { id: 'intro.origin', description: 'Say where you are from and ask where someone is from', order: 7, stage: 'beginner' },
  { id: 'intro.live', description: 'Say where you live and how long you have been there', order: 10, stage: 'beginner' },
  { id: 'intro.job', description: 'Say what you do for a living and ask about someone\'s work', order: 15, stage: 'beginner' },
  { id: 'intro.family', description: 'Talk about family members', order: 20, stage: 'beginner' },
  { id: 'intro.others', description: 'Introduce another person', order: 14, stage: 'beginner' },
  { id: 'intro.age', description: 'Say and ask age', order: 22, stage: 'beginner' },

  // Conversation management
  { id: 'talk.understand', description: 'Say you do not understand and ask someone to repeat or slow down', order: 8, stage: 'beginner' },
  { id: 'talk.meaning', description: 'Ask what a word means or how to say something', order: 9, stage: 'beginner' },
  { id: 'talk.languages', description: 'Say which languages you speak and ask someone to speak another one', order: 10, stage: 'beginner' },
  { id: 'talk.yesno', description: 'Answer yes or no, and maybe', order: 3, stage: 'beginner' },
  { id: 'talk.agree', description: 'Agree and disagree', order: 24, stage: 'beginner' },
  { id: 'talk.surprise', description: 'React with surprise, disbelief or delight', order: 18, stage: 'beginner' },
  { id: 'talk.phone', description: 'Answer the phone, leave a message, text someone', order: 40, stage: 'intermediate' },

  // Numbers, time and dates
  { id: 'number.count', description: 'Count and use small numbers', order: 11, stage: 'beginner' },
  { id: 'number.phone', description: 'Give a phone number or an address number', order: 30, stage: 'beginner' },
  { id: 'time.clock', description: 'Ask and tell the time', order: 19, stage: 'beginner' },
  { id: 'time.days', description: 'Talk about days of the week, today, tomorrow and yesterday', order: 21, stage: 'beginner' },
  { id: 'time.dates', description: 'Talk about dates, months and birthdays', order: 35, stage: 'intermediate' },
  { id: 'time.routine', description: 'Describe a daily routine', order: 33, stage: 'beginner' },
  { id: 'time.frequency', description: 'Say how often you do something', order: 37, stage: 'intermediate' },

  // Shopping and money
  { id: 'shop.want', description: 'Say what you want or are looking for', order: 13, stage: 'beginner' },
  { id: 'shop.price', description: 'Ask how much something costs and understand the price', order: 16, stage: 'beginner' },
  { id: 'shop.size', description: 'Ask for a size, a quantity or another one', order: 26, stage: 'beginner' },
  { id: 'shop.color', description: 'Name colors and ask for another color', order: 23, stage: 'beginner' },
  { id: 'shop.pay', description: 'Pay, ask for change, pay by card or cash', order: 27, stage: 'beginner' },
  { id: 'shop.haggle', description: 'Bargain, complain about a price, ask for a discount', order: 45, stage: 'intermediate' },
  { id: 'shop.return', description: 'Return or exchange something', order: 55, stage: 'intermediate' },

  // Food and drink
  { id: 'food.order', description: 'Order food or drink', order: 17, stage: 'beginner' },
  { id: 'food.taste', description: 'Say how food tastes and whether you like it', order: 25, stage: 'beginner' },
  { id: 'food.likes', description: 'Say what you like, love and hate', order: 18, stage: 'beginner' },
  { id: 'food.bill', description: 'Ask for the bill and split it', order: 29, stage: 'beginner' },
  { id: 'food.diet', description: 'Say what you cannot or do not eat (allergies, preferences)', order: 38, stage: 'intermediate' },
  { id: 'food.cook', description: 'Talk about cooking and recipes', order: 48, stage: 'intermediate' },
  { id: 'food.hungry', description: 'Say you are hungry, thirsty or full', order: 15, stage: 'beginner' },

  // Places and getting around
  { id: 'place.where', description: 'Ask where something is and understand the answer', order: 14, stage: 'beginner' },
  { id: 'place.there', description: 'Say what there is (and is not) somewhere', order: 16, stage: 'beginner' },
  { id: 'drive.directions', description: 'Ask for and follow directions (left, right, straight on)', order: 31, stage: 'beginner' },
  { id: 'drive.transport', description: 'Take a bus, taxi or ride and say where to go', order: 32, stage: 'beginner' },
  { id: 'drive.traffic', description: 'Talk about traffic, being late and parking', order: 42, stage: 'intermediate' },
  { id: 'travel.lodging', description: 'Check in, ask about a room, report a problem', order: 44, stage: 'intermediate' },
  { id: 'travel.tickets', description: 'Buy tickets and ask about times', order: 41, stage: 'intermediate' },

  // Home and neighbors
  { id: 'home.rooms', description: 'Name rooms and things in a home', order: 26, stage: 'beginner' },
  { id: 'home.problem', description: 'Report something broken and ask for a fix', order: 43, stage: 'intermediate' },
  { id: 'home.neighbors', description: 'Chat with neighbors: small favors, noise, gossip', order: 36, stage: 'beginner' },

  // Plans and invitations
  { id: 'plan.invite', description: 'Invite someone and accept or decline', order: 30, stage: 'beginner' },
  { id: 'plan.time', description: 'Agree on when and where to meet', order: 31, stage: 'beginner' },
  { id: 'plan.future', description: 'Say what you are going to do', order: 34, stage: 'beginner' },
  { id: 'plan.suggest', description: 'Suggest doing something together', order: 35, stage: 'beginner' },
  { id: 'plan.cancel', description: 'Cancel or change a plan and give an excuse', order: 47, stage: 'intermediate' },

  // Describing people and things
  { id: 'describe.people', description: 'Describe what someone looks like', order: 39, stage: 'intermediate' },
  { id: 'describe.character', description: 'Describe what someone is like', order: 40, stage: 'intermediate' },
  { id: 'describe.things', description: 'Describe things: big, small, new, old, nice', order: 20, stage: 'beginner' },
  { id: 'describe.compare', description: 'Compare two things or people', order: 49, stage: 'intermediate' },
  { id: 'describe.weather', description: 'Talk about the weather', order: 25, stage: 'beginner' },

  // Feelings and opinions
  { id: 'feel.state', description: 'Say how you feel (tired, happy, nervous, bored)', order: 21, stage: 'beginner' },
  { id: 'feel.opinion', description: 'Give an opinion and ask for one', order: 46, stage: 'intermediate' },
  { id: 'feel.wish', description: 'Say what you wish or hope would happen', order: 60, stage: 'advanced' },
  { id: 'feel.complain', description: 'Complain politely or not so politely', order: 50, stage: 'intermediate' },

  // Health
  { id: 'health.hurts', description: 'Say what hurts and that you feel ill', order: 38, stage: 'intermediate' },
  { id: 'health.pharmacy', description: 'Ask for medicine or help at a pharmacy', order: 52, stage: 'intermediate' },
  { id: 'health.emergency', description: 'Ask for help in an emergency', order: 41, stage: 'intermediate' },

  // Help, permission, obligation
  { id: 'help.ask', description: 'Ask for help or a favor', order: 19, stage: 'beginner' },
  { id: 'help.can', description: 'Ask if you can do something and say what you can do', order: 23, stage: 'beginner' },
  { id: 'help.must', description: 'Say what you have to do', order: 36, stage: 'beginner' },

  // Past and stories
  { id: 'past.yesterday', description: 'Say what you did (yesterday, last week)', order: 44, stage: 'intermediate' },
  { id: 'past.story', description: 'Tell a short story of what happened', order: 54, stage: 'intermediate' },
  { id: 'past.used', description: 'Say what things used to be like', order: 58, stage: 'advanced' },

  // Work and study
  { id: 'work.office', description: 'Talk about tasks, meetings and colleagues', order: 51, stage: 'intermediate' },
  { id: 'work.interview', description: 'Answer questions about yourself in an interview', order: 62, stage: 'advanced' },

  // Dating and friendship
  { id: 'social.flirt', description: 'Flirt, compliment and ask someone out', order: 53, stage: 'intermediate' },
  { id: 'social.friends', description: 'Make plans and banter with friends', order: 37, stage: 'beginner' },
  { id: 'social.party', description: 'Small talk at a party', order: 39, stage: 'intermediate' },

  // Media and travel content
  { id: 'media.recommend', description: 'Recommend a place, a dish or an activity', order: 57, stage: 'intermediate' },
  { id: 'media.describePlace', description: 'Describe a place to an audience', order: 59, stage: 'advanced' },

  // Mystery and reasoning
  { id: 'reason.guess', description: 'Make a guess and say how sure you are', order: 56, stage: 'intermediate' },
  { id: 'reason.because', description: 'Give a reason and ask why', order: 33, stage: 'beginner' },
  { id: 'reason.hypothesis', description: 'Say what would happen if', order: 63, stage: 'advanced' },
];

const BY_ID: ReadonlyMap<string, SyllabusEntry> = new Map(SYLLABUS.map((e) => [e.id, e]));

/** Every syllabus id. */
export const SYLLABUS_IDS: ReadonlySet<string> = new Set(BY_ID.keys());

/** The entry of a syllabus id, or undefined for an unknown id. */
export function syllabusEntry(id: string): SyllabusEntry | undefined {
  return BY_ID.get(id);
}

/** True for an id of the shared syllabus. */
export function isSyllabusId(id: string): boolean {
  return BY_ID.has(id);
}

/** Syllabus ids in suggested teaching order (ties by id). */
export function syllabusInOrder(): string[] {
  return [...SYLLABUS].sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((e) => e.id);
}
