import { usePaymentsQuery, useCollectionReportQuery } from '@/features/api/endpoints';
import { ResourceList } from '@/components/layout/ResourceList';
import { useListState } from '@/lib/useListState';
import { Badge, StatusBadge, type Column } from '@/components/ui';
import { StatCard, StatGrid } from '@/components/ui/StatCard';
import { formatCompactCurrency, formatDateTime } from '@/lib/utils';

type Row = Record<string, unknown>;

export default function PaymentsPage() {
  const { params } = useListState();
  const query = usePaymentsQuery({ ...params, limit: 25 });
  const { data: report } = useCollectionReportQuery({});

  const columns: Array<Column<Row>> = [
    {
      key: 'receipt',
      header: 'Receipt',
      render: (row) => {
        const student = row['student'] as { firstName: string; lastName: string; admissionNo: string } | null;
        return (
          <div className="min-w-0">
            <p className="truncate font-medium text-ink">{String(row['receiptNo'])}</p>
            <p className="truncate text-xs text-ink-subtle">
              {student ? `${student.firstName} ${student.lastName} · ${student.admissionNo}` : '—'}
            </p>
          </div>
        );
      },
    },
    {
      key: 'invoice',
      header: 'Invoice',
      hideOnMobile: true,
      render: (row) => {
        const invoice = row['invoice'] as { invoiceNo: string } | null;
        return <span className="text-ink-muted">{invoice?.invoiceNo ?? '—'}</span>;
      },
    },
    { key: 'mode', header: 'Mode', render: (row) => <Badge tone="neutral">{String(row['mode']).replace('_', ' ')}</Badge> },
    { key: 'amount', header: 'Amount', align: 'right', render: (row) => <span className="nums font-semibold">{formatCompactCurrency(String(row['amount']))}</span> },
    { key: 'paidAt', header: 'Paid at', hideOnMobile: true, render: (row) => <span className="text-ink-muted">{formatDateTime(row['paidAt'] as string | null)}</span> },
    { key: 'status', header: 'Status', render: (row) => <StatusBadge status={String(row['status'])} /> },
  ];

  return (
    <ResourceList
      title="Payments"
      columns={columns}
      query={query}
      keyOf={(row) => String(row['id'])}
      searchPlaceholder="Search receipts…"
      emptyTitle="No payments recorded"
    >
      <StatGrid>
        <StatCard stat={{ key: 'collected', label: 'Total collected', value: report?.collected ?? 0, format: 'currency' }} />
        <StatCard stat={{ key: 'txn', label: 'Transactions', value: report?.transactionCount ?? 0, format: 'number' }} />
        <StatCard stat={{ key: 'outstanding', label: 'Outstanding', value: report?.outstanding ?? 0, format: 'currency' }} accent="warning" />
        <StatCard stat={{ key: 'openInv', label: 'Open invoices', value: report?.outstandingInvoices ?? 0, format: 'number' }} />
      </StatGrid>
    </ResourceList>
  );
}
