# Market Royale art slice

This directory contains the first original arena art-direction proof generated with the built-in image generator.

Use the `@1x.webp` files for compact UI placements up to 256 CSS pixels and `@2x.webp` files for larger or high-density placements up to 512 CSS pixels. Keep the PNG files as transparent sources. Use `object-fit: contain`; do not crop character hands, feet, weapon tips, timer controls, or the prize tray.

The `market-royale-thank-you` banner uses the same cyan sky gradient as the website and is intentionally opaque. Its 768 px and 1536 px WebP variants support full-width celebration and presentation layouts.

The ready set is listed in `assets-manifest.json`. Files under `brand/` and `source-sheets/` are drafts and should not be shipped unless their manifest status changes.

The crown host and Nova are original Market Royale character concepts. They should remain separate from borrowed Figma Community packs so the product identity and later cosmetic system can evolve consistently.
