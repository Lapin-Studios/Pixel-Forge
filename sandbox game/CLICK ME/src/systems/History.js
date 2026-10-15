// Snapshot-based undo / redo for strokes, spawns, deletions, castings and world loads.
export class History {
  constructor(game, limit = 14) {
    this.game = game;
    this.limit = limit;
    this.undoStack = [];
    this.redoStack = [];
    this.onChange = null;
  }

  snapshot() {
    const w = this.game.world;
    return {
      w: w.w, h: w.h, ambient: w.ambient,
      cells: w.cells.slice(), temp: w.temp.slice(), life: w.life.slice(),
      burn: w.burn.slice(), pipe: w.pipe.slice(),
      objects: this.game.objects.serialize(),
    };
  }

  push(label = 'Edit') {
    if (!this.game.world) return;
    this.undoStack.push({ label, snap: this.snapshot() });
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
    this.onChange?.();
  }

  markDirty() { /* hook for autosave bookkeeping */ }

  undo() {
    const entry = this.undoStack.pop();
    if (!entry) { this.game.toast('Nothing to undo', 'info'); return; }
    this.redoStack.push({ label: entry.label, snap: this.snapshot() });
    this.game.applySnapshot(entry.snap);
    this.game.audio?.play('undo');
    this.game.toast(`Undo: ${entry.label}`, 'success');
    this.onChange?.();
  }

  redo() {
    const entry = this.redoStack.pop();
    if (!entry) { this.game.toast('Nothing to redo', 'info'); return; }
    this.undoStack.push({ label: entry.label, snap: this.snapshot() });
    this.game.applySnapshot(entry.snap);
    this.game.audio?.play('redo');
    this.game.toast(`Redo: ${entry.label}`, 'success');
    this.onChange?.();
  }

  clear() {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.onChange?.();
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
}
