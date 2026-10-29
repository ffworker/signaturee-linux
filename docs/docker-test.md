# Docker test CLI (experimental, test AD only)

**This is a containerized, one-shot test-AD generator – not a web server,
production signature deployment or stable release.** No ports are published.

## Build and offline smoke test

On a Docker-capable Linux machine (no LDAP credentials required):

~~~bash
docker build -t signaturee-linux:test .
docker run --rm --read-only --cap-drop ALL \
  --security-opt no-new-privileges \
  --tmpfs /tmp:rw,nosuid,nodev,size=268435456 \
  signaturee-linux:test --help
docker run --rm --read-only --cap-drop ALL \
  --security-opt no-new-privileges \
  --tmpfs /tmp:rw,nosuid,nodev,size=268435456 \
  --entrypoint node signaturee-linux:test /app/scripts/container-smoke.js
~~~

The second command actually runs LibreOffice as **UID 10001**, converts
synthetic HTML to RTF and writes a full private snapshot inside /tmp. No
network access or domain credentials are involved. GitHub Actions runs both.

## Optional test AD via Docker Compose

Create this folder tree locally (do **not** commit its contents):

~~~text
dev/
  config.json           # owner uid 10001, mode 0600
  ldap-bind-password    # private service-bind secret (never put in .env)
  templates/
    HR_Template.htm
    HR_Template.txt
    HR-Dateien/logo.png
    test-ca.pem          # optional, public test-AD CA certificate
  output/                # writable only by uid 10001
~~~

Use the JSON shape in [Test CLI](test-cli.md), but set the absolute paths
inside the container to `/templates` and `/output`, and list a permitted
**test account** in `allowedTestAccounts`. Do not use a domain-admin
account or production shares. Create the output directory ahead of time.

On the Docker host:

~~~bash
mkdir -p dev/templates/HR-Dateien dev/output
sudo chown 10001:10001 dev/config.json dev/output
chmod 600 dev/config.json dev/ldap-bind-password
~~~

Ensure the test user inside the container can read the templates and config.
When using the default `10001` UID, do not bypass errors by running the
container as root or making source directories world-writable.

Set the non-secret LDAPS connection variables in your shell:

~~~bash
export SIGNATUREE_LDAP_URL='ldaps://dc-test.example.invalid:636'
export SIGNATUREE_LDAP_BASE_DN='OU=TestUsers,DC=example,DC=invalid'
export SIGNATUREE_LDAP_BIND_DN='CN=signaturee-reader,OU=Service,DC=example,DC=invalid'
export SIGNATUREE_LDAP_CA_FILE='/templates/test-ca.pem'
~~~

The password comes from the local `dev/ldap-bind-password` file via a
Compose secret mounted at `/run/secrets/ldap-bind-password`. Never commit
it, bake it into the image, or pass it as an argument.

Preview without writing:

~~~bash
docker compose run --rm signaturee-test \
  --config /config/test.json --user test.user --signature HR \
  --preview --ack-test-directory
~~~

Generate a private write-once snapshot to `dev/output`:

~~~bash
docker compose run --rm signaturee-test \
  --config /config/test.json --user test.user --signature HR \
  --generate --ack-test-directory --ack-test-output
~~~

**Limits:** Mount and Compose-secret permissions vary by host. Verify access
from the non-root process. Output is NOT delivered to the stable per-user
Outlook path; no online admin UI, live API or validated SMB/CIFS publishing
exists yet. Normal `docker compose up` just prints CLI usage; use `run --rm`
for one-shot generation.

### Container safety settings

- Unprivileged UID/GID 10001; Linux capabilities dropped.
- Read-only application root, writable private tmpfs for LibreOffice.
- Templates and configuration mounted read-only.
- Output mounted separately, no container-managed SMB mounts or exposed port.
- Bind credential supplied through a mounted secret file; LDAPS TLS
  certificate validation stays enabled.

A passing offline container smoke test does **not** prove that a real test
domain or Classic Outlook rendering will work. Those require separate tests.
