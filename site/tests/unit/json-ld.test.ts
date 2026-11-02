import { describe, expect, it } from 'vitest';
import { serializeJsonLd } from '../../src/lib/json-ld';
describe('JSON-LD script boundary', () => {
  it('keeps an injected closing script tag inside JSON data', () => {
    const data = { title: '</ScRiPt><script>alert(1)</script>', text: 'Русский & <текст>\u2028\u2029' };
    const output = serializeJsonLd(data);
    expect(output).not.toMatch(/[<>&\u2028\u2029]/u);
    expect(JSON.parse(output)).toEqual(data);
  });
});
