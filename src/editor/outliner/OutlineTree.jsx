import { MnMemoBlockRow } from './BlockRow.jsx';
import { MnInlineAiPreview } from './OutlinerPopovers.jsx';

function MnOutlineTree({ blocks, depth, ...handlers }) {
  return (
    <>
      {blocks.map(b => (
        <React.Fragment key={b.id}>
          <MnMemoBlockRow block={b} depth={depth} {...handlers} />
          {handlers.aiPreview?.target?.kind === 'insert-after' && handlers.aiPreview.target.blockId === b.id && (
            <MnInlineAiPreview
              preview={handlers.aiPreview}
              depth={depth}
              T={handlers.T}
              onApply={handlers.onApplyAiPreview}
              onCancel={handlers.onCancelAiPreview}
            />
          )}
          {b.children && b.children.length > 0 && !b.collapsed && (
            <MnOutlineTree blocks={b.children} depth={depth + 1} {...handlers} />
          )}
        </React.Fragment>
      ))}
    </>
  );
}

export { MnOutlineTree };
