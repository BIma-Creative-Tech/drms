/**
 * Five pulsing dots — the admin loader glyph.
 *
 * Adapted from Uiverse.io "thin-lionfish-5" by adamgiebl
 * (https://github.com/uiverse-io/galaxy/blob/main/loaders/adamgiebl_thin-lionfish-5.html),
 * MIT License, Copyright (c) 2023 Uiverse.io — full notice in ./_loading-dots.scss (where the
 * derived CSS lives) and in ADR 0014 §"Loader". Changes: BEM class names, brand colour tokens
 * (light/dark) instead of fixed hex, even delays for dots 4–5, reduced-motion variant.
 *
 * Purely decorative (aria-hidden); the announcement is the role="status" text in LoadingProvider.
 */
export function LoadingDots() {
  return (
    <span className="pk-dots" aria-hidden="true">
      <span className="pk-dots__dot" />
      <span className="pk-dots__dot" />
      <span className="pk-dots__dot" />
      <span className="pk-dots__dot" />
      <span className="pk-dots__dot" />
    </span>
  )
}
