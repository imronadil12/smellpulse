import { useState, useMemo, useRef, useEffect } from 'react';
import {
  Activity,
  Flame,
  X,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  AlertTriangle,
  Lock,
} from 'lucide-react';

export interface OdorObservation {
  id: string;
  clientTokenHash: string;
  intensity: 1 | 2 | 3 | 4 | 5;
  submittedAt: number; // epoch ms
  supersededAt?: number | null;
  withdrawnAt?: number | null;
  hiddenAt?: number | null;
  hiddenReason?: string;
}

export interface LiveStatusSummary {
  activeCount: number;
  headline: string;
  interpretation: string;
  medianIntensity: number | null;
  latestAgeMinutes: number | null;
}

export const LIVE_WINDOW_MS = 45 * 60 * 1000;
export const EPISODE_GAP_MS = 90 * 60 * 1000;

const HERO_PHOTO_URL =
  'https://images.unsplash.com/photo-1744625846268-14c81de2f094?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w4NDM0ODN8MHwxfHJhbmRvbXx8fHx8fHx8fDE3OTQ0NjIxODN8&ixlib=rb-4.1.0&q=80&w=1080';

const INTENSITY_LEVELS: { value: 1 | 2 | 3 | 4 | 5; label: string }[] = [
  { value: 1, label: 'Faint' },
  { value: 2, label: 'Mild' },
  { value: 3, label: 'Mod' },
  { value: 4, label: 'Strong' },
  { value: 5, label: 'Max' },
];

export function computeLiveMetrics(
  observations: OdorObservation[],
  nowMs: number = Date.now()
): LiveStatusSummary {
  const latestByClient = new Map<string, OdorObservation>();
  for (const obs of observations) {
    if (obs.supersededAt || obs.withdrawnAt || obs.hiddenAt) continue;
    if (nowMs - obs.submittedAt > LIVE_WINDOW_MS) continue;
    const prev = latestByClient.get(obs.clientTokenHash);
    if (!prev || obs.submittedAt > prev.submittedAt) {
      latestByClient.set(obs.clientTokenHash, obs);
    }
  }

  const qualifying = Array.from(latestByClient.values()).sort(
    (a, b) => b.submittedAt - a.submittedAt
  );
  const activeCount = qualifying.length;

  let medianIntensity: number | null = null;
  if (activeCount > 0) {
    const sorted = qualifying.map((o) => o.intensity).sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    medianIntensity =
      sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  }

  const latestAgeMinutes =
    activeCount > 0
      ? Math.max(1, Math.round((nowMs - qualifying[0].submittedAt) / 60000))
      : null;

  if (activeCount === 0) {
    return {
      activeCount: 0,
      headline: 'NO RECENT ODOR REPORTS',
      interpretation:
        'Nobody has submitted an odor observation in the last 45m. Conditions are unknown — never a guarantee of safety.',
      medianIntensity: null,
      latestAgeMinutes: null,
    };
  }

  if (activeCount === 1) {
    return {
      activeCount: 1,
      headline: 'ONE RECENT ODOR REPORT',
      interpretation:
        'One reporting browser submitted an odor observation in the last 45m. Self-reported observations only — never a safety test.',
      medianIntensity,
      latestAgeMinutes,
    };
  }

  return {
    activeCount,
    headline: 'MULTIPLE RECENT ODOR REPORTS',
    interpretation:
      'More than one browser reported an odor in the last 45m. Self-reported observations only — never a safety test.',
    medianIntensity,
    latestAgeMinutes,
  };
}

function createInitialObservations(now: number): OdorObservation[] {
  const m = 60 * 1000;
  return [
    {
      id: 'obs-1',
      clientTokenHash: '#9a4c',
      intensity: 4,
      submittedAt: now - 3 * m,
    },
    {
      id: 'obs-2',
      clientTokenHash: '#3f18',
      intensity: 3,
      submittedAt: now - 7 * m,
    },
    {
      id: 'obs-3',
      clientTokenHash: '#7b02',
      intensity: 4,
      submittedAt: now - 14 * m,
    },
    {
      id: 'obs-4',
      clientTokenHash: '#5d91',
      intensity: 3,
      submittedAt: now - 22 * m,
    },
    {
      id: 'obs-5',
      clientTokenHash: '#e104',
      intensity: 5,
      submittedAt: now - 18 * m,
      hiddenAt: now - 15 * m,
      hiddenReason: 'Spam burst',
    },
  ];
}

export function SmellPulseApp() {
  const [nowMs] = useState<number>(() => Date.now());
  const [clientToken] = useState<string>('#9a4c');
  const [observations, setObservations] = useState<OdorObservation[]>(() =>
    createInitialObservations(Date.now())
  );

  // UI Flow State
  const [isPickerOpen, setIsPickerOpen] = useState<boolean>(false);
  const [submittedReport, setSubmittedReport] = useState<{
    id: string;
    intensity: 1 | 2 | 3 | 4 | 5;
    label: string;
  } | null>(null);
  const [thankYouSecondsLeft, setThankYouSecondsLeft] = useState<number>(0);
  const [isSheetOpen, setIsSheetOpen] = useState<boolean>(false);
  const [sheetSlide, setSheetSlide] = useState<'status' | 'history'>('status');
  const [isAdminView, setIsAdminView] = useState<boolean>(() =>
    typeof window !== 'undefined' && window.location.search.includes('view=admin')
  );
  const [safetyContact, setSafetyContact] = useState<string>(
    'Facilities Desk · Ext. 4400 / (555) 019-9400'
  );
  const [savedBanner, setSavedBanner] = useState<boolean>(false);
  const [pulseKey, setPulseKey] = useState<number>(0);

  useEffect(() => {
    document.title = 'SmellPulse — Office Odor Observation Board';
    const syncFromApi = async () => {
      try {
        const res = await fetch('/api/admin');
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.observations) && data.observations.length > 0) {
            setObservations(data.observations);
          }
          if (typeof data.safetyContact === 'string') {
            setSafetyContact(data.safetyContact);
          }
        }
      } catch {
        // Fallback to local state when static preview is used
      }
    };
    void syncFromApi();
    const interval = window.setInterval(syncFromApi, 25000);
    return () => window.clearInterval(interval);
  }, []);

  // 10-second Thank You countdown after submitting 1–5
  useEffect(() => {
    if (!submittedReport) return;
    if (thankYouSecondsLeft <= 0) {
      setSubmittedReport(null);
      setIsPickerOpen(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setThankYouSecondsLeft((s) => s - 1);
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [submittedReport, thankYouSecondsLeft]);

  // Touch swipe tracking for the sliding card (horizontal slide + vertical pull-down)
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  const liveMetrics = useMemo(
    () => computeLiveMetrics(observations, nowMs),
    [observations, nowMs]
  );

  // Auto-submit when user chooses 1–5 -> switch to Thank You card for 10s
  const handleSelectIntensity = (level: 1 | 2 | 3 | 4 | 5) => {
    const timestamp = Date.now();
    const obsId = `obs-${timestamp}`;
    const token = `${clientToken}-${timestamp.toString(36).slice(-3)}`;
    const levelLabel =
      INTENSITY_LEVELS.find((item) => item.value === level)?.label ?? 'Reported';
    setPulseKey((k) => k + 1);
    setObservations((prev) => [
      {
        id: obsId,
        clientTokenHash: token,
        intensity: level,
        submittedAt: nowMs,
      },
      ...prev,
    ]);
    setSubmittedReport({ id: obsId, intensity: level, label: levelLabel });
    setThankYouSecondsLeft(10);

    void fetch('/api/observations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'odor', intensity: level }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.observation?.id) {
          setSubmittedReport((curr) =>
            curr ? { ...curr, id: String(data.observation.id) } : null
          );
          setObservations((prev) =>
            prev.map((o) =>
              o.id === obsId ? { ...o, id: String(data.observation.id) } : o
            )
          );
        }
      })
      .catch(() => {});
  };

  const handleWithdraw = () => {
    const timestamp = Date.now();
    const targetId = submittedReport?.id;
    setPulseKey((k) => k + 1);
    setObservations((prev) =>
      prev.map((o) =>
        (targetId ? o.id === targetId : o.clientTokenHash === clientToken) &&
        !o.supersededAt &&
        !o.withdrawnAt
          ? { ...o, withdrawnAt: timestamp }
          : o
      )
    );
    setSubmittedReport(null);
    setThankYouSecondsLeft(0);

    const qs = targetId ? `?id=${encodeURIComponent(targetId)}` : '';
    void fetch(`/api/my-observation${qs}`, { method: 'DELETE' }).catch(() => {});
  };

  const handleToggleModeration = (id: string) => {
    const timestamp = Date.now();
    const target = observations.find((o) => o.id === id);
    const nextAction = target?.hiddenAt ? 'restore' : 'hide';

    setObservations((prev) =>
      prev.map((o) => {
        if (o.id !== id) return o;
        if (o.hiddenAt) {
          return { ...o, hiddenAt: null, hiddenReason: undefined };
        }
        return { ...o, hiddenAt: timestamp, hiddenReason: 'Spam burst' };
      })
    );

    void fetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'moderate',
        observationId: id,
        action: nextAction,
        reason: 'Spam burst',
      }),
    }).catch(() => {});
  };

  const sevenDayBars = useMemo(() => {
    return [
      { day: 'Mon', count: 1, heightPx: 20 },
      { day: 'Tue', count: 0, heightPx: 6 },
      { day: 'Wed', count: 5, heightPx: 62 },
      { day: 'Thu', count: 0, heightPx: 6 },
      { day: 'Fri', count: 3, heightPx: 40 },
      { day: 'Sat', count: 1, heightPx: 20 },
      {
        day: 'Today',
        count: liveMetrics.activeCount,
        heightPx: Math.max(6, liveMetrics.activeCount * 13),
      },
    ];
  }, [liveMetrics.activeCount]);

  const totalWeekReports = useMemo(
    () => sevenDayBars.reduce((sum, d) => sum + d.count, 0),
    [sevenDayBars]
  );

  if (isAdminView) {
    const activeObs = observations.filter((o) => !o.supersededAt && !o.withdrawnAt);
    const liveCount = activeObs.filter((o) => !o.hiddenAt).length;
    const hiddenCount = activeObs.filter((o) => !!o.hiddenAt).length;
    const uniqueTokens = new Set(activeObs.map((o) => o.clientTokenHash)).size;

    return (
      <main
        id="admin-moderation"
        className="min-h-screen w-full flex justify-center bg-[#0E0E0D] font-[family-name:var(--font-body)] text-[var(--text-primary)] select-none"
      >
        <div className="w-full max-w-[390px] min-h-screen bg-[var(--bg-page)] flex flex-col sm:rounded-[36px] sm:my-auto overflow-hidden shadow-2xl sp-enter">
          <div className="flex-1 flex flex-col px-4 pt-5 pb-7 gap-4">
            {/* Admin Top Navigation Bar */}
            <header className="w-full flex items-center justify-between">
              <button
                type="button"
                onClick={() => setIsAdminView(false)}
                aria-label="Back to public view"
                className="w-9 h-9 rounded-full bg-[#E5E2D9] flex items-center justify-center text-[var(--text-primary)] hover:scale-105 active:scale-95 transition-transform sp-ease-out"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <h1 className="font-[family-name:var(--font-display)] text-[26px] font-extrabold tracking-[0.8px] text-[var(--text-primary)]">
                SMELLPULSE ADMIN
              </h1>
              <button
                type="button"
                onClick={() => setIsAdminView(false)}
                aria-label="Exit protected admin view"
                className="w-9 h-9 rounded-full bg-[var(--bg-dark)] flex items-center justify-center hover:scale-105 active:scale-95 transition-transform sp-ease-out"
              >
                <Lock className="w-[15px] h-[15px] text-[var(--block-pink)]" />
              </button>
            </header>

            {/* Section 1 — Submission Rate Signals */}
            <section
              id="submission-rate-signals"
              style={{ animationDelay: '50ms' }}
              className="w-full rounded-[24px] bg-[var(--block-pink)] p-5 flex flex-col gap-3.5 sp-enter"
            >
              <span className="text-[11px] font-bold tracking-[1px] text-[var(--text-primary)]">
                SUBMISSION-RATE &amp; SAFEGUARD SIGNALS
              </span>
              <h2 className="font-[family-name:var(--font-display)] text-[34px] font-extrabold leading-[0.95] text-[var(--text-primary)]">
                NORMAL OFFICE ACTIVITY
              </h2>
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-[14px] bg-white/80 p-3 flex flex-col gap-0.5 transition-all duration-300 sp-ease-out">
                  <span className="font-[family-name:var(--font-display)] text-[26px] font-extrabold leading-none text-[var(--text-primary)]">
                    {activeObs.length}
                  </span>
                  <span className="text-[10px] font-bold text-[var(--text-secondary)]">
                    1H REPORTS
                  </span>
                  <span className="text-[11px] text-[var(--text-primary)]">
                    {liveCount} live · {hiddenCount} hid
                  </span>
                </div>
                <div className="rounded-[14px] bg-white/80 p-3 flex flex-col gap-0.5 transition-all duration-300 sp-ease-out">
                  <span className="font-[family-name:var(--font-display)] text-[26px] font-extrabold leading-none text-[var(--text-primary)]">
                    {uniqueTokens}
                  </span>
                  <span className="text-[10px] font-bold text-[var(--text-secondary)]">
                    BROWSERS
                  </span>
                  <span className="text-[11px] text-[var(--text-primary)]">Hashed tokens</span>
                </div>
                <div className="rounded-[14px] bg-white/80 p-3 flex flex-col gap-0.5 transition-all duration-300 sp-ease-out">
                  <span className="font-[family-name:var(--font-display)] text-[26px] font-extrabold leading-none text-[var(--text-primary)]">
                    1
                  </span>
                  <span className="text-[10px] font-bold text-[var(--text-secondary)]">
                    COOLDOWNS
                  </span>
                  <span className="text-[11px] text-[var(--text-primary)]">Rate limited</span>
                </div>
              </div>
            </section>

            {/* Section 2 — Moderate Observations */}
            <section
              id="moderate-observations"
              style={{ animationDelay: '110ms' }}
              className="w-full rounded-[24px] bg-[var(--bg-card)] border border-[var(--border-light)] p-5 flex flex-col gap-3 sp-enter"
            >
              <h2 className="font-[family-name:var(--font-display)] text-[24px] font-extrabold text-[var(--text-primary)]">
                MODERATE OBSERVATIONS
              </h2>
              <p className="text-[12px] text-[var(--text-secondary)] leading-snug">
                Hidden observations are excluded from live status &amp; 7-day metrics. No raw
                tokens or IPs exposed.
              </p>
              <div className="flex flex-col gap-2.5">
                {activeObs.map((obs) => {
                  const ageMin = Math.max(1, Math.round((nowMs - obs.submittedAt) / 60000));
                  const isHidden = !!obs.hiddenAt;
                  return (
                    <div
                      key={obs.id}
                      className={`w-full p-3 rounded-[14px] flex items-center justify-between gap-2 transition-colors duration-300 sp-ease-out ${
                        isHidden ? 'bg-[#F8E6EC]' : 'bg-[#F5F3EE]'
                      }`}
                    >
                      <div className="flex flex-col gap-0.5">
                        <span
                          className={`text-[13px] font-bold text-[var(--text-primary)] transition-all duration-200 ${
                            isHidden ? 'line-through opacity-70' : ''
                          }`}
                        >
                          Odor · Intensity {obs.intensity}/5
                        </span>
                        <span className="text-[11px] text-[var(--text-secondary)]">
                          {ageMin}m ago ·{' '}
                          {isHidden
                            ? `Hidden (${obs.hiddenReason})`
                            : `Token ${obs.clientTokenHash} · Active`}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleToggleModeration(obs.id)}
                        className={`px-3 py-2 rounded-[10px] text-[12px] font-bold border border-[var(--border-light)] hover:scale-105 active:scale-95 transition-all duration-200 sp-ease-out ${
                          isHidden
                            ? 'bg-[var(--bg-dark)] text-[var(--text-white)]'
                            : 'bg-[var(--bg-card)] text-[var(--block-red)]'
                        }`}
                      >
                        {isHidden ? 'Restore' : 'Hide'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Section 3 — Safety Contact Config */}
            <section
              id="safety-contact-config"
              style={{ animationDelay: '170ms' }}
              className="w-full rounded-[24px] bg-[var(--bg-dark)] p-5 flex flex-col gap-3 sp-enter"
            >
              <h2 className="font-[family-name:var(--font-display)] text-[22px] font-extrabold text-[var(--block-yellow)]">
                EMERGENCY &amp; FACILITIES CONTACT
              </h2>
              <label className="w-full rounded-[12px] bg-[#232321] p-3 flex flex-col gap-1 focus-within:ring-1 focus-within:ring-[var(--block-yellow)] transition-shadow">
                <span className="text-[10px] font-bold text-[var(--text-muted)]">
                  DESIGNATED SAFETY CONTACT
                </span>
                <input
                  type="text"
                  value={safetyContact}
                  onChange={(e) => {
                    setSafetyContact(e.target.value);
                    setSavedBanner(false);
                  }}
                  className="bg-transparent text-[13px] font-semibold text-[var(--text-white)] focus:outline-none"
                />
              </label>
              <button
                type="button"
                onClick={() => {
                  setSavedBanner(true);
                  void fetch('/api/admin', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      type: 'settings',
                      safetyContact,
                    }),
                  }).catch(() => {});
                }}
                className="w-full py-3 px-4 rounded-[12px] bg-[var(--block-yellow)] font-[family-name:var(--font-display)] text-[18px] font-extrabold text-[var(--text-primary)] text-center hover:brightness-105 active:scale-[0.98] transition-all duration-200 sp-ease-out"
              >
                {savedBanner ? 'CONTACT SETTINGS SAVED ✓' : 'SAVE CONTACT SETTINGS'}
              </button>
            </section>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main
      id="hero"
      className="min-h-screen w-full flex justify-center bg-[#0E0E0D] font-[family-name:var(--font-body)] select-none"
    >
      <div className="relative w-full max-w-[390px] h-screen max-h-[844px] bg-[var(--bg-dark)] flex flex-col overflow-hidden sm:rounded-[36px] sm:my-auto shadow-2xl">
        {/* Full Hero Screen Body with Real Photo & Subtle Zoom Reaction */}
        <div className="relative flex-1 flex flex-col justify-between overflow-hidden pt-5">
          <div
            aria-hidden="true"
            style={{ backgroundImage: `url("${HERO_PHOTO_URL}")` }}
            className={`absolute inset-0 bg-cover bg-center transition-transform duration-700 sp-ease-out ${
              isSheetOpen
                ? 'scale-[1.06] brightness-75'
                : isPickerOpen
                ? 'scale-[1.03]'
                : 'scale-100'
            }`}
          />

          {/* Top Navigation Bar */}
          <header
            id="top-navigation"
            className="relative w-full px-4 flex items-center justify-between z-20"
          >
            <button
              type="button"
              onClick={() => setIsAdminView(true)}
              aria-label="Admin moderation"
              title="Open Admin Moderation"
              className="w-10 h-10 rounded-full bg-transparent flex items-center justify-center text-white/75 hover:text-white hover:bg-black/25 active:scale-90 transition-all duration-200 sp-ease-out"
            >
              <Lock className="w-4 h-4" />
            </button>

            <h1 className="font-[family-name:var(--font-display)] text-[28px] font-extrabold tracking-[1px] text-[var(--text-white)] drop-shadow-sm">
              SMELLPULSE
            </h1>

            <button
              id="status-history-button"
              type="button"
              onClick={() => {
                setSheetSlide('status');
                setIsSheetOpen((open) => !open);
              }}
              aria-label="Open Live Status and Recent History"
              className="relative w-10 h-10 rounded-full bg-transparent flex items-center justify-center text-[var(--text-white)] hover:bg-black/25 active:scale-90 transition-all duration-200 sp-ease-out"
            >
              <Activity
                className={`w-[18px] h-[18px] text-[var(--text-white)] transition-transform duration-300 sp-ease-out ${
                  isSheetOpen ? 'rotate-90 scale-110' : ''
                }`}
              />
            </button>
          </header>

          {/* Bottom Area: Smooth Cross-Transition between Primary CTA Dock & 1–5 Auto-Submit / 10s Thank-You Card */}
          <div className="relative w-full z-20">
            {/* Primary CTA Dock */}
            <section
              id="quick-observation"
              aria-hidden={isPickerOpen}
              className={`w-full px-4 pt-7 pb-6 flex flex-col gap-2.5 bg-gradient-to-b from-transparent to-black/75 transition-all duration-300 sp-ease-out ${
                isPickerOpen
                  ? 'opacity-0 translate-y-6 pointer-events-none absolute inset-x-0 bottom-0'
                  : 'opacity-100 translate-y-0'
              }`}
            >
              <button
                id="notice-smell-button"
                type="button"
                onClick={() => {
                  setSubmittedReport(null);
                  setThankYouSecondsLeft(0);
                  setIsPickerOpen(true);
                }}
                className="group w-full py-[18px] px-5 rounded-[24px] bg-[var(--block-red)] shadow-[0_8px_20px_rgba(0,0,0,0.25)] hover:shadow-[0_12px_28px_rgba(232,60,11,0.45)] hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.97] flex items-center justify-center gap-3 transition-all duration-200 sp-ease-out"
              >
                <span className="w-9 h-9 rounded-full bg-white/15 group-hover:bg-white/25 flex items-center justify-center shrink-0 transition-colors">
                  <Flame className="w-5 h-5 text-[var(--text-white)] sp-flame-idle" />
                </span>
                <span className="flex flex-col items-start gap-0.5">
                  <span className="font-[family-name:var(--font-display)] text-[22px] font-extrabold tracking-[0.4px] leading-none text-[var(--text-white)]">
                    I NOTICE AN UNUSUAL SMELL
                  </span>
                  <span className="text-[12px] font-semibold text-[#FFE0D6]">
                    Tap to rate intensity 1–5
                  </span>
                </span>
              </button>

              <p className="w-full text-center text-[11px] font-semibold text-[var(--text-white)] leading-snug">
                Only report what you notice right now · Urgent hazard? Call Ext. 4400
              </p>
            </section>

            {/* Bottom Card: 1–5 Intensity Auto-Submit Picker OR 10-Second Thank-You Submitted Report Card */}
            <section
              id="intensity-picker"
              aria-hidden={!isPickerOpen}
              className={`mx-4 mb-6 p-5 rounded-[28px] bg-[var(--bg-dark)] shadow-[0_10px_28px_rgba(0,0,0,0.35)] flex flex-col gap-3.5 transition-all duration-300 sp-ease-out ${
                isPickerOpen
                  ? 'opacity-100 translate-y-0 scale-100'
                  : 'opacity-0 translate-y-8 scale-95 pointer-events-none absolute inset-x-0 bottom-0'
              }`}
            >
              {submittedReport ? (
                <div
                  key={pulseKey}
                  id="submitted-thank-you-card"
                  className="flex flex-col gap-3.5 sp-pop-once"
                >
                  <div className="w-full flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-[18px] h-[18px] text-[var(--block-yellow)] shrink-0" />
                      <h2 className="font-[family-name:var(--font-display)] text-[21px] font-extrabold tracking-[0.4px] text-[var(--text-white)]">
                        REPORT SUBMITTED
                      </h2>
                    </div>
                    <span
                      id="thank-you-timer"
                      className="py-1 px-2.5 rounded-[12px] bg-[#262624] text-[11px] font-bold text-[var(--block-yellow)] tabular-nums"
                    >
                      {thankYouSecondsLeft}s
                    </span>
                  </div>

                  <div className="w-full p-4 rounded-[18px] bg-[var(--block-yellow)] flex flex-col gap-1">
                    <h3 className="font-[family-name:var(--font-display)] text-[28px] font-extrabold leading-[0.98] text-[var(--text-primary)]">
                      THANK YOU FOR REPORTING
                    </h3>
                    <p className="text-[12px] font-semibold text-[var(--text-primary)] leading-snug">
                      Recorded Intensity {submittedReport.intensity}/5 (
                      {submittedReport.label}) in the 45m live window.
                    </p>
                  </div>

                  <div className="w-full flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-[var(--text-muted)]">
                      Stays for {thankYouSecondsLeft}s · Then you can submit a new report
                    </span>
                    <button
                      id="withdraw-button"
                      type="button"
                      onClick={handleWithdraw}
                      className="text-[11px] font-bold underline text-[var(--block-pink)] hover:opacity-80 active:scale-95 transition-all"
                    >
                      Withdraw
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="w-full flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Flame className="w-[18px] h-[18px] text-[var(--block-red)] sp-flame-idle" />
                      <h2 className="font-[family-name:var(--font-display)] text-[21px] font-extrabold tracking-[0.4px] text-[var(--text-white)]">
                        I NOTICE AN UNUSUAL SMELL
                      </h2>
                    </div>
                    <button
                      id="close-picker-button"
                      type="button"
                      onClick={() => setIsPickerOpen(false)}
                      aria-label="Close intensity picker"
                      className="w-7 h-7 rounded-full bg-[#2A2A27] hover:bg-[#3A3A36] active:scale-90 flex items-center justify-center transition-all duration-150 sp-ease-out"
                    >
                      <X className="w-3.5 h-3.5 text-[var(--text-white)]" />
                    </button>
                  </div>

                  <p className="text-[12px] font-bold text-[var(--block-yellow)]">
                    HOW STRONG IS IT? TAP 1–5 TO SUBMIT AUTOMATICALLY
                  </p>

                  <div className="w-full grid grid-cols-5 gap-[7px]">
                    {INTENSITY_LEVELS.map(({ value, label }, idx) => (
                      <button
                        key={value}
                        id={`rate-button-${value}`}
                        type="button"
                        onClick={() => handleSelectIntensity(value)}
                        style={{
                          transitionDelay: isPickerOpen ? `${idx * 25}ms` : '0ms',
                        }}
                        className="py-3.5 px-1 rounded-[16px] flex flex-col items-center gap-1 bg-[#262624] hover:bg-[var(--block-red)] group transition-all duration-200 sp-ease-out hover:-translate-y-0.5 active:scale-90"
                      >
                        <span className="font-[family-name:var(--font-display)] text-[28px] font-extrabold leading-none text-[var(--text-white)]">
                          {value}
                        </span>
                        <span className="text-[10px] font-bold text-[var(--text-muted)] group-hover:text-[#FFE0D6]">
                          {label}
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </section>
          </div>

          {/* Backdrop Dim Overlay for Bottom Sheet */}
          <div
            aria-hidden="true"
            onClick={() => setIsSheetOpen(false)}
            className={`absolute inset-0 bg-black/40 backdrop-blur-[2px] z-20 transition-opacity duration-300 sp-ease-out ${
              isSheetOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
            }`}
          />

          {/* Sliding Bottom Card: Live Status (Slide 1) & Recent History (Slide 2) */}
          <section
            id="status-history-sheet"
            aria-hidden={!isSheetOpen}
            onTouchStart={(e) => {
              const t = e.touches[0];
              if (t) touchStartRef.current = { x: t.clientX, y: t.clientY };
            }}
            onTouchEnd={(e) => {
              if (!touchStartRef.current) return;
              const t = e.changedTouches[0];
              if (t) {
                const dx = t.clientX - touchStartRef.current.x;
                const dy = t.clientY - touchStartRef.current.y;
                if (Math.abs(dx) > Math.abs(dy)) {
                  if (dx < -35) setSheetSlide('history');
                  if (dx > 35) setSheetSlide('status');
                } else if (dy > 60) {
                  setIsSheetOpen(false);
                }
              }
              touchStartRef.current = null;
            }}
            className={`absolute inset-x-0 bottom-0 rounded-t-[32px] bg-[var(--bg-page)] pt-3 pb-7 flex flex-col gap-3.5 shadow-[0_-8px_24px_rgba(0,0,0,0.28)] overflow-hidden z-30 transition-transform duration-500 sp-ease-out ${
              isSheetOpen ? 'translate-y-0 pointer-events-auto' : 'translate-y-full pointer-events-none'
            }`}
          >
            {/* Drag Handle */}
            <button
              type="button"
              aria-label="Drag or tap to close sheet"
              onClick={() => setIsSheetOpen(false)}
              className="w-full py-1 flex justify-center group"
            >
              <span className="w-11 h-[5px] rounded-full bg-[#CBC7BC] group-hover:w-14 group-hover:bg-[#A8A499] transition-all duration-200 sp-ease-out" />
            </button>

            {/* Slide Switcher Header */}
            <div className="w-full px-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                {sheetSlide === 'status' ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setSheetSlide('status')}
                      className="py-1.5 px-3 rounded-full bg-[var(--bg-dark)] flex items-center gap-1.5 shadow-sm transition-all duration-200 sp-ease-out"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--block-red)] animate-pulse" />
                      <span className="text-[12px] font-bold text-[var(--text-white)]">
                        Live Status
                      </span>
                    </button>
                    <button
                      id="slide-to-history-button"
                      type="button"
                      onClick={() => setSheetSlide('history')}
                      className="group py-1.5 px-3 rounded-full bg-[#E5E2D9] hover:bg-[#DBD7CC] active:scale-95 flex items-center gap-1.5 transition-all duration-200 sp-ease-out"
                    >
                      <span className="text-[12px] font-semibold text-[var(--text-secondary)]">
                        Slide right: Recent History
                      </span>
                      <ArrowRight className="w-[13px] h-[13px] text-[var(--text-secondary)] group-hover:translate-x-0.5 transition-transform" />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      id="slide-to-status-button"
                      type="button"
                      onClick={() => setSheetSlide('status')}
                      className="group py-1.5 px-3 rounded-full bg-[#E5E2D9] hover:bg-[#DBD7CC] active:scale-95 flex items-center gap-1.5 transition-all duration-200 sp-ease-out"
                    >
                      <ArrowLeft className="w-[13px] h-[13px] text-[var(--text-secondary)] group-hover:-translate-x-0.5 transition-transform" />
                      <span className="text-[12px] font-semibold text-[var(--text-secondary)]">
                        Live Status
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSheetSlide('history')}
                      className="py-1.5 px-3 rounded-full bg-[var(--bg-dark)] flex items-center gap-1.5 shadow-sm transition-all duration-200 sp-ease-out"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--block-blue)] animate-pulse" />
                      <span className="text-[12px] font-bold text-[var(--text-white)]">
                        Recent History (7d)
                      </span>
                    </button>
                  </>
                )}
              </div>

              <button
                id="close-sheet-button"
                type="button"
                onClick={() => setIsSheetOpen(false)}
                aria-label="Close Live Status and Recent History"
                className="w-[30px] h-[30px] rounded-full bg-[#E5E2D9] hover:bg-[#DBD7CC] active:scale-90 flex items-center justify-center transition-all duration-150 sp-ease-out"
              >
                <X className="w-[15px] h-[15px] text-[var(--text-primary)]" />
              </button>
            </div>

            {/* Horizontal Sliding Track (Slide 1: Live Status ↔ Slide 2: Recent History) */}
            <div className="w-full overflow-hidden">
              <div
                className={`flex w-[200%] transition-transform duration-500 sp-ease-out ${
                  sheetSlide === 'status' ? 'translate-x-0' : '-translate-x-1/2'
                }`}
              >
                {/* Slide 1: Live Status */}
                <div className="w-1/2 px-4 flex flex-col gap-3.5">
                  <div
                    id="live-status-card"
                    className={`w-full rounded-[24px] p-5 flex flex-col gap-3.5 transition-colors duration-300 ${
                      liveMetrics.activeCount === 0
                        ? 'bg-[var(--block-blue)] text-[var(--text-primary)]'
                        : liveMetrics.activeCount === 1
                        ? 'bg-[var(--block-yellow)] text-[var(--text-primary)]'
                        : 'bg-[var(--block-red)] text-[var(--text-white)]'
                    }`}
                  >
                    <div className="w-full flex items-center justify-between">
                      <span
                        className={`text-[11px] font-bold tracking-[0.8px] ${
                          liveMetrics.activeCount >= 2
                            ? 'text-[#FFD7CC]'
                            : 'text-[var(--text-primary)]'
                        }`}
                      >
                        45M LIVE WINDOW
                      </span>
                      <span className="text-[12px] font-bold">
                        {liveMetrics.latestAgeMinutes
                          ? `Latest report: ${liveMetrics.latestAgeMinutes}m ago`
                          : 'No reports in last 45m'}
                      </span>
                    </div>

                    <h2 className="font-[family-name:var(--font-display)] text-[38px] font-extrabold leading-[0.95]">
                      {liveMetrics.headline}
                    </h2>

                    <p
                      className={`text-[12px] leading-[1.35] ${
                        liveMetrics.activeCount >= 2
                          ? 'text-[#FFE4DC]'
                          : 'text-[var(--text-primary)]'
                      }`}
                    >
                      {liveMetrics.interpretation}
                    </p>

                    <div className="w-full grid grid-cols-3 gap-2">
                      <div className="rounded-[14px] bg-black/15 p-3 flex flex-col gap-0.5">
                        <span className="font-[family-name:var(--font-display)] text-[28px] font-extrabold leading-none">
                          {liveMetrics.activeCount}
                        </span>
                        <span className="text-[10px] font-bold opacity-85">ODOR COUNT</span>
                        <span className="text-[11px]">Last 45m</span>
                      </div>
                      <div className="rounded-[14px] bg-black/15 p-3 flex flex-col gap-0.5">
                        <span className="font-[family-name:var(--font-display)] text-[28px] font-extrabold leading-none">
                          {liveMetrics.medianIntensity !== null
                            ? `${liveMetrics.medianIntensity}/5`
                            : '—'}
                        </span>
                        <span className="text-[10px] font-bold opacity-85">MEDIAN (1–5)</span>
                        <span className="text-[11px]">
                          {liveMetrics.activeCount > 0
                            ? `n = ${liveMetrics.activeCount} reports`
                            : 'No active data'}
                        </span>
                      </div>
                      <div className="rounded-[14px] bg-black/15 p-3 flex flex-col gap-0.5">
                        <span className="font-[family-name:var(--font-display)] text-[28px] font-extrabold leading-none">
                          {liveMetrics.latestAgeMinutes !== null
                            ? `${liveMetrics.latestAgeMinutes}m`
                            : '—'}
                        </span>
                        <span className="text-[10px] font-bold opacity-85">LATEST</span>
                        <span className="text-[11px]">
                          {liveMetrics.activeCount > 0 ? 'Active now' : 'Quiet'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="w-full py-3 px-3.5 rounded-[16px] bg-[var(--bg-card)] border border-[var(--border-light)]">
                    <p className="text-[11px] leading-[1.35] text-[var(--text-secondary)]">
                      When 0 reports: shows “No recent odor reports” (conditions unknown — never
                      “Safe” or “All clear”).
                    </p>
                  </div>
                </div>

                {/* Slide 2: Recent History (7d) */}
                <div className="w-1/2 px-4 flex flex-col gap-3.5">
                  <div
                    id="recent-history-card"
                    className="w-full rounded-[24px] bg-[var(--block-blue)] p-5 flex flex-col gap-3.5"
                  >
                    <div className="flex flex-col gap-0.5">
                      <h2 className="font-[family-name:var(--font-display)] text-[28px] font-extrabold leading-none text-[var(--text-primary)]">
                        LAST 7 DAYS ACTIVITY
                      </h2>
                      <span className="text-[12px] font-semibold text-[var(--text-primary)]">
                        {totalWeekReports} odor reports · 3 estimated episodes
                      </span>
                    </div>

                    {/* 7-Day Bar Chart with Animated Bar Growth */}
                    <div className="w-full h-[128px] p-3.5 rounded-[16px] bg-white/90 grid grid-cols-7 gap-2 items-end">
                      {sevenDayBars.map((bar, idx) => (
                        <div key={bar.day} className="flex flex-col items-center gap-1">
                          <span
                            className={`text-[10px] font-bold ${
                              bar.count > 0
                                ? 'text-[var(--text-primary)]'
                                : 'text-[var(--text-muted)]'
                            }`}
                          >
                            {bar.count}
                          </span>
                          <div
                            style={{
                              height:
                                isSheetOpen && sheetSlide === 'history'
                                  ? `${bar.heightPx}px`
                                  : '6px',
                              transitionDelay: `${idx * 35}ms`,
                            }}
                            className={`w-6 rounded-[6px] transition-all duration-500 sp-ease-out ${
                              bar.day === 'Today'
                                ? 'bg-[var(--block-red)]'
                                : bar.count > 0
                                ? 'bg-[var(--bg-dark)]'
                                : 'bg-[#E5E2D9]'
                            }`}
                          />
                          <span className="text-[10px] font-semibold text-[var(--text-secondary)]">
                            {bar.day}
                          </span>
                        </div>
                      ))}
                    </div>

                    {/* Possible Odor Episodes */}
                    <div className="flex flex-col gap-2">
                      <span className="text-[11px] font-bold text-[var(--text-primary)]">
                        POSSIBLE ODOR EPISODES (ESTIMATED CLUSTERS, &lt;90M GAP)
                      </span>
                      {[
                        [
                          'Today, 9:15–9:38 AM',
                          `${liveMetrics.activeCount} reports · Median ${
                            liveMetrics.medianIntensity ?? 3.5
                          }/5`,
                        ],
                        ['Fri, 2:10–2:55 PM', '3 reports · Median 4.0/5'],
                        ['Wed, 11:05 AM–12:10 PM', '5 reports · Median 3.0/5'],
                      ].map(([timeRange, stats]) => (
                        <div
                          key={timeRange}
                          className="w-full py-2.5 px-3 rounded-[12px] bg-white/80 hover:bg-white transition-colors flex items-center justify-between"
                        >
                          <span className="text-[12px] font-bold text-[var(--text-primary)]">
                            {timeRange}
                          </span>
                          <span className="text-[12px] font-semibold text-[var(--text-secondary)]">
                            {stats}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Safety Footer Strip */}
            <div className="mx-4 py-3 px-3.5 rounded-[16px] bg-[var(--bg-dark)] flex items-center gap-2.5">
              <AlertTriangle className="w-[18px] h-[18px] text-[var(--block-yellow)] shrink-0" />
              <p className="text-[11px] leading-[1.35] text-[var(--text-white)]">
                Urgent gas leak or hazard? Do not wait for reports — call {safetyContact}{' '}
                immediately.
              </p>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

export default SmellPulseApp;
