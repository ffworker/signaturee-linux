# Signaturee Linux

**A fresh, Docker-first email signature generator for Linux.**

> **Status: early development.** No usable application, Docker image, or Linux release exists yet.

Signaturee Linux is a new implementation informed by the lessons learned from
[Signaturee for Windows v2.0.0](https://github.com/ffworker/Signaturee-public/releases/tag/v2.0.0),
but **not** a PowerShell 7 port or a fork. The Windows application remains an independent,
stable product.

## Project goals

- Serve an accessible web interface for administrators and employee self-service.
- Look up employee attributes and permitted signature groups in Active Directory via **secure LDAP**.
- Render administrator-provided HTML and TXT templates predictably, preserving German characters,
  Outlook layout and associated image files.
- Convert HTML to RTF with **headless LibreOffice**; report errors instead of creating invalid output.
- Publish only approved signatures to a local folder or a **host-managed, mounted SMB destination**.
- Provide a minimal, non-root Docker/Compose deployment **after the application works and is tested**.

## Non-goals

- Reusing the Windows PowerShell generator, Windows RSAT, Word-COM or NTFS ACL logic.
- Guessing directory membership or silently broadening the signatures a user may receive.
- Claiming Linux/Outlook parity before independently verifying real output.
- Shipping a Dockerfile that starts but cannot generate signatures.

## Engineering principles

The **server** determines user identity, group membership and permitted signatures. Requests
may select a subset; no renderer or converter may expand that selection. Invalid or missing
authorization fails closed. LDAP must validate certificates and avoid logging credentials.

Build with small, reviewable changes and tests. The Linux version has **its own release
versioning**. It does not change the Windows release branch or require a monorepo.

## Progress

- [x] Foundational contracts and tests
- [x] LDAP lookup and authentication (native provider + mocked tests; real test AD pending)
- [ ] HTML/TXT renderer and anonymized golden fixtures (core preview in PR #2; production integration pending)
- [ ] Headless LibreOffice RTF converter (experimental converter in PR #5; production publishing pending)
- [ ] Safe output publisher (write-once atomic snapshots in PR #6; stable production paths pending)
- [ ] Web UI and API
- [ ] Dockerfile, Compose and end-to-end Outlook acceptance

See [Docker test CLI](docs/docker-test.md), [Test-AD generation CLI](docs/test-cli.md), [Trusted template loader](docs/template-catalog.md), [End-to-end synthetic pipeline](docs/integration.md), [Architecture](docs/architecture.md), [Publishing](docs/publishing.md), [RTF conversion](docs/rtf.md), [Milestones](docs/milestones.md),
[How to test](docs/testing.md) and [the real test-AD LDAPS probe](docs/test-ldaps.md).

### Try the renderer before LDAP or Docker

On the renderer feature branch (until merged), with **Node.js 24+**:

```bash
npm run check
npm test
npm run demo
```

Open `artifacts/demo/DEMO.htm` to see a signature rendered with **synthetic**
data and a dummy image. GitHub Actions also offers a downloadable demo artifact.
This preview does **not** yet contain LDAP, LibreOffice/RTF, or a functional web UI.

## Windows edition

The stable Windows implementation, with dedicated setup documentation, lives at
[ffworker/Signaturee-public](https://github.com/ffworker/Signaturee-public).
The two projects are related but independently maintained.

## License

MIT. See [LICENSE](LICENSE).
