# TMS Dashboard fixes (apply to `Ahmedmo-27/tms-dashboard`)

The Cloud Agent token can push to `tms-api` but not `tms-dashboard`. These artifacts contain all dashboard fixes from branch `cursor/fix-member-request-accept-b76e` (includes scan monitor + member request acceptance fixes).

## Option A — Git bundle (recommended)

```bash
git clone https://github.com/Ahmedmo-27/tms-dashboard.git
cd tms-dashboard
git fetch /path/to/tms-dashboard-all-fixes.bundle cursor/fix-member-request-accept-b76e:cursor/fix-member-request-accept-b76e
git checkout cursor/fix-member-request-accept-b76e
git push -u origin cursor/fix-member-request-accept-b76e
```

From this repo after cloning tms-api:

```bash
git fetch ../patches/tms-dashboard/tms-dashboard-all-fixes.bundle cursor/fix-member-request-accept-b76e:cursor/fix-member-request-accept-b76e
```

## Option B — Patch file

```bash
git clone https://github.com/Ahmedmo-27/tms-dashboard.git
cd tms-dashboard
git checkout -b cursor/fix-member-request-accept-b76e
git am /path/to/tms-dashboard-all-fixes.patch
git push -u origin cursor/fix-member-request-accept-b76e
```

## Option C — Phone / GitHub mobile

1. Open [tms-dashboard](https://github.com/Ahmedmo-27/tms-dashboard) on desktop or use Working Copy (iOS) / MGit (Android).
2. Create branch `cursor/fix-member-request-accept-b76e`.
3. Apply the patch or cherry-pick commits:
   - `1fc2080` — scan error socket fixes
   - `bd1aa29` — member request acceptance fixes

## What is fixed

- Socket.io connects to API root (not `/api`) for live scan errors
- `/dashboard` redirects to Scans Monitor
- Member request **Add Member** uses server action + error toasts
- `management` / `branch_admin` roles can log into dashboard

## Guest package / Scans Monitor (new)

Apply `guest-package-scans-monitor.patch` on branch `cursor/guest-package-scans-monitor-cf64`:

```bash
cd tms-dashboard
git checkout -b cursor/guest-package-scans-monitor-cf64
git am /path/to/guest-package-scans-monitor.patch
git push -u origin cursor/guest-package-scans-monitor-cf64
```

Changes:
- Scans Monitor **Add Package** uses the unified non-member form
- Staff can type name + phone for walk-ins (no pending signup required)
- Optional search still pre-fills pending signups
- Relaxed guest name validation; phone normalized before API call
