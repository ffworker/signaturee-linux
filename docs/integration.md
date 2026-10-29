# Complete generation pipeline — controlled integration

PR #7 connects existing **server-side** primitives: an LDAP-shaped directory
result, exact direct-group mapping, explicit authorized signature selection,
HTML/TXT rendering, headless LibreOffice and the write-once snapshot publisher.

## What this proves

`generateSignatureSnapshot` calls `prepareSignaturePreview`, converts every
requested signature to RTF, and **only then** asks the existing publisher to
commit the entire batch. An unauthorized signature or failed conversion cannot
produce a partially published set of files.

The module is *not* an HTTP route and never takes client-provided LDAP group
maps, template catalogs, asset maps or output roots. Any future API must
authorize the **operator** to target a user before calling this function.
An arbitrary caller who can invoke it is assumed to already be trusted.

Run on Linux with LibreOffice installed:

~~~bash
npm ci
npm test
npm run demo:integration
~~~

Open the one `artifacts/integration/example.user--.../` snapshot. It contains
HTML, TXT, RTF and the example logo, all generated from a **fake** AD user.
GitHub Actions runs this sequence on Ubuntu and uploads an artifact.

## What's still missing

- **Real-AD integration:** the read-only LDAPS probe remains separate and
  test-domain-only. Production login and operator authorization are not built.
- **Trusted template loading:** catalog/assets currently are in-memory inputs.
  No automatic discovery, file ingestion or live admin uploads.
- **Deployment:** no stable Outlook filenames, retention, Windows ACLs, SMB
  publishing guarantee or Docker web service.
- **Security:** templates are assumed trusted admin-owned and could include
  remote images/HTML; a later template admission process must constrain them.

Do not expose this orchestration directly to untrusted network users.
