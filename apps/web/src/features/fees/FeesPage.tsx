import { useMemo, useState } from 'react';
import { BellRing, FilePlus2, Receipt } from 'lucide-react';
import { toast } from 'sonner';
import {
  useInvoicesQuery, useSendFeeRemindersMutation, useFeeStructuresQuery,
  useClassesQuery, useGenerateInvoicesMutation, useRecordPaymentMutation,
  type InvoiceRow,
} from '@/features/api/endpoints';
import { ResourceList } from '@/components/layout/ResourceList';
import { useAuth } from '@/features/auth/useAuth';
import { errorMessage } from '@/lib/api';
import { FormModal, type Field } from '@/components/forms/FormModal';
import { Button, Select, StatusBadge, type Column } from '@/components/ui';
import { StatCard, StatGrid } from '@/components/ui/StatCard';
import { formatCompactCurrency, formatDate } from '@/lib/utils';
import { useListState } from '@/lib/useListState';

export default function FeesPage() {
  const { can } = useAuth();
  const { params } = useListState();
  const query = useInvoicesQuery({ ...params, limit: 25 });

  const { data: structures } = useFeeStructuresQuery();
  const { data: classes } = useClassesQuery();

  const [sendReminders, { isLoading: reminding }] = useSendFeeRemindersMutation();
  const [generateInvoices] = useGenerateInvoicesMutation();
  const [recordPayment] = useRecordPaymentMutation();

  const [generateOpen, setGenerateOpen] = useState(false);
  /** Invoice currently being paid; null means the dialog is closed. */
  const [payingFor, setPayingFor] = useState<InvoiceRow | null>(null);

  const extra = query.data?.extra ?? {};

  async function remind() {
    try {
      const result = await sendReminders({ onlyOverdue: true }).unwrap();

      // Nothing sent is not the same as success — say why, and what to do.
      if (result.sent === 0) {
        if (result.skipped > 0) {
          toast.warning('No reminders could be sent', {
            description: `${result.skipped} overdue invoices have no contactable guardian — no app account and no phone number on record.`,
          });
        } else {
          toast.info('Nothing to remind', {
            description: 'Every overdue family has already been reminded in the last 24 hours.',
          });
        }
        return;
      }

      const notes = [
        result.bySms > 0 ? `${result.bySms} by SMS to guardians not on the app` : null,
        result.skipped > 0 ? `${result.skipped} had no contact details` : null,
        result.failed > 0 ? `${result.failed} failed and will be retried` : null,
      ].filter(Boolean);

      // Be honest when SMS was only written to the log.
      if (result.bySms > 0 && !result.smsConfigured) {
        toast.warning(`${result.sent} reminders processed — SMS not delivered`, {
          description:
            'No SMS provider is configured, so messages to guardians without an app account were logged only. Add SMS credentials under Settings → Integrations.',
        });
        return;
      }

      toast.success(`Reminders sent to ${result.sent} families`, {
        description: notes.length > 0 ? notes.join(' · ') : undefined,
      });
    } catch (err) {
      toast.error('Could not send reminders', { description: errorMessage(err) });
    }
  }

  const structureOptions = useMemo(
    () =>
      (structures ?? []).map((s) => {
        const year = s['academicYear'] as { name: string } | null;
        return {
          value: String(s['id']),
          label: `${String(s['name'])}${year ? ` (${year.name})` : ''}`,
        };
      }),
    [structures],
  );

  const generateFields: Field[] = [
    { name: 'feeStructureId', label: 'Fee structure', type: 'select', required: true,
      resets: ['installmentId'],
      options: [{ value: '', label: 'Select a structure' }, ...structureOptions] },
    { name: 'installmentId', label: 'Installment', type: 'select', required: true,
      hint: 'Which quarter or term to bill',
      options: (values) => {
        const structure = structures?.find((s) => String(s['id']) === values['feeStructureId']);
        const installments = (structure?.['installments'] ?? []) as Array<Record<string, unknown>>;
        if (installments.length === 0) return [{ value: '', label: 'Choose a structure first' }];
        return [
          { value: '', label: 'Select an installment' },
          ...installments.map((i) => ({
            value: String(i['id']),
            label: `${String(i['name'])} — ${formatCompactCurrency(String(i['amount']))}`,
          })),
        ];
      } },
    { name: 'classId', label: 'Class', type: 'select', half: true,
      hint: 'Leave blank to bill every active student',
      options: [{ value: '', label: 'All classes' }, ...(classes ?? []).map((c) => ({ value: c.id, label: c.name }))] },
    { name: 'issueDate', label: 'Issue date', type: 'date', required: true, half: true,
      defaultValue: new Date().toISOString().slice(0, 10) },
    { name: 'dueDate', label: 'Due date', type: 'date', required: true, half: true },
    { name: 'notes', label: 'Notes', placeholder: 'Shown on the invoice (optional)' },
  ];

  const paymentFields: Field[] = [
    { name: 'amount', label: 'Amount (₹)', type: 'number', required: true, min: 1, half: true,
      defaultValue: payingFor ? Number(payingFor.balanceAmount) : undefined,
      hint: payingFor ? `Outstanding: ${formatCompactCurrency(payingFor.balanceAmount)}` : undefined },
    { name: 'mode', label: 'Payment mode', type: 'select', required: true, half: true,
      options: ['UPI', 'CARD', 'NETBANKING', 'CASH', 'CHEQUE', 'BANK_TRANSFER'].map((v) => ({
        value: v, label: v.replace('_', ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase()),
      })) },
    { name: 'paidAt', label: 'Paid on', type: 'date', half: true,
      defaultValue: new Date().toISOString().slice(0, 10) },
    { name: 'transactionRef', label: 'Transaction reference', half: true,
      hint: 'UPI ref, card auth code or bank reference' },
    { name: 'chequeNumber', label: 'Cheque number', half: true,
      visibleWhen: (v) => v['mode'] === 'CHEQUE' },
    { name: 'bankName', label: 'Bank', half: true,
      visibleWhen: (v) => v['mode'] === 'CHEQUE' || v['mode'] === 'BANK_TRANSFER' },
    { name: 'remarks', label: 'Remarks', type: 'textarea' },
  ];

  const columns: Array<Column<InvoiceRow>> = [
    {
      key: 'invoice',
      header: 'Invoice',
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-ink">{row.invoiceNo}</p>
          <p className="truncate text-xs text-ink-subtle">
            {row.student.firstName} {row.student.lastName} · {row.student.admissionNo}
          </p>
        </div>
      ),
    },
    { key: 'issued', header: 'Issued', hideOnMobile: true, render: (r) => <span className="text-ink-muted">{formatDate(r.issueDate, 'short')}</span> },
    { key: 'due', header: 'Due', hideOnMobile: true, render: (r) => <span className="text-ink-muted">{formatDate(r.dueDate, 'short')}</span> },
    { key: 'total', header: 'Total', align: 'right', render: (r) => <span className="nums font-medium">{formatCompactCurrency(r.totalAmount)}</span> },
    { key: 'paid', header: 'Paid', align: 'right', hideOnMobile: true, render: (r) => <span className="nums text-success">{formatCompactCurrency(r.paidAmount)}</span> },
    { key: 'balance', header: 'Balance', align: 'right', render: (r) => <span className="nums font-semibold text-ink">{formatCompactCurrency(r.balanceAmount)}</span> },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) => {
        if (!can('fees:create') || Number(row.balanceAmount) <= 0) return null;
        return (
          <Button
            size="xs"
            variant="outline"
            onClick={(e) => { e.stopPropagation(); setPayingFor(row); }}
            leftIcon={<Receipt className="h-3 w-3" />}
          >
            Record payment
          </Button>
        );
      },
    },
  ];

  return (
    <>
      <ResourceList
        title="Fees & Invoices"
        columns={columns}
        query={query}
        keyOf={(row) => row.id}
        searchPlaceholder="Search by invoice number…"
        emptyTitle="No invoices match these filters"
        emptyDescription="Generate invoices from a fee structure to bill students."
        actions={
          can('fees:update') && (
            <>
              <Button size="sm" variant="outline" loading={reminding} onClick={remind} leftIcon={<BellRing className="h-3.5 w-3.5" />}>
                Send reminders
              </Button>
              <Button size="sm" onClick={() => setGenerateOpen(true)} leftIcon={<FilePlus2 className="h-3.5 w-3.5" />}>
                Generate invoices
              </Button>
            </>
          )
        }
        filters={(h) => (
          <Select
            aria-label="Filter by status"
            value={h.params['status'] ?? ''}
            onChange={(e) => h.setParam('status', e.target.value || undefined)}
            options={[
              { value: '', label: 'Any status' },
              { value: 'PAID', label: 'Paid' },
              { value: 'PARTIALLY_PAID', label: 'Partially paid' },
              { value: 'OVERDUE', label: 'Overdue' },
              { value: 'ISSUED', label: 'Issued' },
            ]}
            wrapperClassName="w-44"
          />
        )}
      >
        <StatGrid>
          <StatCard stat={{ key: 'billed', label: 'Billed', value: Number(extra['billed'] ?? 0), format: 'currency' }} />
          <StatCard stat={{ key: 'collected', label: 'Collected', value: Number(extra['collected'] ?? 0), format: 'currency' }} />
          <StatCard stat={{ key: 'outstanding', label: 'Outstanding', value: Number(extra['outstanding'] ?? 0), format: 'currency' }} accent="warning" />
          <StatCard stat={{ key: 'count', label: 'Invoices', value: query.data?.meta.total ?? 0, format: 'number' }} />
        </StatGrid>
      </ResourceList>

      <FormModal
        open={generateOpen}
        onClose={() => setGenerateOpen(false)}
        title="Generate invoices"
        description="Creates one invoice per matching student. Students already billed for this installment are skipped."
        fields={generateFields}
        size="lg"
        submitLabel="Generate"
        successMessage="Invoices generated"
        onSubmit={async (values) => {
          const result = await generateInvoices(values).unwrap();
          toast.success(`${result.generated} invoices generated`, {
            description: `${result.skipped} skipped as already billed · ${formatCompactCurrency(result.totalBilled)} billed`,
          });
        }}
      />

      <FormModal
        open={payingFor !== null}
        onClose={() => setPayingFor(null)}
        title={payingFor ? `Record payment — ${payingFor.invoiceNo}` : 'Record payment'}
        description={
          payingFor
            ? `${payingFor.student.firstName} ${payingFor.student.lastName} · outstanding ${formatCompactCurrency(payingFor.balanceAmount)}`
            : undefined
        }
        fields={paymentFields}
        submitLabel="Record payment"
        successMessage="Payment recorded"
        onSubmit={async (values) => {
          const { paidAt, ...rest } = values;
          await recordPayment({
            ...rest,
            invoiceId: payingFor!.id,
            gateway: 'OFFLINE',
            paidAt: paidAt ? new Date(`${String(paidAt)}T12:00:00`).toISOString() : undefined,
          }).unwrap();
        }}
      />
    </>
  );
}
