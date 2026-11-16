import { TextPasteView } from '../../src/features/music/TextPasteView';
import { useTextPaste } from '../../src/music/useTextPaste';

/** Bring a text: paste an article or a transcript; it stays on this device. */
export default function TextPasteRoute() {
  const props = useTextPaste();
  return <TextPasteView {...props} />;
}
