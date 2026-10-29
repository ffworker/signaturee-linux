# LDAP adapter (experimental, not connected to the UI)

This code is an isolated **Active Directory** directory adapter for the future
Linux application. It is **not connected** to the web UI, renderer or any HTTP
endpoint. No external AD account or network was accessed by the tests.

## Initial design

- Use **LDAPS** (default port 636) with strict certificate validation, finite
  timeouts and a trusted CA when your AD certificate is privately issued.
- Use a **read-only, least-privileged service account** for lookup, then verify
  a user's password by binding **as that user** over a separate LDAPS connection.
- Never pass credentials to the frontend. No anonymous login, no empty-password
  bind, no TLS disable switch, no logging raw directory exceptions.
- Only AD enabled user accounts (`userAccountControl` disabled bit unset) are
  returned. Missing/invalid status must fail closed.
- `memberOf` is **direct group membership only**. Do not implicitly expand
  nested groups or expand signatures beyond the selections authorized by the
  server. The new renderer's selection contract remains authoritative.
- Escape LDAP filters; never interpolate unescaped user-controlled values.
- Reject multiple results when looking up one identity.

## Test it

~~~bash
npm test
~~~

The provider is tested using an **in-memory fake LDAP client**. The fake has
hardcoded `example.invalid` identities and fake credentials; it does not
connect to an actual domain. A real AD connection and its TLS/identity/group
semantics must be tested later on a permitted test environment.

## Intended production integration

The service will call `createDirectoryProvider(config)` after installing its
pinned LDAP client dependency. The default factory dynamically imports
`ldapts` to avoid hard-coupling tests to an LDAP server. The module expects
a service bind identity, a search base DN and LDAPS server URL. No production
configuration, API, secrets mechanism or automatic LDAP trust bypass is
implemented by this PR.

**Do not use a domain admin** for service lookup. Test the server TLS chain
and service account read permissions first. Then test real user authentication
with a dedicated test account; do not point an unreviewed prototype at your
production Active Directory.
