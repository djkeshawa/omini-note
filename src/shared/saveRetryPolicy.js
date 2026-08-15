// Save retry policy.
//
// When a note save fails the app used to log, show a modal, and then sit on
// "Saving" forever: the dirty map was never touched, so the debounced save
// effect never re-fired and nothing tried again until the user typed. This
// module owns what happens instead — how many times to retry, how long to
// wait, and the per-note attempt bookkeeping the status pill reads.
//
// It lives in src/shared and imports nothing: the controller that uses it is
// at its no-growth line budget, and the architecture check forbids a shared
// module from reaching up into src/app or src/features.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MN_SAVE_RETRY_POLICY = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  // Three retries, backing off 1s / 4s / 15s. Long enough to ride out a
  // locked file or a drive that is waking up, short enough that the user is
  // told inside half a minute when it is really not going to work.
  const SAVE_RETRY_DELAYS_MS = [1000, 4000, 15000];
  const SAVE_RETRY_MAX_ATTEMPTS = SAVE_RETRY_DELAYS_MS.length;

  // `attempts` is how many retries have already been made for this note.
  // The phase is what the pill states: 'retrying' while another attempt is
  // coming, 'exhausted' once the app has stopped trying on its own.
  function nextRetry(attempts = 0) {
    const made = Number.isFinite(attempts) && attempts > 0 ? Math.floor(attempts) : 0;
    if (made >= SAVE_RETRY_MAX_ATTEMPTS) return { delayMs: null, phase: 'exhausted' };
    return { delayMs: SAVE_RETRY_DELAYS_MS[made], phase: 'retrying' };
  }

  // One notice per failure episode, and only once the app has given up.
  // A notice per attempt would trap focus and yank the caret out of the
  // editor three times in twenty seconds.
  function exhaustedNotice(title = '', detail = '') {
    const message = `VispNote tried three times to save “${title || 'Untitled'}” and could not write to disk. `
      + 'Your text is safe in the app — nothing has been lost. The next edit you make will try again.';
    const reason = String(detail || '').trim();
    return { title: 'Not saved yet', message: reason ? `${message}\n${reason}` : message, tone: 'warn' };
  }

  function createSaveRetryTracker({
    onChange = null,
    schedule = setTimeout,
    cancel = clearTimeout,
    log = console.error,
  } = {}) {
    let states = new Map();
    const timers = new Map();
    // Keys whose next failure was produced by a retry this module scheduled.
    // Kept outside the state map on purpose: arming the mark is bookkeeping,
    // not a transition, and must not re-render the pill.
    const earned = new Set();

    function commit(next) {
      states = next;
      if (onChange) onChange(next);
    }

    function cancelTimer(key) {
      if (!timers.has(key)) return;
      cancel(timers.get(key));
      timers.delete(key);
    }

    function forget(key) {
      cancelTimer(key);
      earned.delete(key);
    }

    // The state map is replaced rather than mutated so React re-renders the
    // pill on every transition.
    function clear(key) {
      forget(key);
      if (!key || !states.has(key)) return false;
      const next = new Map(states);
      next.delete(key);
      commit(next);
      return true;
    }

    // A note that is no longer dirty — deleted, or written by some other path
    // — would otherwise keep its entry forever. The sidebar states the worst
    // status across every vault, so one dead entry pins the whole app on
    // "Not saved". Commit only when something actually went, or the caller's
    // effect would re-render itself in a loop.
    function prune(activeKeys) {
      const keeps = activeKeys && typeof activeKeys.has === 'function' ? key => activeKeys.has(key) : () => false;
      let next = null;
      for (const key of states.keys()) {
        if (keeps(key)) continue;
        if (!next) next = new Map(states);
        forget(key);
        next.delete(key);
      }
      if (!next) return 0;
      const removed = states.size - next.size;
      commit(next);
      return removed;
    }

    // The caller decides what a retry means; all this owes it is the timer
    // and a promise the caller (or a test) can wait on.
    function scheduleRetry(key, delayMs, retry) {
      const run = () => {
        timers.delete(key);
        // Whatever failure this attempt produces is one the policy promised,
        // so it is the one allowed to spend a step of the backoff.
        earned.add(key);
        return Promise.resolve().then(retry).catch(error => log('save retry failed', key, error));
      };
      timers.set(key, schedule(run, delayMs));
    }

    // A failure nobody scheduled — the user typed in a different note and the
    // flush swept this one up again. Hold the episode exactly where it was:
    // no step of the backoff spent, no second timer armed, no announcement.
    function hold(key, entry, id, vaultId) {
      if (entry.id === id && entry.vaultId === vaultId) return entry;
      const held = { ...entry, id, vaultId };
      const next = new Map(states);
      next.set(key, held);
      commit(next);
      return held;
    }

    function fail(key, options = {}) {
      if (!key) return null;
      const { error = null, id = null, vaultId = null, revision = null, title = '', notify = null, retry = null } = options;
      log('saveNote failed', key, error);
      const previous = states.get(key);
      // A newer revision means the user edited the note since the last
      // failure, so this is a fresh episode and it is owed the full backoff
      // again rather than an instant "gave up". It also owes a fresh notice:
      // the user did what the last one asked and it failed anyway.
      const episode = previous && previous.revision === revision ? previous : null;
      const made = episode ? episode.attempts : 0;
      const scheduled = earned.delete(key);
      if (episode && !scheduled) return hold(key, episode, id, vaultId);
      const { delayMs, phase } = nextRetry(made);
      cancelTimer(key);
      // The dialog belongs to the transition into 'exhausted', not to every
      // call that lands there: it steals focus, and the caret with it.
      const spoke = episode ? episode.notified === true : false;
      const announcing = phase === 'exhausted' && !spoke && typeof notify === 'function';
      const entry = { attempts: phase === 'retrying' ? made + 1 : made, phase, id, vaultId, revision, notified: spoke || announcing };
      const next = new Map(states);
      next.set(key, entry);
      commit(next);
      if (phase === 'retrying') {
        if (typeof retry === 'function') scheduleRetry(key, delayMs, retry);
        return entry;
      }
      if (announcing) {
        const notice = exhaustedNotice(title, error?.message || '');
        notify(notice.title, notice.message, notice.tone);
      }
      return entry;
    }

    function dispose() {
      for (const handle of timers.values()) cancel(handle);
      timers.clear();
      earned.clear();
    }

    return { clear, dispose, fail, prune, phaseFor: key => states.get(key)?.phase || '', snapshot: () => states };
  }

  // The React primitives are passed in so this file stays free of imports.
  // One call gives the controller its state, its tracker, and the unmount
  // cleanup that stops a pending retry from firing into a dead tree.
  function useSaveRetries({ useStateA, useRefA, useEffectA, options = {} } = {}) {
    const [saveRetries, setSaveRetries] = useStateA(() => new Map());
    const trackerRef = useRefA(null);
    if (!trackerRef.current) trackerRef.current = createSaveRetryTracker({ ...options, onChange: setSaveRetries });
    useEffectA(() => () => trackerRef.current?.dispose(), []);
    return [saveRetries, trackerRef];
  }

  return {
    SAVE_RETRY_DELAYS_MS,
    SAVE_RETRY_MAX_ATTEMPTS,
    createSaveRetryTracker,
    exhaustedNotice,
    nextRetry,
    useSaveRetries,
  };
});
