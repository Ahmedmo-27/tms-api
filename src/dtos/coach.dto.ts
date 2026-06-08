import { IMemberPackageData } from "../models/member";

// ---------------------------------------------------------------------------
// Request DTOs
// ---------------------------------------------------------------------------


export interface DeductSessionRequestDto {
  memberId: string;
  memberPackageStartDate: string;
  reason: string;
  sessionDate: string;
  sessionType: "INDIVIDUAL" | "GROUP";
}

// ---------------------------------------------------------------------------
// Response DTOs
// ---------------------------------------------------------------------------


export interface DeductSessionResponseDto {
  pkgId: string;
  name: string;
  pkgStartDate: Date;
  pkgEndDate: Date;
  status: string;
  remainingClasses: number;
}

export interface ClientResponseDto {
  memberId: string;
  name: string;
  email: string;
  phoneNumber: string;
  source: string[];
  activePackagesCount: number;
}

export interface ClientListResponseDto {
  clients: ClientResponseDto[];
}

export interface PaginatedClientsResponseDto {
  clients: ClientResponseDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface CalendarClientDto {
  memberId: string;
  name: string;
  phoneNumber: string;
  bookingMethod: string;
  activePackage: {
    pkgId: string;
    pkgStartDate: string;
    remainingClasses: number;
  } | null;
}

export interface ScheduleSessionDto {
  scheduledClassId: string;
  classTitle: string;
  category: string;
  startTime: string;
  endTime: string;
  capacity: number;
  bookedCount: number;
  clients: CalendarClientDto[];
}

export interface ScheduleDayDto {
  date: string;
  dayName: string;
  sessions: ScheduleSessionDto[];
}

export interface ScheduleResponseDto {
  weekStart: string;
  weekEnd: string;
  days: ScheduleDayDto[];
}

export interface MemberPackageResponseDto {
  pkgId: string;
  name?: string;
  pkgStartDate: Date;
  pkgEndDate: Date;
  remainingClasses: number;
  status: string;
  isExpired: boolean;
  daysUntilExpiry: number;
}

export interface MemberPackageListResponseDto {
  packages: MemberPackageResponseDto[];
}

export interface NewPackageEventDto {
  memberName: string;
  packageName: string;
  classesTotal: number;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Mapper functions
// ---------------------------------------------------------------------------

/**
 * Maps a raw IMemberPackageData subdocument to MemberPackageResponseDto,
 * computing server-side expiry values at call time.
 */
export function mapMemberPackageResponseDto(
  pkg: IMemberPackageData
): MemberPackageResponseDto {
  const now = Date.now();
  const endTime = pkg.pkgEndDate.getTime();
  return {
    pkgId: pkg.pkgId.toString(),
    name: pkg.name,
    pkgStartDate: pkg.pkgStartDate,
    pkgEndDate: pkg.pkgEndDate,
    remainingClasses: pkg.remainingClasses,
    status: pkg.status,
    isExpired: pkg.pkgEndDate < new Date(now),
    daysUntilExpiry: Math.ceil((endTime - now) / 86400000),
  };
}

/**
 * Maps an updated IMemberPackageData subdocument to DeductSessionResponseDto.
 */
export function mapDeductSessionResponseDto(
  pkg: IMemberPackageData
): DeductSessionResponseDto {
  return {
    pkgId: pkg.pkgId.toString(),
    name: pkg.name,
    pkgStartDate: pkg.pkgStartDate,
    pkgEndDate: pkg.pkgEndDate,
    status: pkg.status,
    remainingClasses: pkg.remainingClasses,
  };
}
