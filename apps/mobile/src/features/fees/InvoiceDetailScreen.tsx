/**
 * One invoice, itemised.
 *
 * PRD gap analysis asks for GST-compliant invoices and downloadable receipts,
 * so the line items, tax and discount are all shown separately rather than
 * folded into a single total — a parent querying a charge needs to see which
 * fee head it came from.
 */

import { StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { feesApi } from '@/core/api/endpoints';
import { qk } from '@/core/api/queryClient';
import {
  formatCurrencyPrecise,
  formatDate,
  formatDueLabel,
  humanise,
  toAmount,
} from '@/core/utils/format';
import { useTheme } from '@/design/ThemeProvider';
import { spacing } from '@/design/tokens';
import {
  Card,
  ErrorState,
  ListRow,
  ListSkeleton,
  RowDivider,
  Screen,
  SectionHeader,
  StatusBadge,
  Text,
} from '@/design/components';

export function InvoiceDetailScreen({ invoiceId }: { invoiceId: string }) {
  const { colors } = useTheme();

  const query = useQuery({
    queryKey: qk.invoice(invoiceId),
    queryFn: () => feesApi.invoice(invoiceId),
  });

  if (query.isPending) {
    return (
      <Screen scroll>
        <ListSkeleton rows={5} />
      </Screen>
    );
  }

  if (query.isError) {
    return (
      <Screen scroll>
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </Screen>
    );
  }

  const invoice = query.data;
  if (!invoice) return null;

  const outstanding = toAmount(invoice.balanceAmount) > 0;

  return (
    <Screen scroll onRefresh={() => void query.refetch()} refreshing={query.isFetching}>
      <Card elevation="sm">
        <View style={styles.header}>
          <View style={styles.flex}>
            <Text variant="title2">{invoice.invoiceNo}</Text>
            <Text variant="caption" tone="muted" style={{ marginTop: 2 }}>
              {invoice.student.firstName} {invoice.student.lastName} ·{' '}
              {invoice.student.admissionNo}
            </Text>
          </View>
          <StatusBadge status={invoice.status} variant="solid" />
        </View>

        <View style={[styles.dates, { borderTopColor: colors.hairline }]}>
          <Figure label="Issued" value={formatDate(invoice.issueDate)} />
          <Figure
            label="Due"
            value={formatDate(invoice.dueDate)}
            hint={outstanding ? formatDueLabel(invoice.dueDate) : undefined}
            hintTone={invoice.status === 'OVERDUE' ? 'danger' : 'muted'}
          />
        </View>
      </Card>

      <View style={styles.section}>
        <SectionHeader title="Items" />
        <Card elevation="sm">
          {invoice.lines.length === 0 ? (
            <Text variant="callout" tone="muted">
              This invoice has no itemised lines.
            </Text>
          ) : (
            invoice.lines.map((line, index) => (
              <View key={line.id}>
                {index > 0 ? <RowDivider /> : null}
                <ListRow
                  title={line.feeHead?.name ?? line.description}
                  subtitle={line.feeHead ? line.description : null}
                  value={formatCurrencyPrecise(line.amount)}
                  showChevron={false}
                />
              </View>
            ))
          )}
        </Card>
      </View>

      <Card elevation="sm" style={styles.section}>
        <TotalLine label="Subtotal" value={subtotal(invoice.lines)} />

        {toAmount(invoice.discountAmount) > 0 ? (
          <TotalLine
            label="Discount / concession"
            value={-toAmount(invoice.discountAmount)}
            tone="success"
          />
        ) : null}

        {toAmount(invoice.taxAmount) > 0 ? (
          <TotalLine label="GST" value={toAmount(invoice.taxAmount)} />
        ) : null}

        <RowDivider />

        <TotalLine label="Total" value={toAmount(invoice.totalAmount)} emphasis />
        <TotalLine label="Paid" value={toAmount(invoice.paidAmount)} tone="success" />

        <RowDivider />

        <TotalLine
          label="Balance"
          value={toAmount(invoice.balanceAmount)}
          emphasis
          tone={outstanding ? 'danger' : 'success'}
        />
      </Card>

      {invoice.payments.length > 0 ? (
        <View style={styles.section}>
          <SectionHeader title="Payments against this invoice" />
          <Card elevation="sm">
            {invoice.payments.map((payment, index) => (
              <View key={payment.id}>
                {index > 0 ? <RowDivider inset={50} /> : null}
                <ListRow
                  title={formatCurrencyPrecise(payment.amount)}
                  subtitle={`${humanise(payment.mode)} · ${formatDate(payment.paidAt)}`}
                  meta={`Receipt ${payment.receiptNo}`}
                  leadingIcon="success"
                  leadingTone="success"
                  showChevron={false}
                />
              </View>
            ))}
          </Card>
        </View>
      ) : null}

      {invoice.notes ? (
        <Card elevation="none" style={styles.section}>
          <Text variant="micro" tone="subtle">
            NOTE FROM THE ACCOUNTS OFFICE
          </Text>
          <Text variant="callout" tone="muted" style={{ marginTop: spacing.xs }}>
            {invoice.notes}
          </Text>
        </Card>
      ) : null}
    </Screen>
  );
}

function subtotal(lines: Array<{ amount: string }>): number {
  return lines.reduce((sum, line) => sum + toAmount(line.amount), 0);
}

function Figure({
  label,
  value,
  hint,
  hintTone = 'muted',
}: {
  label: string;
  value: string;
  hint?: string;
  hintTone?: 'muted' | 'danger';
}) {
  return (
    <View style={styles.flex}>
      <Text variant="micro" tone="subtle">
        {label.toUpperCase()}
      </Text>
      <Text variant="callout" weight="600" style={{ marginTop: 2 }}>
        {value}
      </Text>
      {hint ? (
        <Text variant="caption" tone={hintTone}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

function TotalLine({
  label,
  value,
  emphasis = false,
  tone,
}: {
  label: string;
  value: number;
  emphasis?: boolean;
  tone?: 'success' | 'danger';
}) {
  return (
    <View style={styles.totalLine}>
      <Text variant={emphasis ? 'bodyStrong' : 'body'} tone={emphasis ? 'default' : 'muted'}>
        {label}
      </Text>
      <Text
        variant={emphasis ? 'title3' : 'body'}
        tabular
        tone={tone ?? 'default'}
      >
        {formatCurrencyPrecise(value)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  flex: {
    flex: 1,
  },
  dates: {
    flexDirection: 'row',
    gap: spacing.lg,
    marginTop: spacing.lg,
    paddingTop: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  section: {
    marginTop: spacing.xl,
  },
  totalLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.xs + 2,
  },
});
