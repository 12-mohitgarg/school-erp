/**
 * Feature API endpoints.
 *
 * One module because they share the same shapes and tag vocabulary, and
 * splitting them per feature would mean a dozen near-identical files.
 * Each group is separated by a banner comment.
 */

import { api, unwrap, unwrapPaged, queryString, type Envelope, type Paged } from '@/lib/api';

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

export interface ListParams {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  [key: string]: unknown;
}

export interface DashboardStat {
  key: string;
  label: string;
  value: number | string;
  delta?: number;
  trend?: 'up' | 'down' | 'flat';
  format?: 'number' | 'currency' | 'percent';
  hint?: string;
}

export interface DashboardPayload {
  stats: DashboardStat[];
  alerts?: Array<{
    id: string;
    type: string;
    severity: string;
    message: string;
    occurredAt: string;
    vehicle?: { registrationNo: string } | null;
  }>;
  timetable?: Array<{
    periodNumber: number;
    startTime: string;
    endTime: string;
    subject: { name: string; colorHex: string };
    section: { name: string; class: { name: string } };
    room: { name: string } | null;
  }>;
  recentPayments?: Array<{
    id: string;
    receiptNo: string;
    amount: string;
    mode: string;
    paidAt: string | null;
    student: { firstName: string; lastName: string; admissionNo: string };
  }>;
  activeTrip?: unknown;
  updatedAt: string;
}

export interface StudentRow {
  id: string;
  admissionNo: string;
  fullName: string;
  firstName: string;
  lastName: string;
  gender: string;
  dateOfBirth: string;
  photoUrl: string | null;
  phone: string | null;
  email: string | null;
  status: string;
  admissionDate: string;
  rollNumber: string | null;
  classId: string | null;
  className: string | null;
  sectionId: string | null;
  sectionName: string | null;
}

export interface ClassRow {
  id: string;
  name: string;
  code: string;
  level: number;
  stream: string | null;
  totalStudents: number;
  sections: Array<{
    id: string;
    name: string;
    capacity: number;
    enrolled: number;
    seatsAvailable: number;
    classTeacher: { id: string; name: string } | null;
    room: { id: string; name: string } | null;
  }>;
}

export interface InvoiceRow {
  id: string;
  invoiceNo: string;
  status: string;
  issueDate: string;
  dueDate: string;
  totalAmount: string;
  paidAmount: string;
  balanceAmount: string;
  student: { id: string; admissionNo: string; firstName: string; lastName: string };
}

export interface EmployeeRow {
  id: string;
  employeeCode: string;
  fullName: string;
  firstName: string;
  lastName: string;
  photoUrl: string | null;
  email: string | null;
  phone: string;
  status: string;
  employmentType: string;
  joiningDate: string;
  department: { id: string; name: string } | null;
  designation: { id: string; name: string; isTeaching: boolean } | null;
}

export interface BookRow {
  id: string;
  title: string;
  author: string;
  isbn: string | null;
  publisher: string | null;
  language: string;
  rackLocation: string | null;
  totalCopies: number;
  availableCopies: number;
  category: { id: string; name: string } | null;
}

export interface VehicleRow {
  id: string;
  registrationNo: string;
  vehicleType: string;
  make: string | null;
  model: string | null;
  capacity: number;
  status: string;
  insuranceExpiry: string | null;
  fitnessExpiry: string | null;
  device: { deviceImei: string; lastPingAt: string | null; batteryLevel: number | null } | null;
  routes: Array<{ id: string; name: string }>;
}

export interface RouteRow {
  id: string;
  name: string;
  code: string;
  startStopName: string;
  endStopName: string;
  distanceKm: string | null;
  monthlyFare: string | null;
  polyline: string | null;
  vehicle: { id: string; registrationNo: string; capacity: number } | null;
  stops: Array<{
    id: string;
    name: string;
    sequence: number;
    latitude: number;
    longitude: number;
    pickupTime: string | null;
    dropTime: string | null;
  }>;
  _count: { allocations: number };
}

export interface LiveVehicle {
  vehicleId: string;
  registrationNo: string;
  routeId: string | null;
  routeName: string | null;
  tripId: string | null;
  driverName: string | null;
  driverPhone: string | null;
  occupancy: number;
  latitude: number;
  longitude: number;
  speed: number;
  heading: number;
  accuracy: number;
  timestamp: string;
  isMoving: boolean;
  staleSeconds: number;
}

export interface AnnouncementRow {
  id: string;
  title: string;
  body: string;
  category: string;
  priority: string;
  isPinned: boolean;
  publishAt: string | null;
  createdAt: string;
  author: { firstName: string; lastName: string; role: string; avatarUrl: string | null };
}

// ---------------------------------------------------------------------------

export const endpoints = api.injectEndpoints({
  endpoints: (build) => ({
    // -- Dashboard --------------------------------------------------------
    dashboard: build.query<DashboardPayload, void>({
      query: () => '/dashboard',
      transformResponse: unwrap<DashboardPayload>,
      providesTags: ['Dashboard'],
    }),

    // -- Students ---------------------------------------------------------
    students: build.query<Paged<StudentRow>, ListParams>({
      query: (params) => `/students${queryString(params)}`,
      transformResponse: unwrapPaged<StudentRow>,
      providesTags: ['Student'],
    }),

    student: build.query<Record<string, unknown>, string>({
      query: (id) => `/students/${id}`,
      transformResponse: unwrap<Record<string, unknown>>,
      providesTags: (_r, _e, id) => [{ type: 'Student' as const, id }],
    }),

    createStudent: build.mutation<StudentRow, Record<string, unknown>>({
      query: (body) => ({ url: '/students', method: 'POST', body }),
      transformResponse: unwrap<StudentRow>,
      invalidatesTags: ['Student', 'Dashboard'],
    }),

    updateStudent: build.mutation<StudentRow, { id: string; body: Record<string, unknown> }>({
      query: ({ id, body }) => ({ url: `/students/${id}`, method: 'PATCH', body }),
      transformResponse: unwrap<StudentRow>,
      invalidatesTags: (_r, _e, { id }) => ['Student', { type: 'Student', id }],
    }),

    studentGuardians: build.query<Array<Record<string, unknown>>, string>({
      query: (id) => `/students/${id}/guardians`,
      transformResponse: (r: Envelope<Array<Record<string, unknown>>>) => r.data,
      providesTags: ['Guardian'],
    }),

    // -- Academic ---------------------------------------------------------
    classes: build.query<ClassRow[], void>({
      query: () => '/academic/classes',
      transformResponse: (r: Envelope<ClassRow[]>) => r.data,
      providesTags: ['Class'],
    }),

    academicYears: build.query<Array<{ id: string; name: string; isCurrent: boolean; startDate: string; endDate: string }>, void>({
      query: () => '/academic/years',
      transformResponse: (r: Envelope<never>) => r.data,
      providesTags: ['AcademicYear'],
    }),

    subjects: build.query<Paged<{ id: string; name: string; code: string; colorHex: string; credits: number; isElective: boolean; hasPractical: boolean }>, ListParams>({
      query: (params) => `/academic/subjects${queryString(params)}`,
      transformResponse: unwrapPaged,
      providesTags: ['Subject'],
    }),

    sectionStudents: build.query<Array<{ id: string; fullName: string; admissionNo: string; rollNumber: string | null; photoUrl: string | null; gender: string }>, string>({
      query: (sectionId) => `/academic/sections/${sectionId}/students`,
      transformResponse: (r: Envelope<never>) => r.data,
      providesTags: ['Student'],
    }),

    timetable: build.query<
      { slots: Array<Record<string, unknown>>; grid: Record<number, Array<Record<string, unknown>>> },
      { sectionId?: string; teacherId?: string; academicYearId?: string }
    >({
      query: (params) => `/academic/timetable${queryString(params)}`,
      transformResponse: unwrap,
      providesTags: ['Timetable'],
    }),

    calendar: build.query<Array<Record<string, unknown>>, { from?: string; to?: string }>({
      query: (params) => `/academic/calendar${queryString(params)}`,
      transformResponse: (r: Envelope<never>) => r.data,
      providesTags: ['AcademicYear'],
    }),

    // -- Attendance -------------------------------------------------------
    attendanceRegister: build.query<
      {
        section: { id: string; name: string; class: { id: string; name: string } };
        date: string;
        isMarked: boolean;
        isLocked: boolean;
        students: Array<{
          studentId: string;
          admissionNo: string;
          rollNumber: string | null;
          fullName: string;
          photoUrl: string | null;
          status: string;
          remarks: string | null;
        }>;
      },
      { sectionId: string; date: string; periodNumber?: number }
    >({
      query: (params) => `/attendance/register${queryString(params)}`,
      transformResponse: unwrap,
      providesTags: ['Attendance'],
    }),

    markAttendance: build.mutation<
      { sessionId: string; marked: number; absent: number; late: number },
      { sectionId: string; date: string; records: Array<{ studentId: string; status: string; remarks?: string }>; source?: string }
    >({
      query: (body) => ({ url: '/attendance/mark', method: 'POST', body }),
      transformResponse: unwrap,
      invalidatesTags: ['Attendance', 'Dashboard'],
    }),

    attendanceSummary: build.query<
      { series: Array<{ key: string; label: string; total: number; present: number; absent: number; late: number; attendancePercent: number }>; totals: { total: number; present: number; absent: number; late: number; attendancePercent: number } },
      { from?: string; to?: string; classId?: string; sectionId?: string; groupBy?: string }
    >({
      query: (params) => `/attendance/summary${queryString(params)}`,
      transformResponse: unwrap,
      providesTags: ['Attendance'],
    }),

    attendanceDefaulters: build.query<
      { threshold: number; students: Array<{ studentId: string; fullName: string; admissionNo: string; className: string | null; sectionName: string | null; attendancePercent: number; daysMarked: number }> },
      { threshold?: number; classId?: string }
    >({
      query: (params) => `/attendance/defaulters${queryString(params)}`,
      transformResponse: unwrap,
      providesTags: ['Attendance'],
    }),

    studentAttendance: build.query<
      { records: Array<Record<string, unknown>>; summary: { total: number; present: number; absent: number; late: number; attendancePercent: number } },
      { id: string; from?: string; to?: string }
    >({
      query: ({ id, ...params }) => `/attendance/student/${id}${queryString(params)}`,
      transformResponse: unwrap,
      providesTags: ['Attendance'],
    }),

    // -- Examination ------------------------------------------------------
    exams: build.query<Paged<Record<string, unknown>>, ListParams>({
      query: (params) => `/examination/exams${queryString(params)}`,
      transformResponse: unwrapPaged,
      providesTags: ['Exam'],
    }),

    examTerms: build.query<Array<Record<string, unknown>>, void>({
      query: () => '/examination/terms',
      transformResponse: (r: Envelope<never>) => r.data,
      providesTags: ['Exam'],
    }),

    assignments: build.query<Paged<Record<string, unknown>>, ListParams>({
      query: (params) => `/examination/assignments${queryString(params)}`,
      transformResponse: unwrapPaged,
      providesTags: ['Assignment'],
    }),

    reportCards: build.query<Array<Record<string, unknown>>, string>({
      query: (studentId) => `/examination/report-cards/student/${studentId}`,
      transformResponse: (r: Envelope<never>) => r.data,
      providesTags: ['ReportCard'],
    }),

    // -- Fees -------------------------------------------------------------
    invoices: build.query<Paged<InvoiceRow>, ListParams>({
      query: (params) => `/fees/invoices${queryString(params)}`,
      transformResponse: unwrapPaged<InvoiceRow>,
      providesTags: ['Invoice'],
    }),

    invoice: build.query<Record<string, unknown>, string>({
      query: (id) => `/fees/invoices/${id}`,
      transformResponse: unwrap,
      providesTags: (_r, _e, id) => [{ type: 'Invoice' as const, id }],
    }),

    feeHeads: build.query<Array<{ id: string; name: string; code: string; category: string; gstRate: string }>, void>({
      query: () => '/fees/heads',
      transformResponse: (r: Envelope<never>) => r.data,
      providesTags: ['FeeHead'],
    }),

    feeStructures: build.query<Array<Record<string, unknown>>, void>({
      query: () => '/fees/structures',
      transformResponse: (r: Envelope<never>) => r.data,
      providesTags: ['FeeStructure'],
    }),

    payments: build.query<Paged<Record<string, unknown>>, ListParams>({
      query: (params) => `/fees/payments${queryString(params)}`,
      transformResponse: unwrapPaged,
      providesTags: ['Payment'],
    }),

    recordPayment: build.mutation<Record<string, unknown>, Record<string, unknown>>({
      query: (body) => ({ url: '/fees/payments', method: 'POST', body }),
      transformResponse: unwrap,
      invalidatesTags: ['Payment', 'Invoice', 'Dashboard'],
    }),

    generateInvoices: build.mutation<{ generated: number; skipped: number; totalBilled: number }, Record<string, unknown>>({
      query: (body) => ({ url: '/fees/invoices/generate', method: 'POST', body }),
      transformResponse: unwrap,
      invalidatesTags: ['Invoice', 'Dashboard'],
    }),

    sendFeeReminders: build.mutation<
      // `skipped` counts invoices whose student has no contactable guardian at
      // all; `bySms` counts guardians reached directly because they have no app
      // account; `smsConfigured` is false when no provider is set up, meaning
      // those direct sends were logged rather than delivered.
      { sent: number; skipped: number; failed: number; bySms: number; smsConfigured: boolean },
      { onlyOverdue: boolean; invoiceIds?: string[] }
    >({
      query: (body) => ({ url: '/fees/invoices/remind', method: 'POST', body }),
      transformResponse: unwrap,
      invalidatesTags: ['Invoice'],
    }),

    studentFeeSummary: build.query<
      { invoices: InvoiceRow[]; recentPayments: Array<Record<string, unknown>>; summary: { totalBilled: number; totalPaid: number; outstanding: number; overdueCount: number; overdueAmount: number } },
      string
    >({
      query: (studentId) => `/fees/student/${studentId}/summary`,
      transformResponse: unwrap,
      providesTags: ['Invoice'],
    }),

    collectionReport: build.query<
      { collected: number; transactionCount: number; outstanding: number; outstandingInvoices: number; byMode: Array<{ mode: string; amount: number; count: number }> },
      { from?: string; to?: string }
    >({
      query: (params) => `/fees/collection-report${queryString(params)}`,
      transformResponse: unwrap,
      providesTags: ['Payment'],
    }),

    // -- HR ---------------------------------------------------------------
    employees: build.query<Paged<EmployeeRow>, ListParams>({
      query: (params) => `/hr/employees${queryString(params)}`,
      transformResponse: unwrapPaged<EmployeeRow>,
      providesTags: ['Employee'],
    }),

    employee: build.query<Record<string, unknown>, string>({
      query: (id) => `/hr/employees/${id}`,
      transformResponse: unwrap,
      providesTags: (_r, _e, id) => [{ type: 'Employee' as const, id }],
    }),

    departments: build.query<Array<{ id: string; name: string; code: string; _count: { employees: number } }>, void>({
      query: () => '/hr/departments',
      transformResponse: (r: Envelope<never>) => r.data,
      providesTags: ['Employee'],
    }),

    leaveRequests: build.query<Paged<Record<string, unknown>>, ListParams>({
      query: (params) => `/hr/leave-requests${queryString(params)}`,
      transformResponse: unwrapPaged,
      providesTags: ['Leave'],
    }),

    decideLeave: build.mutation<Record<string, unknown>, { id: string; approve: boolean; reason?: string }>({
      query: ({ id, ...body }) => ({ url: `/hr/leave-requests/${id}/decide`, method: 'POST', body }),
      transformResponse: unwrap,
      invalidatesTags: ['Leave', 'Dashboard'],
    }),

    payslips: build.query<Paged<Record<string, unknown>>, ListParams>({
      query: (params) => `/hr/payslips${queryString(params)}`,
      transformResponse: unwrapPaged,
      providesTags: ['Payroll'],
    }),

    runPayroll: build.mutation<{ payrollRunId: string; employeeCount: number; totalNet: number }, { month: number; year: number }>({
      query: (body) => ({ url: '/hr/payroll/run', method: 'POST', body }),
      transformResponse: unwrap,
      invalidatesTags: ['Payroll'],
    }),

    // -- Library ----------------------------------------------------------
    books: build.query<Paged<BookRow>, ListParams>({
      query: (params) => `/library/books${queryString(params)}`,
      transformResponse: unwrapPaged<BookRow>,
      providesTags: ['Book'],
    }),

    bookLoans: build.query<Paged<Record<string, unknown>>, ListParams>({
      query: (params) => `/library/loans${queryString(params)}`,
      transformResponse: unwrapPaged,
      providesTags: ['Loan'],
    }),

    issueBook: build.mutation<Record<string, unknown>, Record<string, unknown>>({
      query: (body) => ({ url: '/library/issue', method: 'POST', body }),
      transformResponse: unwrap,
      invalidatesTags: ['Loan', 'Book', 'Dashboard'],
    }),

    returnBook: build.mutation<Record<string, unknown>, { loanId: string; condition?: string; waiveFine?: boolean }>({
      query: ({ loanId, ...body }) => ({ url: `/library/return/${loanId}`, method: 'POST', body }),
      transformResponse: unwrap,
      invalidatesTags: ['Loan', 'Book', 'Dashboard'],
    }),

    // -- Transport & tracking ---------------------------------------------
    vehicles: build.query<Paged<VehicleRow>, ListParams>({
      query: (params) => `/transport/vehicles${queryString(params)}`,
      transformResponse: unwrapPaged<VehicleRow>,
      providesTags: ['Vehicle'],
    }),

    routes: build.query<RouteRow[], void>({
      query: () => '/transport/routes',
      transformResponse: (r: Envelope<RouteRow[]>) => r.data,
      providesTags: ['Route'],
    }),

    fleetLive: build.query<LiveVehicle[], void>({
      query: () => '/tracking/fleet/live',
      transformResponse: (r: Envelope<LiveVehicle[]>) => r.data,
      providesTags: ['Tracking'],
    }),

    studentLive: build.query<Record<string, unknown>, string>({
      query: (studentId) => `/tracking/student/${studentId}/live`,
      transformResponse: unwrap,
      providesTags: ['Tracking'],
    }),

    sosAlerts: build.query<Paged<Record<string, unknown>>, ListParams>({
      query: (params) => `/tracking/sos${queryString(params)}`,
      transformResponse: unwrapPaged,
      providesTags: ['Sos'],
    }),

    acknowledgeSos: build.mutation<void, string>({
      query: (id) => ({ url: `/tracking/sos/${id}/acknowledge`, method: 'POST' }),
      invalidatesTags: ['Sos', 'Dashboard'],
    }),

    resolveSos: build.mutation<void, { id: string; notes: string; falseAlarm: boolean }>({
      query: ({ id, ...body }) => ({ url: `/tracking/sos/${id}/resolve`, method: 'POST', body }),
      invalidatesTags: ['Sos', 'Dashboard'],
    }),

    safetyAlerts: build.query<Paged<Record<string, unknown>>, ListParams>({
      query: (params) => `/tracking/alerts${queryString(params)}`,
      transformResponse: unwrapPaged,
      providesTags: ['Alert'],
    }),

    geofences: build.query<Array<Record<string, unknown>>, void>({
      query: () => '/tracking/geofences',
      transformResponse: (r: Envelope<never>) => r.data,
      providesTags: ['Geofence'],
    }),

    // -- Inventory --------------------------------------------------------
    inventoryItems: build.query<Paged<Record<string, unknown>>, ListParams>({
      query: (params) => `/inventory/items${queryString(params)}`,
      transformResponse: unwrapPaged,
      providesTags: ['Inventory'],
    }),

    assets: build.query<Paged<Record<string, unknown>>, ListParams>({
      query: (params) => `/inventory/assets${queryString(params)}`,
      transformResponse: unwrapPaged,
      providesTags: ['Asset'],
    }),

    vendors: build.query<Array<Record<string, unknown>>, void>({
      query: () => '/inventory/vendors',
      transformResponse: (r: Envelope<never>) => r.data,
      providesTags: ['Vendor'],
    }),

    // -- Reports ----------------------------------------------------------
    reportAcademic: build.query<{ bySubject: Array<{ subject: string; code: string; averagePercent: number; entriesEvaluated: number }> }, Record<string, unknown>>({
      query: (params) => `/reports/academic${queryString(params)}`,
      transformResponse: unwrap,
      providesTags: ['Report'],
    }),

    reportSafety: build.query<
      { trips: number; totalDistanceKm: number; studentsTransported: number; totalAlerts: number; alertsByType: Array<{ type: string; count: number }>; sosByStatus: Array<{ status: string; count: number }>; geofenceEvents: number },
      { from?: string; to?: string }
    >({
      query: (params) => `/reports/safety${queryString(params)}`,
      transformResponse: unwrap,
      providesTags: ['Report'],
    }),

    reportLibrary: build.query<
      { loansByStatus: Array<{ status: string; count: number }>; outstandingFines: number; titles: number; totalCopies: number; availableCopies: number },
      void
    >({
      query: () => '/reports/library',
      transformResponse: unwrap,
      providesTags: ['Report'],
    }),

    reportTransport: build.query<
      { routes: Array<{ routeId: string; name: string; vehicle: string | null; capacity: number; allocated: number; utilisationPercent: number; distanceKm: number | null }> },
      void
    >({
      query: () => '/reports/transport',
      transformResponse: unwrap,
      providesTags: ['Report'],
    }),

    reportHr: build.query<
      { headcount: number; byDepartment: Array<{ department: string; count: number }>; leaveByStatus: Array<{ status: string; count: number }>; latestPayroll: Record<string, unknown> | null },
      void
    >({
      query: () => '/reports/hr',
      transformResponse: unwrap,
      providesTags: ['Report'],
    }),

    reportParentEngagement: build.query<
      { locationViews30d: number; guardiansTotal: number; guardiansOnApp: number; appAdoptionPercent: number; notificationsSent30d: number; notificationReadPercent: number },
      void
    >({
      query: () => '/reports/parent-engagement',
      transformResponse: unwrap,
      providesTags: ['Report'],
    }),

    auditLog: build.query<Paged<Record<string, unknown>>, ListParams>({
      query: (params) => `/reports/audit-log${queryString(params)}`,
      transformResponse: unwrapPaged,
      providesTags: ['Audit'],
    }),

    // -- Settings ---------------------------------------------------------
    institution: build.query<Record<string, unknown>, void>({
      query: () => '/settings/institution',
      transformResponse: unwrap,
      providesTags: ['Settings'],
    }),

    users: build.query<Paged<Record<string, unknown>>, ListParams>({
      query: (params) => `/settings/users${queryString(params)}`,
      transformResponse: unwrapPaged,
      providesTags: ['User'],
    }),

    permissionCatalogue: build.query<
      { permissions: string[]; roles: Array<{ role: string; label: string; description: string; scope: string; permissions: string[] }> },
      void
    >({
      query: () => '/settings/permissions',
      transformResponse: unwrap,
      providesTags: ['Role'],
    }),

    updateUser: build.mutation<Record<string, unknown>, { id: string; body: Record<string, unknown> }>({
      query: ({ id, body }) => ({ url: `/settings/users/${id}`, method: 'PATCH', body }),
      transformResponse: unwrap,
      invalidatesTags: ['User'],
    }),

    integrations: build.query<Array<Record<string, unknown>>, void>({
      query: () => '/settings/integrations',
      transformResponse: (r: Envelope<never>) => r.data,
      providesTags: ['Integration'],
    }),
  }),
});

export const {
  useDashboardQuery,
  useStudentsQuery, useStudentQuery, useCreateStudentMutation, useUpdateStudentMutation, useStudentGuardiansQuery,
  useClassesQuery, useAcademicYearsQuery, useSubjectsQuery, useSectionStudentsQuery, useTimetableQuery, useCalendarQuery,
  useAttendanceRegisterQuery, useMarkAttendanceMutation, useAttendanceSummaryQuery, useAttendanceDefaultersQuery, useStudentAttendanceQuery,
  useExamsQuery, useExamTermsQuery, useAssignmentsQuery, useReportCardsQuery,
  useInvoicesQuery, useInvoiceQuery, useFeeHeadsQuery, useFeeStructuresQuery, usePaymentsQuery,
  useRecordPaymentMutation, useGenerateInvoicesMutation, useSendFeeRemindersMutation,
  useStudentFeeSummaryQuery, useCollectionReportQuery,
  useEmployeesQuery, useEmployeeQuery, useDepartmentsQuery, useLeaveRequestsQuery, useDecideLeaveMutation,
  usePayslipsQuery, useRunPayrollMutation,
  useBooksQuery, useBookLoansQuery, useIssueBookMutation, useReturnBookMutation,
  useVehiclesQuery, useRoutesQuery, useFleetLiveQuery, useStudentLiveQuery,
  useSosAlertsQuery, useAcknowledgeSosMutation, useResolveSosMutation, useSafetyAlertsQuery, useGeofencesQuery,
  useInventoryItemsQuery, useAssetsQuery, useVendorsQuery,
  useReportAcademicQuery, useReportSafetyQuery, useReportLibraryQuery, useReportTransportQuery,
  useReportHrQuery, useReportParentEngagementQuery, useAuditLogQuery,
  useInstitutionQuery, useUsersQuery, usePermissionCatalogueQuery, useUpdateUserMutation, useIntegrationsQuery,
} = endpoints;
