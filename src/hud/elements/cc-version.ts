/**
 * OMC HUD - Claude Code Version Element
 *
 * Renders the Claude Code version running this session (e.g. "v2.1.161").
 * The value comes straight from the statusline stdin `version` field that
 * Claude Code provides per render — no extra process spawn or file read.
 *
 * Rendered dim so it reads as low-weight session metadata, and prefixed with
 * a "v" marker so a bare version number is not confused with the OMC version
 * shown in the leading `OhMy:` label.
 */

import { dim } from '../colors.js';

/**
 * Render the Claude Code version badge.
 *
 * @param version - Version string from statusline stdin; null/undefined/blank hides the badge.
 * @returns Formatted `v<version>` badge, or null when there is no value.
 */
export function renderCcVersion(version: string | null | undefined): string | null {
  if (!version) return null;
  const value = version.trim();
  if (!value) return null;
  // Avoid a double "v" when the upstream value already carries one.
  const label = value.startsWith('v') ? value : `v${value}`;
  return dim(label);
}
