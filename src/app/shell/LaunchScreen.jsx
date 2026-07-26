

const MN_LAUNCH_BLOOMS = [
  { color: '#f3bfd8', duration: '7.6s', delay: '-1.2s' },
  { color: '#a9c2ff', duration: '8.8s', delay: '-3.4s' },
  { color: '#9fe2c9', duration: '9.6s', delay: '-5.1s' },
];

function MnBootLogo() {
  return (
    <div className="mn-boot-brand" aria-label="VispNote">
      <img className="mn-boot-logo" src="assets/vispnote-loading-transparent.png" alt="VispNote" />
      <div className="mn-boot-title mn-boot-wordmark">VispNote</div>
      <div className="mn-boot-tagline" style={{
        fontFamily: 'var(--mn-body)', fontSize: 15, letterSpacing: 0, textTransform: 'none',
      }}>Write, connect, act</div>
    </div>
  );
}

function recoveryButtonStyle(primary = false) {
  return {
    minHeight: 36,
    padding: '7px 13px',
    borderRadius: 7,
    border: '1px solid rgba(86,100,124,0.24)',
    background: primary ? '#435b8d' : 'rgba(255,255,255,0.7)',
    color: primary ? '#fff' : '#43506a',
    cursor: 'pointer',
    fontFamily: 'var(--mn-ui)',
    fontSize: 12,
    fontWeight: 700,
  };
}

function MnLaunchScreen({ state, error, onRetry, onOpenDataFolder, T }) {
  const loading = state === 'loading';
  const [actionError, setActionError] = React.useState('');
  const openDataFolder = async () => {
    setActionError('');
    try {
      const result = await onOpenDataFolder?.();
      if (result?.ok === false) setActionError(result.error || 'Could not open the data folder.');
    } catch (nextError) {
      setActionError(nextError?.message || 'Could not open the data folder.');
    }
  };
  return (
    <div className="mn-boot-splash" style={{ position: 'relative', zIndex: 'auto', width: '100vw', height: '100vh' }}>
      <div className="mn-boot-grid" />
      <div className="mn-boot-light-field" aria-hidden="true">
        {MN_LAUNCH_BLOOMS.map((item, i) => (
          <span
            key={`${item.color}-${i}`}
            className="mn-light-bloom"
            style={{
              '--bloom-color': item.color,
              '--bloom-duration': item.duration,
              '--bloom-delay': item.delay,
              animationPlayState: loading ? 'running' : 'paused',
            }}
          />
        ))}
      </div>
      <div className="mn-boot-core">
        <MnBootLogo />
        <div className="mn-boot-subtitle" style={{ color: loading ? '#667187' : '#b84b42' }}>
          {loading ? 'Connecting your workspace' : 'Launch interrupted'}
        </div>

        {loading ? (
          <>
            <div className="mn-boot-status">Opening vault and indexing notes</div>
            <div className="mn-boot-progress"><div /></div>
          </>
        ) : (
          <div role="alert" style={{
            position: 'relative',
            zIndex: 1,
            width: 'min(480px, calc(100vw - 48px))',
            marginTop: 24,
            padding: '16px',
            borderRadius: 8,
            background: 'rgba(255,255,255,0.56)',
            border: '1px solid rgba(120,130,152,0.22)',
            color: '#56647c',
            lineHeight: 1.55,
            textAlign: 'left',
            wordBreak: 'break-word',
          }}>
            <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 15, fontWeight: 750, color: '#35415a' }}>
              VispNote couldn’t open your local workspace
            </div>
            <div style={{ marginTop: 5, fontFamily: 'var(--mn-body)', fontSize: 13 }}>
              Your notes were not changed. Retry now, or open the data folder if a file or permission needs attention.
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
              <button type="button" onClick={onRetry} style={recoveryButtonStyle(true)}>Retry</button>
              <button type="button" onClick={openDataFolder} style={recoveryButtonStyle(false)}>Open data folder</button>
            </div>
            {actionError && <div style={{ marginTop: 9, fontFamily: 'var(--mn-ui)', fontSize: 11.5, color: '#a2463f' }}>{actionError}</div>}
            <details style={{ marginTop: 13, fontFamily: 'var(--mn-mono)', fontSize: 10.5 }}>
              <summary style={{ cursor: 'pointer', color: '#667187' }}>Technical details</summary>
              <pre style={{ margin: '8px 0 0', whiteSpace: 'pre-wrap', maxHeight: 140, overflow: 'auto' }}>
                {error || 'Unknown startup error'}
              </pre>
            </details>
          </div>
        )}
      </div>
      {/* Say the consequence: this is the whole promise of a local-first app. */}
      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 26,
        display: 'flex', justifyContent: 'center', pointerEvents: 'none',
      }}>
        <span style={{ fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: '#667187' }}>
          Nothing leaves this machine
        </span>
      </div>
    </div>
  );
}

export { MnLaunchScreen };
