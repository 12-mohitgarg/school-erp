import { useState } from 'react';
import { Play } from 'lucide-react';
import { toast } from 'sonner';
import { usePayslipsQuery, useRunPayrollMutation, useReportHrQuery } from '@/features/api/endpoints';
import { useListState } from '@/lib/useListState';
import { useAuth } from '@/features/auth/useAuth';
import { errorMessage } from '@/lib/api';
import { Button, Card, PageHeader, Pagination, Table, StatusBadge, type Column } from '@/components/ui';
import { StatCard, StatGrid } from '@/components/ui/StatCard';
import { formatCompactCurrency } from '@/lib/utils';

type Row = Record<string, unknown>;
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

export default function PayrollPage() {
  const { can } = useAuth();
  const helpers = useListState();
  const { data, isFetching } = usePayslipsQuery({ ...helpers.params, limit: 25 });
  const { data: hr } = useReportHrQuery();
  const [runPayroll, { isLoading: running }] = useRunPayrollMutation();

  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());

  async function run() {
    try {
      const result = await runPayroll({ month, year }).unwrap();
      toast.success('Payroll processed', {
        description: `${result.employeeCount} employees · net ${formatCompactCurrency(result.totalNet)}`,
      });
    } catch (err) {
      toast.error('Payroll run failed', { description: errorMessage(err) });
    }
  }

  const latest = hr?.latestPayroll as Record<string, unknown> | null;

  const columns: Array<Column<Row>> = [
    {
      key: 'employee',
      header: 'Employee',
      render: (row) => {
        const e = row['employee'] as { firstName: string; lastName: string; employeeCode: string };
        return (
          <div className="min-w-0">
            <p className="truncate font-medium text-ink">{e.firstName} {e.lastName}</p>
            <p className="truncate text-xs text-ink-subtle">{e.employeeCode}</p>
          </div>
        );
      },
    },
    { key: 'period', header: 'Period', render: (row) => <span className="text-ink-muted">{MONTHS[Number(row['month']) - 1]} {String(row['year'])}</span> },
    { key: 'days', header: 'Paid days', align: 'right', hideOnMobile: true, render: (row) => <span className="nums text-ink-muted">{String(row['presentDays'])}/{String(row['workingDays'])}</span> },
    { key: 'gross', header: 'Gross', align: 'right', render: (row) => <span className="nums">{formatCompactCurrency(String(row['grossEarnings']))}</span> },
    { key: 'deductions', header: 'Deductions', align: 'right', hideOnMobile: true, render: (row) => <span className="nums text-danger">{formatCompactCurrency(String(row['totalDeductions']))}</span> },
    { key: 'net', header: 'Net pay', align: 'right', render: (row) => <span className="nums font-semibold text-ink">{formatCompactCurrency(String(row['netPay']))}</span> },
  ];

  return (
    <>
      <PageHeader
        title="Payroll"
        description="Monthly salary processing, statutory deductions and payslips."
        actions={
          can('hr:approve') && (
            <div className="flex items-end gap-2">
              <select value={month} onChange={(e) => setMonth(Number(e.target.value))} aria-label="Month"
                className="h-8 rounded-lg border border-hairline bg-surface px-2 text-sm text-ink">
                {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
              <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Year"
                className="h-8 w-20 rounded-lg border border-hairline bg-surface px-2 text-sm text-ink nums" />
              <Button size="sm" loading={running} onClick={run} leftIcon={<Play className="h-3.5 w-3.5" />}>Run payroll</Button>
            </div>
          )
        }
      />

      <StatGrid>
        <StatCard stat={{ key: 'headcount', label: 'Employees', value: hr?.headcount ?? 0, format: 'number' }} />
        <StatCard stat={{ key: 'lastRun', label: 'Last run', value: latest ? `${MONTHS[Number(latest['month']) - 1]} ${String(latest['year'])}` : '—' }} />
        <StatCard stat={{ key: 'gross', label: 'Last gross', value: latest ? Number(latest['totalGross']) : 0, format: 'currency' }} />
        <StatCard stat={{ key: 'net', label: 'Last net paid', value: latest ? Number(latest['totalNet']) : 0, format: 'currency' }} />
      </StatGrid>

      <Card className="mt-4">
        <Table columns={columns} rows={data?.items ?? []} keyOf={(r) => String(r['id'])} loading={isFetching && !data}
          emptyTitle="No payslips generated" emptyDescription="Run payroll for a month to generate payslips." />
        {data && <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} limit={data.meta.limit} onChange={helpers.setPage} />}
      </Card>
    </>
  );
}
