/**
 * Child switcher.
 *
 * A guardian with three children is one account with three completely
 * different sets of data, and every family screen reads `activeChild`. So the
 * switch has to be reachable from anywhere and unmistakable once made — which
 * is why the selected child is also shown in the home header, not just here.
 *
 * `canViewLocation` is surfaced honestly: a non-custodial guardian keeps
 * academic access but loses the live map, and the row says so rather than the
 * tracking tab silently showing an error later.
 */

import { StyleSheet, View } from 'react-native';
import { useAuth } from '@/core/auth/AuthProvider';
import { humanise } from '@/core/utils/format';
import { spacing } from '@/design/tokens';
import { Avatar, Badge, Card, Icon, Sheet, Text } from '@/design/components';

export function ChildSwitcherSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const { children, activeChild, selectChild } = useAuth();

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Switch child"
      subtitle={`${children.length} linked to this account`}
    >
      {children.map((child) => {
        const selected = child.studentId === activeChild?.studentId;

        return (
          <Card
            key={child.studentId}
            elevation={selected ? 'sm' : 'none'}
            onPress={() => {
              selectChild(child.studentId);
              onClose();
            }}
          >
            <View style={styles.row}>
              <Avatar
                name={child.fullName}
                uri={child.avatarUrl}
                size="lg"
                highlighted={selected}
              />

              <View style={styles.body}>
                <Text variant="bodyStrong" numberOfLines={1}>
                  {child.fullName}
                </Text>
                <Text variant="caption" tone="muted">
                  {child.className} · {child.sectionName}
                </Text>
                <Text variant="micro" tone="subtle" style={{ marginTop: 2 }}>
                  {child.admissionNo}
                </Text>

                <View style={styles.badges}>
                  <Badge label={humanise(child.custody)} tone="neutral" />
                  {!child.canViewLocation ? (
                    <Badge label="No location access" tone="warning" />
                  ) : null}
                </View>
              </View>

              {selected ? <Icon name="success" size={20} tone="brand" /> : null}
            </View>
          </Card>
        );
      })}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  body: {
    flex: 1,
  },
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs + 2,
    marginTop: spacing.sm,
  },
});
