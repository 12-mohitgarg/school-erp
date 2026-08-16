/**
 * Demo seed — a realistic, fully-wired school so every panel has data to show.
 *
 * Written for a *remote* database: work is batched into `createManyAndReturn`
 * calls rather than per-row upserts, because a few hundred sequential
 * round-trips to a hosted Postgres takes minutes, while ~40 batched ones take
 * seconds.
 *
 * Destructive by design: it deletes the demo tenant and rebuilds it, so
 * re-running always produces the same clean dataset. It only ever touches the
 * tenant whose code is `DEMO_TENANT_CODE`.
 *
 *   npm run db:seed
 */

import { PrismaClient, Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import 'dotenv/config';

const prisma = new PrismaClient();

const DEMO_TENANT_CODE = 'DPS-DEL';
const PASSWORD = 'Password@123';

const dec = (n: number) => new Prisma.Decimal(n);
const date = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** Deterministic PRNG so every run produces identical demo data. */
let rngState = 20260812;
function rand(): number {
  rngState = (rngState * 1103515245 + 12345) % 2147483648;
  return rngState / 2147483648;
}
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)]!;
const randInt = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));

const FIRST_M = ['Aarav', 'Vivaan', 'Aditya', 'Vihaan', 'Arjun', 'Reyansh', 'Krishna', 'Ishaan', 'Kabir', 'Rudra', 'Aryan', 'Dhruv', 'Atharv', 'Advik'];
const FIRST_F = ['Aadhya', 'Ananya', 'Diya', 'Isha', 'Kavya', 'Myra', 'Saanvi', 'Anika', 'Riya', 'Pari', 'Navya', 'Aarohi', 'Sara', 'Anvi'];
const LAST = ['Sharma', 'Verma', 'Gupta', 'Singh', 'Patel', 'Reddy', 'Nair', 'Iyer', 'Mehta', 'Joshi', 'Kapoor', 'Malhotra', 'Bose', 'Chopra'];

const step = (label: string, detail: string) =>
  console.log(`  ${label.padEnd(14)}${detail}`);

/**
 * Tear a tenant down completely.
 *
 * Most relations cascade from Tenant, but four are deliberately `onDelete:
 * Restrict` so that a fee head, stock item, vendor or bus stop cannot be
 * deleted while an invoice, purchase order or allocation still references it.
 * Those referencing rows must therefore be removed *before* the cascade runs,
 * or Postgres rejects the whole delete.
 *
 * Any real "offboard this institution" admin action needs this same ordering.
 */
async function resetTenant(tenantId: string): Promise<void> {
  await prisma.invoiceLine.deleteMany({ where: { invoice: { tenantId } } });
  await prisma.payment.deleteMany({ where: { tenantId } });
  await prisma.invoice.deleteMany({ where: { tenantId } });

  await prisma.purchaseOrderLine.deleteMany({ where: { purchaseOrder: { tenantId } } });
  await prisma.purchaseOrder.deleteMany({ where: { tenantId } });

  await prisma.transportAllocation.deleteMany({ where: { route: { tenantId } } });

  await prisma.tenant.delete({ where: { id: tenantId } });
}

/**
 * Wait for the database to accept connections.
 *
 * A hosted Postgres suspends an idle compute and refuses the first connection
 * while it resumes; connections released by a just-stopped process also take a
 * moment to be reaped. Both look identical to "server is down".
 */
async function connectWithRetry(attempts = 6): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return;
    } catch (err) {
      if (attempt === attempts) throw err;
      process.stdout.write(`  waiting for the database (attempt ${attempt}/${attempts})…\n`);
      await new Promise((resolve) => setTimeout(resolve, 3000 * attempt));
    }
  }
}

async function main() {
  const started = Date.now();
  console.log('\nSeeding EduSphere demo data…\n');

  await connectWithRetry();

  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  // -------------------------------------------------------------------------
  // Clean slate — deleting the tenant cascades through every owned table.
  // -------------------------------------------------------------------------
  const existing = await prisma.tenant.findUnique({
    where: { code: DEMO_TENANT_CODE },
    select: { id: true },
  });

  if (existing) {
    await resetTenant(existing.id);
    step('reset', 'removed previous demo tenant');
  }

  // -------------------------------------------------------------------------
  // Tenant, branch, academic year
  // -------------------------------------------------------------------------
  const tenant = await prisma.tenant.create({
    data: {
      name: 'Delhi Public School',
      code: DEMO_TENANT_CODE,
      legalName: 'Delhi Public School Society',
      email: 'office@dpsdelhi.edu.in',
      phone: '+911126234567',
      website: 'https://dpsdelhi.edu.in',
      addressLine1: 'Mathura Road, Sector 12',
      city: 'New Delhi',
      state: 'Delhi',
      postalCode: '110003',
      gstin: '07AABCD1234E1Z5',
      primaryColor: '#4F46E5',
    },
    select: { id: true, name: true },
  });

  const branch = await prisma.branch.create({
    data: {
      tenantId: tenant.id,
      name: 'Main Campus',
      code: 'MAIN',
      addressLine1: 'Mathura Road, Sector 12',
      city: 'New Delhi',
      state: 'Delhi',
      postalCode: '110003',
      phone: '+911126234567',
      principalName: 'Dr. Meera Krishnan',
      // Real Delhi coordinates so the live map is plausible out of the box.
      latitude: 28.6129,
      longitude: 77.2295,
      isHeadOffice: true,
    },
    select: { id: true },
  });

  const year = await prisma.academicYear.create({
    data: {
      tenantId: tenant.id,
      name: '2026-27',
      startDate: date('2026-04-01'),
      endDate: date('2027-03-31'),
      isCurrent: true,
    },
    select: { id: true, name: true },
  });
  step('institution', `${tenant.name} · ${year.name}`);

  // -------------------------------------------------------------------------
  // Reference data
  // -------------------------------------------------------------------------
  const departments = await prisma.department.createManyAndReturn({
    data: [
      ['Science', 'SCI'], ['Mathematics', 'MATH'], ['Languages', 'LANG'],
      ['Social Studies', 'SOC'], ['Administration', 'ADMIN'], ['Support Staff', 'SUP'],
    ].map(([name, code]) => ({ tenantId: tenant.id, name: name!, code: code! })),
    select: { id: true, code: true },
  });
  const deptId = Object.fromEntries(departments.map((d) => [d.code, d.id]));

  const designations = await prisma.designation.createManyAndReturn({
    data: ([
      ['Principal', 'PRIN', 10, true], ['Vice Principal', 'VP', 9, true],
      ['Head of Department', 'HOD', 7, true], ['Senior Teacher', 'STCH', 5, true],
      ['Teacher', 'TCH', 4, true], ['Accountant', 'ACC', 4, false],
      ['Librarian', 'LIB', 4, false], ['HR Manager', 'HRM', 6, false],
      ['Bus Driver', 'DRV', 2, false],
    ] as Array<[string, string, number, boolean]>).map(([name, code, level, isTeaching]) => ({
      tenantId: tenant.id, name, code, level, isTeaching,
    })),
    select: { id: true, code: true },
  });
  const desigId = Object.fromEntries(designations.map((d) => [d.code, d.id]));

  const rooms = await prisma.room.createManyAndReturn({
    data: Array.from({ length: 14 }, (_, i) => ({
      tenantId: tenant.id, branchId: branch.id,
      name: i < 12 ? `Room ${101 + i}` : `Lab ${i - 11}`,
      code: i < 12 ? `R${101 + i}` : `LAB${i - 11}`,
      roomType: i < 12 ? 'CLASSROOM' : 'LAB',
      capacity: 40, floor: i < 6 ? 'Ground' : 'First',
    })),
    select: { id: true },
  });
  const roomIds = rooms.map((r) => r.id);

  const SUBJECTS: Array<[string, string, string, boolean]> = [
    ['English', 'ENG', '#6366F1', false],
    ['Hindi', 'HIN', '#EC4899', false],
    ['Mathematics', 'MATH', '#0EA5E9', false],
    ['Science', 'SCI', '#10B981', true],
    ['Social Science', 'SST', '#F59E0B', false],
    ['Computer Science', 'CS', '#8B5CF6', true],
    ['Physical Education', 'PE', '#EF4444', false],
  ];

  const subjects = await prisma.subject.createManyAndReturn({
    data: SUBJECTS.map(([name, code, colorHex, hasPractical]) => ({
      tenantId: tenant.id, name, code, colorHex, hasPractical, credits: 1,
    })),
    select: { id: true, code: true },
  });
  const subjectId = Object.fromEntries(subjects.map((s) => [s.code, s.id]));
  step('reference', `${departments.length} depts · ${rooms.length} rooms · ${subjects.length} subjects`);

  // -------------------------------------------------------------------------
  // Classes & sections
  // -------------------------------------------------------------------------
  const classes = await prisma.class.createManyAndReturn({
    data: Array.from({ length: 8 }, (_, i) => ({
      tenantId: tenant.id, branchId: branch.id,
      name: `Class ${i + 1}`, code: `C${i + 1}`, level: i + 1,
    })),
    select: { id: true, name: true, level: true },
  });

  const sections = await prisma.section.createManyAndReturn({
    data: classes.flatMap((cls, ci) =>
      ['A', 'B'].map((name, si) => ({
        classId: cls.id, name, capacity: 40,
        roomId: roomIds[(ci * 2 + si) % roomIds.length]!,
      })),
    ),
    select: { id: true, name: true, classId: true },
  });

  const sectionsByClass = new Map<string, typeof sections>();
  for (const s of sections) {
    const list = sectionsByClass.get(s.classId) ?? [];
    list.push(s);
    sectionsByClass.set(s.classId, list);
  }
  step('academic', `${classes.length} classes · ${sections.length} sections`);

  // -------------------------------------------------------------------------
  // Staff — one login per role, so every panel is reachable
  // -------------------------------------------------------------------------
  const STAFF: Array<{ email: string; first: string; last: string; role: string; desig: string; dept: string; scope: string; female?: boolean }> = [
    { email: 'superadmin@dpsdelhi.edu.in', first: 'Rajesh', last: 'Khanna', role: 'SUPER_ADMIN', desig: 'PRIN', dept: 'ADMIN', scope: 'TENANT' },
    { email: 'principal@dpsdelhi.edu.in', first: 'Meera', last: 'Krishnan', role: 'ADMIN', desig: 'PRIN', dept: 'ADMIN', scope: 'BRANCH', female: true },
    { email: 'admin@dpsdelhi.edu.in', first: 'Sunita', last: 'Rao', role: 'ADMINISTRATION', desig: 'VP', dept: 'ADMIN', scope: 'BRANCH', female: true },
    { email: 'accounts@dpsdelhi.edu.in', first: 'Vikram', last: 'Desai', role: 'ACCOUNTANT', desig: 'ACC', dept: 'ADMIN', scope: 'BRANCH' },
    { email: 'library@dpsdelhi.edu.in', first: 'Priya', last: 'Menon', role: 'LIBRARIAN', desig: 'LIB', dept: 'SUP', scope: 'BRANCH', female: true },
    { email: 'hr@dpsdelhi.edu.in', first: 'Anil', last: 'Bhatt', role: 'HR', desig: 'HRM', dept: 'ADMIN', scope: 'BRANCH' },
    { email: 'driver@dpsdelhi.edu.in', first: 'Ramesh', last: 'Yadav', role: 'DRIVER', desig: 'DRV', dept: 'SUP', scope: 'ASSIGNED' },
  ];

  // Teachers: one per subject.
  const TEACHERS = SUBJECTS.map(([, code], i) => ({
    email: `teacher.${code.toLowerCase()}@dpsdelhi.edu.in`,
    first: i % 2 === 0 ? FIRST_M[i]! : FIRST_F[i]!,
    last: LAST[i]!,
    role: 'TEACHER',
    desig: 'TCH',
    dept: code === 'MATH' ? 'MATH' : ['SCI', 'CS'].includes(code) ? 'SCI' : code === 'SST' ? 'SOC' : 'LANG',
    scope: 'ASSIGNED',
    female: i % 2 !== 0,
    subjectCode: code,
  }));

  const allStaff = [...STAFF, ...TEACHERS];

  const staffUsers = await prisma.user.createManyAndReturn({
    data: allStaff.map((s, i) => ({
      tenantId: tenant.id, branchId: branch.id,
      email: s.email, phone: `+9198${String(76500000 + i).slice(-8)}`,
      passwordHash, role: s.role as never, scope: s.scope as never,
      firstName: s.first, lastName: s.last,
      status: 'ACTIVE' as never, emailVerifiedAt: new Date(),
    })),
    select: { id: true, email: true, phone: true },
  });
  const userByEmail = new Map(staffUsers.map((u) => [u.email!, u]));

  const employees = await prisma.employee.createManyAndReturn({
    data: allStaff.map((s, i) => ({
      tenantId: tenant.id, branchId: branch.id,
      userId: userByEmail.get(s.email)!.id,
      employeeCode: `EMP${String(i + 1).padStart(4, '0')}`,
      firstName: s.first, lastName: s.last,
      gender: (s.female ? 'FEMALE' : 'MALE') as never,
      phone: userByEmail.get(s.email)!.phone!,
      email: s.email,
      departmentId: deptId[s.dept]!,
      designationId: desigId[s.desig]!,
      joiningDate: date('2021-04-01'),
      qualification: s.role === 'TEACHER' ? 'M.Sc., B.Ed.' : 'MBA',
      experienceYears: randInt(3, 15),
      subjectExpertise: 'subjectCode' in s ? [subjectId[s.subjectCode as string]!] : [],
      status: 'ACTIVE' as never,
    })),
    select: { id: true, email: true },
  });
  const employeeByEmail = new Map(employees.map((e) => [e.email!, e.id]));

  const teacherIds = TEACHERS.map((t) => employeeByEmail.get(t.email)!);
  const driverEmployeeId = employeeByEmail.get('driver@dpsdelhi.edu.in')!;
  const adminUserId = userByEmail.get('principal@dpsdelhi.edu.in')!.id;
  step('staff', `${STAFF.length} role accounts · ${TEACHERS.length} teachers`);

  // Salary structures — without an active one an employee is skipped by
  // payroll, and a run with no eligible employee fails outright.
  const salaryByDesignation: Record<string, number> = {
    PRIN: 120_000, VP: 90_000, HOD: 70_000, STCH: 55_000,
    TCH: 45_000, ACC: 40_000, LIB: 32_000, HRM: 60_000, DRV: 22_000,
  };

  await prisma.salaryStructure.createMany({
    data: allStaff.map((s) => {
      const gross = salaryByDesignation[s.desig] ?? 30_000;
      // Standard Indian split: basic is 50% of gross, the rest allowances.
      const basic = Math.round(gross * 0.5);
      const hra = Math.round(basic * 0.4);
      const conveyance = 1_600;
      const special = gross - basic - hra - conveyance;

      return {
        employeeId: employeeByEmail.get(s.email)!,
        effectiveFrom: date('2026-04-01'),
        basicSalary: dec(basic),
        grossSalary: dec(gross),
        ctcAnnual: dec(gross * 12),
        components: [
          { code: 'BASIC', name: 'Basic', type: 'EARNING', amount: basic },
          { code: 'HRA', name: 'House Rent Allowance', type: 'EARNING', amount: hra },
          { code: 'CONV', name: 'Conveyance', type: 'EARNING', amount: conveyance },
          { code: 'SPL', name: 'Special Allowance', type: 'EARNING', amount: special },
        ] as never,
        isActive: true,
      };
    }),
  });

  // Staff attendance for the current month, so payroll pro-rating has data.
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  const staffAttendance: Array<{ employeeId: string; date: Date; status: never; source: never }> = [];

  for (const s of allStaff) {
    const employeeId = employeeByEmail.get(s.email)!;
    const cursor = new Date(monthStart);
    while (cursor <= new Date() && cursor.getUTCMonth() === monthStart.getUTCMonth()) {
      if (cursor.getUTCDay() !== 0 && cursor.getUTCDay() !== 6) {
        staffAttendance.push({
          employeeId,
          date: new Date(cursor),
          status: (rand() > 0.05 ? 'PRESENT' : 'ABSENT') as never,
          source: 'BIOMETRIC' as never,
        });
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }

  if (staffAttendance.length > 0) {
    await prisma.employeeAttendance.createMany({ data: staffAttendance, skipDuplicates: true });
  }
  step('payroll', `${allStaff.length} salary structures · ${staffAttendance.length} staff attendance rows`);

  // Class teachers — sequential rather than Promise.all. Firing every update
  // at once spikes concurrent connections past what a small hosted Postgres
  // allows, which surfaces as a misleading "can't reach database server".
  for (const [index, section] of sections.entries()) {
    await prisma.section.update({
      where: { id: section.id },
      data: { classTeacherId: teacherIds[index % teacherIds.length]! },
    });
  }

  await prisma.classSubject.createMany({
    data: sections.flatMap((section) =>
      SUBJECTS.map(([, code], si) => ({
        classId: section.classId,
        sectionId: section.id,
        subjectId: subjectId[code]!,
        teacherId: teacherIds[si % teacherIds.length]!,
        weeklyPeriods: code === 'PE' ? 2 : 5,
      })),
    ),
  });

  // -------------------------------------------------------------------------
  // Timetable — Mon-Fri, 7 periods, for the first four classes
  // -------------------------------------------------------------------------
  const PERIODS = [
    ['08:00', '08:45'], ['08:45', '09:30'], ['09:50', '10:35'],
    ['10:35', '11:20'], ['11:40', '12:25'], ['12:25', '13:10'], ['13:10', '13:55'],
  ];

  const timetableRows = sections
    .filter((s) => classes.slice(0, 4).some((c) => c.id === s.classId))
    .flatMap((section) =>
      Array.from({ length: 5 }, (_, d) => d + 1).flatMap((dayOfWeek) =>
        PERIODS.map((slot, p) => {
          const subjectIdx = (dayOfWeek + p) % SUBJECTS.length;
          return {
            tenantId: tenant.id, academicYearId: year.id,
            classId: section.classId, sectionId: section.id,
            subjectId: subjectId[SUBJECTS[subjectIdx]![1]]!,
            teacherId: teacherIds[subjectIdx]!,
            roomId: roomIds[(dayOfWeek + p) % roomIds.length]!,
            dayOfWeek, periodNumber: p + 1,
            startTime: slot[0]!, endTime: slot[1]!,
          };
        }),
      ),
    );

  await prisma.timetableSlot.createMany({ data: timetableRows, skipDuplicates: true });
  step('timetable', `${timetableRows.length} periods`);

  // -------------------------------------------------------------------------
  // Students, guardians, enrolments
  // -------------------------------------------------------------------------
  interface Planned {
    admissionNo: string; first: string; last: string; male: boolean;
    classId: string; sectionId: string; level: number; roll: number;
  }

  const planned: Planned[] = [];
  let admissionCounter = 0;

  for (const cls of classes) {
    for (const section of sectionsByClass.get(cls.id)!) {
      const count = randInt(16, 22);
      for (let n = 0; n < count; n++) {
        admissionCounter++;
        const male = rand() > 0.5;
        planned.push({
          admissionNo: `ADM/2026-27/${String(admissionCounter).padStart(6, '0')}`,
          first: male ? pick(FIRST_M) : pick(FIRST_F),
          last: pick(LAST),
          male,
          classId: cls.id,
          sectionId: section.id,
          level: cls.level,
          roll: n + 1,
        });
      }
    }
  }

  const students = await prisma.student.createManyAndReturn({
    data: planned.map((p, i) => ({
      tenantId: tenant.id, branchId: branch.id,
      admissionNo: p.admissionNo, rollNumber: String(p.roll),
      firstName: p.first, lastName: p.last,
      dateOfBirth: date(`${2026 - 5 - p.level}-0${randInt(1, 9)}-1${randInt(0, 9)}`),
      gender: (p.male ? 'MALE' : 'FEMALE') as never,
      bloodGroup: pick(['A+', 'B+', 'O+', 'AB+', 'A-', 'O-']),
      admissionDate: date('2026-04-05'),
      status: 'ACTIVE' as never,
      city: 'New Delhi', state: 'Delhi',
      // Scatter homes around campus for a believable map.
      homeLatitude: 28.6129 + (rand() - 0.5) * 0.08,
      homeLongitude: 77.2295 + (rand() - 0.5) * 0.08,
      rfidTag: `RF${String(i + 1).padStart(6, '0')}`,
    })),
    select: { id: true, admissionNo: true, firstName: true, lastName: true },
  });

  const studentByAdmission = new Map(students.map((s) => [s.admissionNo, s]));
  const plannedWithId = planned.map((p) => ({ ...p, id: studentByAdmission.get(p.admissionNo)!.id }));

  await prisma.enrollment.createMany({
    data: plannedWithId.map((p) => ({
      studentId: p.id, academicYearId: year.id,
      classId: p.classId, sectionId: p.sectionId,
      rollNumber: String(p.roll), isCurrent: true,
    })),
  });

  // One guardian per student. The first student of each section gets a
  // Parent-App login so the Parent panel is demoable for several classes.
  const parentLoginFor = new Set(
    sections.map((s) => plannedWithId.find((p) => p.sectionId === s.id)?.admissionNo).filter(Boolean) as string[],
  );

  const guardianUsers = await prisma.user.createManyAndReturn({
    data: plannedWithId
      .filter((p) => parentLoginFor.has(p.admissionNo))
      .map((p, i) => {
        const cls = classes.find((c) => c.id === p.classId)!;
        const sec = sections.find((s) => s.id === p.sectionId)!;
        return {
          tenantId: tenant.id, branchId: branch.id,
          email: `parent.${cls.level}${sec.name.toLowerCase()}@example.com`,
          phone: `+9199${String(10000000 + i).slice(-8)}`,
          passwordHash, role: 'PARENT' as never, scope: 'CHILDREN' as never,
          firstName: pick(FIRST_M), lastName: p.last,
          status: 'ACTIVE' as never, phoneVerifiedAt: new Date(),
        };
      }),
    select: { id: true, email: true, phone: true, firstName: true, lastName: true },
  });

  const parentUserByAdmission = new Map<string, (typeof guardianUsers)[number]>();
  {
    const withLogin = plannedWithId.filter((p) => parentLoginFor.has(p.admissionNo));
    withLogin.forEach((p, i) => parentUserByAdmission.set(p.admissionNo, guardianUsers[i]!));
  }

  const guardians = await prisma.guardian.createManyAndReturn({
    data: plannedWithId.map((p, i) => {
      const linked = parentUserByAdmission.get(p.admissionNo);
      return {
        tenantId: tenant.id,
        userId: linked?.id ?? null,
        firstName: linked?.firstName ?? pick(FIRST_M),
        lastName: p.last,
        phone: linked?.phone ?? `+9197${String(20000000 + i).slice(-8)}`,
        email: linked?.email ?? null,
        occupation: pick(['Engineer', 'Doctor', 'Business Owner', 'Teacher', 'Consultant', 'Architect']),
        inviteAcceptedAt: linked ? new Date() : null,
      };
    }),
    select: { id: true },
  });

  await prisma.studentGuardian.createMany({
    data: plannedWithId.map((p, i) => ({
      studentId: p.id,
      guardianId: guardians[i]!.id,
      relation: 'FATHER' as never,
      custody: 'PRIMARY' as never,
      isPrimaryContact: true,
      canViewLocation: true,
      locationConsentAt: new Date(),
    })),
  });

  // Explicit DPDP consent rows for the guardians who actually have logins.
  await prisma.consentRecord.createMany({
    data: guardianUsers.map((u) => ({
      userId: u.id, consentType: 'LOCATION_TRACKING', granted: true, version: '1.0',
    })),
  });

  // A student login for the Student panel.
  const demoStudent = plannedWithId[0]!;
  const studentUser = await prisma.user.create({
    data: {
      tenantId: tenant.id, branchId: branch.id,
      email: 'student@dpsdelhi.edu.in', phone: '+919900000001', passwordHash,
      role: 'STUDENT', scope: 'SELF',
      firstName: demoStudent.first, lastName: demoStudent.last, status: 'ACTIVE',
    },
    select: { id: true },
  });
  await prisma.student.update({ where: { id: demoStudent.id }, data: { userId: studentUser.id } });

  step('students', `${students.length} enrolled · ${guardians.length} guardians · ${guardianUsers.length} parent logins`);

  // -------------------------------------------------------------------------
  // Attendance — last 20 school days for the first four classes
  // -------------------------------------------------------------------------
  const trackedSections = sections.filter((s) =>
    classes.slice(0, 4).some((c) => c.id === s.classId),
  );

  const schoolDays: Date[] = [];
  {
    const cursor = new Date();
    cursor.setUTCHours(0, 0, 0, 0);
    while (schoolDays.length < 20) {
      cursor.setUTCDate(cursor.getUTCDate() - 1);
      if (cursor.getUTCDay() !== 0 && cursor.getUTCDay() !== 6) {
        schoolDays.push(new Date(cursor));
      }
    }
  }

  // Decide every mark up front so session counters and records agree exactly.
  const plannedSessions = trackedSections.flatMap((section) => {
    const roster = plannedWithId.filter((p) => p.sectionId === section.id);
    return schoolDays.map((day) => {
      const marks = roster.map((p) => {
        const roll = rand();
        return {
          studentId: p.id,
          status: roll > 0.94 ? 'ABSENT' : roll > 0.90 ? 'LATE' : 'PRESENT',
        };
      });
      return {
        sectionId: section.id,
        date: day,
        marks,
        present: marks.filter((m) => m.status === 'PRESENT').length,
        absent: marks.filter((m) => m.status === 'ABSENT').length,
        late: marks.filter((m) => m.status === 'LATE').length,
      };
    });
  });

  const attendanceSessions = await prisma.attendanceSession.createManyAndReturn({
    data: plannedSessions.map((s) => ({
      tenantId: tenant.id, sectionId: s.sectionId, date: s.date, periodNumber: 0,
      takenById: teacherIds[0]!, takenAt: s.date,
      totalStudents: s.marks.length,
      presentCount: s.present, absentCount: s.absent, lateCount: s.late,
    })),
    select: { id: true },
  });

  const attendanceRows = plannedSessions.flatMap((s, i) =>
    s.marks.map((m) => ({
      sessionId: attendanceSessions[i]!.id,
      studentId: m.studentId,
      status: m.status as never,
      source: 'TEACHER' as never,
    })),
  );

  // Chunked: a single INSERT with ~14k rows exceeds the parameter limit.
  for (let i = 0; i < attendanceRows.length; i += 5000) {
    await prisma.attendanceRecord.createMany({ data: attendanceRows.slice(i, i + 5000) });
  }
  step('attendance', `${attendanceRows.length} records over ${schoolDays.length} school days`);

  // -------------------------------------------------------------------------
  // Fees
  // -------------------------------------------------------------------------
  const FEE_HEADS: Array<[string, string, string, number, number]> = [
    ['Tuition Fee', 'TUITION', 'TUITION', 0, 3500],
    ['Development Fee', 'DEV', 'MISC', 0, 800],
    ['Examination Fee', 'EXAM', 'EXAM', 0, 500],
    ['Library Fee', 'LIB', 'LIBRARY', 0, 300],
    ['Transport Fee', 'TRANS', 'TRANSPORT', 5, 1800],
  ];

  const feeHeads = await prisma.feeHead.createManyAndReturn({
    data: FEE_HEADS.map(([name, code, category, gst]) => ({
      tenantId: tenant.id, name, code, category,
      gstRate: dec(gst), isTaxable: gst > 0,
      frequency: 'QUARTERLY', hsnSacCode: gst > 0 ? '9992' : null,
    })),
    select: { id: true, code: true, name: true },
  });
  const headByCode = new Map(feeHeads.map((h) => [h.code, h]));

  const billable = FEE_HEADS.slice(0, 4);
  const quarterTotal = billable.reduce((s, [, , , , amt]) => s + amt, 0);

  const structure = await prisma.feeStructure.create({
    data: {
      tenantId: tenant.id, academicYearId: year.id,
      name: 'Standard Quarterly 2026-27',
      description: 'Applies to Classes 1-8',
      totalAmount: dec(quarterTotal * 4),
      items: {
        create: billable.map(([, code, , , amount]) => ({
          feeHeadId: headByCode.get(code)!.id, amount: dec(amount),
        })),
      },
      installments: {
        create: [
          { name: 'Q1 (Apr-Jun)', sequence: 1, amount: dec(quarterTotal), dueDate: date('2026-04-15'), lateFeeAmount: dec(200) },
          { name: 'Q2 (Jul-Sep)', sequence: 2, amount: dec(quarterTotal), dueDate: date('2026-07-15'), lateFeeAmount: dec(200) },
          { name: 'Q3 (Oct-Dec)', sequence: 3, amount: dec(quarterTotal), dueDate: date('2026-10-15'), lateFeeAmount: dec(200) },
          { name: 'Q4 (Jan-Mar)', sequence: 4, amount: dec(quarterTotal), dueDate: date('2027-01-15'), lateFeeAmount: dec(200) },
        ],
      },
    },
    select: { id: true, installments: { where: { sequence: 1 }, select: { id: true } } },
  });

  const q1Id = structure.installments[0]!.id;

  // Q1 is in the past, so unpaid invoices are genuinely OVERDUE — which is
  // what makes the Accountant dashboard interesting.
  const invoicePlan = plannedWithId.map((p, i) => {
    const roll = rand();
    const paid = roll < 0.65 ? quarterTotal : roll < 0.8 ? Math.round(quarterTotal / 2) : 0;
    return {
      student: p,
      invoiceNo: `INV/2026-27/${String(i + 1).padStart(6, '0')}`,
      paid,
      balance: quarterTotal - paid,
      status: paid === quarterTotal ? 'PAID' : paid > 0 ? 'PARTIALLY_PAID' : 'OVERDUE',
    };
  });

  const invoices = await prisma.invoice.createManyAndReturn({
    data: invoicePlan.map((p) => ({
      tenantId: tenant.id, branchId: branch.id, studentId: p.student.id,
      academicYearId: year.id, installmentId: q1Id,
      invoiceNo: p.invoiceNo, status: p.status as never,
      issueDate: date('2026-04-01'), dueDate: date('2026-04-15'),
      subtotal: dec(quarterTotal), totalAmount: dec(quarterTotal),
      paidAmount: dec(p.paid), balanceAmount: dec(p.balance),
      createdById: adminUserId,
    })),
    select: { id: true, invoiceNo: true },
  });

  await prisma.invoiceLine.createMany({
    data: invoices.flatMap((inv) =>
      billable.map(([, code, , , amount]) => ({
        invoiceId: inv.id,
        feeHeadId: headByCode.get(code)!.id,
        description: headByCode.get(code)!.name,
        quantity: 1,
        unitAmount: dec(amount),
        lineTotal: dec(amount),
      })),
    ),
  });

  const paidPlans = invoicePlan
    .map((p, i) => ({ ...p, invoiceId: invoices[i]!.id }))
    .filter((p) => p.paid > 0);

  await prisma.payment.createMany({
    data: paidPlans.map((p, i) => ({
      tenantId: tenant.id, invoiceId: p.invoiceId, studentId: p.student.id,
      receiptNo: `RCP-2026-${String(i + 1).padStart(6, '0')}`,
      amount: dec(p.paid),
      mode: pick(['UPI', 'NETBANKING', 'CARD', 'CASH']) as never,
      gateway: 'RAZORPAY' as never,
      status: 'SUCCESS' as never,
      paidAt: new Date(Date.now() - randInt(1, 60) * 86_400_000),
      collectedById: adminUserId,
    })),
  });
  step('fees', `${invoices.length} invoices · ${paidPlans.length} payments · ₹${(paidPlans.reduce((s, p) => s + p.paid, 0)).toLocaleString('en-IN')} collected`);

  // -------------------------------------------------------------------------
  // Library
  // -------------------------------------------------------------------------
  const categories = await prisma.bookCategory.createManyAndReturn({
    data: [['Fiction', 'FIC'], ['Science', 'SCI'], ['Reference', 'REF'], ['Biography', 'BIO']]
      .map(([name, code]) => ({ tenantId: tenant.id, name: name!, code: code! })),
    select: { id: true, code: true },
  });
  const catId = Object.fromEntries(categories.map((c) => [c.code, c.id]));

  const BOOKS: Array<[string, string, string]> = [
    ['The Jungle Book', 'Rudyard Kipling', 'FIC'],
    ['A Brief History of Time', 'Stephen Hawking', 'SCI'],
    ['Wings of Fire', 'A.P.J. Abdul Kalam', 'BIO'],
    ['Oxford English Dictionary', 'Oxford Press', 'REF'],
    ['The Discovery of India', 'Jawaharlal Nehru', 'BIO'],
    ['Cosmos', 'Carl Sagan', 'SCI'],
    ['Malgudi Days', 'R. K. Narayan', 'FIC'],
    ['Panchatantra', 'Vishnu Sharma', 'FIC'],
    ['The Story of My Experiments with Truth', 'M. K. Gandhi', 'BIO'],
    ['Elements of Chemistry', 'N. Subramaniam', 'SCI'],
  ];

  const bookCopyCounts = BOOKS.map(() => randInt(3, 6));

  const books = await prisma.book.createManyAndReturn({
    data: BOOKS.map(([title, author, cat], i) => ({
      tenantId: tenant.id, branchId: branch.id, categoryId: catId[cat]!,
      title, author, publisher: 'Penguin India', language: 'English',
      rackLocation: `R${randInt(1, 5)}-S${randInt(1, 4)}`,
      price: dec(randInt(200, 800)),
      totalCopies: bookCopyCounts[i]!, availableCopies: bookCopyCounts[i]!,
    })),
    select: { id: true },
  });

  await prisma.bookCopy.createMany({
    data: books.flatMap((book, i) =>
      Array.from({ length: bookCopyCounts[i]! }, (_, c) => ({
        bookId: book.id,
        accessionNo: `ACC${String(i * 10 + c + 1).padStart(5, '0')}`,
      })),
    ),
  });
  step('library', `${books.length} titles · ${bookCopyCounts.reduce((a, b) => a + b, 0)} copies`);

  // -------------------------------------------------------------------------
  // Transport & GPS
  // -------------------------------------------------------------------------
  const vehicle = await prisma.vehicle.create({
    data: {
      tenantId: tenant.id, branchId: branch.id,
      registrationNo: 'DL1PC5432', vehicleType: 'BUS',
      make: 'Tata', model: 'Starbus', capacity: 40, manufactureYear: 2022,
      status: 'ACTIVE', hasGpsDevice: true,
      insuranceExpiry: date('2027-03-31'), fitnessExpiry: date('2027-06-30'),
      permitExpiry: date('2027-09-30'),
    },
    select: { id: true },
  });

  await prisma.trackingDevice.create({
    data: {
      vehicleId: vehicle.id,
      deviceImei: '860123456789012',
      simNumber: '+919812345678',
      vendor: 'Teltonika', model: 'FMB920',
      // Demo credential only — real devices get a random token at provisioning.
      authToken: 'demo-device-token-replace-in-production',
      isActive: true, batteryLevel: 92, signalStrength: 78,
    },
  });

  await prisma.driverProfile.create({
    data: {
      employeeId: driverEmployeeId,
      licenseNumber: 'DL0420110012345', licenseType: 'HMV',
      licenseExpiry: date('2029-08-15'),
      policeVerifiedAt: date('2025-01-10'),
      experienceYears: 12, safetyScore: 96,
    },
  });

  const route = await prisma.transportRoute.create({
    data: {
      tenantId: tenant.id, branchId: branch.id,
      vehicleId: vehicle.id, driverId: driverEmployeeId,
      name: 'Route 1 — South Delhi', code: 'RT01',
      startStopName: 'Lajpat Nagar', endStopName: 'DPS Main Campus',
      distanceKm: dec(12.4), estimatedMinutes: 45,
      pickupStartTime: '06:45', dropStartTime: '14:15',
      monthlyFare: dec(1800),
      stops: {
        create: [
          { name: 'Lajpat Nagar Metro', sequence: 1, latitude: 28.5677, longitude: 77.2433, pickupTime: '06:45', dropTime: '15:00', radiusMeters: 120 },
          { name: 'Defence Colony', sequence: 2, latitude: 28.5729, longitude: 77.2295, pickupTime: '06:55', dropTime: '14:50', radiusMeters: 120 },
          { name: 'Jangpura', sequence: 3, latitude: 28.5836, longitude: 77.2434, pickupTime: '07:05', dropTime: '14:40', radiusMeters: 120 },
          { name: 'Nizamuddin', sequence: 4, latitude: 28.5933, longitude: 77.2507, pickupTime: '07:15', dropTime: '14:30', radiusMeters: 120 },
          { name: 'DPS Main Campus', sequence: 5, latitude: 28.6129, longitude: 77.2295, pickupTime: '07:30', dropTime: '14:15', radiusMeters: 200 },
        ],
      },
    },
    select: { id: true, stops: { select: { id: true, sequence: true } } },
  });

  const pickupStops = route.stops.filter((s) => s.sequence < 5);

  await prisma.transportAllocation.createMany({
    data: plannedWithId.slice(0, 40).map((p, i) => ({
      studentId: p.id, routeId: route.id,
      pickupStopId: pickupStops[i % pickupStops.length]!.id,
      academicYearId: year.id,
      validFrom: date('2026-04-01'), monthlyFare: dec(1800), isActive: true,
    })),
  });

  await prisma.geofence.createMany({
    data: [
      {
        tenantId: tenant.id, branchId: branch.id,
        name: 'DPS Main Campus', type: 'SCHOOL' as never, shape: 'CIRCLE' as never,
        centerLatitude: 28.6129, centerLongitude: 77.2295, radiusMeters: 250,
        notifyOnEntry: true, notifyOnExit: true, cooldownMinutes: 5,
      },
      {
        tenantId: tenant.id, branchId: branch.id,
        name: 'Lajpat Nagar Stop', type: 'BUS_STOP' as never, shape: 'CIRCLE' as never,
        centerLatitude: 28.5677, centerLongitude: 77.2433, radiusMeters: 120,
        notifyOnEntry: true, notifyOnExit: false, cooldownMinutes: 10,
      },
    ],
  });
  step('transport', `1 bus · 5 stops · 40 students allocated · 2 geofences`);

  // -------------------------------------------------------------------------
  // Examinations
  // -------------------------------------------------------------------------
  const term = await prisma.examTerm.create({
    data: {
      tenantId: tenant.id, academicYearId: year.id,
      name: 'Term 1', sequence: 1,
      startDate: date('2026-09-15'), endDate: date('2026-09-25'), weightPercent: 50,
    },
    select: { id: true },
  });

  const exams = await prisma.exam.createManyAndReturn({
    data: classes.slice(0, 4).map((cls) => ({
      tenantId: tenant.id, examTermId: term.id, classId: cls.id,
      name: `Term 1 Examination — ${cls.name}`,
      gradingSystem: 'PERCENTAGE' as never, status: 'SCHEDULED' as never,
      startDate: date('2026-09-15'), endDate: date('2026-09-25'),
      instructions: 'Bring your own stationery. Mobile phones are not permitted.',
    })),
    select: { id: true },
  });

  await prisma.examSchedule.createMany({
    data: exams.flatMap((exam) =>
      SUBJECTS.slice(0, 5).map(([, code], idx) => ({
        examId: exam.id,
        subjectId: subjectId[code]!,
        examDate: date(`2026-09-${15 + idx * 2}`),
        startTime: '09:00', endTime: '12:00',
        maxMarks: dec(100), passingMarks: dec(33),
      })),
    ),
  });
  step('examination', `${exams.length} exams · ${exams.length * 5} subject sittings`);

  // -------------------------------------------------------------------------
  // Assignments, announcements, leave types
  // -------------------------------------------------------------------------
  await prisma.assignment.createMany({
    data: trackedSections.slice(0, 8).map((section, i) => ({
      tenantId: tenant.id,
      classId: section.classId,
      sectionId: section.id,
      subjectId: subjectId[SUBJECTS[i % SUBJECTS.length]![1]]!,
      teacherId: teacherIds[i % teacherIds.length]!,
      title: pick([
        'Chapter 4 — Practice Problems',
        'Essay: My Favourite Season',
        'Lab Record — Photosynthesis',
        'Map Work: Indian Rivers',
        'Worksheet: Fractions',
      ]),
      description: 'Complete the exercises and submit through the portal before the due date.',
      maxMarks: dec(20),
      status: 'PUBLISHED' as never,
      assignedOn: date('2026-08-01'),
      dueAt: new Date(Date.now() + randInt(2, 10) * 86_400_000),
      publishedAt: new Date(),
    })),
  });

  await prisma.announcement.createMany({
    data: ([
      ['Annual Sports Day — 15 September', 'The annual sports day will be held on the main ground. Parents are cordially invited. Events begin at 8:00 AM sharp.', 'EVENT', 'NORMAL', false],
      ['Term 1 Examination Schedule Released', 'The Term 1 datesheet for Classes 1-8 is now available under Examinations. Please review the dates and inform your ward.', 'EXAM', 'HIGH', false],
      ['Quarter 1 Fee Due — 15 April', 'Q1 fees are due by 15 April. Payment can be made online through the Parent App. A late fee of ₹200 applies thereafter.', 'FEE', 'HIGH', true],
      ['Gandhi Jayanti — School Closed', 'The school will remain closed on 2 October on account of Gandhi Jayanti.', 'HOLIDAY', 'NORMAL', false],
      ['Parent-Teacher Meeting — 28 August', 'PTM for all classes will be held from 9:00 AM to 1:00 PM. Please book a slot with your class teacher.', 'EVENT', 'HIGH', false],
    ] as Array<[string, string, string, string, boolean]>).map(([title, body, category, priority, isPinned]) => ({
      tenantId: tenant.id, authorId: adminUserId,
      title, body, category, priority: priority as never,
      audienceType: 'INSTITUTION' as never,
      channels: ['IN_APP', 'PUSH'] as never,
      isPublished: true, publishAt: new Date(), isPinned,
    })),
  });

  await prisma.leaveType.createMany({
    data: ([
      ['Casual Leave', 'CL', 12, true], ['Sick Leave', 'SL', 10, true],
      ['Earned Leave', 'EL', 15, true], ['Loss of Pay', 'LOP', 0, false],
    ] as Array<[string, string, number, boolean]>).map(([name, code, annualQuota, isPaid]) => ({
      tenantId: tenant.id, name, code, annualQuota, isPaid,
    })),
  });

  await prisma.attendanceRule.create({
    data: {
      tenantId: tenant.id, branchId: branch.id, name: 'Default',
      schoolStartTime: '08:00', schoolEndTime: '14:30',
      graceMinutes: 10, halfDayAfterMinutes: 120,
      absenceAlertThreshold: 3, minAttendancePercent: 75,
      notifyParentOnAbsence: true, notifyParentOnLate: false, lockAfterHours: 24,
    },
  });

  step('content', 'assignments · announcements · leave types · attendance rules');

  // -------------------------------------------------------------------------
  console.log(`\nDone in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
  console.log(`\nSign in at http://localhost:5173 — password for every account: ${PASSWORD}\n`);
  console.table([
    { Panel: 'Super Admin', Email: 'superadmin@dpsdelhi.edu.in' },
    { Panel: 'School Admin', Email: 'principal@dpsdelhi.edu.in' },
    { Panel: 'Administration', Email: 'admin@dpsdelhi.edu.in' },
    { Panel: 'Teacher', Email: 'teacher.math@dpsdelhi.edu.in' },
    { Panel: 'Accountant', Email: 'accounts@dpsdelhi.edu.in' },
    { Panel: 'Librarian', Email: 'library@dpsdelhi.edu.in' },
    { Panel: 'HR', Email: 'hr@dpsdelhi.edu.in' },
    { Panel: 'Student', Email: 'student@dpsdelhi.edu.in' },
    { Panel: 'Parent', Email: 'parent.1a@example.com' },
    { Panel: 'Driver', Email: 'driver@dpsdelhi.edu.in' },
  ]);
}

main()
  .catch((err) => {
    console.error('\nSeed failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
