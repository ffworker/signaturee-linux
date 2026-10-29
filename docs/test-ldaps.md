# First real LDAPS smoke test (test domain only)

This is an **optional manual integration test**, not part of CI. The GitHub
unit tests use an isolated fake LDAP directory and never contact your domain.

## Prepare a disposable Debian/Ubuntu VM

Install **Node.js 24+** and Git, check out the current review branch and install
locked dependencies:

~~~bash
git clone https://github.com/ffworker/signaturee-linux.git
cd signaturee-linux
git fetch origin feature/ldap-render-bridge-and-smoke
git switch feature/ldap-render-bridge-and-smoke
npm ci
npm test
~~~

The VM needs DNS and TCP 636 access to a **test AD domain controller**.
Use a **read-only service account** and a **non-privileged test user**.
If the DC uses an internal CA, copy its **public CA certificate** (not its
private key) into a local PEM file.

In a local interactive shell only:

~~~bash
export SIGNATUREE_LDAP_URL='ldaps://dc-test.example.invalid:636'
export SIGNATUREE_LDAP_BASE_DN='OU=TestUsers,DC=example,DC=invalid'
export SIGNATUREE_LDAP_BIND_DN='CN=signaturee-reader,OU=Service,DC=example,DC=invalid'
export SIGNATUREE_LDAP_CA_FILE='/path/to/test-ca.pem'
read -rsp 'Read-only service bind password: ' SIGNATUREE_LDAP_BIND_PASSWORD
echo
export SIGNATUREE_LDAP_BIND_PASSWORD
npm run ldap:probe -- --user test.user --ack-test-directory
unset SIGNATUREE_LDAP_BIND_PASSWORD
~~~

Replace all `example.invalid` values with **your test domain only**.
If your test DC uses a certificate from an already trusted public CA,
the CA-file variable can be omitted.

The command never prints actual attributes, usernames, password values or
group DNs. A passing result means only that the service bind, LDAP TLS,
read-only enabled-account lookup and direct memberOf parsing worked.
It **does not** validate end-user password authentication, group assignment
against company-specific templates, RTF output, SMB rights or Outlook layout.

**Never** put passwords in the command line, a GitHub issue, CI variables
for public PRs, a Docker image or a committed `.env` file. Clear the interactive
shell after testing as appropriate. Do not point this early-development code
at production AD without an explicit security review.

## In-memory integration test

`npm test` exercises the newly connected pipeline:

- LDAP-like enabled user → direct group DNs
- exact full-DN admin group mappings → eligible signatures
- explicitly selected subset → HTML/TXT with synthetic golden outputs

No generator writes files or makes external connections at this stage. The
browser/HTTP API and real output publishing come later.
