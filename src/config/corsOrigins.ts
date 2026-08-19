/** Shared CORS allow-list for Express and Socket.io */
export const CORS_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:3803",
  "https://tms-dashboard-ashen.vercel.app",
  "https://tms-dashboard-test.vercel.app",
  "https://tms-dashboard-psi.vercel.app",
  "https://the-mind-space.com",
  "https://www.the-mind-space.com",
];

const LOCAL_DEV_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/;

/** Native apps send no Origin. Flutter web on localhost uses a random port. */
export function isAllowedCorsOrigin(origin?: string): boolean {
  if (!origin) return true;
  if (CORS_ORIGINS.includes(origin)) return true;
  return LOCAL_DEV_ORIGIN.test(origin);
}
