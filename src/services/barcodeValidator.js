/**
 * Barcode type detection and validation.
 * Returns a BarcodeResult with type, isValid flag, and optional warning.
 *
 * All regexes are compiled once at module load — not per-scan — for performance.
 * With 30 stations × 1 scan / 2 seconds = 15 validations/second, this matters.
 */

// USPS Intelligent Mail Barcode (IMpb) — starts with service type indicator
const RE_USPS_IMB_22 = /^(420\d{5})?(9[12345]\d{20})$/;
// USPS 20-digit (older format)
const RE_USPS_20 = /^\d{20}$/;
// USPS 22-digit
const RE_USPS_22 = /^\d{22}$/;
// USPS 30-digit (full IMpb with ZIP+4)
const RE_USPS_30 = /^\d{30}$/;

// UPS — always starts with 1Z
const RE_UPS = /^1Z[A-Z0-9]{16}$/i;

// FedEx — 12 or 15 or 20 digit numeric
// Note: FedEx 20-digit overlaps with USPS 20-digit.
// Disambiguation: USPS 20-digit starts with 94, 92, 93, 95; FedEx starts with other prefixes.
const RE_FEDEX_12 = /^\d{12}$/;
const RE_FEDEX_15 = /^\d{15}$/;

const USPS_20_PREFIXES = new Set(['94', '92', '93', '95', '91', '96']);

// TikTok Shop order numbers — format TBD; using configurable pattern
// These can be overridden via CONFIG tab in production
const RE_TIKTOK = /^(TT|TO|TK)\d{10,18}$/i;

// WhatNot order numbers
const RE_WHATNOT = /^WN\d{8,16}$/i;

/**
 * @param {string} raw - The raw barcode string from the scanner
 * @returns {{ type: string, isUSPS: boolean, warning: string|null }}
 */
export function detectBarcodeType(raw) {
  if (!raw || typeof raw !== 'string') {
    return { type: 'INVALID', isUSPS: false, warning: 'Empty or invalid barcode' };
  }

  const b = raw.trim();

  // UPS — most specific, check first
  if (RE_UPS.test(b)) {
    return { type: 'UPS', isUSPS: false, warning: null };
  }

  // TikTok
  if (RE_TIKTOK.test(b)) {
    return { type: 'TIKTOK_ORDER', isUSPS: false, warning: null };
  }

  // WhatNot
  if (RE_WHATNOT.test(b)) {
    return { type: 'WHATNOT_ORDER', isUSPS: false, warning: null };
  }

  // USPS IMpb (22-digit core, optionally prefixed with 5-digit ZIP)
  if (RE_USPS_IMB_22.test(b)) {
    return { type: 'USPS_IMB', isUSPS: true, warning: null };
  }

  // USPS 30-digit
  if (RE_USPS_30.test(b)) {
    return { type: 'USPS_30', isUSPS: true, warning: null };
  }

  // USPS 22-digit
  if (RE_USPS_22.test(b)) {
    return { type: 'USPS_22', isUSPS: true, warning: null };
  }

  // USPS 20-digit vs FedEx 20-digit disambiguation
  if (RE_USPS_20.test(b)) {
    const prefix = b.slice(0, 2);
    if (USPS_20_PREFIXES.has(prefix)) {
      return { type: 'USPS_20', isUSPS: true, warning: null };
    }
    // Likely FedEx — flag as unknown rather than misclassify
    return {
      type: 'FEDEX_OR_UNKNOWN',
      isUSPS: false,
      warning: 'Could be FedEx or USPS — verify manually',
    };
  }

  // FedEx 15-digit
  if (RE_FEDEX_15.test(b)) {
    return { type: 'FEDEX_15', isUSPS: false, warning: null };
  }

  // FedEx 12-digit
  if (RE_FEDEX_12.test(b)) {
    return { type: 'FEDEX_12', isUSPS: false, warning: null };
  }

  return {
    type: 'UNKNOWN',
    isUSPS: false,
    warning: 'Barcode format not recognized — logged as UNKNOWN',
  };
}

/**
 * Quick check: is this barcode plausibly valid (not garbage from a mis-scan)?
 * Minimum 8 characters, no control characters.
 */
export function isScanPlausible(raw) {
  if (!raw || typeof raw !== 'string') return false;
  const b = raw.trim();
  return b.length >= 8 && /^[\x20-\x7E]+$/.test(b);
}
