/**
 * Print the shared checks (validate.ts) for every en-es series: per episode, the share of
 * content words within the level, the words outside it, and every issue.
 *
 * Usage, from engine/:
 *   npx vite-node ../proof/stories/report.ts            # every series
 *   npx vite-node ../proof/stories/report.ts living     # one series (track id suffix)
 *
 * Exit code 1 when any issue is found. Add a series to SERIES below when you write one.
 */
import { createSpanishPack } from '../../engine/src/lang/es';
import { LIVING_STORIES, LIVING_TRACK, LIVING_WORDS } from '../../engine/src/pair/en-es/stories/living';
import type { LibraryStory, LibraryTrack } from '../../engine/src/pair/types';
import { checkSeries } from './validate';
import type { SeriesWords } from './validate';

const SERIES: { track: LibraryTrack; stories: readonly LibraryStory[]; words: SeriesWords }[] = [
  { track: LIVING_TRACK, stories: LIVING_STORIES, words: LIVING_WORDS },
];

const pack = createSpanishPack();
const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
let failed = false;
for (const s of SERIES) {
  if (only.length && !only.some((o) => s.track.id.endsWith(o))) continue;
  console.log(`\n== ${s.track.title} (${s.track.id})`);
  for (const r of checkSeries(pack, s.track, s.stories, s.words)) {
    const outside = Object.entries(r.outOfLevel)
      .map(([w, n]) => (n > 1 ? `${w} x${n}` : w))
      .join(', ');
    console.log(`e${r.episode} level ${r.level}: ${(r.coverage * 100).toFixed(1)}% of ${r.contentWords} content words in level${outside ? `; outside: ${outside}` : ''}`);
    for (const i of r.issues) {
      failed = true;
      console.log(`  ! ${i.where}: ${i.message}`);
    }
  }
}
process.exitCode = failed ? 1 : 0;
