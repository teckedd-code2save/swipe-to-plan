# Unstressed: modern brand direction

Status: a proposed direction and reusable local assets. Not deployed. The preview is a visual concept, not a screenshot of a working build.

## Recommendation

Keep the current name, lowercase wordmark, warm paper, forest green and celery. Make the experience sharper through a single modern type family and a recognizable custom mark. Keep the product an outing companion, not a wellness or meditation brand.

- Use Manrope for headings and interface text. The web already bundles it, so this is an evolution rather than an unrelated reset.
- Replace the generic sun/leaf combination with the open U and detached sun dot. The bowl suggests a relaxed smile; the open space keeps it light. Use the same mark in the header, assistant avatar, launcher and splash.
- Keep the short existing line “Good days. Less planning.” and the native hero “Less figuring out. More heading out.” Avoid adding AI claims or new product promises.
- Use real venue photography in results when available. Keep decoration out of dense comparison, evidence and route screens.

## Current audit

Inspected local source at native commit 11da7d0 in teckedd-code2save/swipe-to-plan, plus the existing web UI source and an existing desktop QA capture. No live app claim is implied by this source audit.

- `frontend/src/main.jsx` imports bundled Manrope and Fraunces.
- `frontend/src/product-design.css` makes Fraunces the display/brand face. Several important controls and metadata use 10–12 px text. The new direction should reduce that small-type density, not merely change a font.
- `frontend/src/ChatStudio.jsx` uses the wordmark “unstressed.”, the sun and “Less planning. More living.”
- `frontend/src/PlannerIcons.jsx` defines a 12-ray sun.
- `mobile/App.tsx` uses system sans plus Georgia on iOS / generic serif on Android. Its header has a leaf and its welcome screen a stock sun. Its existing warm palette is close to the proposed one but is separately defined.
- `mobile/app.json` currently has no app icon, adaptive icon or splash branding entries.
- `docs/PRODUCT-EXPERIENCE.md` describes the intended companion, existing bundled fonts and evidence boundaries.

## Type system

One family, four explicit weights. Bundle fonts in the app; no remote font dependency.

| Token | Size / line | Weight | Use |
|---|---:|---:|---|
| Hero | 36 / 42 | 500 | Empty/welcome screen |
| Screen | 28 / 34 | 600 | Plan or sheet title |
| Section | 22 / 28 | 600 | Venue and group heading |
| Body | 16 / 24 | 400 | Reading and chat |
| Control | 15 / 20 | 600 | Buttons and tabs |
| Label | 14 / 20 | 500 | Fields and facts |
| Caption | 13 / 18 | 400 | Secondary context |

Use roughly -0.025em tracking for large display text, normal tracking for body and controls. Prefer sentence case. Reserve all caps for a very short decorative eyebrow, never important evidence. Use tabular numerals for prices and times. Preserve native text scaling and do not shrink important text to force fit.

## Color system

| Token | Hex | Use |
|---|---|---|
| Paper | #F7F5EF | Main canvas |
| Surface | #FFFDF8 | Cards and inputs |
| Ink | #183B35 | Text, primary buttons |
| Muted | #5F6F66 | Secondary readable text |
| Line | #DDE3D8 | Decorative dividers |
| Celery | #DCEABD | Selected fill, reversed mark |
| Accent | #B6D382 | Sparing emphasis |
| Error | #9B392F | Errors, with icon/text |

Calculated WCAG ratios: ink on paper 11.23:1; muted on paper 4.87:1; ink on celery 9.64:1; surface on ink 12.04:1. Do not use pale green as small text on paper. Thin line color is decorative and insufficient by itself to identify interactive boundaries or focus. Give controls clear text/icon labels and a strong ink outline for focus. Do not rely on color alone for state.

## Shape and motion

- Spacing: 4, 8, 12, 16, 24, 32.
- Minimum touch target: 44 × 44 pt on iOS; 48 × 48 dp on Android.
- Corner radii: 12 for controls, 20 for cards, 28 for sheets. Pills for short tags only.
- One stroke icon family, 20–24 px, roughly 1.75–2 px stroke.
- Small 160–220 ms state transitions. Respect reduced motion; no pulsing brand mark in ordinary idle states.

## Asset notes

- `assets/unstressed-mark.svg`: single-color vector, 64-unit grid.
- `assets/unstressed-wordmark.svg`: outlined wordmark; no font loading needed. Keep text labels accessible in components.
- `assets/unstressed-app-icon.png`: opaque 1024 × 1024 forest square; platform supplies clipping. Do not add baked-in rounded corners.
- `assets/unstressed-adaptive-foreground.png`: transparent 1024 × 1024 with central mark. Use forest as adaptive icon background; verify all launcher masks.
- PNG versions are rendering conveniences. SVG is canonical.
- The `Manrope-*.ttf` files in this concept folder are static Latin-subset instances solely used to render the concept. For app integration use the official full Manrope package plus its OFL license. Test ₵, GH₵, apostrophes, long venue names, diacritics and user languages; the board uses a fallback font for characters absent from the subset.
- Clear space: at least 12 units around the 64-unit mark. Minimum recommended UI display: 24 px. At 16 px use the standalone mark only and verify its dot remains distinct.

## Integration and checks

1. Add shared brand tokens and assets. Keep planning logic and provider evidence untouched.
2. Bundle the typeface, implement a reusable BrandMark, and use it consistently across native header, empty state and app metadata.
3. Apply typography by role rather than an uncontrolled global font replacement.
4. Bring the web header and headings into the same system in a separate scoped change, including the legacy room view.
5. Check 320 px width, iOS/Android large text, keyboard-open composer, long location and venue names, long money values, screen-reader naming and reduced motion. Verify actual iOS and Android builds, not only web export.
6. Run repository checks and compare rendered screens before any release.

The design direction is not a trademark clearance or claim of logo uniqueness. No publication or deployment was performed.
