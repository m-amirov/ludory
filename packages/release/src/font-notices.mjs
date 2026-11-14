// The only author-supplied text files admitted to platform archives are the
// notices paired with the two fonts that Ludory's narrative export renames.
// This is an allowlist, not a general .txt export extension.
export const FONT_NOTICE_PAIRS = Object.freeze([
  Object.freeze({
    font: 'assets/fonts/CormorantGaramond-wght.ttf',
    notice: 'assets/fonts/OFL-CormorantGaramond.txt',
  }),
  Object.freeze({
    font: 'assets/fonts/Manrope-wght.ttf',
    notice: 'assets/fonts/OFL-Manrope.txt',
  }),
]);

export const FONT_NOTICE_NAMES = new Set(FONT_NOTICE_PAIRS.map(pair => pair.notice));

export const SOURCE_FONT_NOTICE_PAIRS = Object.freeze([
  Object.freeze({
    font: 'assets/fonts/CormorantGaramond[wght].ttf',
    notice: 'assets/fonts/OFL-CormorantGaramond.txt',
  }),
  Object.freeze({
    font: 'assets/fonts/Manrope[wght].ttf',
    notice: 'assets/fonts/OFL-Manrope.txt',
  }),
]);

/**
 * Check only the mechanical relationship between a redistributed font and
 * its notice. This does not attest ownership or grant a legal rights PASS.
 */
export function validateFontNoticePairing(names, label = 'candidate') {
  const present = new Set(names);
  const errors = [];
  for (const { font, notice } of FONT_NOTICE_PAIRS) {
    if (present.has(font) !== present.has(notice)) {
      errors.push(`${font} <-> ${notice}`);
    }
  }
  for (const notice of FONT_NOTICE_NAMES) {
    if (present.has(notice) && !FONT_NOTICE_PAIRS.some(pair => pair.notice === notice && present.has(pair.font))) {
      errors.push(`unpaired notice ${notice}`);
    }
  }
  if (errors.length) throw new Error(`F6E_FONT_NOTICE_PAIRING_${label}: ${errors.join('; ')}`);
  return true;
}

/** Same pairing check for the source-side names before export renaming. */
export function validateSourceFontNoticePairing(names, label = 'source') {
  const present = new Set(names);
  const errors = [];
  for (const { font, notice } of SOURCE_FONT_NOTICE_PAIRS) {
    if (present.has(font) !== present.has(notice)) {
      errors.push(`${font} <-> ${notice}`);
    }
  }
  if (errors.length) throw new Error(`F6E_FONT_NOTICE_PAIRING_${label}: ${errors.join('; ')}`);
  return true;
}
