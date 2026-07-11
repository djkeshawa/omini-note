import { MnCanvasDashboard } from './components/CanvasDashboard.jsx';
import { MnCanvasEditor } from './components/CanvasEditor.jsx';
export { MnCanvasEmbed } from './components/CanvasElements.jsx';

function MnCanvasPanel({ canvases, activeCanvas, onCreate, onOpen, onBack, onSave, onDelete, notes = [], onOpenNote, onTextEditingChange, T }) {
  if (activeCanvas) {
    return (
      <MnCanvasEditor
        canvas={activeCanvas}
        onBack={onBack}
        onSave={onSave}
        onDelete={onDelete}
        notes={notes}
        onOpenNote={onOpenNote}
        onTextEditingChange={onTextEditingChange}
        T={T}
      />
    );
  }
  return (
    <MnCanvasDashboard
      canvases={canvases}
      onCreate={onCreate}
      onOpen={onOpen}
      onDelete={onDelete}
      T={T}
    />
  );
}

export { MnCanvasPanel };
