# Headless LibreOffice → RTF (M3, experimental)

This adapter converts **trusted administrator-authored HTML** to RTF using
`soffice` on Linux. It is a new Node module, not a port of
`GenerateSignatures.ps1`. It does **not** persist employee output, manage shares,
or publish signatures into a user directory.

## Try it locally

Install Node.js 24+, Git and LibreOffice Writer (including command-line
`soffice`). On Debian/Ubuntu, the package is usually `libreoffice-writer`.

~~~bash
git clone https://github.com/ffworker/signaturee-linux.git
cd signaturee-linux
git fetch origin feature/headless-libreoffice-rtf
git switch feature/headless-libreoffice-rtf
npm ci
npm test
npm run demo:rtf
~~~

`npm run demo:rtf` first renders the established synthetic HTML/TXT demo
and then generates an actual `artifacts/demo/DEMO.rtf`, alongside its HTML,
TXT and image. Inspect it in **Classic Outlook** on a Windows workstation
if desired, but do **not** treat visual success as proof of production parity.

To run the real conversion integration assertion locally:

~~~bash
SIGNATUREE_TEST_LIBREOFFICE=1 npm test
~~~

GitHub Actions runs a dedicated Ubuntu job with LibreOffice and stores a
downloadable demo artifact containing HTML, TXT, RTF and test image.

## Security and limitations

- Every conversion runs with its own temporary directory and LibreOffice
  user profile; no shared state between concurrent jobs.
- No shell interpolation. The process has a bounded timeout and output must
  look like RTF; failures abort instead of returning partial files.
- Input HTML and binary assets have size limits. Relative image paths must
  pass a containment check. No production files are touched.
- **Trusted admin templates only.** LibreOffice is not an HTML sanitizer or
  network isolation sandbox. Untrusted HTML may reference external resources.
  Safe template ingestion/network policy and publisher sandboxing are required
  before accepting arbitrary uploaded markup in a production deployment.
- Image rendering (especially SVG), emoji, German special characters and
  Outlook-specific RTF formatting must be evaluated **visually** on Windows.
  Different LibreOffice versions can produce different RTF bytes.
- Output publisher and API integration will be introduced in subsequent PRs.

Run the earlier **read-only test-AD probe** separately; LDAPS smoke testing
does not require LibreOffice and should not use production credentials.
