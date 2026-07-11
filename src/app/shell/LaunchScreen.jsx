

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
      <div className="mn-boot-tagline"><span>Capture</span><i /><span>Organize</span><i /><span>Remember</span></div>
    </div>
  );
}

function MnLaunchScreen({ state, error, T }) {
  const loading = state === 'loading';
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
          <div style={{
            position: 'relative',
            zIndex: 1,
            width: 'min(420px, calc(100vw - 48px))',
            marginTop: 24,
            padding: '12px 14px',
            borderRadius: 8,
            background: 'rgba(255,255,255,0.56)',
            border: '1px solid rgba(120,130,152,0.22)',
            color: '#56647c',
            fontFamily: 'var(--mn-mono)',
            fontSize: 11,
            lineHeight: 1.55,
            textAlign: 'left',
            wordBreak: 'break-word',
          }}>{error || 'Unknown startup error'}</div>
        )}
      </div>
    </div>
  );
}

export { MnLaunchScreen };
