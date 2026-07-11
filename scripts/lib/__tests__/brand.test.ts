import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveBrand, DEFAULT_BRAND } from '../../../src/brand';
import { BRAND } from '../../../src/config';

test('resolveBrand: no props returns EternalFrame defaults', () => {
  assert.equal(resolveBrand(), DEFAULT_BRAND);
  assert.equal(resolveBrand().name, 'EternalFrame');
});

test('resolveBrand: partial colors merge over defaults', () => {
  const b = resolveBrand({ colors: { coral: '#57ACE0' }, name: 'NK Nails & Spa' });
  assert.equal(b.colors.coral, '#57ACE0');
  assert.equal(b.colors.teal, BRAND.teal); // untouched keys keep defaults
  assert.equal(b.name, 'NK Nails & Spa');
  assert.equal(b.afterLabel, 'Restored ✦'); // unset fields keep defaults
});

test('resolveBrand: empty logoSrc hides logo, cta overrides badge', () => {
  const b = resolveBrand({ logoSrc: '', cta: '📞 (206) 937-0755' });
  assert.equal(b.logoSrc, '');
  assert.equal(b.cta, '📞 (206) 937-0755');
});
