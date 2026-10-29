# Architecture decisions — Linux edition

This is a new codebase, **not** a migration of the Windows PowerShell generator.
[Signaturee for Windows](https://github.com/ffworker/Signaturee-public) remains stable and independent.
The new Linux edition starts with a deliberately smaller feature set.

## Stack and separation

- **Runtime:** Node.js 24 LTS, native ECMAScript modules and built-in tests. We can update the LTS after testing; do not inherit Windows runtime constraints automatically.
- **Frontend:** The existing Windows UI is a *design and protocol reference*. Reuse selected files when it makes sense, with license notice; don't copy its 6,000-line backend.
- **Directory:** An adapter around a native LDAP client with LDAPS/StartTLS and strict certificate validation; user searches and LDAP binds must be isolated and access-controlled.
- **Authorization:** A server-calculated list of eligible signatures, a server-discovered template catalog, and an explicitly selected subset. Neither the renderer nor CSV data may expand selection. The pure contract lives in `src/core/selection.js`.
- **Rendering:** A small deterministic Node module for HTML/TXT, with known byte encoding and resource paths. Compare anonymized golden outputs to Windows where useful.
- **RTF:** A separate headless LibreOffice converter with unique per-job profile, timeout, temp files, validation and atomic replacement only after success.
- **Publishing:** A contained output directory. CIFS/SMB mounting belongs to the *host*, not a privileged Docker container. POSIX permissions must be documented and verified independently.
- **Runtime:** One service exposing a compatible subset of administrator/generation APIs. Its lifecycle is managed by Docker/Compose rather than Windows Scheduled Tasks.

## Security invariants

1. **Fail closed:** No empty or unauthorized signature selection and no implicit fallback from `selected` to `memberOf`.
2. **Server authority:** Browser requests supply only identifiers and explicit selected keys; the server verifies the user, groups and available templates.
3. **No secrets or personal data in logs:** Do not log LDAP passwords, full employee attributes, generated signature content, or bearer tokens.
4. **Strict TLS:** Verify LDAP certificates. Do not implement a production `rejectUnauthorized: false` escape hatch.
5. **Filesystem containment:** Reject path traversal and symlinks escaping the configured root. Write temporary artifacts outside publicly served paths and commit outputs atomically.
6. **Least privilege:** Run the eventual container unprivileged with only necessary writable mounts.
7. **No automatic parity claims:** The current selection helper is a contract proof, **not** a functional Linux signature generator.

## Interface candidates (future work)

- `DirectoryProvider.searchUsers` / `DirectoryProvider.getUser` / `DirectoryProvider.authenticate`.
- `SignatureRenderer.renderHtmlAndText`.
- `RtfConverter.convert`.
- `OutputPublisher.publish`.

These are **planned boundaries**, not APIs implemented by this foundation PR.

## Integration with the Windows application

There is no automatic cross-repository synchronization. Windows fixes may suggest new tests
or requirements here, but no Windows source change should be imported without review.
Keep the two projects independent until a genuinely reusable core emerges from working code.
