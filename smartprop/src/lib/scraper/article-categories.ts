/** Preserve the JSON array shape expected by article discovery and category filters. */
export function normalizeArticleCategories(category: string | string[]): string[] {
  const values = (Array.isArray(category) ? category : [category])
    .map(value => String(value || '').trim())
    .filter(value => value && !['tags', 'property news'].includes(value.toLowerCase()) && !value.toLowerCase().startsWith('tags:'))
    .map(value => value.slice(0, 200));
  const categories = [...new Set(values)];
  return categories.length ? categories : ['News'];
}
