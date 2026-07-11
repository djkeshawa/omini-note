import { MnCanvasDeleteDialog, MnCanvasNotePicker } from './CanvasControls.jsx';

export function CanvasDialogs({
  deleteDialogOpen, setDeleteDialogOpen, draft, onDelete,
  notePickerOpen, setNotePickerOpen, notes, addNoteCard, T,
}) {
  return (
    <>
      {deleteDialogOpen && (
        <MnCanvasDeleteDialog
          canvas={draft}
          T={T}
          onCancel={() => setDeleteDialogOpen(false)}
          onConfirm={() => {
            setDeleteDialogOpen(false);
            onDelete?.(draft.id);
          }}
        />
      )}
      {notePickerOpen && (
        <MnCanvasNotePicker
          notes={notes}
          onPick={addNoteCard}
          onClose={() => setNotePickerOpen(false)}
          T={T}
        />
      )}
    </>
  );
}
