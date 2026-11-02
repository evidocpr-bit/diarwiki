import { describe, expect, it } from 'vitest';
import { decodeEntities, visibleWordCount } from '../../scripts/html-text.mjs';
describe('offline HTML inspection', () => {
  it('decodes a single layer without turning encoded data into markup', () => {
    expect(decodeEntities('&amp;lt;script&amp;gt;')).toBe('&lt;script&gt;');
    expect(decodeEntities('a&amp;b&lt;c&gt;&quot;&apos;&#39;')).toBe('a&b<c>"\'\'');
  });
  it('counts visible text with a parser and excludes active-element contents', () => {
    expect(visibleWordCount('<p>Один два</p><script >hidden hidden</script ><style>hidden</style><p>Три</p>')).toBe(3);
  });
});
