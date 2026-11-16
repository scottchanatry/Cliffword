/**
 * Hold anywhere to speak (BRIEF, OUTLINE 5.5): one long press over the whole screen.
 *
 * - Touch-down warms the recognizer (holdBegin); after 120 ms of holding, listening starts
 *   (holdStart); release sends the utterance (holdEnd). Moving the finger does not cancel the
 *   hold (maxDistance is huge, shouldCancelWhenOutside false); a system cancel, or a scroll
 *   that takes the touch, drops it (holdCancel). A touch that ends before 120 ms (a tap)
 *   cools the recognizer down with holdCancel.
 * - Word tiles read the root gesture from context and block it, so holding a tile reveals
 *   the word instead of listening (WordTile).
 * - Screen-reader users cannot hold anywhere: HoldArea and HoldButton are buttons whose
 *   activate action toggles listening (useListenToggle).
 */
import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { GestureDetector, useLongPressGesture, type LongPressGesture } from 'react-native-gesture-handler';
import type { CommonActions } from '../../session/contract';

/** How long a touch must stay down before listening starts. */
export const HOLD_MIN_MS = 120;

export type HoldActions = Pick<CommonActions, 'holdBegin' | 'holdStart' | 'holdEnd' | 'holdCancel'>;

const RootHoldContext = createContext<LongPressGesture | null>(null);

/** The root hold gesture, for gestures that must win over it (block). Null outside HoldAnywhere. */
export function useRootHold(): LongPressGesture | null {
  return useContext(RootHoldContext);
}

export interface HoldAnywhereProps {
  actions: HoldActions;
  /** Off while nothing listens (loading). */
  enabled?: boolean;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function HoldAnywhere({ actions, enabled = true, children, style, testID }: HoldAnywhereProps) {
  // Callbacks read the latest actions through a ref, so the gesture (and every tile that
  // blocks it) is not rebuilt when the controller hands over new action objects.
  const actionsRef = useRef(actions);
  useEffect(() => {
    actionsRef.current = actions;
  }, [actions]);
  const active = useRef(false);

  const root = useLongPressGesture({
    minDuration: HOLD_MIN_MS,
    maxDistance: 100000,
    shouldCancelWhenOutside: false,
    runOnJS: true,
    enabled,
    testID: 'hold-anywhere',
    onBegin: () => {
      active.current = false;
      actionsRef.current.holdBegin();
    },
    onActivate: () => {
      active.current = true;
      actionsRef.current.holdStart();
    },
    onFinalize: (event) => {
      const wasActive = active.current;
      active.current = false;
      if (wasActive && !event.canceled) actionsRef.current.holdEnd();
      else actionsRef.current.holdCancel();
    },
  });

  return (
    <RootHoldContext.Provider value={root}>
      <GestureDetector gesture={root}>
        <View style={[styles.fill, style]} testID={testID}>
          {children}
        </View>
      </GestureDetector>
    </RootHoldContext.Provider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
