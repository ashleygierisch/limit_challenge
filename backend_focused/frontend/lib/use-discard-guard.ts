'use client';

/**
 * Stops a half-filled form being thrown away by an accidental dismissal.
 *
 * A MUI Dialog closes on a backdrop click and on Escape, and these forms are
 * remounted on every open so they start empty — which means one stray click
 * beside the dialog silently discards everything typed so far.
 *
 * Once the form differs from what it opened with, those two routes ask for
 * confirmation instead of closing. Pressing Cancel asks too. Nothing is
 * blocked: the user can always leave, they are just never surprised by it.
 * An untouched form still closes immediately, so the guard is invisible until
 * it is needed.
 */

import { useCallback, useRef, useState } from 'react';

/**
 * Whether `current` differs from what it was on first render.
 *
 * The snapshot is taken once per mount. These dialogs are keyed by their
 * parent so each open is a fresh mount, which makes "first render" exactly
 * "the state the form opened with".
 */
export function useIsDirty(current: unknown): boolean {
  const initial = useRef<string | null>(null);
  const serialized = JSON.stringify(current);
  initial.current ??= serialized;
  return serialized !== initial.current;
}

export interface DiscardGuard {
  /** Pass to `<Dialog onClose>`; ignores nothing, but asks when dirty. */
  handleDialogClose: (event: unknown, reason?: string) => void;
  /** Pass to the Cancel button. */
  requestClose: () => void;
  /** Whether the "discard changes?" prompt is showing. */
  confirming: boolean;
  /** Discard and close. */
  confirmDiscard: () => void;
  /** Dismiss the prompt and stay in the form. */
  keepEditing: () => void;
}

export function useDiscardGuard(dirty: boolean, close: () => void): DiscardGuard {
  const [confirming, setConfirming] = useState(false);

  const requestClose = useCallback(() => {
    if (dirty) setConfirming(true);
    else close();
  }, [close, dirty]);

  const handleDialogClose = useCallback(
    (_event: unknown, reason?: string) => {
      // Only the accidental routes are guarded. A caller that closes the
      // dialog itself — after a successful save — passes no reason and goes
      // straight through.
      if (dirty && (reason === 'backdropClick' || reason === 'escapeKeyDown')) {
        setConfirming(true);
        return;
      }
      close();
    },
    [close, dirty],
  );

  return {
    handleDialogClose,
    requestClose,
    confirming,
    confirmDiscard: useCallback(() => {
      setConfirming(false);
      close();
    }, [close]),
    keepEditing: useCallback(() => setConfirming(false), []),
  };
}
