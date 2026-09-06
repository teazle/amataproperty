export type ArticleContentValidationResult =
  | { valid: true }
  | { valid: false; reason: 'challenge' | 'empty' | 'not_article' };

type ArticleContentForValidation = {
  title: string;
  text: string;
  html: string;
};

function normalized(value: string) {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

export function validateArticleContent({
  title,
  text,
  html,
}: ArticleContentForValidation): ArticleContentValidationResult {
  const normalizedText = normalized(text);
  const normalizedHtml = normalized(html);

  if (!normalizedText && !normalizedHtml.replace(/<[^>]*>/g, '').trim()) {
    return { valid: false, reason: 'empty' };
  }

  const page = `${normalized(title)} ${normalizedText} ${normalizedHtml}`;
  const hasVerificationHeading = page.includes('performing security verification');
  const hasVerificationInstruction =
    page.includes('enable javascript and cookies to continue') ||
    page.includes('waiting for www.edgeprop.sg to respond') ||
    page.includes('verifies you are not a bot');

  if (hasVerificationHeading && hasVerificationInstruction) {
    return { valid: false, reason: 'challenge' };
  }

  const pageShellOnly = normalizedText === 'page not found' || normalizedText === 'access denied';
  if (pageShellOnly) {
    return { valid: false, reason: 'not_article' };
  }

  return { valid: true };
}
