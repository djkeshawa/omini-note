import { H, SettingsCard, Row, Segmented, Toggle, Select, FontSizeStepper } from '../settingsControls.jsx';
import { platformApi } from '../../platform/index.js';
import { BtnOutline } from '../settingsPrimitives.jsx';
const { useState: useStateS, useEffect: useEffectS } = React;

function SectionUsagePrivacy({ T }) {
  const [status, setStatus] = useStateS(null);
  const [previewOpen, setPreviewOpen] = useStateS(false);
  const [busy, setBusy] = useStateS(false);
  const [message, setMessage] = useStateS('');
  const load = async () => {
    const result = await platformApi.integrations.featureUsage.status?.();
    if (result?.ok) setStatus(result.value);
  };
  useEffectS(() => { load(); }, []);
  const setPreference = async (key, value) => {
    setBusy(true);
    setMessage('');
    try {
      const result = await platformApi.preferences.setPrefs({ [key]: value });
      if (result?.ok === false) throw new Error(result.error || 'Preference could not be saved');
      await load();
    } catch (error) {
      setMessage(error.message || String(error));
    } finally {
      setBusy(false);
    }
  };
  const run = async (action, successMessage) => {
    setBusy(true);
    setMessage('');
    try {
      const result = await action?.();
      if (result?.ok === false) throw new Error(result.error || 'Action failed');
      if (result?.value?.canceled) return;
      setMessage(successMessage);
      await load();
    } catch (error) {
      setMessage(error.message || String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <SettingsCard T={T} style={{ marginTop: 14 }}>
      <Row T={T} label="Local feature report" sub="Count feature use on this device without note text, titles, searches, paths, IDs, prompts, or secrets.">
        <Toggle T={T} checked={status?.localUsageMetrics !== false} disabled={busy}
          onChange={value => setPreference('localUsageMetrics', value)} />
      </Row>
      {status?.anonymousUploadAvailable && (
        <Row T={T} label="Anonymous sharing" sub="Off by default. Shares only aggregate counters, repeat-use days, app version, OS family, and a monthly random ID.">
          <Toggle T={T} checked={status?.anonymousUsageSharing === true} disabled={busy}
            onChange={value => setPreference('anonymousUsageSharing', value)} />
        </Row>
      )}
      <Row T={T} label="Your report" sub="Preview, export, or clear the exact on-device report." last>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <BtnOutline T={T} onClick={() => setPreviewOpen(value => !value)}>{previewOpen ? 'Hide' : 'Preview'}</BtnOutline>
          <BtnOutline T={T} disabled={busy} onClick={() => run(platformApi.integrations.featureUsage.export, 'Report exported.')}>Export</BtnOutline>
          <BtnOutline T={T} danger disabled={busy} onClick={() => run(platformApi.integrations.featureUsage.clear, 'Local report cleared.')}>Clear</BtnOutline>
          {status?.anonymousUploadAvailable && status?.anonymousUsageSharing && (
            <BtnOutline T={T} disabled={busy} onClick={() => run(platformApi.integrations.featureUsage.share, 'Anonymous aggregates shared.')}>Share now</BtnOutline>
          )}
        </div>
      </Row>
      {previewOpen && (
        <pre style={{ margin: '0 16px 16px', padding: 12, maxHeight: 220, overflow: 'auto', borderRadius: 6, background: T.bgSub, border: `1px solid ${T.lineSub}`, color: T.inkMed, fontFamily: 'var(--mn-mono)', fontSize: 10.5, whiteSpace: 'pre-wrap' }}>
          {JSON.stringify(status?.report || {}, null, 2)}
        </pre>
      )}
      {message && <div style={{ padding: '0 16px 14px', color: T.inkMed, fontSize: 12 }}>{message}</div>}
    </SettingsCard>
  );
}

export { SectionUsagePrivacy };
