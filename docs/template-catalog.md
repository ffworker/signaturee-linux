# Trusted template catalog loader

The service can now load administrator-owned templates and declared assets
from a real Linux directory using the existing Windows-style naming convention.

Example static config (not a web request):

~~~json
{
  "profiles": [
    {
      "key": "HR",
      "encoding": "utf-8",
      "images": ["HR-Dateien/logo.png"]
    }
  ]
}
~~~

Place `HR_Template.htm`, `HR_Template.txt` and
`HR-Dateien/logo.png` inside a trusted, existing, absolute root. The module
returns `{ catalog, assetsByKey }` suitable for the already-tested generation
pipeline. New templates default to **strict UTF-8**. Set `encoding` to
`windows-1252` only for imported legacy exports.

## Security and boundaries

- Rejects relative/symlink template roots, symlinked files and directories,
  file traversal, duplicate/case-ambiguous keys, unsupported encodings and
  overly large or missing files.
- Assets are explicitly listed; there is **no recursive automatic scan** or
  implicit access to unrelated files. Template pairs must both exist.
- Template content is **trusted/admin-owned**. The loader does **not** sanitize
  HTML or SVG. Do not permit untrusted end users to upload templates; keep
  the source directory mounted read-only and restrict filesystem ownership.
- Symlink checks assume a trusted mount with no hostile concurrent writers.
  Directory ownership/mount policy remains part of deployment review.
- Neither a web UI nor an AD connection is made by this module. A future
  CLI/container layer will read a verified admin configuration and pass these
  server-resolved objects to `generateSignatureSnapshot`.

## Testing

`npm test` includes tests against synthetic templates and separate temporary
filesystem fixtures for traversal, symlink, encoding and size failures.
