# Env-only Docker test-AD quickstart

This is a **test AD only** one-shot CLI, not a web interface or production deployment. The `.env` file is ignored by Git. Docker Compose automatically loads it **from this project directory**.

~~~bash
git pull
cp .env.example .env
chmod 600 .env
mkdir -p dev/templates dev/output
nano .env
~~~

Edit the LDAPS URL/base/bind identity and **test-only** bind password, allowed account, template profile key and the exact distinguished name (DN) of a direct AD group that the selected test account belongs to. The JSON arrays in `.env` must remain valid JSON. For the default HR profile create `dev/templates/HR_Template.htm` and `dev/templates/HR_Template.txt` using trusted content. Optional images must be declared in `SIGNATUREE_PROFILES_JSON` and stored under `dev/templates`. Set `SIGNATUREE_LDAP_CA_FILE=/templates/lab-ca.pem` if using your own CA and copy its PEM there.

For an **isolated AD lab only**, if certificates are unavailable and plain TCP/389 is enabled, set `SIGNATUREE_LDAP_URL=ldap://dc-test.example.invalid:389`, `SIGNATUREE_ALLOW_INSECURE_TEST_LDAP=true`, and leave `SIGNATUREE_LDAP_CA_FILE=` empty. This transmits the service-account password and directory data **unencrypted** over the network. Use a disposable read-only account; do not use this setting on shared/untrusted networks or against production AD. The default remains strict LDAPS; leaving the opt-in false rejects `ldap://`.

The container runs as UID 10001. The host output directory must be writable by this UID, for example `sudo chown 10001:10001 dev/output`. Make sure template files/directories are readable by the container user.

~~~bash
docker compose build
docker compose run --rm signaturee-test --env-config --user test.user --signature HR --preview --ack-test-directory
docker compose run --rm signaturee-test --env-config --user test.user --signature HR --generate --ack-test-directory --ack-test-output
~~~

The snapshot is saved under `dev/output`. No AD modifications, stable Outlook paths or production SMB publishing occur. The CLI still enforces explicit test-account allowlisting, exact direct-group membership, and acknowledgment flags.

**Security:** Putting a bind password in `.env` is convenient for an isolated disposable test account but exposes it in Docker container metadata (`docker inspect`), to Docker administrators, and potentially via `docker compose config`. Do not commit `.env`, paste its contents in tickets or screenshots, or use a production account. For production we will return to a mounted secret. `docker compose config --quiet` validates Compose without printing resolved secrets.
