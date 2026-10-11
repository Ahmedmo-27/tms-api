export function resolvePtPaymentPurposeLabel(payment: {
  purpose?: string;
  note?: string;
}): string | null {
  const note = payment.note?.trim();
  if (!note) return null;

  const ptWithCoachMatch = note.match(
    /^(?:Personal training (?:guest )?drop-?in with|PT drop-?in with|PT with)\s+([^;]+)/i
  );
  if (ptWithCoachMatch) {
    const coachName = ptWithCoachMatch[1].trim();
    return `PT dropin with ${coachName}`;
  }

  if (
    payment.purpose === "DROPIN" &&
    /^(?:Personal training (?:guest )?drop-?in|PT drop-?in)/i.test(note)
  ) {
    return "PT dropin";
  }

  return null;
}
