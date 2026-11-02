import sanitizeHtml from 'sanitize-html';
const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };
// Decode exactly one layer. Chained replacements can decode attacker input twice.
export function decodeEntities(value = '') {
  return value.replace(/&(amp|lt|gt|quot|apos|#39);/gu, (_, name) => entities[name]);
}
export function visibleWordCount(html) {
  const chunks = [];
  sanitizeHtml(html, {
    allowedTags: [], allowedAttributes: {},
    nonTextTags: ['script', 'style', 'textarea', 'option'],
    textFilter(text) { chunks.push(decodeEntities(text)); return ''; },
  });
  return chunks.join(' ').trim().split(/\s+/u).filter(Boolean).length;
}
