export function normalizeSingaporeRecipient(value: string): string | null {
  const digits = value.replace(/@c\.us$/i, '').replace(/\D/g, '');
  const local = digits.startsWith('65') ? digits.slice(2) : digits;

  if (!/^[89]\d{7}$/.test(local)) return null;
  return `+65${local}`;
}
