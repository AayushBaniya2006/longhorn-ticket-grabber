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
const StatusBadge = ({ status }: { status: SessionStatus }) => {
  const colorMap: Record<SessionStatus, string> = {
    active: 'bg-blue-500',
    monitoring: 'bg-yellow-500 animate-pulse',
    triggered: 'bg-green-500 animate-bounce',
    processing: 'bg-orange-500 animate-pulse',
    processed: 'bg-gray-500',
  };
  return (
    <span className={`px-2 py-1 text-xs font-bold text-white rounded-full ${colorMap[status]}`}>
      {status.toUpperCase()}
    </span>
  );
};

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
    <div className="bg-gray-900 text-gray-100 h-screen p-6 flex flex-col font-sans overflow-hidden">
      <header className="mb-6 shrink-0 text-center">
        <h1 className="text-3xl font-extrabold" style={{ color: '#BF5700' }}>🤘 Longhorn Ticket Grabber</h1>
        <p className="text-gray-400 text-sm mt-1">Run parallel queue sessions to boost your odds on UT&nbsp;Austin student football tickets.</p>
      </header>

      {/* --- GO NOW: a session cleared the queue --- */}
      {Object.keys(clearedAt).length > 0 && (
        <div className="mb-4 bg-green-600/90 border-2 border-green-300 p-4 rounded-lg shrink-0 animate-pulse">
          <h2 className="text-xl font-extrabold text-white mb-1">🎟️ GO NOW — a session cleared!</h2>
          <p className="text-sm text-green-50 mb-2">
            Switch to the highlighted browser window and check out. Once it&rsquo;s your turn you have a
            limited time (set by the ticket site) &mdash; act fast.
          </p>
          <ul className="space-y-1">
            {Object.entries(clearedAt).map(([id, at]) => (
              <li key={id} className="flex items-center justify-between bg-black/20 rounded px-2 py-1">
                <span className="font-mono text-xs text-white truncate">{id}</span>
                <span className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-green-50 tabular-nums">cleared {formatElapsed((now - at) / 1000)} ago</span>
                  <button onClick={() => dismissCleared(id)} className="text-xs bg-white/20 hover:bg-white/30 text-white font-semibold px-2 py-0.5 rounded">
                    I&rsquo;m on it
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* --- Controls --- */}
      <div className="space-y-4 bg-gray-800 p-4 rounded-lg shadow-lg shrink-0">
        <div>
          <label htmlFor="url" className="block text-sm font-medium text-gray-300 mb-1">Ticket page link</label>
          <input type="text" id="url" value={url} onChange={e => setUrl(e.target.value)} className="w-full bg-gray-700 border border-gray-600 rounded-md px-3 py-2 text-white focus:ring-indigo-500 focus:border-indigo-500" />
          <p className="text-xs text-gray-500 mt-1">Pre-filled for UT student football tickets — only change this if UT sent you a specific link.</p>
        </div>
        <div>
          <button type="button" onClick={() => setShowAdvanced(v => !v)} className="text-xs text-gray-400 hover:text-gray-200">
            {showAdvanced ? '▾ Hide advanced settings' : '▸ Advanced settings (you usually don’t need this)'}
          </button>
          {showAdvanced && (
            <div className="mt-2">
              <label htmlFor="selector" className="block text-sm font-medium text-gray-300 mb-1">Queue element to watch (CSS selector)</label>
              <input type="text" id="selector" value={selector} onChange={e => setSelector(e.target.value)} placeholder="e.g., #queue-spinner, .waiting-div" className="w-full bg-gray-700 border border-gray-600 rounded-md px-3 py-2 text-white focus:ring-indigo-500 focus:border-indigo-500" />
              <p className="text-xs text-gray-500 mt-1">Leave as-is unless UT changes their ticketing site. This is the waiting-room element that vanishes when you clear the queue.</p>
              <label className="flex items-start mt-3 text-xs text-gray-400 select-none">
                <input type="checkbox" checked={recordDiagnostics} onChange={e => setRecordDiagnostics(e.target.checked)} className="mr-2 mt-0.5" />
                <span>
                  Record this drop (diagnostics) — logs each session&rsquo;s queue progress and a hashed queue
                  token locally, to check whether parallel sessions really get independent positions. No
                  credentials, no raw tokens.
                </span>
              </label>
            </div>
          )}
        </div>
        <div className="border-t border-gray-700 pt-4">
          <label className="block text-sm font-medium text-gray-300 mb-1">Your UT login <span className="text-gray-500 font-normal">(optional — auto-fills each session)</span></label>
          <div className="flex space-x-3">
            <input type="text" value={eid} onChange={e => setEid(e.target.value)} placeholder="UT EID" autoComplete="off" className="flex-1 bg-gray-700 border border-gray-600 rounded-md px-3 py-2 text-white focus:ring-indigo-500 focus:border-indigo-500" />
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder={hasSavedPassword && !password ? 'Using saved password' : 'Password'} autoComplete="off" className="flex-1 bg-gray-700 border border-gray-600 rounded-md px-3 py-2 text-white focus:ring-indigo-500 focus:border-indigo-500" />
          </div>
          <label className="flex items-center mt-2 text-xs text-gray-400 select-none">
            <input type="checkbox" checked={rememberCreds} onChange={e => setRememberCreds(e.target.checked)} className="mr-2" />
            Remember on this device (saved encrypted; never leaves your Mac). You still approve Duo on your phone.
          </label>
        </div>
        <div className="flex space-x-4">
          <button onClick={handleSpawnSession} disabled={isLoading || !!currentActiveSession} className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-900 disabled:text-gray-500 disabled:cursor-not-allowed text-white font-bold py-2 px-4 rounded-md transition-all duration-200 shadow-md">
            {isLoading ? 'Spawning...' : '1. Spawn New Session'}
          </button>
          <button onClick={handleSessionReady} disabled={isLoading || !currentActiveSession} className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-green-900 disabled:text-gray-500 disabled:cursor-not-allowed text-white font-bold py-2 px-4 rounded-md transition-all duration-200 shadow-md">
            2. Session Ready &amp; Tile
          </button>
        </div>
        {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
        {notice && <p className="text-yellow-300 text-sm mt-2">{notice}</p>}
      </div>

      {/* --- Anti-bot challenge: needs a human --- */}
      {blockedSessions.length > 0 && (
        <div className="mt-6 bg-red-900/50 border-2 border-red-500 p-4 rounded-lg shrink-0 animate-pulse">
          <h2 className="text-lg font-semibold text-red-300 mb-1">
            Needs you: Press &amp; Hold ({blockedSessions.length})
          </h2>
          <p className="text-sm text-red-200 mb-2">
            The site is showing a &ldquo;confirm you are a human&rdquo; check. That window has been brought
            to the front &mdash; press and hold the button in it. These sessions are <strong>not</strong> in
            the queue until you do.
          </p>
          {blockedSessions.map(id => (
            <p key={id} className="text-xs font-mono text-red-200 flex items-center justify-between">
              <span className="truncate">{id}</span>
              {blockedAt[id] && (
                <span className="tabular-nums shrink-0 ml-2">waiting {formatElapsed((now - blockedAt[id]) / 1000)}</span>
              )}
            </p>
          ))}
        </div>
      )}

      {/* --- Processing Session --- */}
      {currentProcessingSession && (
        <div className="mt-6 bg-blue-900/50 border border-blue-500 p-4 rounded-lg shrink-0">
          <h2 className="text-lg font-semibold text-blue-300 mb-2">Processing Session</h2>
          <p className="text-sm">Session ID: {currentProcessingSession}</p>
          <button onClick={() => markProcessed(currentProcessingSession)} className="mt-2 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-md transition-all duration-200 shadow-md">
            Mark as Processed
          </button>
        </div>
      )}

      {/* --- Ready Queue --- */}
      {readyQueue.length > 0 && (
        <div className="mt-6 bg-green-900/50 border border-green-500 p-4 rounded-lg shrink-0">
          <h2 className="text-lg font-semibold text-green-300 mb-2">Ready to Process</h2>
          <ul className="space-y-2">
            {readyQueue.map(id => (
              <li key={id} className="flex items-center justify-between bg-gray-800 p-2 rounded-md">
                <span className="font-mono text-sm">{id}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* --- Queue leaderboard: who's closest to the front --- */}
      {sessions.some(s => s.status === 'monitoring') && (
        <div className="mt-6 shrink-0">
          <h2 className="text-lg font-semibold mb-2 text-gray-100">Closest to the front</h2>
          <ul className="space-y-2">
            {rankByProgress(
              sessions
                .filter(s => s.status === 'monitoring')
                .map(s => ({
                  id: s.id,
                  progress: progress[s.id]?.progress ?? null,
                  usersAhead: progress[s.id]?.usersAhead ?? null,
                }))
            ).map(row => {
              const pct = row.progress === null ? null : Math.round(row.progress * 100);
              return (
                <li key={row.id} className="bg-gray-800 p-2 rounded-md">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-mono text-xs text-indigo-300 truncate">{row.id}</span>
                    <span className="text-xs text-gray-400 shrink-0 ml-2 tabular-nums">
                      {pct === null ? 'waiting…' : `${pct}%`}
                      {row.usersAhead !== null ? ` · ${row.usersAhead.toLocaleString()} ahead` : ''}
                    </span>
                  </div>
                  <div className="h-1.5 bg-gray-700 rounded overflow-hidden">
                    <div className="h-full bg-green-500" style={{ width: `${pct ?? 0}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-gray-500 mt-1">
            Shows the queue page’s own progress when it exposes one. “waiting…” means it isn’t reporting a
            number yet — the session is still holding its place.
          </p>
        </div>
      )}

      {/* --- Session List --- */}
      <div className="mt-6 flex-1 overflow-y-auto">
        <h2 className="text-xl font-semibold mb-3 text-gray-100">All Sessions ({sessions.length})</h2>
        <ul className="space-y-3">
          {[...sessions].reverse().map(session => (
            <li key={session.id} className="bg-gray-800 p-3 rounded-lg flex items-center justify-between shadow-md">
              <div className="min-w-0">
                <p className="font-mono text-indigo-300 truncate">{session.id}</p>
                <p className="text-xs text-gray-400 truncate">{session.url}</p>
              </div>
              <div className="flex items-center space-x-3 shrink-0">
                {(session.status === 'triggered' || session.status === 'processing') && (
                  <button onClick={() => markProcessed(session.id)} className="text-xs bg-blue-600 hover:bg-blue-700 text-white font-semibold py-1 px-2 rounded-md transition-all duration-200">
                    Mark Processed
                  </button>
                )}
                <StatusBadge status={session.status} />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

export default App;
