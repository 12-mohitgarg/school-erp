import { useState } from 'react';
import { Download } from 'lucide-react';
import {
  useReportAcademicQuery, useReportSafetyQuery, useReportLibraryQuery,
  useReportTransportQuery, useReportHrQuery, useReportParentEngagementQuery,
  useCollectionReportQuery, useAttendanceSummaryQuery,
} from '@/features/api/endpoints';
import { Button, Card, PageHeader, Tabs } from '@/components/ui';
import { StatCard, StatGrid } from '@/components/ui/StatCard';
import { ComparisonChart, DistributionChart, TrendChart } from '@/components/charts/Charts';
import { downloadBlob, formatCompactCurrency, formatDate, toCsv } from '@/lib/utils';

type Tab = 'academic' | 'financial' | 'attendance' | 'safety' | 'operations' | 'engagement';

export default function ReportsPage() {
  const [tab, setTab] = useState<Tab>('academic');

  return (
    <>
      <PageHeader
        title="Reports & Analytics"
        description="Academic, financial, attendance, safety and engagement reporting."
      />

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'academic', label: 'Academic' },
          { value: 'financial', label: 'Financial' },
          { value: 'attendance', label: 'Attendance' },
          { value: 'safety', label: 'GPS & Safety' },
          { value: 'operations', label: 'Operations' },
          { value: 'engagement', label: 'Parent engagement' },
        ]}
        className="mb-5"
      />

      {tab === 'academic' && <AcademicReport />}
      {tab === 'financial' && <FinancialReport />}
      {tab === 'attendance' && <AttendanceReport />}
      {tab === 'safety' && <SafetyReport />}
      {tab === 'operations' && <OperationsReport />}
      {tab === 'engagement' && <EngagementReport />}
    </>
  );
}

function ExportButton({ rows, filename }: { rows: Array<Record<string, unknown>>; filename: string }) {
  return (
    <Button
      size="sm"
      variant="outline"
      leftIcon={<Download className="h-3.5 w-3.5" />}
      onClick={() => downloadBlob(toCsv(rows), filename)}
      disabled={rows.length === 0}
    >
      Export CSV
    </Button>
  );
}

function AcademicReport() {
  const { data } = useReportAcademicQuery({});
  const rows = data?.bySubject ?? [];

  return (
    <div className="space-y-4">
      <ComparisonChart
        title="Average score by subject"
        description="Across all evaluated exam entries"
        data={rows.map((r) => ({ label: r.subject, Average: r.averagePercent }))}
        series={[{ key: 'Average', name: 'Average %' }]}
        valueFormatter={(v) => `${v.toFixed(1)}%`}
        horizontal
        height={Math.max(240, rows.length * 42)}
      />
      <div className="flex justify-end">
        <ExportButton rows={rows as unknown as Array<Record<string, unknown>>} filename="academic-report.csv" />
      </div>
    </div>
  );
}

function FinancialReport() {
  const { data } = useCollectionReportQuery({});

  return (
    <div className="space-y-4">
      <StatGrid>
        <StatCard stat={{ key: 'collected', label: 'Collected', value: data?.collected ?? 0, format: 'currency' }} />
        <StatCard stat={{ key: 'txn', label: 'Transactions', value: data?.transactionCount ?? 0, format: 'number' }} />
        <StatCard stat={{ key: 'outstanding', label: 'Outstanding', value: data?.outstanding ?? 0, format: 'currency' }} accent="warning" />
        <StatCard stat={{ key: 'invoices', label: 'Open invoices', value: data?.outstandingInvoices ?? 0, format: 'number' }} />
      </StatGrid>

      <DistributionChart
        title="Collection by payment mode"
        data={(data?.byMode ?? []).map((m) => ({ label: m.mode.replace('_', ' '), value: m.amount }))}
        valueFormatter={formatCompactCurrency}
      />

      <div className="flex justify-end">
        <ExportButton rows={(data?.byMode ?? []) as unknown as Array<Record<string, unknown>>} filename="collection-report.csv" />
      </div>
    </div>
  );
}

function AttendanceReport() {
  const { data } = useAttendanceSummaryQuery({ groupBy: 'day' });

  return (
    <div className="space-y-4">
      <StatGrid>
        <StatCard stat={{ key: 'total', label: 'Records', value: data?.totals.total ?? 0, format: 'number' }} />
        <StatCard stat={{ key: 'present', label: 'Present', value: data?.totals.present ?? 0, format: 'number' }} />
        <StatCard stat={{ key: 'absent', label: 'Absent', value: data?.totals.absent ?? 0, format: 'number' }} />
        <StatCard stat={{ key: 'pct', label: 'Attendance', value: `${data?.totals.attendancePercent ?? 0}%` }} />
      </StatGrid>

      <TrendChart
        title="Attendance by day"
        data={(data?.series ?? []).map((p) => ({ label: formatDate(p.label, 'short'), Attendance: p.attendancePercent }))}
        series={[{ key: 'Attendance', name: 'Attendance %' }]}
        valueFormatter={(v) => `${v}%`}
        height={300}
      />

      <div className="flex justify-end">
        <ExportButton rows={(data?.series ?? []) as unknown as Array<Record<string, unknown>>} filename="attendance-report.csv" />
      </div>
    </div>
  );
}

function SafetyReport() {
  const { data } = useReportSafetyQuery({});

  return (
    <div className="space-y-4">
      <StatGrid>
        <StatCard stat={{ key: 'trips', label: 'Trips (30 days)', value: data?.trips ?? 0, format: 'number' }} />
        <StatCard stat={{ key: 'distance', label: 'Distance covered', value: `${(data?.totalDistanceKm ?? 0).toFixed(0)} km` }} />
        <StatCard stat={{ key: 'students', label: 'Students transported', value: data?.studentsTransported ?? 0, format: 'number' }} />
        <StatCard stat={{ key: 'alerts', label: 'Safety alerts', value: data?.totalAlerts ?? 0, format: 'number' }} accent={data && data.totalAlerts > 0 ? 'warning' : undefined} />
      </StatGrid>

      <div className="grid gap-4 lg:grid-cols-2">
        <ComparisonChart
          title="Alerts by type"
          data={(data?.alertsByType ?? []).map((a) => ({ label: a.type.replace(/_/g, ' ').toLowerCase(), Count: a.count }))}
          series={[{ key: 'Count', name: 'Alerts' }]}
          horizontal
        />
        <DistributionChart
          title="SOS alerts by status"
          data={(data?.sosByStatus ?? []).map((s) => ({ label: s.status, value: s.count }))}
        />
      </div>
    </div>
  );
}

function OperationsReport() {
  const { data: library } = useReportLibraryQuery();
  const { data: transport } = useReportTransportQuery();
  const { data: hr } = useReportHrQuery();

  return (
    <div className="space-y-4">
      <StatGrid>
        <StatCard stat={{ key: 'titles', label: 'Library titles', value: library?.titles ?? 0, format: 'number' }} />
        <StatCard stat={{ key: 'fines', label: 'Fines outstanding', value: library?.outstandingFines ?? 0, format: 'currency' }} />
        <StatCard stat={{ key: 'routes', label: 'Transport routes', value: transport?.routes.length ?? 0, format: 'number' }} />
        <StatCard stat={{ key: 'headcount', label: 'Staff headcount', value: hr?.headcount ?? 0, format: 'number' }} />
      </StatGrid>

      <div className="grid gap-4 lg:grid-cols-2">
        <ComparisonChart
          title="Route utilisation"
          description="Allocated students against vehicle capacity"
          data={(transport?.routes ?? []).map((r) => ({ label: r.name, Utilisation: r.utilisationPercent }))}
          series={[{ key: 'Utilisation', name: 'Utilisation %' }]}
          valueFormatter={(v) => `${v}%`}
          horizontal
        />
        <ComparisonChart
          title="Staff by department"
          data={(hr?.byDepartment ?? []).map((d) => ({ label: d.department, Staff: d.count }))}
          series={[{ key: 'Staff', name: 'Employees' }]}
          horizontal
        />
      </div>
    </div>
  );
}

function EngagementReport() {
  const { data } = useReportParentEngagementQuery();

  return (
    <div className="space-y-4">
      <StatGrid>
        <StatCard stat={{ key: 'guardians', label: 'Guardians', value: data?.guardiansTotal ?? 0, format: 'number' }} />
        <StatCard stat={{ key: 'onApp', label: 'On the app', value: data?.guardiansOnApp ?? 0, format: 'number', hint: `${data?.appAdoptionPercent ?? 0}% adoption` }} />
        <StatCard stat={{ key: 'views', label: 'Location views (30d)', value: data?.locationViews30d ?? 0, format: 'number' }} />
        <StatCard stat={{ key: 'read', label: 'Notification read rate', value: `${data?.notificationReadPercent ?? 0}%` }} />
      </StatGrid>

      <Card>
        <div className="p-5 text-sm text-ink-muted">
          <p>
            Every view of a child's location is written to an access log with the viewer, purpose
            and IP address, as required by the data-protection policy. The audit trail is available
            under Settings → Audit log.
          </p>
        </div>
      </Card>
    </div>
  );
}
