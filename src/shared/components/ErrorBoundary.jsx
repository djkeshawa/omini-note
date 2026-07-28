// The wall between one broken view and the whole window.
//
// Without a boundary, a render throw anywhere unmounts the entire React root:
// blank window, and the quit-flush listener goes down with it, so unsaved
// notes are lost on the next quit. With one, the crash is contained to the
// content area, the app bar keeps working, and the user gets a way back.

class MnErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('view crashed', error, info?.componentStack || '');
  }

  componentDidUpdate(prevProps) {
    // Switching views (from the app bar, which lives outside the boundary)
    // gives the replacement view a clean start.
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    const { T, onReset, children } = this.props;
    if (!this.state.error) return children;
    return (
      <div style={{
        flex: 1, minHeight: 0, display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        background: T?.bg || '#fff',
      }}>
        <div style={{ maxWidth: 420, textAlign: 'center', padding: 24 }}>
          <div style={{
            fontFamily: 'var(--mn-ui)', fontSize: 15, fontWeight: 600,
            color: T?.ink || '#111', marginBottom: 8,
          }}>This view ran into a problem</div>
          <div style={{
            fontFamily: 'var(--mn-ui)', fontSize: 12.5, lineHeight: 1.5,
            color: T?.inkMed || '#555', marginBottom: 6,
          }}>
            Your notes are safe on disk — only the display failed. Going back
            to your notes usually clears it.
          </div>
          <div style={{
            fontFamily: 'var(--mn-mono)', fontSize: 10.5,
            color: T?.inkDim || '#888', marginBottom: 16,
            overflowWrap: 'anywhere',
          }}>{String(this.state.error?.message || this.state.error)}</div>
          <button
            type="button"
            onClick={() => { this.setState({ error: null }); onReset?.(); }}
            style={{
              height: 32, padding: '0 16px', borderRadius: 8,
              border: 'none', cursor: 'pointer',
              background: T?.ink || '#111', color: T?.bg || '#fff',
              fontFamily: 'var(--mn-ui)', fontSize: 12.5, fontWeight: 600,
            }}>Back to notes</button>
        </div>
      </div>
    );
  }
}

export { MnErrorBoundary };
