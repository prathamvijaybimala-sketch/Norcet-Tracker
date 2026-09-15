import { useEffect } from 'react';
import { useAppStore, type Route } from './store/appStore';
import { ImportScreen } from './screens/ImportScreen';
import { PlanScreen } from './screens/PlanScreen';
import { TodayScreen } from './screens/TodayScreen';
import { TimelineScreen } from './screens/TimelineScreen';
import { RevisionScreen } from './screens/RevisionScreen';
import { DataScreen } from './screens/DataScreen';
import { Toast } from './components/ui';
import { computePlanStats } from './lib/stats';
import { dueRevisions } from './lib/revision';
import { formatDate, todayISO } from './lib/dates';

const ROUTES: Route[] = ['import', 'setup', 'today', 'timeline', 'subjects', 'revision', 'data'];

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
  const toast = useAppStore((s) => s.toast);
  const init = useAppStore((s) => s.init);
  const setRoute = useAppStore((s) => s.setRoute);
  const dismissToast = useAppStore((s) => s.dismissToast);

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

  return (
    <div className="app">
      <header className="app-header">
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
      </header>

      {!ready ? (
        <div className="screen">
          <div className="empty">Loading your plan…</div>
        </div>
      ) : effectiveRoute === 'import' ? (
        <ImportScreen />
      ) : effectiveRoute === 'setup' || effectiveRoute === 'subjects' ? (
        <PlanScreen />
      ) : effectiveRoute === 'timeline' ? (
        <TimelineScreen />
      ) : effectiveRoute === 'revision' ? (
        <RevisionScreen />
      ) : effectiveRoute === 'data' ? (
        <DataScreen />
      ) : (
        <TodayScreen />
      )}

      {showNav ? (
        <nav className="bottom-nav">
          <NavButton route="today" label="Today" icon="◉" active={effectiveRoute} onClick={setRoute} />
          <NavButton route="timeline" label="Timeline" icon="▦" active={effectiveRoute} onClick={setRoute} />
          <NavButton route="setup" label="Plan" icon="≡" active={effectiveRoute} onClick={setRoute} />
          <NavButton
            route="revision"
            label="Revise"
            icon="↻"
            active={effectiveRoute}
            onClick={setRoute}
            badge={revisionDue}
          />
          <NavButton route="data" label="Data" icon="⤓" active={effectiveRoute} onClick={setRoute} />
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
