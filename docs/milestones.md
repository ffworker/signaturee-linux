# Development milestones

Every milestone must produce a focused PR, with a clear validation step. No Linux
release exists until the end-to-end workflow passes against a test AD and Classic Outlook.

1. **M0 — Foundation:** npm metadata, Ubuntu CI, explicit authorization-selection contract
   and tests. No copied Windows backend, no container image masquerading as a working app.
2. **M1 — Deterministic renderer:** Test-only sample users and HTML/TXT templates (with
   German umlauts, HTML entities, mobile/fax rows, images, filenames). Define encoding explicitly.
   Ensure no source contains real employees or company logos.
3. **M2 — Secure directory integration:** Native LDAP search/login, direct group mapping,
   enabled-user policy and normalized attributes, all with TLS and mock tests.
   **Status:** Native provider and mock-backed rendering bridge implemented; a read-only
   real test-AD LDAPS probe is available. Real-world AD validation remains outstanding.
4. **M3 — Converter and publisher:** Headless LibreOffice with isolated profile, timeout,
   RTF validation and atomic publish; mounted output and no accidental ACL escalation.
   **Status:** Isolated HTML-to-RTF converter and real LibreOffice CI planned in PR #5;
   experimental write-once snapshot publisher added in PR #6; stable live Outlook
   paths, retention, mounted-volume verification and integration remain future work.
5. **M4 — API and UI:** After PR #7's fake-AD→renderer→RTF→snapshot
   pipeline, add trusted catalog loading and a properly authenticated operator API.
   Trusted disk-based catalog loading is added in PR #8; a user-authorized
   test-AD CLI is introduced in PR #9; an authenticated HTTP API, stable
   Outlook deployment and Docker startup remain future work. Use a compatible subset
   of the existing Signaturee frontend,
   implement preview/preflight/generate routes, and keep authorization server-side.
6. **M5 — Docker development deployment:** PR #10 adds a non-root one-shot
   test CLI container; a persistent HTTP web service and its health checks
   are still missing. Non-root OCI build and Compose, health checks,
   configuration/SQLite storage, immutable image and explicitly mounted directories.
7. **M6 — Acceptance:** Test Linux end-to-end using a real test LDAP directory, inspect
   resulting HTML/TXT/RTF and images in Classic Outlook, perform security review, then
   tag the first Linux release. No promise of feature parity with Windows v2.0.0.

**Review policy:** Small PRs; don't merge release or security-sensitive changes automatically.
