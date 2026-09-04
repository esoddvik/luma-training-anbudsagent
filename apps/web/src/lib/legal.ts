/**
 * Legal link resolution.
 *
 * Spec section 18: the privacy policy URL is configured in
 * `LUMA_PRIVACY_POLICY_URL` and must not be hardcoded in several components.
 * Everything that needs the link reads it from here.
 */

const FALLBACK_PRIVACY_POLICY_URL = 'https://luma-training.com/personvern';

/**
 * Luma Training's privacy policy. Falls back to the public URL when the
 * environment variable is not set, so a preview build never renders a dead
 * link — section 51 point 1 makes the configured value a launch blocker.
 */
export function privacyPolicyUrl(): string {
  const configured = process.env['LUMA_PRIVACY_POLICY_URL'];
  return configured !== undefined && configured.length > 0
    ? configured
    : FALLBACK_PRIVACY_POLICY_URL;
}

// `TERMS_VERSION` used to live here. It is gone deliberately: the version is a
// property of the document, and the document is `@luma/content`'s
// `LEGAL_DOCUMENT_SEEDS`. A constant here was a second answer to "which
// version is in force", and it disagreed with `legal_document_versions`
// without anything noticing.
