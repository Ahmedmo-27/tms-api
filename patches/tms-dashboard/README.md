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

**Requires** the matching `tms-api` branch `cursor/open-gym-custom-packages-ce23` (six renewal periods: 1/2/3 week and 1/2/3 month, custom names and prices per branch).

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
