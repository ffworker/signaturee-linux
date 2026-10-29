# Testing Signaturee Linux

## Now: golden-output tests and visible HTML demo

**Where:** GitHub Actions (Ubuntu), or any Windows/Linux/macOS machine with Node.js 24+.
**Requires:** No LDAP, credentials, LibreOffice, SMB, Docker or Windows Server.

Review this branch before it is merged:

~~~bash
git clone https://github.com/ffworker/signaturee-linux.git
cd signaturee-linux
git fetch origin feature/renderer-golden-fixtures
git switch feature/renderer-golden-fixtures
npm run check
npm test
npm run demo
~~~

The demo creates a local, ignored output directory:

~~~text
artifacts/demo/
  DEMO.htm
  DEMO.txt
  DEMO-Dateien/
    logo.svg
~~~

Open `artifacts/demo/DEMO.htm` in a browser (double-click on Windows; `xdg-open`
on Linux desktops) and inspect `DEMO.txt` in a text editor. Look for the
synthetic `Alex Müller` data, correctly displayed umlauts and the sample logo.
All data uses `example.invalid` and an original placeholder image.

**Without local Node:** On GitHub, open PR #2 → Checks → the successful
`Linux foundation checks` workflow. Download its
`signaturee-linux-html-txt-demo` Actions artifact and open the included
`DEMO.htm` file. This is a **visual sample**, not a working web app.

The unit tests check exact HTML and TXT golden output, safe escaping, UTF-8,
explicit legacy Windows-1252 decoding, and that generating `DEMO` never expands
to `SALES` simply because both are eligible.

## Integration testing later

| Phase | Test environment | Acceptance criteria |
| --- | --- | --- |
| M1 — This PR | Ubuntu CI or local Node 24 | Golden HTML/TXT output and visible synthetic demo |
| M2 | Disposable Linux VM and **test Active Directory** | LDAP search/bind, strict TLS, correct user/group permissions |
| M3 | Linux + headless LibreOffice | Valid RTF, logo fidelity, concurrency and safe failure handling |
| M4–M5 | Trusted Linux VM with Docker Compose | Functional API/UI, mounts, persistent data, non-root process |
| M6 | Linux application + Windows workstation with Classic Outlook | Final end-to-end signature validation, including RTF and images |

A small Debian/Ubuntu VM is enough for the upcoming integration tests. We
do **not** need Proxmox/Kubernetes-specific deployment or production LDAP/SMB
credentials for the current renderer work.

## Deliberate limitations

This branch does not implement automatic template discovery, production output
publishing, LDAP, RTF, or a web application. The sample image is copied only
by the demo command. Golden fixtures describe **new Linux rendering behavior**;
they are not proof of byte-identical output with Signaturee Windows v2.0.0.
