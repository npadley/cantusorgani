# MEI 5.0 schema (vendored)

- **Release:** music-encoding/music-encoding tag `v5.0` (published 2023-09-05).
- **Archive:** https://github.com/music-encoding/music-encoding/releases/download/v5.0/MEI_Schemata_v5.0.zip
  - archive sha256: `fe5f21dc86f7733642d3689c52b5f3cb7771bad3f705d423478cde1504221687`
  - the release's detached `.asc` signature was downloaded but not verified (no `gpg` on the build host).
- **Downloaded:** 2026-10-09 (UTC).
- **Licence:** Educational Community License 2.0 (ECL-2.0). Confirmed by the header comment in `mei-CMN.rng` ("Licensed under the Educational Community License version 2.0") and by the repository `LICENSE` at tag `v5.0` (copy vendored here as `LICENSE`).
- **Vendored files:** only `mei-CMN.rng`. It is self-contained: it has no `<include>` or `<externalRef>`, so no other file is needed. The other schemata in the archive (`mei-all`, `mei-basic`, `mei-Mensural`, `mei-Neumes`, the `.odd` sources) are deliberately not vendored.

| file | bytes | sha256 |
|---|---|---|
| `mei-CMN.rng` | 1342561 | `fa2081b4e0c858e1dcde339b1b733b8e6350212a46c0db50b94cc71bbe68ca4c` |
| `LICENSE` | 893 | `5c5d273168ce857aafe81c0de800b3d63440084eb86386b8db80005ee5746a61` |

`SchemaBundle.sha256` ("sha256 of the sorted concatenated files") covers the schema files only, which here is just `mei-CMN.rng`; A3 computes it over `mei-CMN.rng` (LICENSE and SOURCE.md excluded).
