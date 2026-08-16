/**
 * Write endpoints.
 *
 * Kept apart from `endpoints.ts` (which is read-heavy) so the invalidation
 * story for writes is visible in one place: each mutation lists exactly which
 * cached tags it makes stale, which is what keeps a list refreshing after a
 * create without any manual refetch at the call site.
 */

import { api, unwrap } from '@/lib/api';

type Body = Record<string, unknown>;

export const mutations = api.injectEndpoints({
  endpoints: (build) => ({
    // -- Academic ---------------------------------------------------------
    createClass: build.mutation<Body, Body>({
      query: (body) => ({ url: '/academic/classes', method: 'POST', body }),
      transformResponse: unwrap<Body>,
      invalidatesTags: ['Class', 'Dashboard'],
    }),

    createSection: build.mutation<Body, { classId: string } & Body>({
      query: ({ classId, ...body }) => ({
        url: `/academic/classes/${classId}/sections`, method: 'POST', body,
      }),
      transformResponse: unwrap<Body>,
      invalidatesTags: ['Class', 'Section'],
    }),

    createSubject: build.mutation<Body, Body>({
      query: (body) => ({ url: '/academic/subjects', method: 'POST', body }),
      transformResponse: unwrap<Body>,
      invalidatesTags: ['Subject'],
    }),

    createRoom: build.mutation<Body, Body>({
      query: (body) => ({ url: '/academic/rooms', method: 'POST', body }),
      transformResponse: unwrap<Body>,
      invalidatesTags: ['Class'],
    }),

    createAcademicYear: build.mutation<Body, Body>({
      query: (body) => ({ url: '/academic/years', method: 'POST', body }),
      transformResponse: unwrap<Body>,
      invalidatesTags: ['AcademicYear'],
    }),

    createCalendarEvent: build.mutation<Body, Body>({
      query: (body) => ({ url: '/academic/calendar', method: 'POST', body }),
      transformResponse: unwrap<Body>,
      invalidatesTags: ['AcademicYear'],
    }),

    createTimetableSlot: build.mutation<Body, Body>({
      query: (body) => ({ url: '/academic/timetable', method: 'POST', body }),
      transformResponse: unwrap<Body>,
      invalidatesTags: ['Timetable'],
    }),

    createClassSubject: build.mutation<Body, Body>({
      query: (body) => ({ url: '/academic/class-subjects', method: 'POST', body }),
      transformResponse: unwrap<Body>,
      invalidatesTags: ['Class', 'Subject', 'Timetable'],
    }),

    // -- Students ---------------------------------------------------------
    createAdmissionApplication: build.mutation<Body, Body>({
      query: (body) => ({ url: '/students/admissions/applications', method: 'POST', body }),
      transformResponse: unwrap<Body>,
      invalidatesTags: ['Student'],
    }),

    addGuardian: build.mutation<Body, { studentId: string } & Body>({
      query: ({ studentId, ...body }) => ({
        url: `/students/${studentId}/guardians`, method: 'POST', body,
      }),
      transformResponse: unwrap<Body>,
      invalidatesTags: ['Guardian', 'Student'],
    }),

    // -- Examination ------------------------------------------------------
    createExamTerm: build.mutation<Body, Body>({
      query: (body) => ({ url: '/examination/terms', method: 'POST', body }),
      transformResponse: unwrap<Body>,
      invalidatesTags: ['Exam'],
    }),

    createExam: build.mutation<Body, Body>({
      query: (body) => ({ url: '/examination/exams', method: 'POST', body }),
      transformResponse: unwrap<Body>,
      invalidatesTags: ['Exam'],
    }),

    createAssignment: build.mutation<Body, Body>({
      query: (body) => ({ url: '/examination/assignments', method: 'POST', body }),
      transformResponse: unwrap<Body>,
      invalidatesTags: ['Assignment', 'Dashboard'],
    }),

    // -- Fees -------------------------------------------------------------
    createFeeHead: build.mutation<Body, Body>({
      query: (body) => ({ url: '/fees/heads', method: 'POST', body }),
      transformResponse: unwrap<Body>,
      invalidatesTags: ['FeeHead'],
    }),

    // -- HR ---------------------------------------------------------------
    createEmployee: build.mutation<Body, Body>({
      query: (body) => ({ url: '/hr/employees', method: 'POST', body }),
      transformResponse: unwrap<Body>,
      invalidatesTags: ['Employee', 'Dashboard'],
    }),

    createDepartment: build.mutation<Body, Body>({
      query: (body) => ({ url: '/hr/departments', method: 'POST', body }),
      transformResponse: unwrap<Body>,
      invalidatesTags: ['Employee'],
    }),

    createDesignation: build.mutation<Body, Body>({
      query: (body) => ({ url: '/hr/designations', method: 'POST', body }),
      transformResponse: unwrap<Body>,
      invalidatesTags: ['Employee'],
    }),

    createLeaveRequest: build.mutation<Body, Body>({
      query: (body) => ({ url: '/hr/leave-requests', method: 'POST', body }),
      transformResponse: unwrap<Body>,
      invalidatesTags: ['Leave', 'Dashboard'],
    }),

    createSalaryStructure: build.mutation<Body, Body>({
      query: (body) => ({ url: '/hr/salary-structures', method: 'POST', body }),
      transformResponse: unwrap<Body>,
      invalidatesTags: ['Payroll', 'Employee'],
    }),

    // -- Library ----------------------------------------------------------
    createBook: build.mutation<Body, Body>({
      query: (body) => ({ url: '/library/books', method: 'POST', body }),
      transformResponse: unwrap<Body>,
      invalidatesTags: ['Book', 'Dashboard'],
    }),

    createBookCategory: build.mutation<Body, Body>({
      query: (body) => ({ url: '/library/categories', method: 'POST', body }),
      transformResponse: unwrap<Body>,
      invalidatesTags: ['Book'],
    }),

    // -- Transport --------------------------------------------------------
    createVehicle: build.mutation<Body, Body>({
      query: (body) => ({ url: '/transport/vehicles', method: 'POST', body }),
      transformResponse: unwrap<Body>,
      invalidatesTags: ['Vehicle', 'Dashboard'],
    }),

    createRoute: build.mutation<Body, Body>({
      query: (body) => ({ url: '/transport/routes', method: 'POST', body }),
      transformResponse: unwrap<Body>,
      invalidatesTags: ['Route', 'Vehicle'],
    }),

    createAllocation: build.mutation<Body, Body>({
      query: (body) => ({ url: '/transport/allocations', method: 'POST', body }),
      transformResponse: unwrap<Body>,
      invalidatesTags: ['Route', 'Student'],
    }),

    // -- Inventory --------------------------------------------------------
    createInventoryItem: build.mutation<Body, Body>({
      query: (body) => ({ url: '/inventory/items', method: 'POST', body }),
      transformResponse: unwrap<Body>,
      invalidatesTags: ['Inventory'],
    }),

    createStockMovement: build.mutation<Body, { itemId: string } & Body>({
      query: ({ itemId, ...body }) => ({
        url: `/inventory/items/${itemId}/movements`, method: 'POST', body,
      }),
      transformResponse: unwrap<Body>,
      invalidatesTags: ['Inventory'],
    }),

    createVendor: build.mutation<Body, Body>({
      query: (body) => ({ url: '/inventory/vendors', method: 'POST', body }),
      transformResponse: unwrap<Body>,
      invalidatesTags: ['Vendor'],
    }),

    createAsset: build.mutation<Body, Body>({
      query: (body) => ({ url: '/inventory/assets', method: 'POST', body }),
      transformResponse: unwrap<Body>,
      invalidatesTags: ['Asset'],
    }),

    // -- Settings ---------------------------------------------------------
    createUser: build.mutation<Body, Body>({
      query: (body) => ({ url: '/settings/users', method: 'POST', body }),
      transformResponse: unwrap<Body>,
      invalidatesTags: ['User'],
    }),

    createBranch: build.mutation<Body, Body>({
      query: (body) => ({ url: '/settings/branches', method: 'POST', body }),
      transformResponse: unwrap<Body>,
      invalidatesTags: ['Settings'],
    }),
  }),
});

export const {
  useCreateClassMutation, useCreateSectionMutation, useCreateSubjectMutation,
  useCreateRoomMutation, useCreateAcademicYearMutation, useCreateCalendarEventMutation,
  useCreateTimetableSlotMutation, useCreateClassSubjectMutation,
  useCreateAdmissionApplicationMutation, useAddGuardianMutation,
  useCreateExamTermMutation, useCreateExamMutation, useCreateAssignmentMutation,
  useCreateFeeHeadMutation,
  useCreateEmployeeMutation, useCreateDepartmentMutation, useCreateDesignationMutation,
  useCreateLeaveRequestMutation, useCreateSalaryStructureMutation,
  useCreateBookMutation, useCreateBookCategoryMutation,
  useCreateVehicleMutation, useCreateRouteMutation, useCreateAllocationMutation,
  useCreateInventoryItemMutation, useCreateStockMovementMutation,
  useCreateVendorMutation, useCreateAssetMutation,
  useCreateUserMutation, useCreateBranchMutation,
} = mutations;
