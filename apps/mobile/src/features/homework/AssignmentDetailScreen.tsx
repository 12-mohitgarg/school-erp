/**
 * One assignment, with submission for students.
 *
 * Late submission is governed by the assignment's own `allowLateSubmission`
 * and `latePenaltyPercent`, and the screen states the penalty *before* the
 * student submits rather than showing it as a surprise deduction afterwards.
 *
 * Attachments upload straight from the device to Cloudinary — the same
 * unsigned-preset flow the web app uses, so no binary ever transits the API
 * and the student sees real byte-level progress instead of a frozen button.
 */

import { useCallback, useMemo, useState } from 'react';
import { Alert, Linking, StyleSheet, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import { ApiError } from '@/core/api/client';
import { examinationApi } from '@/core/api/endpoints';
import { qk } from '@/core/api/queryClient';
import { useAuth } from '@/core/auth/AuthProvider';
import {
  daysUntil,
  formatDate,
  formatDateTime,
  formatDueLabel,
  fullName,
  toAmount,
} from '@/core/utils/format';
import { useSubjectStudent } from '@/features/shared/useSubjectStudent';
import { uploadToCloudinary, type UploadProgress } from '@/core/storage/cloudinary';
import { useTheme } from '@/design/ThemeProvider';
import { radii, spacing } from '@/design/tokens';
import {
  Badge,
  Banner,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Icon,
  Input,
  ListSkeleton,
  ProgressBar,
  Screen,
  Text,
} from '@/design/components';

interface Attachment {
  name: string;
  uri: string;
  mimeType: string;
  size: number;
  /** Set once the upload completes. */
  url?: string;
  progress?: number;
  error?: string;
}

export function AssignmentDetailScreen({ assignmentId }: { assignmentId: string }) {
  const { colors } = useTheme();
  const { role } = useAuth();
  const subject = useSubjectStudent();
  const queryClient = useQueryClient();

  const scope = subject.sectionId ?? subject.classId ?? 'all';

  /**
   * There is no `GET /assignments/:id`, so the row is read out of the list
   * query that is already cached. That is a deliberate trade: one fewer
   * endpoint to maintain, and the detail screen opens instantly from the list.
   */
  const listQuery = useQuery({
    queryKey: qk.assignments(scope),
    queryFn: () =>
      examinationApi.assignments({
        limit: 60,
        ...(subject.sectionId ? { sectionId: subject.sectionId } : {}),
        ...(!subject.sectionId && subject.classId ? { classId: subject.classId } : {}),
      }),
    enabled: !subject.isPending,
  });

  const assignment = useMemo(
    () => listQuery.data?.items.find((a) => a.id === assignmentId),
    [listQuery.data, assignmentId],
  );

  const [content, setContent] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useMutation({
    mutationFn: () =>
      examinationApi.submitAssignment(assignmentId, {
        content: content.trim() || undefined,
        attachmentUrls: attachments
          .map((a) => a.url)
          .filter((url): url is string => Boolean(url)),
      }),
    onSuccess: () => {
      setSubmitted(true);
      setError(null);
      void queryClient.invalidateQueries({ queryKey: qk.assignments(scope) });
      void queryClient.invalidateQueries({ queryKey: qk.dashboard() });
    },
    onError: (err) => {
      setError(
        err instanceof ApiError ? err.message : 'Your work could not be submitted. Try again.',
      );
    },
  });

  const pickAttachment = useCallback(async () => {
    const result = await DocumentPicker.getDocumentAsync({
      multiple: false,
      copyToCacheDirectory: true,
    });

    const file = result.assets?.[0];
    if (result.canceled || !file) return;

    const attachment: Attachment = {
      name: file.name,
      uri: file.uri,
      mimeType: file.mimeType ?? 'application/octet-stream',
      size: file.size ?? 0,
      progress: 0,
    };

    setAttachments((prev) => [...prev, attachment]);

    try {
      const url = await uploadToCloudinary(attachment, (p: UploadProgress) => {
        setAttachments((prev) =>
          prev.map((a) => (a.uri === attachment.uri ? { ...a, progress: p.percent } : a)),
        );
      });

      setAttachments((prev) =>
        prev.map((a) => (a.uri === attachment.uri ? { ...a, url, progress: 100 } : a)),
      );
    } catch (err) {
      setAttachments((prev) =>
        prev.map((a) =>
          a.uri === attachment.uri
            ? { ...a, error: err instanceof Error ? err.message : 'Upload failed' }
            : a,
        ),
      );
    }
  }, []);

  if (listQuery.isPending || subject.isPending) {
    return (
      <Screen scroll>
        <ListSkeleton rows={4} />
      </Screen>
    );
  }

  if (listQuery.isError) {
    return (
      <Screen scroll>
        <ErrorState error={listQuery.error} onRetry={() => void listQuery.refetch()} />
      </Screen>
    );
  }

  if (!assignment) {
    return (
      <Screen scroll>
        <EmptyState
          icon="homework"
          title="Assignment not found"
          message="It may have been withdrawn by the teacher."
        />
      </Screen>
    );
  }

  const days = daysUntil(assignment.dueAt);
  const overdue = days !== null && days < 0;
  const canSubmit = role === 'STUDENT' && (!overdue || assignment.allowLateSubmission);
  const uploading = attachments.some((a) => a.progress !== undefined && a.progress < 100 && !a.error);

  return (
    <Screen scroll bottomInset={canSubmit ? 60 : 0}>
      <Card elevation="sm" accentColor={assignment.subject.colorHex || colors.brand500}>
        <View style={styles.headerRow}>
          <Badge label={assignment.subject.name} tone="brand" />
          <Badge label={`${toAmount(assignment.maxMarks)} marks`} tone="neutral" />
          <View style={styles.flex} />
          <Text
            variant="micro"
            weight="600"
            tone={overdue ? 'danger' : days !== null && days <= 1 ? 'warning' : 'subtle'}
          >
            {formatDueLabel(assignment.dueAt).toUpperCase()}
          </Text>
        </View>

        <Text variant="title1" style={{ marginTop: spacing.md }}>
          {assignment.title}
        </Text>

        <Text variant="caption" tone="muted" style={{ marginTop: spacing.xs }}>
          {fullName(assignment.teacher.firstName, assignment.teacher.lastName)} ·{' '}
          {assignment.class.name}
          {assignment.section ? ` ${assignment.section.name}` : ''}
        </Text>

        <View style={[styles.dates, { borderTopColor: colors.hairline }]}>
          <DateFigure label="Assigned" value={formatDate(assignment.assignedOn)} />
          <DateFigure label="Due" value={formatDateTime(assignment.dueAt)} />
        </View>
      </Card>

      <Card elevation="none" style={styles.block}>
        <Text variant="title3">Description</Text>
        <Text variant="body" tone="muted" style={{ marginTop: spacing.sm }}>
          {assignment.description}
        </Text>

        {assignment.instructions ? (
          <>
            <Text variant="title3" style={{ marginTop: spacing.xl }}>
              Instructions
            </Text>
            <Text variant="body" tone="muted" style={{ marginTop: spacing.sm }}>
              {assignment.instructions}
            </Text>
          </>
        ) : null}
      </Card>

      {assignment.attachmentUrls.length > 0 ? (
        <Card elevation="none" style={styles.block}>
          <Text variant="title3">Material from the teacher</Text>
          <View style={styles.attachmentList}>
            {assignment.attachmentUrls.map((url, index) => (
              <Card
                key={url}
                elevation="none"
                padded={false}
                onPress={() => void Linking.openURL(url)}
                style={styles.attachmentRow}
              >
                <Icon name="document" size={18} tone="brand" />
                <Text variant="callout" tone="brand" numberOfLines={1} style={styles.flex}>
                  Attachment {index + 1}
                </Text>
                <Icon name="forward" size={14} tone="subtle" />
              </Card>
            ))}
          </View>
        </Card>
      ) : null}

      {/* Submission — students only. */}
      {role === 'STUDENT' ? (
        submitted ? (
          <Banner
            tone="success"
            icon="success"
            title="Submitted"
            message={
              overdue && assignment.allowLateSubmission
                ? `Handed in late — a ${assignment.latePenaltyPercent}% penalty may be applied.`
                : 'Your teacher will mark this and the grade will appear under Results.'
            }
          />
        ) : (
          <Card elevation="sm" style={styles.block}>
            <Text variant="title3">Submit your work</Text>

            {overdue && assignment.allowLateSubmission ? (
              <Banner
                tone="warning"
                icon="clock"
                title="This is now late"
                message={`Late submissions are accepted with a ${assignment.latePenaltyPercent}% penalty.`}
              />
            ) : null}

            {overdue && !assignment.allowLateSubmission ? (
              <Banner
                tone="danger"
                icon="lock"
                title="Submissions are closed"
                message="This assignment did not allow late submission. Speak to your teacher."
              />
            ) : null}

            {error ? <Banner tone="danger" icon="alert" title={error} /> : null}

            <Input
              label="Your answer"
              value={content}
              onChangeText={setContent}
              placeholder="Type your answer, or attach a file below"
              multiline
              numberOfLines={6}
              maxLength={20000}
              editable={canSubmit && !submit.isPending}
              containerStyle={{ marginTop: spacing.lg }}
              style={styles.answerInput}
            />

            <View style={styles.attachmentList}>
              {attachments.map((attachment) => (
                <AttachmentRow
                  key={attachment.uri}
                  attachment={attachment}
                  onRemove={() =>
                    setAttachments((prev) => prev.filter((a) => a.uri !== attachment.uri))
                  }
                />
              ))}
            </View>

            <Button
              label="Attach a file"
              variant="secondary"
              size="sm"
              leading={<Icon name="attach" size={15} tone="brand" />}
              disabled={!canSubmit || attachments.length >= 10}
              onPress={() => void pickAttachment()}
              style={{ marginTop: spacing.md }}
            />

            <Button
              label={uploading ? 'Waiting for uploads…' : 'Submit'}
              size="lg"
              fullWidth
              loading={submit.isPending}
              disabled={
                !canSubmit ||
                uploading ||
                (content.trim().length === 0 && attachments.every((a) => !a.url))
              }
              onPress={() =>
                Alert.alert(
                  'Submit this work?',
                  'You will not be able to change it afterwards.',
                  [
                    { text: 'Not yet', style: 'cancel' },
                    { text: 'Submit', onPress: () => submit.mutate() },
                  ],
                )
              }
              style={{ marginTop: spacing.lg }}
            />
          </Card>
        )
      ) : (
        <Banner
          tone="info"
          icon="info"
          title="Submitted by the student"
          message="Your child hands this in from their own app. You can see the grade here once it is marked."
        />
      )}
    </Screen>
  );
}

function DateFigure({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.flex}>
      <Text variant="micro" tone="subtle">
        {label.toUpperCase()}
      </Text>
      <Text variant="callout" weight="600" style={{ marginTop: 2 }}>
        {value}
      </Text>
    </View>
  );
}

function AttachmentRow({
  attachment,
  onRemove,
}: {
  attachment: Attachment;
  onRemove: () => void;
}) {
  const { colors } = useTheme();
  const done = Boolean(attachment.url);

  return (
    <View style={[styles.uploadRow, { backgroundColor: colors.surfaceSunken }]}>
      <Icon
        name={attachment.error ? 'alert' : done ? 'success' : 'document'}
        size={18}
        tone={attachment.error ? 'danger' : done ? 'success' : 'muted'}
      />

      <View style={styles.flex}>
        <Text variant="callout" numberOfLines={1}>
          {attachment.name}
        </Text>

        {attachment.error ? (
          <Text variant="caption" tone="danger">
            {attachment.error}
          </Text>
        ) : done ? (
          <Text variant="caption" tone="success">
            Uploaded
          </Text>
        ) : (
          <View style={{ marginTop: 4 }}>
            <ProgressBar value={attachment.progress ?? 0} height={4} />
          </View>
        )}
      </View>

      <Button label="Remove" variant="ghost" size="sm" onPress={onRemove} />
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
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
  block: {
    marginTop: spacing.lg,
  },
  attachmentList: {
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  attachmentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
  },
  uploadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.md,
  },
  answerInput: {
    minHeight: 120,
    textAlignVertical: 'top',
  },
});
