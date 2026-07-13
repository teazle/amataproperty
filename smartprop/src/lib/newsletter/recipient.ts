export function normalizeSingaporeRecipient(value: string): string | null {
  const phone = value.trim().replace(/@c\.us$/i, '').trim();
  if (!/^[+\d\s()-]+$/.test(phone)) return null;

  const plusCount = phone.match(/\+/g)?.length || 0;
  if (plusCount > 1 || (plusCount === 1 && !phone.startsWith('+'))) return null;

  let parenthesisDepth = 0;
  for (const character of phone) {
    if (character === '(') parenthesisDepth += 1;
    if (character === ')') parenthesisDepth -= 1;
    if (parenthesisDepth < 0 || parenthesisDepth > 1) return null;
  }
  if (parenthesisDepth !== 0) return null;

  const compact = phone.replace(/[\s()-]/g, '');
  const match = compact.match(/^(?:\+?65)?([89]\d{7})$/);

  return match ? `+65${match[1]}` : null;
}
