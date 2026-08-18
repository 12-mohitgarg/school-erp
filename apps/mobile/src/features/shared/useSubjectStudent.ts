/**
 * "Whose records am I looking at?"
 *
 * A student is looking at their own; a guardian is looking at the child they
 * selected. Every academic screen in the Parent and Student apps is the same
 * screen with a different answer to that one question, which is why they are
 * shared components rather than duplicated per app.
 *
 * The profile is fetched because several screens need the *current enrolment*
 * — the timetable needs `sectionId`, homework needs `classId`, and neither is
 * on the login payload (`LinkedChild` carries the class name, not its id).
 */

import { useQuery } from '@tanstack/react-query';
import { studentApi } from '@/core/api/endpoints';
import { qk } from '@/core/api/queryClient';
import { useAuth } from '@/core/auth/AuthProvider';
import type { EnrollmentRow, StudentProfile } from '@/core/api/types';

export interface SubjectStudent {
  studentId: string | null;
  /** Display name, available before the profile loads. */
  displayName: string;
  profile: StudentProfile | undefined;
  /** The enrolment marked `isCurrent`, falling back to the most recent. */
  enrollment: EnrollmentRow | undefined;
  sectionId: string | undefined;
  classId: string | undefined;
  className: string | undefined;
  sectionName: string | undefined;
  /** False for a non-custodial guardian — the live map must stay hidden. */
  canViewLocation: boolean;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
}

export function useSubjectStudent(): SubjectStudent {
  const { user, subjectStudentId, activeChild, role } = useAuth();

  const query = useQuery({
    queryKey: qk.student(subjectStudentId ?? 'none'),
    queryFn: () => studentApi.profile(subjectStudentId!),
    enabled: Boolean(subjectStudentId),
    // A student's class and section change once a year at most.
    staleTime: 10 * 60_000,
  });

  const profile = query.data;

  const enrollment =
    profile?.enrollments.find((e) => e.isCurrent) ?? profile?.enrollments[0];

  const displayName =
    activeChild?.fullName ??
    (profile ? `${profile.firstName} ${profile.lastName}` : (user?.fullName ?? 'Student'));

  return {
    studentId: subjectStudentId,
    displayName,
    profile,
    enrollment,
    sectionId: enrollment?.section.id,
    classId: enrollment?.class.id,
    className: enrollment?.class.name ?? activeChild?.className,
    sectionName: enrollment?.section.name ?? activeChild?.sectionName,
    // A student always sees their own; a guardian only if the link allows it.
    canViewLocation: role === 'STUDENT' ? true : (activeChild?.canViewLocation ?? false),
    isPending: Boolean(subjectStudentId) && query.isPending,
    isError: query.isError,
    error: query.error,
    refetch: () => void query.refetch(),
  };
}
