/**
 * Central runtime configuration loaded from environment variables.
 * All access to env vars should go through this module to make missing-var bugs obvious.
 */

const ROOT_ADMIN_EMAIL_RAW = process.env["ROOT_ADMIN_EMAIL"];
if (!ROOT_ADMIN_EMAIL_RAW) {
  console.warn("WARNING: ROOT_ADMIN_EMAIL is not set. The root super-admin bypass will be disabled.");
}

/** The email address that always gets super_admin role and bypasses the allowed_emails gate. */
export const ROOT_ADMIN_EMAIL = ROOT_ADMIN_EMAIL_RAW?.toLowerCase() ?? "";
