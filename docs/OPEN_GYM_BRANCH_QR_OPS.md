# Open Gym QR Codes — Operations Note

## QR formats

| QR content | Meaning |
|---|---|
| `{scheduledClassId}` | Class check-in (unchanged) |
| `opengym:{locationId}` | Open gym check-in at a specific branch |
| `opengym` | Legacy global open gym code (backward compatibility only) |

`locationId` is the MongoDB `_id` from `GET /admin/locations`.

Example branch QR: `opengym:674a1b2c3d4e5f6789012345`

## What to print at each branch

Open gym is available at every location, so **each branch needs its own QR code**:

1. Open **Admin → Locations** and copy the branch `_id`.
2. Generate a QR whose raw string is exactly: `opengym:{thatLocationId}`
3. Post that QR at the corresponding branch only.

Do **not** reuse one global `opengym` QR across branches once multi-branch open gym is live.

## Legacy `opengym` QR (old printed codes)

The backend still accepts the exact string `opengym` for already-printed codes, with these rules:

- If exactly **one** branch exists in the system, scans are attributed to that branch.
- If `LEGACY_OPEN_GYM_DEFAULT_LOCATION_ID` is set to a valid location `_id`, scans use that branch.
- If **multiple** branches exist and no default is configured, legacy scans are **rejected**. Staff should replace old QRs with per-branch codes.

## Member scan behavior (no app update required)

The mobile app sends the raw QR string to `POST /member/attend/:attendanceId` unchanged. The backend:

1. Treats valid class IDs as class scans (unchanged).
2. Treats `opengym:{locationId}` as branch-scoped open gym.
3. Treats exact `opengym` as legacy open gym (rules above).
4. Rejects unknown formats, invalid `locationId` values, and unknown/deleted branches with `INVALID_LOCATION` — **no attendance is created**.

Members must hold an open-gym-eligible package (or valid drop-in) for **that branch**. Scanning Branch B’s QR with access only at Branch A fails with `NO_ACCESS_AT_LOCATION`.

## Daily attendance

`GET /admin/daily-attendance` returns `locationId` on each open gym record (populated with branch details when available).
