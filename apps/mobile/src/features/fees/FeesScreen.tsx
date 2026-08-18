/**
 * Fees.
 *
 * The outstanding balance leads, because that is the only number anyone opens
 * this screen for. Overdue invoices are separated out rather than sorted in —
 * "how much am I late on" is a different question from "what do I owe", and
 * mixing them makes both harder to answer.
 *
 * Note on payment: PARENT holds `fees:view` and deliberately *not*
 * `fees:create`, because `fees:create` would also authorise recording
 * arbitrary payments, issuing refunds and granting concessions. Online payment
 * therefore goes through a gateway checkout, not through this app writing a
 * payment row — so the button hands off rather than pretending to settle.
 */

import { useCallback, useMemo } from 'react';
import { Alert, Linking, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { feesApi } from '@/core/api/endpoints';
import { qk } from '@/core/api/queryClient';
import {
  daysUntil,
  formatCurrency,
  formatDate,
  formatDueLabel,
  humanise,
} from '@/core/utils/format';
import { useSubjectStudent } from '@/features/shared/useSubjectStudent';
import { useTheme } from '@/design/ThemeProvider';
import { spacing } from '@/design/tokens';
import {
  Banner,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Icon,
  ListRow,
  ListSkeleton,
  ProgressBar,
  RowDivider,
  Screen,
  SectionHeader,
  StatusBadge,
  Text,
} from '@/design/components';
import type { InvoiceRow } from '@/core/api/types';

export function FeesScreen({
  onOpenInvoice,
}: {
  onOpenInvoice: (invoiceId: string) => void;
}) {
  const { colors } = useTheme();
  const subject = useSubjectStudent();

  const query = useQuery({
    queryKey: qk.fees(subject.studentId ?? 'none'),
    queryFn: () => feesApi.studentSummary(subject.studentId!),
    enabled: Boolean(subject.studentId),
  });

  const onRefresh = useCallback(() => {
    void query.refetch();
  }, [query]);

  const { overdue, upcoming, settled } = useMemo(() => {
    const invoices = query.data?.invoices ?? [];

    return {
      overdue: invoices.filter((i) => i.status === 'OVERDUE'),
      upcoming: invoices.filter(
        (i) => i.status === 'ISSUED' || i.status === 'PARTIALLY_PAID',
      ),
      settled: invoices.filter((i) => i.status === 'PAID' || i.status === 'REFUNDED'),
    };
  }, [query.data]);

  if (!subject.studentId) {
    return (
      <Screen scroll>
        <EmptyState
          icon="fees"
          title="No student selected"
          message="Choose a child from the home screen to see their fees."
        />
      </Screen>
    );
  }

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
        <ErrorState error={query.error} onRetry={onRefresh} />
      </Screen>
    );
  }

  const summary = query.data?.summary;
  const payments = query.data?.recentPayments ?? [];
  const collected =
    summary && summary.totalBilled > 0 ? (summary.totalPaid / summary.totalBilled) * 100 : 0;

  return (
    <Screen scroll onRefresh={onRefresh} refreshing={query.isFetching}>
      {/* The headline. One figure, unambiguous, with the context under it. */}
      {summary ? (
        <Card elevation="md">
          <Text variant="micro" tone="subtle">
            OUTSTANDING BALANCE
          </Text>

          <Text
            variant="display"
            tabular
            tone={summary.outstanding > 0 ? 'danger' : 'success'}
            style={{ marginTop: spacing.xs }}
          >
            {formatCurrency(summary.outstanding)}
          </Text>

          {summary.overdueCount > 0 ? (
            <Text variant="callout" tone="danger" style={{ marginTop: spacing.xs }}>
              {formatCurrency(summary.overdueAmount)} of this is overdue across{' '}
              {summary.overdueCount} invoice{summary.overdueCount === 1 ? '' : 's'}
            </Text>
          ) : summary.outstanding === 0 ? (
            <Text variant="callout" tone="success" style={{ marginTop: spacing.xs }}>
              All fees are paid up to date.
            </Text>
          ) : null}

          <View style={styles.progressBlock}>
            <ProgressBar
              value={collected}
              height={7}
              color={colors.success}
            />
            <View style={styles.progressLegend}>
              <Text variant="caption" tone="muted">
                Paid {formatCurrency(summary.totalPaid)}
              </Text>
              <Text variant="caption" tone="subtle">
                of {formatCurrency(summary.totalBilled)} billed
              </Text>
            </View>
          </View>

          {summary.outstanding > 0 ? (
            <Button
              label="Pay now"
              size="lg"
              fullWidth
              leading={<Icon name="fees" size={17} tone="onBrand" />}
              onPress={openCheckout}
              style={{ marginTop: spacing.lg }}
            />
          ) : null}
        </Card>
      ) : null}

      {overdue.length > 0 ? (
        <View style={styles.section}>
          <SectionHeader title="Overdue" subtitle="Settle these first" />
          <View style={styles.stack}>
            {overdue.map((invoice) => (
              <InvoiceCard
                key={invoice.id}
                invoice={invoice}
                onPress={() => onOpenInvoice(invoice.id)}
              />
            ))}
          </View>
        </View>
      ) : null}

      {upcoming.length > 0 ? (
        <View style={styles.section}>
          <SectionHeader title="Due" subtitle={`${upcoming.length} open invoice${upcoming.length === 1 ? '' : 's'}`} />
          <View style={styles.stack}>
            {upcoming.map((invoice) => (
              <InvoiceCard
                key={invoice.id}
                invoice={invoice}
                onPress={() => onOpenInvoice(invoice.id)}
              />
            ))}
          </View>
        </View>
      ) : null}

      {payments.length > 0 ? (
        <View style={styles.section}>
          <SectionHeader title="Recent payments" subtitle="Tap a receipt for its detail" />
          <Card elevation="sm">
            {payments.map((payment, index) => (
              <View key={payment.id}>
                {index > 0 ? <RowDivider inset={50} /> : null}
                <ListRow
                  title={formatCurrency(payment.amount)}
                  subtitle={`${humanise(payment.mode)} · ${formatDate(payment.paidAt)}`}
                  meta={payment.receiptNo}
                  leadingIcon="success"
                  leadingTone="success"
                  showChevron={false}
                />
              </View>
            ))}
          </Card>
        </View>
      ) : null}

      {settled.length > 0 ? (
        <View style={styles.section}>
          <SectionHeader title="Settled invoices" subtitle={`${settled.length} closed`} />
          <View style={styles.stack}>
            {settled.slice(0, 6).map((invoice) => (
              <InvoiceCard
                key={invoice.id}
                invoice={invoice}
                onPress={() => onOpenInvoice(invoice.id)}
              />
            ))}
          </View>
        </View>
      ) : null}

      {(query.data?.invoices ?? []).length === 0 ? (
        <EmptyState
          icon="fees"
          title="No invoices yet"
          message="Fee invoices raised by the school office will appear here."
        />
      ) : null}

      <Banner
        tone="info"
        icon="info"
        title="Questions about a charge?"
        message="Contact the school accounts office. Concessions and refunds are handled there, not in the app."
      />
    </Screen>
  );
}

export function InvoiceCard({
  invoice,
  onPress,
}: {
  invoice: InvoiceRow;
  onPress: () => void;
}) {
  const { colors } = useTheme();

  const days = daysUntil(invoice.dueDate);
  const outstanding = invoice.status !== 'PAID' && invoice.status !== 'REFUNDED';

  const accent =
    invoice.status === 'OVERDUE'
      ? colors.danger
      : invoice.status === 'PARTIALLY_PAID'
        ? colors.warning
        : undefined;

  return (
    <Card onPress={onPress} accentColor={accent} elevation={outstanding ? 'sm' : 'none'}>
      <View style={styles.invoiceHeader}>
        <View style={styles.flex}>
          <Text variant="bodyStrong" numberOfLines={1}>
            {invoice.invoiceNo}
          </Text>
          <Text variant="caption" tone="muted" style={{ marginTop: 1 }}>
            Issued {formatDate(invoice.issueDate)}
          </Text>
        </View>

        <StatusBadge status={invoice.status} />
      </View>

      <View style={[styles.invoiceAmounts, { borderTopColor: colors.hairline }]}>
        <View style={styles.flex}>
          <Text variant="micro" tone="subtle">
            {outstanding ? 'BALANCE' : 'TOTAL'}
          </Text>
          <Text
            variant="title3"
            tabular
            tone={invoice.status === 'OVERDUE' ? 'danger' : 'default'}
            style={{ marginTop: 2 }}
          >
            {formatCurrency(outstanding ? invoice.balanceAmount : invoice.totalAmount)}
          </Text>
        </View>

        {outstanding ? (
          <View style={styles.dueBlock}>
            <Text
              variant="caption"
              weight="600"
              tone={
                invoice.status === 'OVERDUE'
                  ? 'danger'
                  : days !== null && days <= 7
                    ? 'warning'
                    : 'muted'
              }
            >
              {formatDueLabel(invoice.dueDate)}
            </Text>
            <Text variant="micro" tone="subtle">
              {formatDate(invoice.dueDate).toUpperCase()}
            </Text>
          </View>
        ) : null}
      </View>
    </Card>
  );
}

/**
 * Hand off to the school's own gateway checkout.
 *
 * There is no in-app payment endpoint a guardian is authorised to call, and
 * building a card form here would mean handling card data on a device — so the
 * honest implementation is to explain and hand off. Wire the school's Razorpay
 * / Stripe / PayU checkout URL in when the gateway is provisioned.
 */
function openCheckout(): void {
  Alert.alert(
    'Pay fees',
    'Payments are taken on the school’s secure payment page. You will be taken there now.',
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Continue',
        onPress: () => {
          void Linking.openURL('https://edusphere.io/pay').catch(() =>
            Alert.alert(
              'Could not open the payment page',
              'Please contact the school accounts office to pay.',
            ),
          );
        },
      },
    ],
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: spacing['2xl'],
  },
  stack: {
    gap: spacing.md,
  },
  flex: {
    flex: 1,
  },
  progressBlock: {
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  progressLegend: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  invoiceHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  invoiceAmounts: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.md,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  dueBlock: {
    alignItems: 'flex-end',
    gap: 2,
  },
});
