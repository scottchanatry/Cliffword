import { MusicLibraryView } from '../../../src/features/music/MusicLibraryView';
import { useMusicLibrary } from '../../../src/music/useMusicLibrary';

/** Your music (C3): sources, the library with its slang summary, shares, texts, regions and explicit lyrics. */
export default function MusicLibraryRoute() {
  const { props } = useMusicLibrary();
  return <MusicLibraryView {...props} />;
}
