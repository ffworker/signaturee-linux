# Atomic output snapshots — publisher (M3, experimental)

`publishSignatureSnapshot({ rootDirectory, accountName, signatures })` takes a
**complete in-memory batch** of rendered HTML, TXT, RTF and image assets and
publishes them to one *new* snapshot directory. **No existing files are changed.**

## Guarantees and limitations

- All input keys, bytes, asset names and size limits are checked before any I/O.
- A new private staging directory is created **inside the same output mount**.
- Files are written at mode `0600`, directories at `0700` on POSIX filesystems.
- A single directory rename makes a complete batch visible together. Failed
  writes must not produce a published snapshot; staging files are cleaned up.
- Every generation has a fresh random snapshot suffix; previous generations
  remain unchanged. Case-ambiguous signature keys and assets are rejected.
- Source paths are not accepted from requests. A host-configured, existing,
  real/absolute output root is required; symlink roots and path traversal are
  rejected. The publisher never creates or changes NTFS ACLs or mounts shares.

**Important:** This is a **write-once snapshot publisher**, not a finalized
live Outlook deployment strategy. There is deliberately no `current` pointer,
automatic cleanup, rollback across already-published jobs or overwrite path.
Integrating a stable path/manifest and a retention policy will require a
separate review. A rename is atomically *visible* on the **same POSIX mount**;
it is not a guarantee of crash durability (no directory `fsync`), network-share
server semantics, or resistance to a hostile concurrent process able to change
the mount's directory tree. Use trusted host-managed storage.

## Demo

The existing synthetic demo can now output a complete batch:

~~~bash
npm ci
npm run demo:publish
~~~

This command requires the `soffice` executable installed locally. It
creates `artifacts/published/test.user--<random-id>/` containing:

~~~text
DEMO.htm
DEMO.txt
DEMO.rtf
DEMO-Dateien/logo.svg
~~~

The Ubuntu LibreOffice CI job also runs the publisher demo and uploads the
`signaturee-linux-published-snapshot-demo` artifact. You can verify that the
files are together and the logo still resolves.

## Integration contract

The caller must provide **server-approved** selected signatures, not the
browser's unverified request. The batch publisher intentionally does **not**
authorize LDAP users or determine eligibility; that remains the responsibility
of the LDAP-to-render preview bridge. It refuses incomplete/invalid RTF.

The output directory is meant to be a dedicated host-mounted path; the future
Docker application must run as a non-root user with strict rights and must not
have credentials for mounting SMB shares itself.
