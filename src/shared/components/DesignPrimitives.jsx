// The four patterns that repeat across every VispNote surface.
// Geometry and type come from designSystem.js; colour comes from theme.jsx.

// ── Group label ─────────────────────────────────────────────────────────────
//
// Replaces every mono ALL-CAPS eyebrow. Sentence case, Inter Tight 11/600.
// `count` is a machine value, so it stays mono.

function DsGroupLabel({ label, count, T, rule = false, style }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      ...dsGroupLabelStyle(T), ...style,
    }}>
      <span>{label}</span>
      {count != null && <span style={dsMachineStyle(T)}>{count}</span>}
      {rule && <div style={{ flex: 1, borderTop: `1px solid ${T.lineSub}` }} />}
    </div>
  );
}

// ── Status pill ─────────────────────────────────────────────────────────────
//
// Dot plus sentence-case word. State is stated, not abbreviated.

function DsStatusPill({ tone = 'neutral', children, T, sunken = false, title, style }) {
  return (
    <span title={title} style={{ ...dsStatusPillStyle(T, { sunken }), ...style }}>
      <span style={dsStatusDotStyle(T, tone)} />
      {children}
    </span>
  );
}

// ── Empty state ─────────────────────────────────────────────────────────────
//
// Icon · Newsreader headline · one sentence explaining the model · exactly one
// action. Say what the thing is and where it lives, then offer the action.

function DsEmptyState({ icon, headline, body, action, T, tone = 'neutral', compact = false, style }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 8, textAlign: 'center', padding: compact ? 18 : '40px 24px', ...style,
    }}>
      {icon && (
        <span style={{
          ...dsToneIconStyle(T, tone, 38),
          borderRadius: DS_RADIUS.panel,
          background: T.bgElevated || T.bg,
        }}>{icon}</span>
      )}
      <span style={{ ...DS_TYPE.sectionHead, fontSize: compact ? 16 : 17, color: T.ink }}>
        {headline}
      </span>
      {body && (
        <span style={{
          maxWidth: 250, fontFamily: 'var(--mn-ui)', fontSize: 12.5,
          lineHeight: 1.5, color: T.inkDim,
        }}>{body}</span>
      )}
      {action && (
        <div style={{
          marginTop: 6, display: 'flex', gap: 6,
          flexWrap: 'wrap', justifyContent: 'center',
        }}>{action}</div>
      )}
    </div>
  );
}

// ── Dialog shell ────────────────────────────────────────────────────────────
//
// Tone icon · 15/650 title · Newsreader consequence · optional subject card ·
// right-aligned actions with the primary last.

function DsDialogShell({
  tone = 'neutral', icon, title, consequence, children, actions,
  T, onDismiss, titleId = 'mn-dialog-title', width = 420, className,
  role = 'dialog', zIndex = 90,
}) {
  const dialogRef = useDialogFocus({ onEscape: onDismiss });
  return (
    <div
      className={className}
      onClick={onDismiss}
      style={{
        position: 'absolute', inset: 0, zIndex,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: T.overlay || `color-mix(in oklab, ${T.ink} 30%, transparent)`,
        backdropFilter: 'blur(2px)',
        animation: 'mnFadeIn 120ms ease',
      }}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={event => event.stopPropagation()}
        style={{
          width, maxWidth: 'calc(100vw - 40px)',
          background: T.bg, color: T.ink,
          border: `1px solid ${T.line}`,
          borderRadius: DS_RADIUS.panel,
          boxShadow: `0 24px 70px color-mix(in oklab, ${T.ink} 26%, transparent)`,
          overflow: 'hidden', fontFamily: 'var(--mn-ui)',
        }}>
        <div style={{ display: 'flex', gap: 12, padding: '18px 20px 14px' }}>
          {icon && <span style={dsToneIconStyle(T, tone, 34)}>{icon}</span>}
          <div style={{ minWidth: 0 }}>
            <div id={titleId} style={{ fontSize: 15, fontWeight: 650, color: T.ink, marginBottom: 4 }}>
              {title}
            </div>
            {consequence && (
              <div style={{ ...DS_TYPE.prose, fontSize: 13, lineHeight: 1.5, color: T.inkMed }}>
                {consequence}
              </div>
            )}
          </div>
        </div>
        {children != null && <div style={{ padding: '0 20px' }}>{children}</div>}
        {actions && (
          <div style={{
            // Three-action dialogs overflow a narrow window without wrapping.
            display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
            gap: 8, flexWrap: 'wrap',
            padding: '16px 20px 18px',
          }}>{actions}</div>
        )}
      </div>
    </div>
  );
}

// The card inside a dialog that names the thing being acted on.
function DsSubjectCard({ title, meta, T }) {
  return (
    <div style={{
      border: `1px solid ${T.lineSub}`, borderRadius: DS_RADIUS.control,
      background: T.bgSub, padding: '11px 12px',
    }}>
      <div style={{
        ...DS_TYPE.rowTitle, color: T.ink, marginBottom: meta ? 5 : 0,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>{title}</div>
      {meta && (
        <div style={{
          display: 'flex', gap: 8, flexWrap: 'wrap',
          fontSize: 11.5, color: T.inkDim,
        }}>{meta}</div>
      )}
    </div>
  );
}

export { DsDialogShell, DsEmptyState, DsGroupLabel, DsStatusPill, DsSubjectCard };
import {
  DS_RADIUS, DS_TYPE, dsGroupLabelStyle, dsMachineStyle,
  dsStatusDotStyle, dsStatusPillStyle, dsToneIconStyle,
} from '../designSystem.js';
import { useDialogFocus } from '../useDialogFocus.js';
