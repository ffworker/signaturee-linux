# Offline browser demo (no LDAP required)

This mode is **synthetic-only**. It has a single hardcoded employee
`example.user`, one permitted `DEMO` signature, and shipped example templates.
It does not read a real Active Directory, accept arbitrary usernames,
use the `.env` LDAP credentials, connect to SMB, or expose a production admin API.

## Run the web UI on your Linux Docker host

~~~bash
git pull
docker compose --profile demo up --build -d signaturee-demo
~~~

Then visit **http://127.0.0.1:8789** in a browser **on the same machine**.
Click **Refresh preview** to render HTML/TXT without writing output.
Click **Generate HTML / TXT / RTF** to run the **real** LibreOffice conversion,
publish an atomic snapshot, and enable three download links.
The synthetic preview image is embedded inline. Downloads are served by the
container so no host file-ownership change is required.

The named Docker volume `signaturee-demo-output` persists private snapshots.
Files and directories are created as unprivileged UID 10001; avoid changing
their permissions just to browse them.

~~~bash
docker compose --profile demo logs -f signaturee-demo
docker compose --profile demo down
~~~

The second command stops the demo but keeps the named volume.
To explicitly destroy **all** Compose-owned named volumes (including demo
snapshots), run `docker compose --profile demo down --volumes` only if you
intend to delete the demonstration results.

## Boundaries

- Port 8789 is published **only on 127.0.0.1**, never on 0.0.0.0.
- No authentication exists because there are **no actual employee accounts**:
  do not reverse-proxy or publicly expose this demo.
- The browser cannot choose a user, signature group, filesystem path or
  template. Only fixed, synthetic server-owned values are processed.
- The server rejects cross-origin generation requests and unknown hostnames.
- HTML previews use an iframe with the `sandbox` attribute and a restrictive
  content-security policy. HTML templates here are trusted, bundled fixtures.
- RTF still depends on installed LibreOffice inside the Docker image.
- LDAP/AD, HTTPS, multi-user authentication, production retention, Outlook
  deployment and real corporate templates **remain unverified**.

This demo does **not** replace the separate `signaturee-test` CLI for eventual
AD-lab acceptance. It is a frontend and integration milestone while the
machine cannot reach the domain controller.
