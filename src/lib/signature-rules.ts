/**
 * The words and limits of a proposal signature, shared by the signing page,
 * the server action, the certificate and the PDF. Dependency-free and safe to
 * import from the browser.
 */

/** Who the client signs with: on the snapshot, the certificate and the PDF. */
export const AGENCY_NAME = "Avix Digital";

/**
 * The consent the signer ticks. Stored with every signature together with
 * this version, so a signature always names the exact wording it was given.
 * Change the wording → bump the version; the page and the server compare
 * versions, so a page loaded before the change can't sign under the new text.
 */
export const SIGNATURE_CONSENT_VERSION = "esign-consent-2026-11";

export function signatureConsentText(company: string | null | undefined): string {
  const onBehalf = company?.trim()
    ? `I have authority to sign on behalf of ${company.trim()}.`
    : "I have authority to sign this agreement.";
  return `I agree to sign electronically. My electronic signature is legally binding, the same as a handwritten one, and ${onBehalf}`;
}

/**
 * What an admin-recorded acceptance stores in place of the client's consent:
 * the agency's own statement of what happened, which is all it can honestly
 * claim. The certificate shows it word for word.
 */
export const ADMIN_RECORD_VERSION = "admin-record-2026-11";

export function adminRecordText(signerName: string): string {
  return `Recorded by ${AGENCY_NAME} on behalf of ${signerName.trim()}, who agreed to this proposal outside the online signing page (by email, call or chat).`;
}

/** The typed signature's script font, on the page and in the PDF. */
export const SIGNATURE_FONT = "Dancing Script";

/** A drawn signature is a trimmed PNG of at most this many bytes… */
export const SIGNATURE_PNG_MAX_BYTES = 150 * 1024;
/** …which as a data URL is at most this long; the action's input is capped at it. */
export const SIGNATURE_DATA_URL_MAX =
  "data:image/png;base64,".length + Math.ceil(SIGNATURE_PNG_MAX_BYTES / 3) * 4;
/** …and at most this big; the pad scales its export to fit. */
export const SIGNATURE_MAX_WIDTH = 1200;
export const SIGNATURE_MAX_HEIGHT = 400;
/** Smaller than this is a dot or a slip, not a signature. */
export const SIGNATURE_MIN_LONG_SIDE = 40;
export const SIGNATURE_MIN_SHORT_SIDE = 8;

/** "3f2a9c1e7b04…5d81ab" — enough to compare by eye; the full hash is a copy away. */
export function shortHash(hash: string): string {
  return hash.length > 20 ? `${hash.slice(0, 12)}…${hash.slice(-6)}` : hash;
}

function versionOf(ua: string, marker: RegExp): string | null {
  const match = marker.exec(ua);
  return match ? match[1].split(".")[0] : null;
}

/**
 * "Chrome 130 on macOS" from a user-agent string, for the certificate. The
 * full string is stored; this is only how it is read out. Order matters:
 * Edge, Opera and Samsung all claim to be Chrome, and Chrome claims Safari.
 */
export function browserSummary(userAgent: string | null | undefined): string | null {
  if (!userAgent) return null;
  const ua = userAgent;

  const browsers: [string, RegExp][] = [
    ["Edge", /Edg(?:e|A|iOS)?\/([\d.]+)/],
    ["Opera", /(?:OPR|OPT)\/([\d.]+)/],
    ["Samsung Internet", /SamsungBrowser\/([\d.]+)/],
    ["Firefox", /(?:Firefox|FxiOS)\/([\d.]+)/],
    ["Chrome", /(?:Chrome|CriOS)\/([\d.]+)/],
    ["Safari", /Version\/([\d.]+).*Safari\//],
  ];
  let browser: string | null = null;
  for (const [name, marker] of browsers) {
    const version = versionOf(ua, marker);
    if (version) {
      browser = `${name} ${version}`;
      break;
    }
  }

  const os = /iPhone|iPad|iPod/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /CrOS/.test(ua)
        ? "ChromeOS"
        : /Windows/.test(ua)
          ? "Windows"
          : /Mac OS X|Macintosh/.test(ua)
            ? "macOS"
            : /Linux/.test(ua)
              ? "Linux"
              : null;

  if (browser && os) return `${browser} on ${os}`;
  return browser ?? (os ? `A browser on ${os}` : "Unknown browser");
}
