# Droplet site-wide update — 25 November 2026

The update covers all 49 HTML pages, including all 42 tools. The existing homepage is the visual reference. Every remaining page now uses the same navigation, blue/slate palette, typography, theme control, focus styles and footer where the workspace permits it. Tool workflows remain specific to their purpose.

All AdSense loaders, advertising slots, publisher tags, initialisation calls and commented-out snippets were removed. `ads.txt` no longer authorises an advertising network. Privacy and Terms now describe the advertising-free implementation.

## Shared improvements

- Clear tool introductions, file limits, local/online processing information, consistent cards and controls, related tools and expandable help on standard tool pages.
- Full-screen editors/scanner/crop/watermark tools use the shared header and matching controls; the PDF editor has its own workspace panels and mobile drawers.
- Mutable engines and styles use network-first service-worker delivery with versioned build URLs; immutable vendor files retain cache-first delivery. Cache version is v11.
- Added local Unicode PDF font support and the relevant font/fontkit notices.
- Generated HTML/Office/EPUB PDFs use isolated document rendering with a white background and safer pagination. Native page operations preserve source PDF text, dimensions and rotation.

## Page-by-page changes and verification

Every row also received the applicable shared design and advertising cleanup described above. A row stating that a workflow was verified does not imply its conversion engine needed replacement.

| Page | Changes | Verification |
|---|---|---|
| [About Droplet](https://dropletweb.xyz/about) | Aligned navigation, typography, cards, spacing and footer with the homepage. | Content, links, heading structure and responsive layout. |
| [Add page numbers](https://dropletweb.xyz/add-page-numbers) | Matched the shared layout and controls; removed advertising code. | Numbered all four mixed-size pages; reopened the PDF and verified numbering, including the intentionally blank last page. |
| [Add watermark](https://dropletweb.xyz/add-watermark) | Unified the studio, header and dark-mode controls; added the local Unicode export font. | Exported a four-page PDF with a watermark and retained the original document text. |
| [AI Summarizer](https://dropletweb.xyz/ai-summarizer) | Unified the tool layout and collapsed long explanations; kept PDF/TXT import and clear local-summary limits. | Imported a real PDF, generated an extractive summary and reopened the downloaded text. |
| [AVIF to PNG](https://dropletweb.xyz/avif-to-png) | Matched the upload, settings, results and related-tool layout; removed advertising code. | Converted an AVIF sample and reopened the 320 × 180 PNG. |
| [Contact Droplet](https://dropletweb.xyz/contact) | Aligned the help/contact layout, navigation and controls with the homepage. | Contact links and responsive layout; no test message was sent. |
| [Crop PDF](https://dropletweb.xyz/crop-pdf) | Unified the full-screen studio, fixed header positioning and improved dark-mode controls. | Cropped the first page of a four-page PDF; reopened and rendered the output. |
| [CSV to JSON](https://dropletweb.xyz/csv-to-json) | Matched the data-input/results layout, colours and shared navigation. | Converted quoted CSV values and checked the downloaded JSON and numeric values. |
| [Edit PDF](https://dropletweb.xyz/edit-pdf) | Rebuilt the workspace with a tool rail, pages panel, properties/layers tabs and mobile drawers; added page/layer ordering, duplication, direct resizing, fit and PNG export. Preserved original PDF rendering until explicit text reconstruction; repaired undo/redo, zoom coordinates, rotation/crop export placement, Unicode text, native form fields and original-text DOCX/XLSX exports. Added arrowheads to PDF shape exports and accurate export/help limits. | Tested import, text annotation, resize, layer duplicate/undo/redo, rotated/cropped source PDFs, another page rotation, native PDF/PNG output, Unicode text, a real checkbox field, and DOCX/XLSX export of untouched source text. Inspected desktop and mobile layouts. |
| [EPS to SVG](https://dropletweb.xyz/eps-to-svg) | Unified the upload/result layout and retained explicit limits for the supported EPS subset. | Converted a simple supported EPS and checked the resulting SVG; complex PostScript is not covered. |
| [EPUB to PDF](https://dropletweb.xyz/epub-to-pdf) | Replaced the failing page/image export path with the shared document renderer; separated cover and chapter pages. | Converted a sample EPUB to a readable two-page PDF and inspected the output. |
| [Excel to PDF](https://dropletweb.xyz/excel-to-pdf) | Repaired blank/black rendering; added readable sheet titles and tables, all selected sheets and a visible row-limit error instead of silent truncation. | Converted a workbook with two sheets into a readable two-page PDF and inspected the tables. |
| [Extract pages](https://dropletweb.xyz/extract-pages) | Preserved user selection order in both range text and native page export. | Extracted pages 3,1 and verified that exact order and the original page dimensions. |
| [Questions & answers](https://dropletweb.xyz/faq) | Unified question cards, navigation, colours and footer. | Question disclosures, links and responsive layout. |
| [GIF to PNG](https://dropletweb.xyz/gif-to-png) | Unified the upload, frame controls, results and help layout. | Exported a two-frame GIF as a ZIP containing two valid PNG files. |
| [HEIC to JPG](https://dropletweb.xyz/heic-to-jpg) | Unified settings and results; removed active and commented advertising code. | Converted HEIC to a readable 320 × 180 JPEG; reviewed single and batch filenames. |
| [HTML to PDF](https://dropletweb.xyz/html-to-pdf) | Replaced the broken screenshot path with isolated white-background document rendering, sanitisation and line-aware pagination. | Converted short HTML and a 30-section document; checked the five-page long output and its final page. |
| [Homepage](https://dropletweb.xyz/) | Kept the homepage as the design reference; removed advertising remnants and improved asset refresh behaviour. | Homepage navigation, theme and upload-routing maps; mobile and desktop layout. |
| [JPG to PDF](https://dropletweb.xyz/jpg-to-pdf) | Replaced HTML fallbacks with native image embedding; combined output is the default, separate output remains available. Fixed transparency turning black, fit-to-image dimensions, quality/grayscale handling and visible per-file errors. | Converted three images including a transparent PNG; reopened the combined PDF and checked white backgrounds and page count. |
| [JSON to CSV](https://dropletweb.xyz/json-to-csv) | Unified data input, conversion controls and download layout. | Converted JSON and checked CSV quoting, including a comma inside a value. |
| [Merge PDF](https://dropletweb.xyz/merge-pdf) | Disabled export while imports are pending; retained native pages, text and dimensions. | Merged two four-page PDFs into eight pages and checked order, content and mixed page sizes. |
| [You are offline](https://dropletweb.xyz/offline) | Matched the offline screen, recovery links and theme to the homepage. | Offline-page rendering and recovery links; service-worker source and cache-version checks. |
| [Organize PDF](https://dropletweb.xyz/organize-pdf) | Unified page cards, controls, navigation and results. | Reversed a four-page PDF and verified the exported order, including the intentional blank page. |
| [PDF Forms](https://dropletweb.xyz/pdf-forms) | Replaced raster form overlays with native AcroForm fields; added editable/flattened output, Unicode values and corrected placement on scaled/rotated pages. Removed dangling annotation references after flattening and aligned the help with actual behaviour. | Exported a four-page PDF containing an editable Unicode text field, then a flattened version; verified values, original text, page sizes and absence of dangling annotation references. |
| [PDF to Excel](https://dropletweb.xyz/pdf-to-excel) | Fixed generic table detection by deriving columns from the actual header; retained first-column values and numeric cell types. | Exported Description/Quantity/Amount with Concrete 3/1500 and Steel 5/900; reopened the XLSX and checked exact cells. |
| [PDF to JPG](https://dropletweb.xyz/pdf-to-jpg) | Unified resolution controls, results and shared navigation. | Exported all four PDF pages as a ZIP of valid JPEG images. |
| [PDF to Markdown](https://dropletweb.xyz/pdf-to-markdown) | Prevented conversion before PDF parsing finishes and matched the shared layout. | Imported the four-page fixture and verified extracted headings/text in the Markdown download. |
| [PDF to PDF/A](https://dropletweb.xyz/pdf-to-pdfa) | Unified the archival-copy workflow and repaired its raster PDF export with white backgrounds; retained the visible statement that output is not certified PDF/A. | Reopened and rendered the four-page archival-style PDF. No PDF/A conformance claim or validation was made. |
| [PDF to PowerPoint](https://dropletweb.xyz/pdf-to-powerpoint) | Matched conversion options, result cards and navigation to the homepage. | Converted the four-page PDF and reopened the four-slide PowerPoint output. |
| [PDF to TXT](https://dropletweb.xyz/pdf-to-txt) | Unified text output, download controls and help layout. | Extracted text from the four-page sample and checked the downloaded UTF-8 text. |
| [PDF to DOCX (Word)](https://dropletweb.xyz/pdf-to-word) | Matched upload, settings, results and help to the shared design. | Converted the sample PDF and reopened the DOCX to check real text and document content. |
| [PowerPoint to PDF](https://dropletweb.xyz/powerpoint-to-pdf) | Repaired slide rendering and fixed the extra final page; made one-slide-per-page output explicit. Retained the extract-and-rebuild explanation. | Converted two slides to exactly two readable landscape PDF pages; inspected content and slide numbering. |
| [Privacy policy](https://dropletweb.xyz/privacy) | Updated the advertising/cookie statements to reflect removal of advertising scripts; unified the page layout. | Content and navigation review; responsive layout. |
| [PSD to PNG](https://dropletweb.xyz/psd-to-png) | Added a saved-composite decoder for supported raw/RLE RGB and grayscale PSDs, including flattened files with zero layer records, with a fallback to the existing layered decoder. | Converted a valid flattened PSD that failed the previous decoder; reopened its 4 × 4 PNG. |
| [RAW to JPG](https://dropletweb.xyz/raw-to-jpg) | Matched upload, settings, results and help while keeping the supported-format limitations visible. | Converted a basic DNG fixture to a valid 2 × 2 JPEG; this does not establish support for every camera RAW variant. |
| [Remove pages](https://dropletweb.xyz/remove-pages) | Unified page selection, action buttons, results and help. | Removed pages 2 and 4 and verified that pages 1 and 3 remained in the two-page output. |
| [Rotate PDF](https://dropletweb.xyz/rotate-pdf) | Unified preview cards, rotation controls, navigation and results. | Rotated all four pages right; verified 90-degree page rotation in the downloaded PDF. |
| [Scan to PDF](https://dropletweb.xyz/scan-to-pdf) | Unified the studio and fixed shared-header sizing; made photo imports preserve colour by default and removed automatic sharpening from imported images. | Imported two images, generated a two-page PDF and visually verified retained blue image content. Camera permission/capture was not exercised. |
| [Split PDF](https://dropletweb.xyz/split-pdf) | Replaced screenshot-based splitting with native PDF page copying; fixed blank/black output, strict range/every-N handling and nonconsecutive extraction. | Tested every-two-pages splitting and custom ranges, plus extracting pages 1 and 3; reopened outputs and checked content, page sizes and counts. |
| [SVG to PNG](https://dropletweb.xyz/svg-to-png) | Unified upload, output settings, results and navigation. | Converted a supported SVG and reopened the 320 × 180 PNG. |
| [Terms of use](https://dropletweb.xyz/terms) | Updated advertising statements and matched the shared site design. | Content and navigation review; responsive layout. |
| [TIFF to PDF](https://dropletweb.xyz/tiff-to-pdf) | Repaired image-to-PDF rendering with the shared white-background output path. | Converted a single-frame TIFF and a two-frame TIFF; verified one- and two-page readable PDFs. |
| [Translate PDF](https://dropletweb.xyz/translate-pdf) | Unified the layout and expandable guide; fixed Unicode PDF export, source-language labels and unwanted trailing blank pages. Retained explicit consent before external translation. | Verified the consent guard, translated an anonymous table from English to Afrikaans and reopened the one-page translated PDF. |
| [TXT to PDF](https://dropletweb.xyz/txt-to-pdf) | Restored missing paper/font/spacing/title-page controls; replaced blank raster output with selectable Unicode PDF text and safe text previews. | Converted UTF-8 Venda/accented text and checked selectable text, page count and readable output. |
| [Voice to Text](https://dropletweb.xyz/voice-to-text) | Matched the voice workspace and controls to the shared navigation and theme. | Ran the on-device Fast model on a public speech recording and downloaded a nonempty transcript. Microphone capture was not exercised; recognition is not word-perfect. |
| [WebP to JPG](https://dropletweb.xyz/webp-to-jpg) | Unified upload, settings, results and help. | Converted WebP and reopened the 320 × 180 JPEG. |
| [WebP to PNG](https://dropletweb.xyz/webp-to-png) | Unified upload, settings, results and help. | Converted WebP and reopened the 320 × 180 PNG. |
| [Word (DOCX) to PDF](https://dropletweb.xyz/word-to-pdf) | Repaired blank/black document rendering, preserved document padding and corrected source-based download names. | Converted a DOCX with text, an image and a table; visually inspected the one-page PDF. |
| [XML to JSON](https://dropletweb.xyz/xml-to-json) | Unified input/results layout, help and shared navigation. | Converted XML and checked attributes, repeated elements, booleans and the downloaded JSON. |

## Validation evidence

- `npm run check` and `python scripts/check_site.py --dist`: 49 pages, 42 handoff receivers, homepage file maps, local resources, fragments, metadata, structured data and JavaScript syntax.
- Browser layout audits: all 49 pages at 1280px desktop and 390px mobile; mobile light and dark themes; zero horizontal overflow, one H1, shared header at the top and zero advertising elements. All mobile backgrounds match the homepage in each theme.
- Actual conversions were exercised on all 42 tools using anonymous synthetic fixtures, plus a public speech sample. Downloaded PDFs, images, ZIPs, DOCX, XLSX, PPTX and text outputs were reopened. Selected PDFs were rendered and visually reviewed. The source PDF intentionally has a blank fourth page; preserving that page is correct.
- PDF output checks include page counts, original text/order where applicable, blank/black detection, page dimensions and invalid annotation references. Office and data outputs were checked for real content, not only file extensions.
- Machine-readable evidence: `upgrade/page-audit.json`, `upgrade/output-checks.json`, `upgrade/layout-desktop.json`, `upgrade/layout-mobile.json` and `upgrade/layout-light.json`. `upgrade/make_fixtures.py` and `upgrade/check_output.py` reproduce the local fixture and output checks. `upgrade/layout-qa.html` is a local test harness and is excluded from the deployed build.

## Practical limits

This is a substantial update, not a claim of Canva feature parity or proof that every possible file is supported. Camera/microphone permission flows and live capture were not exercised; scanner image import and audio-file transcription were exercised. Existing file handoff wiring is retained and statically checked for all 42 receivers.

- Imported PDF text editing uses visual replacement. Whiteout and masked text do not securely redact source content; hidden originals may remain extractable. Complex text layouts and rotated text can require manual adjustment. Newly added annotations export over the preserved original PDF.
- Editor DOCX export rebuilds extractable text and added images; shapes/forms are described as text. It does not recreate all original PDF backgrounds or complex page layouts. XLSX export is an object/content inventory, not a table reconstruction of the PDF. Use PDF to Excel for table extraction.
- Generated Word/Excel/HTML/EPUB/PowerPoint PDFs are rendered images rather than selectable text. TXT output and native structural PDF operations retain selectable text. PowerPoint conversion rebuilds text; it does not preserve animations, video or all original slide artwork.
- The archival PDF tool makes a flattened viewing copy. It is explicitly not certified PDF/A and was not validated as standards-compliant PDF/A.
- RAW, EPS and PSD support depends on supported file encodings. The fixtures establish the listed cases, not every camera format or arbitrary PostScript program. Large files remain constrained by browser memory.
- Translation uses an external service only after consent and is subject to its availability and quotas. Voice recognition can make transcription errors. Typed/image signatures are not certificate-based digital signatures.

The update is intended for the existing Drop-tech593/Droplet repository and existing Cloudflare deployment. No hosting migration or new site was created.
