# Offline template workbench (no LDAP)

Use **your own locally maintained** HTML and TXT signature templates while the laptop cannot access AD. This is a deliberately separate Compose service from the bundled DEMO, accessible only on `127.0.0.1:8790`. It uses the real template catalog, escaping, LibreOffice conversion and atomic output snapshots, but **only synthetic user attributes**.

## Quick start

1. In `signaturee-linux/.env`, set:
   ~~~dotenv
   SIGNATUREE_OFFLINE_PROFILE=HR
   SIGNATUREE_PROFILES_JSON='[{"key":"HR","encoding":"utf-8","images":[]}]'
   SIGNATUREE_OFFLINE_USER_JSON='{"displayName":"Alex Müller (Offline Test)","mail":"alex@example.invalid","title":"IT Engineer"}'
   SIGNATUREE_STATIC_VALUES_JSON='{"footer":"Example GmbH"}'
   ~~~
   The profile must exist in `SIGNATUREE_PROFILES_JSON`. No AD group DNs or LDAP credentials are used by the workbench.

2. Place your trusted admin-authored files inside `dev/templates`:
   ~~~text
   dev/templates/
     HR_Template.htm
     HR_Template.txt
   ~~~
   Template placeholders include `$displayName`, `$givenName`, `$sn`, `$mail`, `$title`, `$department`, `$telephoneNumber`, `$mobile`, `$accountName`, `$userPrincipalName`, plus configured `SIGNATUREE_STATIC_VALUES_JSON` keys such as `$footer`. Keep template files readable by UID 10001. A missing or unreadable file causes startup to fail clearly in the container logs.

   Images referenced as `HR-Dateien/logo.png` must physically exist under `dev/templates/HR-Dateien/logo.png` and be listed in the profile JSON's `images` array. They are embedded as data images for the sandboxed browser preview; the generated HTML and RTF use the original image paths/assets.

3. Start and open the workbench:

   ~~~bash
   mkdir -p dev/templates
   docker compose --profile workbench up --build -d signaturee-workbench
   docker compose --profile workbench logs -f signaturee-workbench
   ~~~

   Browse to **http://127.0.0.1:8790/** on the same host. **Refresh preview** reloads local template file changes without rebuilding. **Generate** writes real HTML/TXT/RTF results into a dedicated persistent named Docker volume. Download the resulting files from the browser.

   ~~~bash
   docker compose --profile workbench down
   ~~~

## Important boundaries

- The workbench **never gets** `SIGNATUREE_LDAP_URL`, the service-account password or other LDAP configuration as container environment variables. It does not initiate LDAP connections.
- Your local `.env` may contain lab secrets, but this service receives only the four offline/template variables listed in Compose. Keep `.env` ignored in Git.
- User data are synthetic, with fixed `accountName=example.user`; there is no login or authorization over real AD. Templates and static variables are admin-controlled, not submitted by browser requests.
- The HTTP service is unauthenticated, on localhost only. Do not publish it through a public reverse proxy, LAN binding or tunnel.
- This mode tests rendering, local template files, declared images, conversion and downloads. It **does not** prove AD connections, AD group membership, real production signature compatibility, or Outlook deployment.
- RTF conversion and the browser preview may render external references embedded in **trusted** HTML; use only templates you administer. The UI iframe is sandboxed.
- Named volume `signaturee-workbench-output` holds the test snapshots; `docker compose down` preserves it.

The original [bundled DEMO](offline-demo.md) remains available at `127.0.0.1:8789` independently.
