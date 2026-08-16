import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { BookUp } from 'lucide-react';
import { useBooksQuery, useStudentsQuery, useEmployeesQuery, useIssueBookMutation } from '@/features/api/endpoints';
import { errorMessage } from '@/lib/api';
import { Combobox } from '@/components/forms/Combobox';
import { Alert, Button, Input, Modal, Select } from '@/components/ui';
import { DEFAULT_LOAN_DAYS } from '@erp/shared';
import { formatDate } from '@/lib/utils';

/**
 * Issue a book at the circulation desk.
 *
 * Hand-built rather than a `FormModal` because the member picker switches
 * between two different entity lists, and both lists need search — a plain
 * select over 300 students is unusable.
 */
export function IssueBookDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [memberType, setMemberType] = useState<'student' | 'staff'>('student');
  const [bookId, setBookId] = useState('');
  const [memberId, setMemberId] = useState('');
  const [loanDays, setLoanDays] = useState(String(DEFAULT_LOAN_DAYS));
  const [error, setError] = useState<string | null>(null);

  const [issueBook, { isLoading }] = useIssueBookMutation();

  // Only fetch the list actually in use.
  const { data: books } = useBooksQuery({ limit: 200 }, { skip: !open });
  const { data: students } = useStudentsQuery(
    { limit: 200, status: 'ACTIVE' },
    { skip: !open || memberType !== 'student' },
  );
  const { data: staff } = useEmployeesQuery(
    { limit: 200, status: 'ACTIVE' },
    { skip: !open || memberType !== 'staff' },
  );

  const bookItems = useMemo(
    () =>
      (books?.items ?? []).map((b) => ({
        value: b.id,
        label: b.title,
        detail: `${b.author} · ${b.availableCopies}/${b.totalCopies} available`,
        // A title with nothing on the shelf cannot be issued.
        disabled: b.availableCopies === 0,
      })),
    [books],
  );

  const memberItems = useMemo(() => {
    if (memberType === 'student') {
      return (students?.items ?? []).map((s) => ({
        value: s.id,
        label: s.fullName,
        detail: `${s.admissionNo}${s.className ? ` · ${s.className}-${s.sectionName}` : ''}`,
      }));
    }
    return (staff?.items ?? []).map((e) => ({
      value: e.id,
      label: e.fullName,
      detail: `${e.employeeCode}${e.designation ? ` · ${e.designation.name}` : ''}`,
    }));
  }, [memberType, students, staff]);

  const selectedBook = books?.items.find((b) => b.id === bookId);
  const dueDate = new Date(Date.now() + Number(loanDays || DEFAULT_LOAN_DAYS) * 86_400_000);

  function reset() {
    setBookId('');
    setMemberId('');
    setLoanDays(String(DEFAULT_LOAN_DAYS));
    setError(null);
  }

  async function submit() {
    setError(null);

    if (!bookId) return setError('Choose a book to issue.');
    if (!memberId) return setError('Choose who the book is being issued to.');

    try {
      await issueBook({
        // The server picks a free copy of this title, so the desk never has to
        // look up an accession number.
        bookId,
        ...(memberType === 'student' ? { studentId: memberId } : { employeeId: memberId }),
        loanDays: Number(loanDays),
      }).unwrap();

      toast.success('Book issued', {
        description: `${selectedBook?.title ?? 'Book'} · due ${formatDate(dueDate, 'medium')}`,
      });
      reset();
      onClose();
    } catch (err) {
      setError(errorMessage(err, 'Could not issue this book.'));
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => { reset(); onClose(); }}
      title="Issue book"
      description="The system picks an available copy automatically."
      footer={
        <>
          <Button variant="ghost" onClick={() => { reset(); onClose(); }} disabled={isLoading}>Cancel</Button>
          <Button onClick={submit} loading={isLoading} leftIcon={<BookUp className="h-3.5 w-3.5" />}>
            Issue book
          </Button>
        </>
      }
    >
      {error && <Alert tone="danger" className="mb-4" onDismiss={() => setError(null)}>{error}</Alert>}

      <div className="space-y-4">
        <Combobox
          label="Book"
          required
          value={bookId}
          onChange={setBookId}
          items={bookItems}
          placeholder="Search by title or author…"
          emptyMessage="No books match"
        />

        <Select
          label="Issue to"
          value={memberType}
          onChange={(e) => {
            setMemberType(e.target.value as 'student' | 'staff');
            // The previous selection belongs to the other list.
            setMemberId('');
          }}
          options={[
            { value: 'student', label: 'Student' },
            { value: 'staff', label: 'Staff member' },
          ]}
        />

        <Combobox
          label={memberType === 'student' ? 'Student' : 'Staff member'}
          required
          value={memberId}
          onChange={setMemberId}
          items={memberItems}
          placeholder={memberType === 'student' ? 'Search by name or admission number…' : 'Search by name or code…'}
          emptyMessage="No matches"
        />

        <Input
          label="Loan period (days)"
          type="number"
          min={1}
          max={90}
          value={loanDays}
          onChange={(e) => setLoanDays(e.target.value)}
          hint={`Due ${formatDate(dueDate, 'medium')}`}
        />

        {selectedBook && selectedBook.availableCopies <= 1 && (
          <Alert tone="warning">
            This is the last available copy of “{selectedBook.title}”.
          </Alert>
        )}
      </div>
    </Modal>
  );
}
