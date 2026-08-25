export function normalizeSpaceNameKey(name: string): string {
  return (name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function spacePhoneDigits(raw?: string): string {
  return (raw || "").replace(/\D/g, "");
}

export function spacePhonesMatch(a?: string, b?: string): boolean {
  const left = spacePhoneDigits(a);
  const right = spacePhoneDigits(b);
  if (left.length < 8 || right.length < 8) return false;
  const leftTail = left.slice(-10);
  const rightTail = right.slice(-10);
  return (
    leftTail === rightTail || left.endsWith(right) || right.endsWith(left)
  );
}

export function spacePaymentPurpose(
  payment: {
    purpose?: string;
    note?: string;
    pkgId?: { name?: string } | string | null;
    scid?: unknown;
  },
  fallback = "",
): string {
  const pkg = payment.pkgId;
  const pkgName =
    pkg && typeof pkg === "object" && pkg.name ? pkg.name.trim() : "";
  if (pkgName) return pkgName;

  const note = (payment.note || "").toLowerCase();
  const purpose = (payment.purpose || "").toUpperCase();
  if (
    purpose === "DROPIN" ||
    purpose === "WALKIN" ||
    note.includes("open gym") ||
    /\bdrop\s*-?\s*in\b/.test(note)
  ) {
    if (note.includes("open gym") || note.includes("space")) {
      return "Drop in Space";
    }
    if (payment.scid) {
      return "Drop in";
    }
    return "Drop in Space";
  }
  if (purpose === "PACKAGE" || purpose === "NON_USER_PACKAGE") {
    return fallback || "Package";
  }
  return fallback || payment.note || payment.purpose || "";
}

export function matchSpaceRowForPayment<
  T extends {
    amount?: number | null;
    memberId?: string;
    name: string;
    phone?: string;
  },
>(
  rows: T[],
  person: { memberId?: string; name: string; phone: string },
): T | undefined {
  const nameKey = normalizeSpaceNameKey(person.name || "");
  return rows.find((row) => {
    if (row.amount != null && Number(row.amount) > 0) return false;
    if (person.memberId && row.memberId === person.memberId) return true;
    if (spacePhonesMatch(person.phone, row.phone)) return true;
    if (nameKey && normalizeSpaceNameKey(row.name) === nameKey) return true;
    return false;
  });
}
