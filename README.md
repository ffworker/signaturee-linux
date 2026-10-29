# Signaturee Linux

**A fresh, Docker-first email signature generator for Linux.**

> **Status: experimental Docker test CLI (not a production release).** Offline synthetic signature generation with real LibreOffice is implemented and checked in CI. Test AD integration, Outlook output and production deployment are not yet validated.

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
- [x] HTML/TXT renderer and synthetic fixtures (real AD acceptance pending)
- [x] Headless LibreOffice RTF converter (real conversion tested in CI; Outlook acceptance pending)
- [x] Safe experimental output publisher (write-once snapshots; stable production paths pending)
- [x] Localhost-only offline browser demo UI/API (synthetic data, NOT AD-authenticated)
- [ ] Authenticated production web UI and API
- [x] Non-root Docker CLI and offline synthetic end-to-end smoke in CI
- [ ] Real test-AD acceptance, stable Outlook paths, SMB deployment and Classic Outlook compatibility

See [Docker test CLI](docs/docker-test.md), [Test-AD generation CLI](docs/test-cli.md), [Trusted template loader](docs/template-catalog.md), [End-to-end synthetic pipeline](docs/integration.md), [Architecture](docs/architecture.md), [Publishing](docs/publishing.md), [RTF conversion](docs/rtf.md), [Milestones](docs/milestones.md),
[How to test](docs/testing.md) and [the real test-AD LDAPS probe](docs/test-ldaps.md).

### Test the browser UI offline — no AD needed

```bash
docker compose --profile demo up --build -d signaturee-demo
```

Open **http://127.0.0.1:8789** on your Docker host to preview a bundled synthetic user's signature and generate/download real HTML, TXT and LibreOffice RTF output. No domain controller, LDAP credentials, or manual template setup is necessary. This is a **local-only, intentionally unauthenticated synthetic demo**, not a corporate UI. See [Offline browser demo](docs/offline-demo.md) for boundaries and cleanup instructions.

### Preview your own templates without AD

Put `HR_Template.htm` and `HR_Template.txt` into `dev/templates/`, select `SIGNATUREE_OFFLINE_PROFILE=HR` in `.env`, then run:

```bash
docker compose --profile workbench up --build -d signaturee-workbench
```

Open **http://127.0.0.1:8790/** on the Docker host. This local-only workbench uses only synthetic user attributes and the configured read-only local template; it never connects to LDAP. See [Offline template workbench](docs/offline-workbench.md).

### Configure your test AD with a single .env file

Copy `.env.example` to `.env`, edit LDAPS, allowlisted account, profile and group mapping, then run the Docker CLI. See [env-only quickstart](docs/env-quickstart.md). This convenience mode exposes the **test-only** bind password in container environment metadata; never use a privileged or production service account.

### Test Docker on a Linux machine (no AD credentials)

With Docker Engine installed and the current main branch checked out:

```bash
git clone https://github.com/ffworker/signaturee-linux.git
cd signaturee-linux
bash scripts/verify-docker.sh
```

This builds the image and performs restricted, network-disabled HTML/TXT/RTF generation with LibreOffice and an atomic snapshot using synthetic data. It is the same acceptance command executed in CI. It does **not** connect to LDAP, publish to SMB or establish Classic Outlook layout compatibility. See [Docker test CLI](docs/docker-test.md) for a separate optional isolated test-AD setup.

## Windows edition

The stable Windows implementation, with dedicated setup documentation, lives at
[ffworker/Signaturee-public](https://github.com/ffworker/Signaturee-public).
The two projects are related but independently maintained.

## License

MIT. See [LICENSE](LICENSE).
