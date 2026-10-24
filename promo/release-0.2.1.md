# pi-webman 0.2.1

Documentation and release plumbing. No runtime changes — `0.2.0` behaves identically.

- README documents the `/` command surface, the extension popup bridge, and the release flow.
- Publishing now happens in CI through npm Trusted Publishing (OIDC), so this release and every
  later one ships with a provenance attestation linking the tarball to this repository and
  commit. No long-lived `NPM_TOKEN` exists.

```bash
pi install npm:pi-webman
```
