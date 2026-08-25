export type SheetPane = "class" | "space_pt";

export type SheetLabelMapping =
  | { kind: "dropin" }
  | { kind: "label"; label: string };

export type SheetIntent =
  | { kind: "invalid"; reason: string }
  | { kind: "skip_unmapped"; reason: string }
  | { kind: "class_attend" }
  | { kind: "class_dropin" }
  | { kind: "class_foc" }
  | { kind: "class_package_then_attend" }
  | { kind: "space_attend" }
  | { kind: "pt_attend" }
  | { kind: "space_dropin" }
  | { kind: "package_sale" }
  | { kind: "cash_out" }
  | { kind: "member_refund" };

export const SHEET_PAYMENT_METHODS = [
  "CASH",
  "VISA",
  "APP",
  "INSTAPAY",
  "VALU",
  "PAYMENT_LINK",
] as const;

export type SheetPaymentMethod = (typeof SHEET_PAYMENT_METHODS)[number];

export function normalizeSheetText(raw: string): string {
  return (raw || "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Sheet shorthand staff type instead of full class or membership names. */
export const SHEET_ABBREVIATIONS: Record<string, string[]> = {
  ft: ["functional", "training"],
  st: ["studio"],
  ums: ["ultimate", "mindspacer"],
  pt: ["personal", "training"],
  sm: ["spacer", "mix"],
  og: ["open", "gym"],
  mat: ["mat", "pilates"],
  ref: ["reformer", "pilates"],
  rf: ["rope", "flow"],
  cond: ["conditioning"],
  str: ["strength"],
  lw: ["ladies", "workout"],
  pp: ["prenatal", "postpartum"],
  hyrox: ["hyrox"],
};

/** Abbreviations that name a whole category instead of one class title. */
export const SHEET_ABBREVIATION_CLASS_CATEGORIES: Record<string, string> = {
  ft: "FUNCTIONAL_TRAINING",
  st: "STUDIO",
  og: "WORKSPACE",
};

export function sheetTokens(raw: string): string[] {
  return normalizeSheetText(raw)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
}

/**
 * "append" keeps the shorthand alongside its expansion (substring scoring).
 * "replace" drops the shorthand so token overlap against catalog titles is exact.
 */
export function expandSheetTokens(
  raw: string,
  mode: "append" | "replace" = "append",
): string[] {
  const tokens = sheetTokens(raw);
  const out: string[] = [];
  for (const token of tokens) {
    const expanded = SHEET_ABBREVIATIONS[token];
    if (expanded) {
      if (mode === "append") out.push(token);
      out.push(...expanded);
    } else {
      out.push(token);
    }
  }
  if (tokens.includes("pre") && tokens.includes("post")) {
    out.push("prenatal", "postpartum");
  }
  return [...new Set(out)];
}

export function sheetAbbreviationCategory(raw: string): string | null {
  const tokens = sheetTokens(raw);
  if (tokens.length !== 1) return null;
  return SHEET_ABBREVIATION_CLASS_CATEGORIES[tokens[0]] ?? null;
}

function extractAfterWith(method: string): string {
  const match = method.match(/\bwith\s+(.+)$/i);
  return match?.[1]?.trim() || "Coach";
}

export function mapClassMethodToSheetLabel(method: string): SheetLabelMapping {
  const normalized = normalizeSheetText(method);

  if (normalized === "drop in" || normalized === "drop-in") {
    return { kind: "dropin" };
  }
  if (normalized.includes("spacer mix")) {
    return { kind: "label", label: "Spacer mix member" };
  }
  if (normalized.includes("ultimate mindspacer")) {
    return { kind: "label", label: "UMS App member" };
  }
  if (normalized.includes("functional training")) {
    return { kind: "label", label: "Ft App member" };
  }
  if (
    normalized.includes("prenatal") ||
    normalized.includes("postpartum") ||
    normalized.includes("pre/post")
  ) {
    return { kind: "label", label: "Pre/Post App member" };
  }
  if (normalized.includes("studio")) {
    return { kind: "label", label: "ST App member" };
  }

  return { kind: "label", label: method?.trim() || "" };
}

export function mapPtMethodToSheetLabel(method: string): SheetLabelMapping {
  const normalized = normalizeSheetText(method);

  if (normalized === "drop in" || normalized === "drop-in") {
    return { kind: "dropin" };
  }

  const isOnline = normalized.includes("online");
  const isPrePost =
    normalized.includes("pre/post") ||
    normalized.includes("pre-post") ||
    normalized.includes("prenatal") ||
    normalized.includes("postpartum");
  const isPt =
    normalized.includes("personal training") ||
    /(^|\s)pt(\s|$)/.test(normalized);

  if (isPt && normalized.includes("with")) {
    const coach = extractAfterWith(method);
    if (isOnline) {
      return { kind: "label", label: `Online PT with ${coach}` };
    }
    if (isPrePost) {
      return { kind: "label", label: `Pre/Post PT with ${coach}` };
    }
    return { kind: "label", label: `PT with ${coach}` };
  }

  return { kind: "label", label: method?.trim() || "" };
}

export function mapOpenGymMethodToSheetLabel(
  method: string,
): SheetLabelMapping {
  const normalized = normalizeSheetText(method);

  if (normalized === "drop in" || normalized === "drop-in") {
    return { kind: "dropin" };
  }
  if (normalized.includes("spacer mix")) {
    return { kind: "label", label: "Spacer Mix App Member" };
  }
  if (normalized.includes("ultimate mindspacer")) {
    return { kind: "label", label: "UMS App member" };
  }
  if (
    normalized.includes("space membership") ||
    /^(\d+\s+(month|months)\s+)?space(\s|$)/.test(normalized)
  ) {
    return { kind: "label", label: "Space App Member" };
  }

  return { kind: "label", label: method?.trim() || "" };
}

export function isDropInText(raw: string): boolean {
  return /drop\s*-?\s*in/i.test(raw || "");
}

export function isFocText(raw: string): boolean {
  const n = normalizeSheetText(raw);
  return n === "foc" || n.includes("free of charge");
}

export function isClinicText(raw: string): boolean {
  return /\bclin[ic]{1,3}\b/i.test(raw || "");
}

export function isWillPayText(raw: string): boolean {
  return /will\s*(pay|renew|scan)|willpay|willrenew|willscan/i.test(raw || "");
}

export function isInvitationText(raw: string): boolean {
  const n = normalizeSheetText(raw);
  if (!n) return false;
  return (
    /\binvitations?\b/.test(n) ||
    /\binvite\b/.test(n) ||
    /(^|\s)inv(\s|$|\.)/.test(n)
  );
}

export function isRetailPurpose(raw: string): boolean {
  const n = normalizeSheetText(raw);
  if (!n) return false;
  return (
    /\bweleda\b/.test(n) ||
    /\btrace brow\b/.test(n) ||
    /\bbrow soap\b/.test(n) ||
    /\bsocks?\b/.test(n) ||
    /\bretail\b/.test(n) ||
    /\bmerchandise\b/.test(n)
  );
}

export function isCashOutText(raw: string): boolean {
  const n = normalizeSheetText(raw);
  if (!n) return false;
  return (
    n === "cash out" ||
    n === "cashout" ||
    n.includes("cash out") ||
    n.includes("cashout")
  );
}

export function isRefundText(raw: string): boolean {
  const n = normalizeSheetText(raw);
  if (!n) return false;
  return n === "refund" || n.includes("refund");
}

export function isNonCheckInText(raw: string): boolean {
  const n = normalizeSheetText(raw);
  if (!n) return false;
  return (
    /\bassessment\b/.test(n) ||
    /\brehab\b/.test(n) ||
    /check\s*package/.test(n)
  );
}

const SPLIT_AMOUNT_REASON =
  "Split amounts are not a single check-in payment. Put extra amounts in Notes.";

export function parseSheetAmount(raw: string): {
  amount: number | null;
  invalid?: string;
} {
  const s = (raw || "").trim();
  if (!s || /^(member|will pay|foc|paid)$/i.test(s)) {
    return { amount: null };
  }
  const withoutParens = s.replace(/\([^)]*\)/g, " ").replace(/%/g, " ");
  if (/\d(?:[\d,]*(?:\.\d+)?)(?:\s*\+\s*|\s+)\d/.test(withoutParens)) {
    return { amount: null, invalid: SPLIT_AMOUNT_REASON };
  }
  if (/\+/.test(s) && /\d/.test(s)) {
    return { amount: null, invalid: SPLIT_AMOUNT_REASON };
  }
  const match = s.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!match) return { amount: null };
  const n = parseFloat(match[0]);
  return Number.isFinite(n) ? { amount: n } : { amount: null };
}

export function isPtLabel(raw: string): boolean {
  const n = normalizeSheetText(raw);
  if (!n) return false;
  return (
    n.includes("personal training") ||
    n.includes("pre/post") ||
    n.includes("pre-post") ||
    n.includes("prenatal") ||
    n.includes("postpartum") ||
    n.includes("online pt") ||
    /(^|\s)pt(\s|$)/.test(n)
  );
}

export function isSpaceLabel(raw: string): boolean {
  const n = normalizeSheetText(raw);
  if (!n) return false;
  return (
    n.includes("space membership") ||
    n.includes("space member") ||
    n.includes("space app") ||
    n.includes("spacer mix") ||
    n.includes("open gym") ||
    n.includes("ultimate mindspacer") ||
    /(^|\s)ums(\s|$)/.test(n)
  );
}

export function looksLikePackagePurchase(raw: string): boolean {
  const n = normalizeSheetText(raw);
  if (!n || isDropInText(n) || isFocText(n)) return false;
  if (/\d/.test(n) && /(ft|st|ums|pt|month|week|class|space|studio)/.test(n)) {
    return true;
  }
  return /(month|week).*(ums|space|ultimate)/.test(n);
}

export function classifySheetRow(input: {
  pane: SheetPane;
  name?: string;
  memberLabel?: string;
  purpose?: string;
  amount?: number | null;
  amountText?: string;
  paymentMethod?: string;
}): SheetIntent {
  const name = (input.name || "").trim();
  if (!name) {
    return { kind: "invalid", reason: "Name is required" };
  }

  const memberLabel = input.memberLabel || "";
  const purpose = input.purpose || "";
  const text = `${memberLabel} ${purpose}`.trim();
  const amountParsed = parseSheetAmount(input.amountText || "");
  if (amountParsed.invalid) {
    return { kind: "invalid", reason: amountParsed.invalid };
  }
  const amount =
    input.amount != null && Number.isFinite(Number(input.amount))
      ? Number(input.amount)
      : amountParsed.amount;
  const hasAmount = amount != null && amount > 0;
  const hasPaidMethod = Boolean(mapPaymentMethod(input.paymentMethod || "").method);
  const paid = hasAmount || hasPaidMethod;

  const nameNorm = normalizeSheetText(name);
  if (isCashOutText(nameNorm) || isCashOutText(text)) {
    return { kind: "cash_out" };
  }

  const isNegativeAmount = amount != null && amount < 0;
  if (isNegativeAmount || isRefundText(nameNorm) || isRefundText(text)) {
    return { kind: "member_refund" };
  }

  if (isWillPayText(text)) {
    return {
      kind: "skip_unmapped",
      reason: "Skipped — will pay / will renew (kept in Notes)",
    };
  }

  if (isInvitationText(text)) {
    return {
      kind: "skip_unmapped",
      reason: "Skipped — invitation is not a gym check-in",
    };
  }

  if (isClinicText(text)) {
    return {
      kind: "skip_unmapped",
      reason: "Skipped — clinic is not a gym check-in",
    };
  }

  if (isNonCheckInText(text)) {
    return {
      kind: "skip_unmapped",
      reason: `Skipped — not a check-in (${memberLabel || purpose})`,
    };
  }

  if (paid && isRetailPurpose(text)) {
    return {
      kind: "invalid",
      reason: "Product sale, not a check-in",
    };
  }

  const dropIn = isDropInText(text);
  const foc = isFocText(memberLabel) || isFocText(purpose);
  const packagePurchase =
    hasAmount &&
    (looksLikePackagePurchase(purpose) || looksLikePackagePurchase(memberLabel));
  const spaceDrop =
    paid &&
    dropIn &&
    (input.pane === "space_pt" || /space|open gym/i.test(text));

  if (paid) {
    if (spaceDrop) return { kind: "space_dropin" };
    if (dropIn && input.pane === "class") return { kind: "class_dropin" };
    if (packagePurchase) {
      return input.pane === "class"
        ? { kind: "class_package_then_attend" }
        : { kind: "package_sale" };
    }
    if (input.pane === "class") return { kind: "class_dropin" };
    return { kind: "space_dropin" };
  }

  if (dropIn) {
    return input.pane === "class"
      ? { kind: "class_dropin" }
      : { kind: "space_dropin" };
  }

  if (foc) {
    if (input.pane === "class") return { kind: "class_foc" };
    return {
      kind: "skip_unmapped",
      reason: "Skipped — FOC on Space/PT is not a gym check-in",
    };
  }

  if (input.pane === "class") {
    if (!memberLabel.trim() && !purpose.trim()) {
      return { kind: "invalid", reason: "Add a membership or payment" };
    }
    return { kind: "class_attend" };
  }

  if (isPtLabel(text)) return { kind: "pt_attend" };
  if (isSpaceLabel(text)) return { kind: "space_attend" };
  if (!memberLabel.trim() && !purpose.trim()) {
    return { kind: "invalid", reason: "Add a membership or payment" };
  }
  return {
    kind: "skip_unmapped",
    reason: `Skipped — unmapped membership (${memberLabel || purpose})`,
  };
}

function paymentMethodHitCount(s: string): number {
  let count = 0;
  if (/\bvisa\b/.test(s)) count += 1;
  if (/\bcash\b/.test(s)) count += 1;
  if (/\binsta/.test(s)) count += 1;
  if (/\bvalu\b/.test(s)) count += 1;
  if (/\bapp\b/.test(s)) count += 1;
  if (s.includes("payment link") || s.includes("link payment") || s === "link") {
    count += 1;
  }
  return count;
}

export function mapPaymentMethod(
  raw: string,
): { method: SheetPaymentMethod | null; flag?: string } {
  const s = normalizeSheetText(raw);
  if (!s) return { method: null, flag: "MISSING_PAYMENT_METHOD" };
  if (/[+]/.test(s) || paymentMethodHitCount(s) > 1) {
    return { method: null, flag: `UNKNOWN_PAYMENT_METHOD:${raw}` };
  }
  if (s.includes("visa")) return { method: "VISA" };
  if (s.includes("cash")) return { method: "CASH" };
  if (s.includes("insta")) return { method: "INSTAPAY" };
  if (
    s.includes("payment link") ||
    s.includes("link payment") ||
    s === "link"
  ) {
    return { method: "PAYMENT_LINK" };
  }
  if (s === "app") return { method: "APP" };
  if (s.includes("valu")) return { method: "VALU" };
  return { method: null, flag: `UNKNOWN_PAYMENT_METHOD:${raw}` };
}

export function displayPaymentMethod(method?: string | null): string {
  if (!method) return "";
  const mapped = mapPaymentMethod(method);
  if (!mapped.method) return method;
  const labels: Record<SheetPaymentMethod, string> = {
    CASH: "Cash",
    VISA: "Visa",
    APP: "App",
    INSTAPAY: "Instapay",
    VALU: "Valu",
    PAYMENT_LINK: "Payment Link",
  };
  return labels[mapped.method];
}

export type SheetPackageCandidate = {
  id: string;
  name: string;
  category: string;
  coachName?: string;
  numberOfSessions?: number;
};

function expandPurposeTokens(raw: string): string[] {
  return expandSheetTokens(raw, "append");
}

export function matchPackageByPurpose(
  purpose: string,
  packages: SheetPackageCandidate[],
): SheetPackageCandidate | null {
  const n = normalizeSheetText(purpose);
  if (!n || packages.length === 0) return null;

  const tokens = expandPurposeTokens(purpose);
  const sessionMatch = n.match(/(\d+)/);
  const sessionCount = sessionMatch ? parseInt(sessionMatch[1], 10) : null;
  const wantsFt = /ft|functional/.test(n);
  const wantsSt = /(^|\s)st(\s|$)|studio/.test(n);
  const wantsUms = /ums|ultimate/.test(n);
  const wantsSpace = /space|open gym/.test(n);
  const wantsPt = isPtLabel(n);
  const coachHint = extractAfterWith(purpose);

  let best: { pkg: SheetPackageCandidate; score: number } | null = null;

  for (const pkg of packages) {
    const name = normalizeSheetText(pkg.name);
    const category = (pkg.category || "").toUpperCase();
    let score = 0;

    for (const tok of tokens) {
      if (tok.length < 2) continue;
      if (name.includes(tok)) score += tok.length > 3 ? 2 : 1;
    }

    if (sessionCount && pkg.numberOfSessions === sessionCount) score += 3;

    if (wantsFt && category === "FUNCTIONAL_TRAINING") score += 4;
    if (wantsSt && category === "STUDIO") score += 4;
    if (wantsUms && category === "ULTIMATE_MINDSPACER") score += 4;
    if (wantsSpace && (category === "SPACE_MEMBERSHIP" || category === "OPEN_GYM")) {
      score += 4;
    }
    if (wantsPt && category === "PERSONAL_TRAINING") score += 4;
    if (wantsPt && /pre\/post|prenatal|postpartum/.test(n) && category === "PRE_POST_NATAL") {
      score += 4;
    }

    if (pkg.coachName && coachHint) {
      const coach = normalizeSheetText(pkg.coachName);
      const hint = normalizeSheetText(coachHint);
      if (coach && hint && (coach.includes(hint) || hint.includes(coach))) {
        score += 5;
      }
    }

    if (!best || score > best.score) {
      best = { pkg, score };
    }
  }

  if (!best || best.score < 3) return null;
  return best.pkg;
}

export const CLASS_MEMBER_LABELS = [
  "Ft App member",
  "UMS App member",
  "ST App member",
  "Spacer mix member",
  "Pre/Post App member",
  "Class Credit",
  "FOC",
];

export const SPACE_MEMBER_LABELS = [
  "Space membership",
  "Space App Member",
  "UMS App member",
  "UMS",
  "Spacer Mix App Member",
  "FOC",
];

export const CLASS_PURPOSE_LABELS = ["Drop in"];
export const SPACE_PURPOSE_LABELS = ["Drop in Space", "Drop in"];
