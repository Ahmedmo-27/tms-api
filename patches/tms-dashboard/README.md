# TMS Dashboard fixes (apply to `Ahmedmo-27/tms-dashboard`)

The Cloud Agent token can push to `tms-api` but not `tms-dashboard`. Apply patches from this folder to the dashboard repo.

## Open gym custom packages (latest)

Branch: `cursor/open-gym-custom-packages-ce23`

```bash
git clone https://github.com/Ahmedmo-27/tms-dashboard.git
cd tms-dashboard
git checkout -b cursor/open-gym-custom-packages-ce23
git am /path/to/tms-api/patches/tms-dashboard/open-gym-custom-packages.patch
git push -u origin cursor/open-gym-custom-packages-ce23
```

**Requires** the matching `tms-api` branch `cursor/open-gym-custom-packages-ce23` (custom open gym package name, duration in weeks/months/days, and price per branch).

## Earlier fixes bundle

Branch: `cursor/fix-member-request-accept-b76e` (scan monitor + member request acceptance fixes).

### Option A — Git bundle (recommended)

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

### Option B — Patch file

```bash
git clone https://github.com/Ahmedmo-27/tms-dashboard.git
cd tms-dashboard
git checkout -b cursor/fix-member-request-accept-b76e
git am /path/to/tms-dashboard-all-fixes.patch
git push -u origin cursor/fix-member-request-accept-b76e
```

### Option C — Phone / GitHub mobile

1. Open [tms-dashboard](https://github.com/Ahmedmo-27/tms-dashboard) on desktop or use Working Copy (iOS) / MGit (Android).
2. Create branch `cursor/fix-member-request-accept-b76e`.
3. Apply the patch or cherry-pick commits:
   - `1fc2080` — scan error socket fixes
   - `bd1aa29` — member request acceptance fixes

## What is fixed (earlier bundle)

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
- **Add open gym package** supports walk-ins with name + phone (same flow)
- Staff can type name + phone for walk-ins (no pending signup required)
- Optional search pre-fills existing members or pending signups
- Relaxed guest name validation; phone normalized before API call
- Branch `locationId` forwarded for guest open gym package purchases
