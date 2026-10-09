# S5: MEI 5.0 schema validator (2026-10-08)

## Decision

**Validator: `lxml.etree.RelaxNG`, lxml 6.1.3 (libxml2 2.14.6), Python 3.14.7.** `jing` is not needed and was not tried. Java is **not available** on this host (`/usr/bin/java` is the macOS stub: "Unable to locate a Java Runtime"), so jing would be unusable here anyway.

**Dependency for the coordinator:** add `lxml>=5,<7` to `pyproject.toml` (6.1.3 was tested; 5.x was not run). Ship the `SchemaBundle.validator` string as `lxml-relaxng 6.1.3` (derive it from `etree.LXML_VERSION` at runtime).

Schema: `data/typeset/mei/schemas/mei-5.0/mei-CMN.rng` (MEI v5.0, ECL-2.0, self-contained, no includes). Provenance and hashes are in `SOURCE.md` beside it. Compile time is about 0.3 s.

## Result on the experiment MEI

`tests/fixtures/mei/kyrie-ix/experiment.mei`: **VALID, 0 errors.**

Negative control (same file with `<bogus/>` inserted inside `<mdiv>`): INVALID, 1 error, `line 13: Did not expect element bogus there`. So the validator is really enforcing the schema.

## Throwaway harness

Installed with `uv venv build/s5venv && uv pip install --python build/s5venv lxml` (`build/` is gitignored; `pyproject.toml` untouched). Harness `build/s5/validate.py`, essential parts:

```python
P = lambda: etree.XMLParser(resolve_entities=False, no_network=True, load_dtd=False)
schema = etree.RelaxNG(etree.parse(".../mei-CMN.rng", P()))   # the schema is parsed with the same hardened parser
doc = etree.parse(path, P())
if doc.docinfo.doctype or doc.docinfo.system_url or doc.docinfo.public_id:
    reject("DOCTYPE present")
ok = schema.validate(doc); errors = schema.error_log
```

With `--block-net` the harness first replaces `socket.socket`, `socket.create_connection` and `socket.getaddrinfo` with functions that raise.

## No-network proof

Run with the socket shim (any socket use would raise `RuntimeError`):

```
$ build/s5venv/bin/python build/s5/validate.py --block-net tests/fixtures/mei/kyrie-ix/experiment.mei
compile_s=0.30
tests/fixtures/mei/kyrie-ix/experiment.mei VALID 0 errors     (exit 0)
```

Identical output to the unblocked run. The schema compiles and validates with no socket creation.

## DOCTYPE and entity rejection

Four hostile documents (built from the experiment MEI), all run under the socket shim: external DTD (`SYSTEM "http://127.0.0.1:9/x.dtd"`), file entity (`SYSTEM "file:///.../secret.txt"` used as the title), http entity (`SYSTEM "http://127.0.0.1:9/e"`), and a nested internal-entity bomb. Result for all four: `REJECT: DOCTYPE present`, no exception from the shim, nothing fetched.

What the parser flags do on their own (parse only, no explicit guard): the entity reference stays an unexpanded `Entity` node (`<title>&xxe;</title>`); the secret file content never appears (`title.text` is `None`), and the bomb stays `&c;` (no expansion). `no_network=True` and `load_dtd=False` mean the DTD is not read.

**Important finding:** schema validation does *not* reject these documents. With only the hardened parser, `RelaxNG.validate` returns **True** for all three entity documents (the unexpanded entity node is ignored by the validator). Therefore **the DOCTYPE guard is mandatory, not optional**: `validate_schema` must reject any input where `doc.docinfo.doctype`, `system_url` or `public_id` is non-empty (the doctype string was `<!DOCTYPE mei>` even for an internal-subset-only document). Recommended belt and braces: also refuse bytes containing `<!DOCTYPE` or `<!ENTITY` before parsing, and produce a `Diagnostic` (blocker) rather than an exception.

## Risks and notes

- Python 3.14 wheel of lxml 6.1.3 was available; the repo's declared Python (3.12+) is untested here.
- `libxml2` RelaxNG is slower/less strict than jing on some Schematron-embedded rules: the `.rng` contains `sch:` Schematron rules (ignored by libxml2 RelaxNG). Constraints that exist only in the embedded Schematron (e.g. some cross-attribute checks) are **not enforced**. Recorded as a known gap; "valid" means structurally valid RelaxNG, not Schematron-clean.
- The vendored `LICENSE` is the ECL notice file from the tag (893 B), not the full ECL text; the full text is at https://opensource.org/licenses/ECL-2.0.
- The release signature (`.asc`) was not verified (no gpg); integrity rests on the sha256 values recorded in `SOURCE.md` (taken from a TLS download from GitHub).
