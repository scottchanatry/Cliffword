import { HoldButton } from '../../components/voice/HoldButton';
import type { ListenState } from '../../session/contract';

export interface SingItButtonProps {
  /** "Sing it", "Say it street": drawn in Anton, uppercase. */
  label: string;
  listen: ListenState;
  /** Starts or stops listening: the screen-reader activate action. */
  onToggle: () => void;
  /** 68 (C1) or 64 (C2). */
  height?: number;
  testID?: string;
}

/**
 * The big ink "SING IT" button of the Tarima look (C1, C2): the shared HoldButton in its tarima
 * look. Holding it is holding anywhere; a quick tap shows how to hold; while listening it turns
 * live orange and shows what is heard; for screen readers its activate action toggles listening.
 */
export function SingItButton({ height = 68, testID = 'sing-it', ...props }: SingItButtonProps) {
  return <HoldButton {...props} look="tarima" height={height} testID={testID} />;
}
