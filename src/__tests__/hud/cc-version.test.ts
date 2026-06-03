/**
 * Tests for the Claude Code version HUD element.
 */

import { describe, it, expect } from 'vitest';
import { renderCcVersion } from '../../hud/elements/cc-version.js';

describe('renderCcVersion', () => {
  it('returns null for null/undefined/blank', () => {
    expect(renderCcVersion(null)).toBeNull();
    expect(renderCcVersion(undefined)).toBeNull();
    expect(renderCcVersion('')).toBeNull();
    expect(renderCcVersion('   ')).toBeNull();
  });

  it('renders the version with a leading "v" marker', () => {
    const out = renderCcVersion('2.1.161')!;
    expect(out).toContain('v2.1.161');
  });

  it('does not double the "v" when the value already starts with one', () => {
    const out = renderCcVersion('v2.1.161')!;
    expect(out).toContain('v2.1.161');
    expect(out).not.toContain('vv2.1.161');
  });

  it('trims surrounding whitespace from the version', () => {
    const out = renderCcVersion('  2.1.161  ')!;
    expect(out).toContain('v2.1.161');
    expect(out).not.toContain('  2.1.161  ');
  });
});
