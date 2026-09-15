import { useState } from 'react';
import { SubjectOrderList } from '../components/SubjectOrderList';
import { PaceControls } from '../components/PaceControls';
import { BulkMarkPanel } from '../components/BulkMarkPanel';
import { LeaveManager } from '../components/LeaveManager';

type Tab = 'order' | 'bulk' | 'leave';

const TABS: { id: Tab; label: string }[] = [
  { id: 'order', label: 'Order & pace' },
  { id: 'bulk', label: 'Mark done' },
  { id: 'leave', label: 'Leave days' },
];

export function PlanScreen() {
  const [tab, setTab] = useState<Tab>('order');

  return (
    <div className="screen">
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'order' ? (
        <>
          <PaceControls />
          <SubjectOrderList />
        </>
      ) : null}
      {tab === 'bulk' ? <BulkMarkPanel /> : null}
      {tab === 'leave' ? <LeaveManager /> : null}
    </div>
  );
}
