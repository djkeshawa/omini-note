// Hidden structural markers. The block's marker ("> ", "# ", "- [ ] ") stays
// out of the textarea while writing and is revealed only while the caret sits
// at the start of the block, so text reads clean but the marker remains
// reachable and editable. Storage is untouched: only the editing projection
// changes, and the markdown rules still reason over the full prefixed text.
import MN_MARKDOWN_INPUT_RULES from '../markdownInputRules.js';

const { useState: useStateHM, useRef: useRefHM, useEffect: useEffectHM,
        useLayoutEffect: useLayoutEffectHM } = React;

export function useHiddenMarker({ block, editing, inputRef }) {
  const [markerRevealed, setMarkerRevealed] = useStateHM(false);
  const editorPrefixLength = MN_MARKDOWN_INPUT_RULES.contentOffsetToEditorOffset?.(block, 0) ?? 0;
  const markerHidden = editorPrefixLength > 0 && !markerRevealed;

  // Fresh edits and kind changes always start hidden.
  useEffectHM(() => { setMarkerRevealed(false); }, [block.kind, editing]);

  // Caret restore for reveal/hide. A setTimeout can fire before React commits
  // the swapped textarea value, so setSelectionRange would clamp against the
  // old text; a layout effect keyed on the toggle runs in the same commit.
  const markerCaretRef = useRefHM(null);
  useLayoutEffectHM(() => {
    if (markerCaretRef.current == null) return;
    const pos = markerCaretRef.current;
    markerCaretRef.current = null;
    if (inputRef.current) inputRef.current.setSelectionRange(pos, pos);
  }, [markerRevealed]);

  // A textarea offset means different things in the two projections.
  const taOffsetToContent = (offset) => markerHidden
    ? Math.max(0, Number(offset) || 0)
    : (MN_MARKDOWN_INPUT_RULES.editorOffsetToContentOffset?.(block, offset) ?? offset);

  // The markdown rules always parse the full prefixed text; when the marker is
  // hidden the prefix is put back first so every conversion rule is identical.
  const parseSourceFor = (value) => {
    if (!markerHidden) return value;
    const full = MN_MARKDOWN_INPUT_RULES.editableMarkdownForBlock?.({ ...block, content: '' }) ?? '';
    return full + value;
  };

  const editorValue = markerHidden
    ? String(block.content ?? '')
    : (MN_MARKDOWN_INPUT_RULES.editableMarkdownForBlock?.(block) ?? block.content);

  // Reveal at content start, hide once the caret moves past the marker. Only
  // collapsed carets toggle, so shift-selections are never disturbed.
  const toggleFromSelect = (ta) => {
    if (!(editorPrefixLength > 0) || ta.selectionStart !== ta.selectionEnd) return false;
    if (markerHidden && ta.selectionStart === 0) {
      markerCaretRef.current = editorPrefixLength;
      setMarkerRevealed(true);
      return true;
    }
    if (markerRevealed && ta.selectionStart > editorPrefixLength) {
      markerCaretRef.current = ta.selectionStart - editorPrefixLength;
      setMarkerRevealed(false);
      return true;
    }
    return false;
  };

  // Writing hides the marker again. Keyup would eventually do this too, but
  // input is the event that actually accompanies the edit -- synthetic typing
  // and IME composition produce no keyup at all.
  const hideAfterInput = (pos) => {
    if (markerRevealed && pos > editorPrefixLength) {
      markerCaretRef.current = pos - editorPrefixLength;
      setMarkerRevealed(false);
    }
  };

  // With the marker revealed and the caret sitting right after it (where the
  // reveal places it), one Backspace removes the block type outright --
  // deleting marker characters one by one leaves artifacts like a paragraph
  // whose text begins with ">".
  const atRevealBoundary = (ta) => markerRevealed
    && ta.selectionStart === editorPrefixLength && ta.selectionEnd === editorPrefixLength;

  return {
    markerRevealed, markerHidden, editorPrefixLength, editorValue,
    taOffsetToContent, parseSourceFor, toggleFromSelect, hideAfterInput, atRevealBoundary,
  };
}
