/**
 * Library.
 *
 * Loans are scoped server-side: a student's token carries SELF scope and a
 * guardian's carries CHILDREN, so `GET /library/loans` already returns only
 * the right rows. The app never sends a student id as a filter, because a
 * filter is a hint, not a control.
 *
 * Overdue books lead, with the accrued fine shown — the fine is what turns
 * "I forgot" into "I should go and return it", and the server's hourly job
 * keeps it current.
 */

import { useCallback, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { DEFAULT_FINE_PER_DAY } from '@erp/shared';
import { libraryApi } from '@/core/api/endpoints';
import { qk } from '@/core/api/queryClient';
import { useAuth } from '@/core/auth/AuthProvider';
import { daysUntil, formatCurrency, formatDate, formatDueLabel, toAmount } from '@/core/utils/format';
import { useSubjectStudent } from '@/features/shared/useSubjectStudent';
import { useTheme } from '@/design/ThemeProvider';
import { spacing } from '@/design/tokens';
import {
  Banner,
  Card,
  EmptyState,
  ErrorState,
  Icon,
  ListSkeleton,
  Screen,
  SectionHeader,
  StatusBadge,
  Text,
} from '@/design/components';
import type { LoanRow } from '@/core/api/types';

export function LibraryScreen() {
  const { role } = useAuth();
  const subject = useSubjectStudent();

  /**
   * A student asks for their own loans and lets scope do the work. A guardian
   * has several children, so the id has to be named — CHILDREN scope permits
   * all of them, and without it the list would mix two children's books.
   */
  const forChild = role === 'PARENT' && subject.studentId;

  const query = useQuery({
    queryKey: qk.loans(forChild ? subject.studentId! : 'self'),
    queryFn: () =>
      forChild ? libraryApi.loansForStudent(subject.studentId!) : libraryApi.myLoans(),
    enabled: role !== 'PARENT' || Boolean(subject.studentId),
  });

  const onRefresh = useCallback(() => {
    void query.refetch();
  }, [query]);

  const { current, overdue, history, totalFine } = useMemo(() => {
    const loans = query.data?.items ?? [];

    return {
      overdue: loans.filter((l) => l.status === 'OVERDUE' || l.status === 'LOST'),
      current: loans.filter((l) => l.status === 'ISSUED' || l.status === 'RESERVED'),
      history: loans.filter((l) => l.status === 'RETURNED'),
      totalFine: loans
        .filter((l) => !l.finePaid)
        .reduce((sum, l) => sum + toAmount(l.fineAmount), 0),
    };
  }, [query.data]);

  if (query.isPending) {
    return (
      <Screen scroll>
        <ListSkeleton rows={4} />
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

  const isEmpty = (query.data?.items ?? []).length === 0;

  return (
    <Screen scroll onRefresh={onRefresh} refreshing={query.isFetching}>
      {totalFine > 0 ? (
        <Banner
          tone="warning"
          icon="alert"
          title={`${formatCurrency(totalFine)} in library fines outstanding`}
          message={`Fines accrue at about ${formatCurrency(DEFAULT_FINE_PER_DAY)} per day per book. Settle them at the library counter.`}
        />
      ) : null}

      {overdue.length > 0 ? (
        <View style={styles.section}>
          <SectionHeader title="Overdue" subtitle="Return these as soon as possible" />
          <View style={styles.stack}>
            {overdue.map((loan) => (
              <LoanCard key={loan.id} loan={loan} />
            ))}
          </View>
        </View>
      ) : null}

      {current.length > 0 ? (
        <View style={styles.section}>
          <SectionHeader
            title="Currently issued"
            subtitle={`${current.length} book${current.length === 1 ? '' : 's'} on loan`}
          />
          <View style={styles.stack}>
            {current.map((loan) => (
              <LoanCard key={loan.id} loan={loan} />
            ))}
          </View>
        </View>
      ) : null}

      {history.length > 0 ? (
        <View style={styles.section}>
          <SectionHeader title="Returned" subtitle={`${history.length} in your history`} />
          <View style={styles.stack}>
            {history.slice(0, 12).map((loan) => (
              <LoanCard key={loan.id} loan={loan} />
            ))}
          </View>
        </View>
      ) : null}

      {isEmpty ? (
        <EmptyState
          icon="library"
          title="No library activity"
          message="Books issued from the school library will appear here, along with their due dates."
        />
      ) : null}
    </Screen>
  );
}

function LoanCard({ loan }: { loan: LoanRow }) {
  const { colors } = useTheme();

  const returned = loan.status === 'RETURNED';
  const late = loan.status === 'OVERDUE' || loan.status === 'LOST';
  const days = daysUntil(loan.dueAt);

  return (
    <Card
      elevation={returned ? 'none' : 'sm'}
      accentColor={late ? colors.danger : undefined}
    >
      <View style={styles.row}>
        <View style={[styles.spine, { backgroundColor: colors.surfaceSunken }]}>
          <Icon name="library" size={20} tone={late ? 'danger' : 'brand'} />
        </View>

        <View style={styles.flex}>
          <Text variant="bodyStrong" numberOfLines={2}>
            {loan.bookCopy.book.title}
          </Text>
          <Text variant="caption" tone="muted" numberOfLines={1} style={{ marginTop: 1 }}>
            {loan.bookCopy.book.author}
          </Text>
          <Text variant="micro" tone="subtle" style={{ marginTop: 2 }}>
            {loan.bookCopy.accessionNo}
            {loan.renewalCount > 0
              ? ` · RENEWED ${loan.renewalCount}×`
              : ''}
          </Text>
        </View>

        <StatusBadge status={loan.status} />
      </View>

      <View style={[styles.footer, { borderTopColor: colors.hairline }]}>
        <Text variant="caption" tone="muted">
          Issued {formatDate(loan.issuedAt)}
        </Text>

        {returned ? (
          <Text variant="caption" tone="success">
            Returned {formatDate(loan.returnedAt)}
          </Text>
        ) : (
          <Text
            variant="caption"
            weight="600"
            tone={late ? 'danger' : days !== null && days <= 2 ? 'warning' : 'muted'}
          >
            {formatDueLabel(loan.dueAt)}
          </Text>
        )}

        {toAmount(loan.fineAmount) > 0 ? (
          <Text variant="caption" weight="600" tone={loan.finePaid ? 'success' : 'danger'}>
            {loan.finePaid ? 'Fine paid' : `Fine ${formatCurrency(loan.fineAmount)}`}
          </Text>
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: spacing.xl,
  },
  stack: {
    gap: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  spine: {
    width: 40,
    height: 52,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flex: {
    flex: 1,
  },
  footer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
