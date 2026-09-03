import React, { useEffect, useState } from 'react';
import './App.css';
import { formatElapsed } from './alerts';
import { rankByProgress } from '../backend/session-queue';

// --- Type Definitions ---
type SessionStatus = 'active' | 'monitoring' | 'triggered' | 'processing' | 'processed';
interface Session {
  id: string;
  status: SessionStatus;
  url: string;
}

// --- Helper Components ---
const StatusBadge = ({ status }: { status: SessionStatus }) => (
  <span className={`pill pill--${status}`}>{status.toUpperCase()}</span>
);

const App = () => {
  // --- State Management ---
  const [url, setUrl] = useState('https://texaslonghorns.evenue.net/signin');
  const [selector, setSelector] = useState('#hlLinkToQueueTicket2Text');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [readyQueue, setReadyQueue] = useState<string[]>([]);
  // Sessions sitting on a "Press & Hold" anti-bot interstitial, waiting for the user to clear it.
  const [blockedSessions, setBlockedSessions] = useState<string[]>([]);
  const [currentActiveSession, setCurrentActiveSession] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [currentProcessingSession, setCurrentProcessingSession] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [recordDiagnostics, setRecordDiagnostics] = useState(false);
  const [eid, setEid] = useState('');
  const [password, setPassword] = useState('');
  const [rememberCreds, setRememberCreds] = useState(true);
  const [hasSavedPassword, setHasSavedPassword] = useState(false);
  // "Never miss a clear" alerts: when each session cleared the queue / hit a Press & Hold, so we can
  // show an elapsed urgency timer and flash the title. Values are epoch-ms keyed by session id.
  const [clearedAt, setClearedAt] = useState<Record<string, number>>({});
  const [blockedAt, setBlockedAt] = useState<Record<string, number>>({});
  const [now, setNow] = useState<number>(() => Date.now());
  // Live Queue-it progress per session (for the "closest to the front" leaderboard).
  const [progress, setProgress] = useState<Record<string, { progress: number | null; usersAhead: number | null }>>({});

  // --- Effects ---
  // Listen for triggers from the main process.
  useEffect(() => {
    if (!window.api) return;
    const cleanup = window.api.receive(window.api.channels.MainToRendererChannels.SESSION_TRIGGERED, (data) => {
      const { sessionId } = data;
      console.log(`Trigger received for session: ${sessionId}`);
      setSessions(prev =>
        prev.map(s => (s.id === sessionId ? { ...s, status: 'triggered' } : s))
      );
      setReadyQueue(prev => [...prev, sessionId]);
      setClearedAt(prev => ({ ...prev, [sessionId]: Date.now() }));
    });
    return cleanup;
  }, []);

  useEffect(() => {
    if (!window.api) return;
    const cleanup = window.api.receive(window.api.channels.MainToRendererChannels.SESSION_PROCESSING, (data) => {
      const { sessionId } = data;
      console.log(`Processing started for session: ${sessionId}`);
      setSessions(prev =>
        prev.map(s => (s.id === sessionId ? { ...s, status: 'processing' } : s))
      );
      setCurrentProcessingSession(sessionId);
    });
    return cleanup;
  }, []);

  // An anti-bot challenge is on screen in one of the sessions. The main process has already brought
  // that window forward; all the UI has to do is tell the user which one needs them.
  useEffect(() => {
    if (!window.api) return;
    const cleanup = window.api.receive(window.api.channels.MainToRendererChannels.SESSION_BLOCKED, (data) => {
      setBlockedSessions(prev => (prev.includes(data.sessionId) ? prev : [...prev, data.sessionId]));
      setBlockedAt(prev => (prev[data.sessionId] ? prev : { ...prev, [data.sessionId]: Date.now() }));
    });
    return cleanup;
  }, []);

  useEffect(() => {
    if (!window.api) return;
    const cleanup = window.api.receive(window.api.channels.MainToRendererChannels.SESSION_UNBLOCKED, (data) => {
      setBlockedSessions(prev => prev.filter(id => id !== data.sessionId));
      setBlockedAt(prev => {
        const next = { ...prev };
        delete next[data.sessionId];
        return next;
      });
    });
    return cleanup;
  }, []);

  // Live Queue-it progress updates for the leaderboard.
  useEffect(() => {
    if (!window.api) return;
    const cleanup = window.api.receive(window.api.channels.MainToRendererChannels.SESSION_PROGRESS, (data) => {
      setProgress(prev => ({ ...prev, [data.sessionId]: { progress: data.progress, usersAhead: data.usersAhead } }));
    });
    return cleanup;
  }, []);

  // Load any saved UT login on startup (stored encrypted on this device).
  useEffect(() => {
    if (!window.api) return;
    (async () => {
      const res = await window.api.request(window.api.channels.RequestResponseChannels.LOAD_CREDENTIALS, {});
      if (res?.remembered) {
        setEid(res.eid);
        // The password is never sent to the renderer; we only know one is stored. Leave the field
        // blank and show a "saved" placeholder — the main process fills it in on spawn.
        setHasSavedPassword(!!res.hasPassword);
        setRememberCreds(true);
      }
    })();
  }, []);

  // Tick once a second so the elapsed-time labels update while any alert is showing.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Flash the window title while a session needs attention, so it's obvious even when the app is
  // behind other windows. Restores the plain title once nothing is waiting.
  useEffect(() => {
    const base = 'Longhorn Ticket Grabber';
    const hasAlerts = Object.keys(clearedAt).length > 0 || blockedSessions.length > 0;
    if (!hasAlerts) {
      document.title = base;
      return;
    }
    let on = false;
    const flash = () => {
      document.title = on ? '⚠️ ACTION NEEDED — Longhorn Ticket Grabber' : base;
      on = !on;
    };
    flash();
    const t = setInterval(flash, 800);
    return () => {
      clearInterval(t);
      document.title = base;
    };
  }, [clearedAt, blockedSessions]);

  // --- Event Handlers ---
  const handleSpawnSession = async () => {
    if (currentActiveSession) {
      setError('A session is already active. Mark it as ready first.');
      return;
    }
    if (!window.api) {
      setError('App bridge failed to load — please reinstall the app.');
      return;
    }
    setIsLoading(true);
    setError(null);
    setNotice(null);
    // Persist (or clear) the saved login — but only when there's something to do, and NEVER blocking
    // the spawn on it. Saving touches the OS keychain (and can pop a keychain permission dialog); if
    // no credentials were entered there's nothing to store, so we skip it entirely and go straight to
    // spawning. Guarded so a save failure surfaces as a notice instead of an unhandled rejection.
    const hasCredsToSave = eid.trim() !== '' || password !== '';
    if (!rememberCreds || hasCredsToSave) {
      // Save concurrently — never block the spawn on the keychain. Awaited inside its own async
      // block (so the nested-Promise response type unwraps) and guarded so a failure shows a notice
      // instead of an unhandled rejection or a stuck spawn.
      void (async () => {
        try {
          const saveRes = await window.api.request(window.api.channels.RequestResponseChannels.SAVE_CREDENTIALS, { eid, password, remember: rememberCreds });
          if (rememberCreds && saveRes && !saveRes.success && saveRes.error) setNotice(saveRes.error);
        } catch {
          setNotice('Could not save your login on this device; you can still continue.');
        }
      })();
    }
    const res = await window.api.request(window.api.channels.RequestResponseChannels.SPAWN_SESSION, { url, selector, eid, password, recordDiagnostics });
    if (res?.success) {
      setCurrentActiveSession(res.sessionId!);
      setSessions(prev => [...prev, { id: res.sessionId!, status: 'active', url }]);
    } else {
      setError(res?.error || 'Failed to spawn session');
    }
    setIsLoading(false);
  };

  const handleSessionReady = async () => {
    if (!currentActiveSession) return;
    setIsLoading(true);
    setError(null);
    setNotice(null);
    const res = await window.api.request(window.api.channels.RequestResponseChannels.SESSION_READY, { sessionId: currentActiveSession });
    console.log('Session ready response:', res);
    if (res?.success) {
      setSessions(prev =>
        prev.map(s => (s.id === currentActiveSession ? { ...s, status: 'monitoring' } : s))
      );
      if (res.warning) setNotice(res.warning);
      setCurrentActiveSession(null);
    } else {
      setError(res?.error || 'Failed to mark session as ready');
    }
    setIsLoading(false);
  };

  const markProcessed = (sessionId: string) => {
    window.api.send(window.api.channels.RendererToMainChannels.MARK_SESSION_PROCESSED, { sessionId });
    setSessions(prev =>
      prev.map(s => (s.id === sessionId ? { ...s, status: 'processed' } : s))
    );
    setReadyQueue(prev => prev.filter(id => id !== sessionId));
    setClearedAt(prev => {
      const next = { ...prev };
      delete next[sessionId];
      return next;
    });
    if (sessionId === currentProcessingSession) setCurrentProcessingSession(null);
  };

  // "I'm on it" — stop the cleared-session nag without marking it processed (the user may still be
  // mid-checkout). The session stays in the list and in the Ready/Processing panels below.
  const dismissCleared = (sessionId: string) => {
    setClearedAt(prev => {
      const next = { ...prev };
      delete next[sessionId];
      return next;
    });
  };

  // --- Render Logic ---
  return (
    <div className="shell">
      <header className="topbar">
        <div>
          <div className="brand"><span className="hook">🤘</span><h1>Longhorn <span className="lt">Ticket&nbsp;Grabber</span></h1></div>
          <p className="tagline">Parallel queue sessions · UT student football</p>
        </div>
        <div className="live"><span className="dot" />{sessions.length} session{sessions.length === 1 ? '' : 's'}</div>
      </header>

      <div className="scroll">

      {/* --- GO NOW: a session cleared the queue --- */}
      {Object.keys(clearedAt).length > 0 && (
        <div className="alert alert--go pulse">
          <h2 className="alert-title">🎟️ GO NOW — a session cleared</h2>
          <p className="alert-body">
            Switch to the highlighted browser window and check out. Once it&rsquo;s your turn you have a
            limited time (set by the ticket site) &mdash; act fast.
          </p>
          {Object.entries(clearedAt).map(([id, at]) => (
            <div key={id} className="alert-row">
              <span className="id mono truncate">{id}</span>
              <span className="hstack">
                <span className="timer mono">cleared {formatElapsed((now - at) / 1000)} ago</span>
                <button onClick={() => dismissCleared(id)} className="btn btn--sm btn--go">I&rsquo;m on it</button>
              </span>
            </div>
          ))}
        </div>
      )}

      {/* --- Controls --- */}
      <div className="card">
        <div className="field">
          <label htmlFor="url" className="field-label">Ticket page link</label>
          <input type="text" id="url" value={url} onChange={e => setUrl(e.target.value)} className="text-input mono" />
          <p className="hint">Pre-filled for UT student football tickets — only change this if UT sent you a specific link.</p>
        </div>
        <div className="field">
          <button type="button" onClick={() => setShowAdvanced(v => !v)} className="disclosure">
            {showAdvanced ? '▾ Hide advanced settings' : '▸ Advanced settings (you usually don’t need this)'}
          </button>
          {showAdvanced && (
            <div style={{ marginTop: 10 }}>
              <label htmlFor="selector" className="field-label">Queue element to watch (CSS selector)</label>
              <input type="text" id="selector" value={selector} onChange={e => setSelector(e.target.value)} placeholder="e.g., #queue-spinner, .waiting-div" className="text-input mono" />
              <p className="hint">Leave as-is unless UT changes their ticketing site. This is the waiting-room element that vanishes when you clear the queue.</p>
              <label className="check">
                <input type="checkbox" checked={recordDiagnostics} onChange={e => setRecordDiagnostics(e.target.checked)} />
                <span>
                  Record this drop (diagnostics) — logs each session&rsquo;s queue progress and a hashed queue
                  token locally, to check whether parallel sessions really get independent positions. No
                  credentials, no raw tokens.
                </span>
              </label>
            </div>
          )}
        </div>
        <hr className="divider" />
        <div className="field">
          <label className="field-label">Your UT login <span className="opt">(optional — auto-fills each session)</span></label>
          <div className="hstack" style={{ gap: 10 }}>
            <input type="text" value={eid} onChange={e => setEid(e.target.value)} placeholder="UT EID" autoComplete="off" className="text-input mono" style={{ flex: 1 }} />
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder={hasSavedPassword && !password ? 'Using saved password' : 'Password'} autoComplete="off" className="text-input mono" style={{ flex: 1 }} />
          </div>
          <label className="check">
            <input type="checkbox" checked={rememberCreds} onChange={e => setRememberCreds(e.target.checked)} />
            Remember on this device (saved encrypted; never leaves your Mac). You still approve Duo on your phone.
          </label>
        </div>
        <div className="actions">
          <button onClick={handleSpawnSession} disabled={isLoading || !!currentActiveSession} className="btn btn--grow btn--primary">
            {isLoading ? 'Spawning…' : '1. Spawn New Session'}
          </button>
          <button onClick={handleSessionReady} disabled={isLoading || !currentActiveSession} className="btn btn--grow btn--arm">
            2. Session Ready &amp; Tile
          </button>
        </div>
        {error && <p className="msg-error">{error}</p>}
        {notice && <p className="msg-notice">{notice}</p>}
      </div>

      {/* --- Anti-bot challenge: needs a human --- */}
      {blockedSessions.length > 0 && (
        <div className="alert alert--block pulse">
          <h2 className="alert-title">✋ Needs you: Press &amp; Hold ({blockedSessions.length})</h2>
          <p className="alert-body">
            The site is showing a &ldquo;confirm you are a human&rdquo; check. That window has been brought
            to the front &mdash; press and hold the button in it. These sessions are <strong>not</strong> in
            the queue until you do.
          </p>
          {blockedSessions.map(id => (
            <div key={id} className="alert-row">
              <span className="id mono truncate">{id}</span>
              {blockedAt[id] && (
                <span className="timer mono">waiting {formatElapsed((now - blockedAt[id]) / 1000)}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* --- Processing Session --- */}
      {currentProcessingSession && (
        <div className="panel panel--proc">
          <h2 className="panel-title">Processing Session</h2>
          <p className="mono" style={{ fontSize: 13 }}>Session ID: {currentProcessingSession}</p>
          <button onClick={() => markProcessed(currentProcessingSession)} className="btn btn--primary" style={{ marginTop: 11 }}>
            Mark as Processed
          </button>
        </div>
      )}

      {/* --- Ready Queue --- */}
      {readyQueue.length > 0 && (
        <div className="panel">
          <h2 className="panel-title">Ready to Process</h2>
          <div className="rows">
            {readyQueue.map(id => (
              <div key={id} className="row"><span className="rid mono truncate">{id}</span></div>
            ))}
          </div>
        </div>
      )}

      {/* --- Queue leaderboard: who's closest to the front --- */}
      {sessions.some(s => s.status === 'monitoring') && (
        <div>
          <div className="section-head"><h2>Closest to the front</h2></div>
          <div className="lanes">
            {rankByProgress(
              sessions
                .filter(s => s.status === 'monitoring')
                .map(s => ({
                  id: s.id,
                  progress: progress[s.id]?.progress ?? null,
                  usersAhead: progress[s.id]?.usersAhead ?? null,
                }))
            ).map((row, i) => {
              const pct = row.progress === null ? null : Math.round(row.progress * 100);
              const lead = i === 0 && (pct !== null || row.usersAhead !== null);
              return (
                <div key={row.id} className={lead ? 'lane lead' : 'lane'}>
                  <span className="rank">{i + 1}</span>
                  <div style={{ minWidth: 0 }}>
                    <span className="laneid mono truncate">{row.id}</span>
                    <div className="track"><div className="fill" style={{ width: `${pct ?? 0}%` }} /></div>
                  </div>
                  <span className="metric mono">
                    {pct === null ? 'waiting…' : `${pct}%`}
                    {row.usersAhead !== null && <span className="ahead"> · {row.usersAhead.toLocaleString()} ahead</span>}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="hint">
            Ranks each session by the queue page’s own progress. “waiting…” means it isn’t reporting a
            number yet — the session is still holding its place.
          </p>
        </div>
      )}

      {/* --- Session List --- */}
      <div>
        <div className="section-head"><h2>All Sessions ({sessions.length})</h2></div>
        <div className="rows">
          {[...sessions].reverse().map(session => (
            <div key={session.id} className="row">
              <div style={{ minWidth: 0 }}>
                <div className="rid mono truncate">{session.id}</div>
                <div className="rurl truncate">{session.url}</div>
              </div>
              <div className="row-right">
                {(session.status === 'triggered' || session.status === 'processing') && (
                  <button onClick={() => markProcessed(session.id)} className="btn btn--sm btn--arm">
                    Mark Processed
                  </button>
                )}
                <StatusBadge status={session.status} />
              </div>
            </div>
          ))}
        </div>
      </div>

      </div>
    </div>
  );
};

export default App;
