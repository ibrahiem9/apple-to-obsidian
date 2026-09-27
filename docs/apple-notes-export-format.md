# Apple Notes content preservation

The exporter reads Notes through macOS Automation. It reads both HTML and plaintext, enumerates attachment metadata, and asks Notes to save each attachment into a private staging directory. It does not open Apple's protected attachment folder, change the source library, or fetch linked websites.

Each note retains its source ID, title, creation/modification dates, account and folder names/IDs, sharing and lock status, and attachment IDs, names, content identifiers, URLs, dates and sharing status. Real deep links present in the HTML are retained. A Core Data note ID is not a public Notes deep link; the exporter does not invent a link from it.

HTML becomes searchable Markdown with links, lists, tables, code and formatting. Any plaintext not represented by the conversion is also included. Inline attachment references resolve to saved files or URL cards. Downloaded files use content hashes, so a changed attachment is detected even if the note text has not changed. Copied files live independently of Notes.

The note links to immutable source JSON and HTML-as-text in `Sources`, with copied files in `Attachments`. `source_urls` and `apple_attachments` provide structured metadata. Raw source files can contain private content, just like the note; do not include them in bug reports. Source capture JSON's `exportedFile` records a temporary staging reference; the published note's `apple_attachments[].vaultPath` is the retained attachment location.

## Limits and visible failures

A saved X post or other URL card retains the title and URL exposed by Notes. Text present in Notes HTML/plaintext or a readable exported link metadata file is retained too. The exporter does not download the remote post. If Notes exposes only a title and URL, the remote post's full text will not become searchable. A missing preview appears in `apple_capture_warnings` and the note's Capture warnings section.

`apple_content_complete` means that the exposed fields and available attachments were captured without detected failures; `apple_content_completeness_scope: exposed-fields` makes this limit explicit. It does not promise a pixel-perfect Notes rendering, remote webpage contents, OCR of images/scans, or hidden internal metadata. HTML links can include app-specific schemes, whose behavior depends on the installed app.

Unreadable note fields, failed binary saves, missing attachments, unsafe paths and unresolved media references make the export incomplete. The job exits unsuccessfully and records failures in its manifest. It keeps an existing Obsidian copy intact; a newly encountered incomplete note displays a warning and retains whatever was available. Subsequent runs retry the capture.

## Updates and historical recovery

Future successful runs update the source-managed Markdown. Before replacing a legacy export or externally edited content (including frontmatter metadata), the writer retains a separate copy in `Preserved`, including its metadata, and adds a link from the current note. This also preserves independently backfilled content. These copies are immutable and content-addressed; an edited preservation file is never overwritten. Normal unchanged runs do not add more copies.

Keep `apple_note_id` in the main exported file. Preserved copies use `apple_original_note_id` instead so they cannot become duplicate primary exports. Do not edit the content-addressed `Sources` or `Attachments` files; a checksum mismatch is a failure, not permission to overwrite.

Preserved copies adjust generated attachment/source links for their new folder. Their `apple_original_markdown` points to an exact copy of the previous Markdown, and `apple_original_path` records its former location for restoring arbitrary user-authored relative links.

Historical recovery is separate from this change. Installing the writer does not run an immediate vault export. Coordinate backfill and scheduled runs so only one writer modifies the same vault at a time. A diagnostic `--limit` capture is explicitly rejected by the publisher to prevent a partial inventory marking other notes as deleted.
