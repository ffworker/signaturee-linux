# First test-AD-driven signature generation (CLI)

This is a **local command-line test harness**, not an administrator web UI,
self-service endpoint, or production release. It binds to a **test AD** over
strict LDAPS and can render a verified test account into a write-once snapshot
after explicit acknowledgment. Do not use production secrets or production
shares.

## Environment

Debian/Ubuntu VM with Node.js **24+**, LibreOffice Writer and Git. The VM
must resolve and reach its **test-domain controller TCP 636**, and trust its
server certificate (use the public CA PEM if privately signed).

~~~bash
git clone https://github.com/ffworker/signaturee-linux.git
cd signaturee-linux
npm ci
npm test
~~~

Create a **separate, private** JSON file (`chmod 600`), for example
`/home/tester/signaturee-test.json`, with absolute paths:

~~~json
{
  "schema": 1,
  "allowedTestAccounts": ["test.user"],
  "templatesRoot": "/home/tester/signaturee-templates",
  "outputRoot": "/home/tester/signaturee-test-output",
  "profiles": [
    { "key": "HR", "encoding": "utf-8", "images": ["HR-Dateien/logo.png"] }
  ],
  "mappings": [
    {
      "groupDn": "CN=Signature-HR,OU=TestGroups,DC=example,DC=invalid",
      "signatureKey": "HR"
    }
  ],
  "staticValues": {}
}
~~~

In the template directory, provide `HR_Template.htm`,
`HR_Template.txt`, and `HR-Dateien/logo.png`. Create the output
directory in advance; keep the source templates **read-only** and ensure
both the config and output are accessible only to the local test operator.

Set test-AD credentials **interactively**, not as CLI flags:

~~~bash
export SIGNATUREE_LDAP_URL='ldaps://dc-test.example.invalid:636'
export SIGNATUREE_LDAP_BASE_DN='OU=TestUsers,DC=example,DC=invalid'
export SIGNATUREE_LDAP_BIND_DN='CN=signaturee-reader,OU=Service,DC=example,DC=invalid'
export SIGNATUREE_LDAP_CA_FILE='/path/to/test-ca.pem'
read -rsp 'Read-only service bind password: ' SIGNATUREE_LDAP_BIND_PASSWORD
echo
export SIGNATUREE_LDAP_BIND_PASSWORD
~~~

### Step 1: preview only (no writes)

~~~bash
node scripts/generate-signatures.js --config /home/tester/signaturee-test.json \
  --user test.user --signature HR --preview --ack-test-directory
~~~

### Step 2: write-once output in an isolated test directory

~~~bash
node scripts/generate-signatures.js --config /home/tester/signaturee-test.json \
  --user test.user --signature HR --generate \
  --ack-test-directory --ack-test-output
unset SIGNATUREE_LDAP_BIND_PASSWORD
~~~

The output directory receives one private
`test.user--<random-uuid>/` snapshot with `HR.htm`, `HR.txt`,
`HR.rtf`, and its declared assets. This **does not deploy** anything
to the Windows Outlook profile. The existing snapshot publisher still
provides no stable `current` directory or automatic SMB deployment.

## Checks and safety limitations

- A test account must be explicitly listed in `allowedTestAccounts`.
  Another account is rejected **before LDAP is contacted**.
- `--preview` makes no output writes. `--generate` requires **both**
  acknowledgments, and cannot silently replace any prior snapshot.
- The config file must be a real file with restrictive `0600`-style
  permissions and an absolute path. It cannot be a symlink.
- Avoid using a Domain Admin service account: a delegated, read-only
  account is sufficient for lookup.
- The CLI does not authenticate an HTTP user; **the local OS account**
  is the operator trust boundary. Do not expose it to arbitrary users,
  web inputs, cron jobs with broad privileges or container networks.
- HTML and SVG must come from trusted administrators; the tool is not an
  HTML sanitizer. The initial test VM should be isolated from production
  networks and secrets.

These are **manual acceptance steps**. Automated GitHub tests use fake
directory clients and synthetic data only.
