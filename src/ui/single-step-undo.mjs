export function undoTargetFromResult(result) {
  return result?.status === "successful" && result.previousItemState
    ? result.previousItemState
    : null;
}

export function canUndoSingleStep({ undoItemState, busy = false }) {
  return !busy && Boolean(undoItemState);
}

export function restoreSingleStepUndo(undoItemState) {
  if (!undoItemState) return null;
  return undoItemState;
}

export function adoptSingleStepResult({ currentItemState, result }) {
  const undoItemState = undoTargetFromResult(result);
  return Object.freeze({
    itemState: undoItemState ? result.itemState : currentItemState,
    undoItemState,
    result
  });
}

export function applySingleStepUndo({ currentItemState, undoItemState }) {
  const restored = restoreSingleStepUndo(undoItemState);
  return Object.freeze({
    itemState: restored ?? currentItemState,
    undoItemState: null,
    result: null,
    undone: Boolean(restored)
  });
}
