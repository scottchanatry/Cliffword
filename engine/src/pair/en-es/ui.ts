/**
 * English interface strings for Spanish learners, keyed by id. Placeholders are written
 * {name} and filled by the app: {n}, {m}, {minutes}, {seconds}, {round}, {rounds},
 * {sound}, {expected}, {fix}, {region}, {speaker}, {word}, {answer}, {lyric}, {street},
 * {neutral}. Every key a session screen can carry is listed in SESSION_UI_KEYS
 * (engine/src/session/uiKeys.ts); this pack covers all of them. Spoken commands stay in Spanish because the
 * learner says them; their English meaning follows the dash.
 */
export const UI_STRINGS: Readonly<Record<string, string>> = {
  // Tabs and corner menu
  'tab.story': 'Story',
  'tab.music': 'Music',
  'menu.profile': 'Profile',
  'menu.settings': 'Settings',

  // The cliff
  'cliff.prompt': 'Say what comes next.',
  'cliff.holdToSpeak': 'Hold anywhere and say it.',
  'cliff.anyAnswer': 'Any natural answer counts.',
  'cliff.listening': 'Listening…',
  'cliff.pickOne': 'Pick the one that fits.',
  'cliff.hint': 'It starts with “{sound}”.',
  'cliff.answerInEnglish': 'You can answer in English. You’ll hear the Spanish to repeat.',
  'cliff.repeatAloud': 'Now say it out loud.',

  // Where the answer landed
  'landing.actual': 'That’s exactly what the story said.',
  'landing.likely': 'You landed where a Spanish speaker would.',
  'landing.plausible': 'That works. A Spanish speaker could say it too.',
  'landing.form': 'Right word, different form. Try it again.',
  'landing.unlikely': 'Not quite. Here’s what a Spanish speaker would say.',
  'landing.timesInHundred': 'About {n} times in 100, a Spanish speaker says that here.',
  'landing.justAsNatural': '“{word}” is just as natural.',

  // Spoken commands (said in Spanish)
  'commands.title': 'Say these any time',
  'command.otraVez': 'otra vez — again',
  'command.masDespacio': 'más despacio — slower',
  'command.noSe': 'no sé — skip and hear the answer',
  'command.siguiente': 'siguiente — next',
  'command.listo': 'listo — done',

  // Text and tiles
  'text.show': 'Show text',
  'text.hide': 'Hide text',
  'tile.hint': 'Tap a word to hear it. Hold it to see it.',

  // Self-repair and corrections
  'repair.prompt': 'Want to try that again?',
  'repair.expected': 'Expected: {expected}',
  'repair.fix': 'Try: {fix}',
  'story.asks': '{speaker} asks you',
  'story.noSentence': 'No sentence is ready yet. Try again in a moment.',
  'falseFriend.title': 'Looks like English, but isn’t',

  // Timed retell
  'retell.title': 'Retell the story',
  'retell.round': 'Round {round} of {rounds}: {seconds} seconds',
  'retell.start': 'Start',
  'retell.pause': 'Pause',
  'retell.done': 'Done',

  // Progress
  'stats.understood': 'Understood {n} of {m} words',
  'stats.spokenToday': 'Spoken today: {minutes} min',
  'stats.minutesSpoken': 'Minutes spoken',

  // Slang
  'slang.title': 'Slang',
  'slang.neutral': 'Neutral',
  'slang.street': 'Street',
  'slang.region': 'Heard in {region}',
  'slang.formality.casual': 'Casual',
  'slang.formality.street': 'Street',
  'slang.formality.vulgar': 'Vulgar',
  'slang.explicit': 'Explicit',
  'region.PR': 'Puerto Rico',
  'region.DO': 'the Dominican Republic',
  'region.CU': 'Cuba',
  'region.CO': 'Colombia',
  'region.CARIB': 'the Caribbean',

  // Music
  'music.explicitOn': 'Explicit lyrics: on',
  'music.explicitOff': 'Explicit lyrics: off',
  'music.connectAppleMusic': 'Connect Apple Music',
  'music.shareFromSpotify': 'Share a song from Spotify',
  'music.pasteLyrics': 'Paste lyrics',
  'music.pasteLyricsHint': 'Paste the lyrics of the song you’re playing.',
  'music.singBack': 'Sing the line back.',
  'echo.landed': '{n} of {m} landed',
  'lyrics.answer.spelling': 'Same words. Spelling marks don’t count when you sing.',
  'lyrics.answer.neutralForStreet': '“{answer}” is the neutral way to say “{lyric}” ({neutral} for {street}). Both count.',
  'lyrics.answer.streetForNeutral': '“{answer}” is the street way to say “{lyric}” ({street} for {neutral}).',
  'lyrics.answer.streetVariant': 'Different slang, same meaning as “{lyric}”.',
  'lyrics.answer.judgedNeutral': 'Slang can’t be scored directly, so your answer was checked as “{neutral}”.',

  // Start
  'onboarding.brandNew': 'I’m brand new',
};
