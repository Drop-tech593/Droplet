# Droplet

42 browser tools for PDFs, images, documents, data and audio.

The website uses editable static HTML, CSS and JavaScript. Its production domain is `https://dropletweb.xyz/`.

## Develop and build

```bash
npm ci
npm run build
npm run dev
```

`dist/` contains the upload-ready site. The development server supports the same extensionless URLs used by the production site. `npm run check` checks source page metadata, headings, JSON-LD, local resources, link fragments, JavaScript syntax and all 42 handoff receiver contracts; this check needs Python 3 and `lxml`. After building, use `python3 scripts/check_site.py --dist` to check the generated site as well.

The compiled stylesheet is committed at `assets/toolkit.css`. Hosting the repository root as a static site also works without running Node on the web server. Cloudflare Pages can instead build with `npm run build` and publish `dist`.

## Repairs in this update

- Complete 42-tool directory, working category anchors, accessible mobile navigation and keyboard search.
- Search input is rendered as text, including when it contains HTML characters.
- Shared, per-tab file handoff using `assets/droplet-runtime.js`, with expiry and a direct-open fallback.
- Matching converters for XLSX, PPTX, HTML, EPS and supported audio files.
- Restored Voice to Text, its recording interface and TXT, DOCX and PDF exports.
- Explicit opt-in before PDF text is sent to the MyMemory translation service; source language selection and complete paragraph batching.
- Corrected headings, descriptions, canonical URLs, sitemap, sharing image and app manifest; unverified rating markup removed.
- Locally hosted conversion libraries and compiled Tailwind CSS, including replacements for broken DOCX and XML dependencies.
- Accurate processing, storage, file-limit and offline explanations, plus working help and contact pages.
- `ads.txt` uses the publisher ID already present in the existing site.

## Processing and offline use

Each of the 42 tools marks its primary file input with `data-droplet-handoff`. The shared runtime restores the files and dispatches the same change event used by the tool's own picker. The homepage inventory declares whether each tool accepts one file or a batch: 28 tools accept one, and 14 support multiple files. A batch is offered only to compatible tools; extra files are never silently discarded. Homepage transfers support up to 20 files and 100 MB total, subject to the selected tool's own file limit.

AI Summarizer imports TXT files and selectable text from PDFs up to 10 MB locally. Scanned PDFs need OCR through PDF to TXT first. Review the imported text before choosing Summarize. Scan to PDF binds its upload control before a handoff can arrive and preserves imported pages during startup.

Most converters process files locally. PDF translation is an online service, and optional browser speech recognition may use the browser provider. Speech models, OCR resources and some audio decoder resources need an initial download.

Homepage transfers expire after two minutes and are removed after receipt or by expiry cleanup. Voice drafts and downloaded model resources can remain in browser storage. The privacy page describes these differences.

The service worker caches pages and resources after use. It does not promise that every feature works offline. Increase its cache version when deploying changed runtime assets.

## Third-party software

Unmodified conversion library bundles are in `assets/vendor`. Download sources and checksums are recorded in `vendor-sources.json`; notices and license files are included in `assets/vendor/THIRD-PARTY-NOTICES.txt` and `assets/vendor/licenses`.
