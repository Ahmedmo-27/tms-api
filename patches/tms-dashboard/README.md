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

## Management branch selection in modals (latest)

Branch: `cursor/management-branch-modal-selection`

When management views **all branches** (no `?locationId=` filter), write actions now show a **branch picker inside each modal** instead of failing with `BRANCH_REQUIRED`.

Apply the patch (use **UTF-8** path; `git am` does not work with PowerShell redirects):

```bash
cd tms-dashboard
git checkout -b cursor/management-branch-modal-selection
git am "D:/Work/The Mind Space/Testing Environment/API Test/patches/tms-dashboard/management-branch-modal-selection.patch"
git push -u origin cursor/management-branch-modal-selection
```

From `Dashboard Test/tms-dashboard`, the patch path is:

```powershell
git am "../../API Test/patches/tms-dashboard/management-branch-modal-selection.patch"
```

### Endpoints covered (management role, requires `locationId` on write)

| Dashboard surface | API route |
|---|---|
| Add package to member (`sub-package`, open gym subscribe) | `POST /admin/member-packages` |
| Guest / non-member package modals | `POST /admin/nonUserPackage` |
| Open gym drop-in (member + guest) | `POST /admin/openGym/memberDropIn`, `.../guestDropIn` |
| Open gym pricing dialog | `POST /admin/openGym/dropInPrice`, package CRUD |
| Add OPEN_GYM catalog package | `POST /admin/packages` |
| Walk-in booking | `POST /admin/nonUserBooking/walk-in` |
| Guest payment (Will Pay) | `POST /admin/nonUserBooking/pay` |
| Checkout / complete order | `POST /admin/orders` |
| Cash out | `POST /admin/refunds/cashout` |
| Schedule class | already had location picker in modal |

`branch_admin` users are unchanged — branch comes from their assigned `user.locationId`.

## Member package pending deduction (latest)

Branch: `cursor/member-package-pending-deduction`

When adding a package from a member profile, staff can check **Attended a class using this package** to deduct one session at subscribe time (same as guest/non-member package modals).

Apply the patch:

```bash
cd tms-dashboard
git checkout -b cursor/member-package-pending-deduction
git am "D:/Work/The Mind Space/Testing Environment/API Test/patches/tms-dashboard/member-package-pending-deduction.patch"
git push -u origin cursor/member-package-pending-deduction
```

Requires matching `tms-api` changes: `POST /admin/member-packages` accepts optional `pendingDeduction: true`.
