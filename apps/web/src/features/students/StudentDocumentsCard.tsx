/**
 * Student document repository (PRD §5.2).
 *
 * The schema always had a documents table; nothing in the app could put a file
 * into it. Uploads go straight from the browser to Cloudinary and only the
 * resulting URL is posted here, which the API then verifies belongs to our own
 * cloud before storing it.
 *
 * Deleting removes the stored file as well as the row — an orphaned pile of
 * children's identity documents that nothing tracks is exactly what the DPDP
 * erasure workflow has to be able to clear.
 */

import { useState } from 'react';
import {
  FileText, Trash2, ExternalLink, ShieldCheck, Upload as UploadIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  useStudentDocumentsQuery, useAddStudentDocumentMutation,
  useVerifyStudentDocumentMutation, useDeleteStudentDocumentMutation,
} from '@/features/api/endpoints';
import { FileUpload, FileTypeIcon } from '@/components/forms/FileUpload';
import { useAuth } from '@/features/auth/useAuth';
import {
  Badge, Button, Card, CardHeader, EmptyState, Modal, Select, Input,
} from '@/components/ui';
import { ListSkeleton } from '@/components/ui/Skeletons';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { errorMessage } from '@/lib/api';
import { formatBytes, cloudinaryThumb } from '@/lib/cloudinary';
import { formatDate } from '@/lib/utils';
import type { UploadedAsset } from '@/lib/cloudinary';

const DOCUMENT_TYPES = [
  { value: 'BIRTH_CERTIFICATE', label: 'Birth certificate' },
  { value: 'TRANSFER_CERTIFICATE', label: 'Transfer certificate' },
  { value: 'ID_PROOF', label: 'ID proof' },
  { value: 'PHOTO', label: 'Photograph' },
  { value: 'MARKSHEET', label: 'Marksheet' },
  { value: 'MEDICAL', label: 'Medical record' },
  { value: 'CASTE_CERTIFICATE', label: 'Caste certificate' },
  { value: 'OTHER', label: 'Other' },
];

const TYPE_LABEL = new Map(DOCUMENT_TYPES.map((t) => [t.value, t.label]));

export function StudentDocumentsCard({
  studentId,
  studentName,
}: {
  studentId: string;
  studentName: string;
}) {
  const { can } = useAuth();
  const { data, isLoading } = useStudentDocumentsQuery(studentId);

  const [addDocument] = useAddStudentDocumentMutation();
  const [verifyDocument] = useVerifyStudentDocumentMutation();
  const [deleteDocument] = useDeleteStudentDocumentMutation();

  const [uploadOpen, setUploadOpen] = useState(false);
  const [documentType, setDocumentType] = useState('BIRTH_CERTIFICATE');
  const [title, setTitle] = useState('');
  const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string } | null>(null);

  const canUpload = can('student:update');
  const canDelete = can('student:delete');

  /**
   * Called once per uploaded file. The record is written here rather than in
   * the upload component, because only this screen knows which student the
   * file belongs to and what it is.
   */
  async function persist(asset: UploadedAsset) {
    await addDocument({
      studentId,
      body: {
        documentType,
        // Fall back to the original filename so a hurried upload still lands
        // with something readable rather than "Untitled".
        title: title.trim() || asset.originalFilename,
        fileUrl: asset.url,
        filePublicId: asset.publicId,
        fileResourceType: asset.resourceType,
        fileSizeBytes: asset.bytes,
        ...(asset.format ? { mimeType: `${asset.resourceType}/${asset.format}` } : {}),
      },
    }).unwrap();

    setTitle('');
  }

  const documents = data ?? [];
  const verified = documents.filter((d) => d.isVerified).length;

  return (
    <>
      <Card className="lg:col-span-2">
        <CardHeader
          title="Documents"
          description={
            documents.length > 0
              ? `${documents.length} on file · ${verified} verified`
              : 'Birth certificate, ID proof, transfer certificate'
          }
          action={
            canUpload && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setUploadOpen(true)}
                leftIcon={<UploadIcon className="h-3.5 w-3.5" />}
              >
                Upload
              </Button>
            )
          }
        />

        {isLoading ? (
          <ListSkeleton rows={3} avatar={false} />
        ) : documents.length === 0 ? (
          <EmptyState
            icon={<FileText className="h-5 w-5" aria-hidden="true" />}
            title="No documents uploaded"
            description={
              canUpload
                ? "Upload the applicant's certificates and identity proofs to complete their record."
                : 'Documents uploaded by the office will appear here.'
            }
            action={
              canUpload ? (
                <Button size="sm" onClick={() => setUploadOpen(true)}>
                  Upload a document
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="divide-y divide-hairline">
            {documents.map((doc) => {
              const thumb = cloudinaryThumb(doc.fileUrl, 72);
              const isImage = doc.fileResourceType === 'image';

              return (
                <li key={doc.id} className="flex items-center gap-3 px-5 py-3">
                  {isImage && thumb ? (
                    <img
                      src={thumb}
                      alt=""
                      className="h-9 w-9 shrink-0 rounded-lg border border-hairline object-cover"
                    />
                  ) : (
                    <FileTypeIcon mimeType={doc.mimeType} />
                  )}

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{doc.title}</p>
                    <p className="truncate text-xs text-ink-subtle">
                      {TYPE_LABEL.get(doc.documentType) ?? doc.documentType}
                      {doc.fileSizeBytes ? ` · ${formatBytes(doc.fileSizeBytes)}` : ''}
                      {` · ${formatDate(doc.createdAt, 'short')}`}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    {doc.isVerified ? (
                      <Badge tone="success" dot>
                        Verified
                      </Badge>
                    ) : (
                      <Badge tone="warning" dot>
                        Unverified
                      </Badge>
                    )}

                    <a
                      href={doc.fileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Open document"
                      className="rounded-md p-1.5 text-ink-subtle transition-colors hover:bg-surface-sunken hover:text-ink"
                    >
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                    </a>

                    {!doc.isVerified && canUpload && (
                      <button
                        type="button"
                        title="Mark as verified"
                        onClick={() => {
                          void verifyDocument({ docId: doc.id })
                            .unwrap()
                            .then(() => toast.success('Document verified'))
                            .catch((err: unknown) =>
                              toast.error('Could not verify', { description: errorMessage(err) }),
                            );
                        }}
                        className="rounded-md p-1.5 text-ink-subtle transition-colors hover:bg-success/10 hover:text-success"
                      >
                        <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    )}

                    {canDelete && (
                      <button
                        type="button"
                        title="Delete document"
                        onClick={() => setPendingDelete({ id: doc.id, title: doc.title })}
                        className="rounded-md p-1.5 text-ink-subtle transition-colors hover:bg-danger/10 hover:text-danger"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Modal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        title={`Upload a document for ${studentName}`}
        description="Files are stored in Cloudinary. Choose the type before selecting the file."
        footer={
          <Button variant="ghost" onClick={() => setUploadOpen(false)}>
            Done
          </Button>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Document type"
            required
            value={documentType}
            onChange={(e) => setDocumentType(e.target.value)}
            options={DOCUMENT_TYPES}
          />
          <Input
            label="Title"
            placeholder="Leave blank to use the filename"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <FileUpload
          className="mt-2"
          folder={`students/${studentId}`}
          accept="image/*,application/pdf"
          label="Drop the document here"
          onUploaded={persist}
        />
      </Modal>

      <ConfirmDialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title="Delete this document?"
        message={
          <>
            <span className="font-medium text-ink">{pendingDelete?.title}</span> and the stored file
            are both removed. This cannot be undone.
          </>
        }
        confirmLabel="Delete"
        tone="danger"
        successMessage="Document deleted"
        onConfirm={async () => {
          if (!pendingDelete) return;
          await deleteDocument(pendingDelete.id).unwrap();
          setPendingDelete(null);
        }}
      />
    </>
  );
}
