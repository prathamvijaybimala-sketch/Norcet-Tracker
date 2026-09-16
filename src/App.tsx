import { useEffect, useMemo, useState } from 'react';
import { useAppStore, type Route } from './store/appStore';
import { ImportScreen } from './screens/ImportScreen';
import { PlanScreen } from './screens/PlanScreen';
import { TodayScreen } from './screens/TodayScreen';
import { TimelineScreen } from './screens/TimelineScreen';
import { RevisionScreen } from './screens/RevisionScreen';
import { BacklogScreen } from './screens/BacklogScreen';
import { DataScreen } from './screens/DataScreen';
import { Toast } from './components/ui';
import { PlanLockScreen } from './components/PlanLockScreen';
import { computePlanStats, missedLectures } from './lib/stats';
import { dueRevisions } from './lib/revision';
import { formatDate, todayISO } from './lib/dates';

const ROUTES: Route[] = [
  'import',
  'setup',
  'today',
  'timeline',
  'subjects',
  'revision',
  'backlog',
  'data',
];

function routeFromHash(): Route | null {
  const hash = window.location.hash.replace(/^#\/?/, '');
  return (ROUTES as string[]).includes(hash) ? (hash as Route) : null;
}

export default function App() {
  const ready = useAppStore((s) => s.ready);
  const route = useAppStore((s) => s.route);
  const hasCurriculum = useAppStore((s) => s.curriculum.length > 0);
  const schedule = useAppStore((s) => s.schedule);
  const revision = useAppStore((s) => s.revision);
  const progress = useAppStore((s) => s.progress);
  const lectureIndex = useAppStore((s) => s.lectureIndex);
  const subjectOrder = useAppStore((s) => s.planConfig.subjectOrder);
  const toast = useAppStore((s) => s.toast);
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const planLockHash = useAppStore((s) => s.planLockHash);
  const planUnlocked = useAppStore((s) => s.planUnlocked);
  const init = useAppStore((s) => s.init);
  const setRoute = useAppStore((s) => s.setRoute);
  const dismissToast = useAppStore((s) => s.dismissToast);

  const [menuOpen, setMenuOpen] = useState(false);

  // Reflect the theme on <html> (CSS variables swap per [data-theme]) and
  // on the status-bar meta so Android's bar follows light/dark.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'dark' ? '#0d1014' : '#f3f5f9');
  }, [theme]);

  useEffect(() => {
    void init().then(() => {
      const fromHash = routeFromHash();
      if (fromHash) useAppStore.setState({ route: fromHash });
    });
    const onHash = () => {
      const next = routeFromHash();
      if (next) useAppStore.setState({ route: next });
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [init]);

  const showNav = ready && hasCurriculum;
  const effectiveRoute: Route = !hasCurriculum ? 'import' : route === 'import' ? 'today' : route;
  const stats = computePlanStats(schedule);
  const revisionDue = dueRevisions(revision, todayISO()).length;
  const missedCount = useMemo(
    () => missedLectures(schedule, lectureIndex, subjectOrder, progress, todayISO()).length,
    [schedule, lectureIndex, subjectOrder, progress],
  );

  const go = (r: Route) => {
    setRoute(r);
    setMenuOpen(false);
  };

  return (
    <div className="app">
      <header className="app-header">
        {showNav ? (
          <button
            className="icon-btn menu-btn"
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
            title="Menu"
          >
            ☰
          </button>
        ) : null}
        <div className="brand">
          <span className="brand-mark">N</span>
          <span>NORCET Tracker</span>
        </div>
        <span className="header-spacer" />
        {hasCurriculum && stats.finishDate ? (
          <div className="header-meta">
            <div>{formatDate(todayISO())}</div>
            <div>ends {formatDate(stats.finishDate)}</div>
          </div>
        ) : null}
        {ready ? (
          <button
            className="icon-btn"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
        ) : null}
      </header>

      {!ready ? (
        <div className="screen">
          <div className="empty">Loading your plan…</div>
        </div>
      ) : effectiveRoute === 'import' ? (
        <ImportScreen />
      ) : effectiveRoute === 'setup' || effectiveRoute === 'subjects' ? (
        planLockHash && !planUnlocked ? (
          <PlanLockScreen />
        ) : (
          <PlanScreen />
        )
      ) : effectiveRoute === 'timeline' ? (
        <TimelineScreen />
      ) : effectiveRoute === 'revision' ? (
        <RevisionScreen />
      ) : effectiveRoute === 'backlog' ? (
        <BacklogScreen />
      ) : effectiveRoute === 'data' ? (
        <DataScreen />
      ) : (
        <TodayScreen />
      )}

      {showNav ? (
        <>
          <div
            className={menuOpen ? 'drawer-overlay open' : 'drawer-overlay'}
            onClick={() => setMenuOpen(false)}
            aria-hidden="true"
          />
          <nav className={menuOpen ? 'side-menu open' : 'side-menu'} aria-label="Menu">
            <div className="side-menu-title">Menu</div>
            <button
              className={
                effectiveRoute === 'setup' || effectiveRoute === 'subjects' ? 'active' : ''
              }
              onClick={() => go('setup')}
            >
              <span className="nav-icon">≡</span>
              <span>Plan</span>
            </button>
            <button
              className={effectiveRoute === 'data' ? 'active' : ''}
              onClick={() => go('data')}
            >
              <span className="nav-icon">⤓</span>
              <span>Data &amp; backup</span>
            </button>
          </nav>
        </>
      ) : null}

      {showNav ? (
        <nav className="bottom-nav">
          <NavButton route="today" label="Today" icon="◉" active={effectiveRoute} onClick={setRoute} />
          <NavButton
            route="backlog"
            label="Backlog"
            icon="📥"
            active={effectiveRoute}
            onClick={setRoute}
            badge={missedCount}
          />
          <NavButton
            route="revision"
            label="Revision"
            icon="↻"
            active={effectiveRoute}
            onClick={setRoute}
            badge={revisionDue}
          />
          <NavButton route="timeline" label="Timeline" icon="▦" active={effectiveRoute} onClick={setRoute} />
        </nav>
      ) : null}

      {toast ? <Toast message={toast.message} onDismiss={dismissToast} /> : null}
    </div>
  );
}

function NavButton({
  route,
  label,
  icon,
  active,
  onClick,
  badge,
}: {
  route: Route;
  label: string;
  icon: string;
  active: Route;
  onClick: (route: Route) => void;
  badge?: number;
}) {
  return (
    <button className={active === route ? 'active' : ''} onClick={() => onClick(route)}>
      <span className="nav-icon">{icon}</span>
      <span>{label}</span>
      {badge ? <span className="nav-badge">{badge > 9 ? '9+' : badge}</span> : null}
    </button>
  );
}
