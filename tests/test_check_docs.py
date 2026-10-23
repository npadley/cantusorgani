import pytest

from tools.check_docs import check_docs, main


@pytest.fixture
def repo(tmp_path):
    tmp_path = tmp_path / "repo"
    tmp_path.mkdir()
    (tmp_path / "pipeline").mkdir()
    (tmp_path / "pipeline/cli.py").write_text(
        'subs.add_parser("doctor")\nsubs.add_parser(\n "catalog", help="build")\n'
        "subs.add_parser('chants')\n"
    )

    (tmp_path / "tools").mkdir()
    return tmp_path


def write(repo, name, text=""):
    path = repo / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    return path


def test_check_docs_missing_path_reports_line(repo):
    write(repo, "README.md", "Intro\n\nSee `pipeline/missing.py`.\n")
    assert check_docs(repo) == ["README.md:3: pipeline/missing.py: path does not exist"]


@pytest.mark.parametrize("name", ["README.md", "AGENTS.md", "CLAUDE.md", ".claude/rules/guide.md"])
def test_check_docs_existing_path_ok(repo, name):
    write(repo, name, "Read `pipeline/cli.py`, `pipeline/` and `pyproject.toml`.")
    write(repo, "pyproject.toml")
    assert check_docs(repo) == []


@pytest.mark.parametrize("reference", ["data/*.yml", "data/**/*.yml", "data/file[12].yml"])
def test_check_docs_glob_matches_file(repo, reference):
    write(repo, "data/file1.yml")
    write(repo, "README.md", f"`{reference}`")
    assert check_docs(repo) == []


def test_check_docs_glob_requires_file(repo):
    (repo / "data/folder.yml").mkdir(parents=True)
    write(repo, "README.md", "`data/*.yml`")
    assert check_docs(repo) == ["README.md:1: data/*.yml: glob matches no files"]


@pytest.mark.parametrize("command", ["noh doctor", "uv run noh catalog", "noh chants"])
def test_check_docs_subcommand_exists(repo, command):
    write(repo, "README.md", f"`{command}`")
    assert check_docs(repo) == []


@pytest.mark.parametrize("command", ["noh vanished", "uv run noh vanished"])
def test_check_docs_missing_subcommand_reports_line(repo, command):
    write(repo, ".claude/rules/guide.md", f"Intro\n```bash\n{command} --flag\n```\n")
    assert check_docs(repo) == [".claude/rules/guide.md:3: noh vanished: unknown noh subcommand"]


@pytest.mark.parametrize("exists", [True, False])
def test_check_docs_script_name(repo, exists):
    if exists:
        write(repo, "scripts/check.sh")
    write(repo, "README.md", "```bash\n./scripts/check.sh --quick\n```\n")
    expected = [] if exists else ["README.md:2: scripts/check.sh: path does not exist"]
    assert check_docs(repo) == expected


def test_check_docs_bash_paths_and_inline_spans(repo):
    write(repo, "README.md", '``data/gone.yml``\n```bash\ncat "data/other.json"\n```')
    assert check_docs(repo) == [
        "README.md:1: data/gone.yml: path does not exist",
        "README.md:3: data/other.json: path does not exist",
    ]


def test_check_docs_bare_filename_is_not_checked(repo):
    write(repo, ".claude/rules/guide.md", "`screen.png` and `index.html`")
    assert check_docs(repo) == []


@pytest.mark.parametrize("reference", [
    "https://example.org/data/gone.py", "data/<volume>.yml", "data/{volume}.yml",
    "data/…/file.py", "data/.../file.py", "vendor/missing.py", "web/node_modules/a.ts",
    "web/public/vendor/missing.js", "noh <command>", "noh --help", "noh …-fetch",
])
def test_check_docs_ignored_references(repo, reference):
    write(repo, "README.md", f"`{reference}`")
    assert check_docs(repo) == []


def test_check_docs_scope_excludes_prose_nested_docs_and_non_bash_fences(repo):
    write(repo, "README.md", "data/missing.py\n```python\n`data/no.py`\n```\n")
    write(repo, ".claude/rules/nested/PLAN.md", "`data/missing.yml`")
    assert check_docs(repo) == []


@pytest.mark.parametrize("target,problem", [
    ("OTHER.md#hello-world", None),
    ("OTHER.md#hello-world-1", None),
    ("OTHER.md#café--code", None),
    ("OTHER.md#setext", None),
    ("OTHER.md#nope", "anchor does not exist"),
    ("MISSING.md#hello-world", "linked document does not exist"),
])
def test_check_docs_markdown_link_anchors(repo, target, problem):
    write(repo, ".claude/rules/OTHER.md", "# Hello, World!\n# Hello, World!\n## Café & `code`\n"
          "Setext\n------\n```bash\n# Not a heading\n```\n")
    write(repo, ".claude/rules/guide.md", f"Intro\n[guide]({target})\n")
    expected = [] if problem is None else [f".claude/rules/guide.md:2: {target}: {problem}"]
    assert check_docs(repo) == expected


def test_check_docs_links_relative_and_percent_encoded(repo):
    write(repo, "README.md", "# Café\n")
    write(repo, ".claude/rules/guide.md", "[home](../../README.md#caf%C3%A9)\n[web](https://x/a.md#no)")
    assert check_docs(repo) == []


def test_check_docs_heading_link_text_and_duplicate_slug_collision(repo):
    write(repo, "README.md", "# [Hello](https://example.org) **World**\n"
          "# Hello World-1\n# Hello World\n[go](#hello-world-2)")
    assert check_docs(repo) == []


def test_check_docs_fenced_heading_is_not_anchor(repo):
    write(repo, "README.md", "```bash\n# pretend\n```\n[bad](#pretend)")
    assert check_docs(repo) == ["README.md:4: #pretend: anchor does not exist"]


def test_check_docs_allowlist_is_scoped_and_preserves_anchor(repo):
    write(repo, "README.md", "`data/gone.yml`\n[bad](#gone)\n")
    write(repo, ".claude/rules/guide.md", "`data/gone.yml`")
    write(repo, "tools/check_docs_allow.txt", "# accepted\nREADME.md:data/gone.yml\n"
          "README.md:#gone\n\n")
    assert check_docs(repo) == [".claude/rules/guide.md:1: data/gone.yml: path does not exist"]


def test_check_docs_cli_exit_and_output(repo, capsys):
    write(repo, "README.md", "`pipeline/gone.py`")
    assert main(repo) == 1
    assert "README.md:1: pipeline/gone.py: path does not exist" in capsys.readouterr().out
    write(repo, "README.md", "`pipeline/cli.py`")
    assert main(repo) == 0


def test_check_docs_bare_filename_shorthand_resolves_in_repo(repo):
    write(repo, "data/catalog.json")
    write(repo, "data/sections/noh1.yml")
    write(repo, "README.md", "`catalog.json` and `noh*.yml`")
    assert check_docs(repo) == []


def test_check_docs_recursive_glob_matches_descendant_files(repo):
    write(repo, "data/src/vol/file.ly")
    write(repo, "README.md", "`data/src/**`")
    assert check_docs(repo) == []


def test_check_docs_placeholder_with_spaces_does_not_leak_tokens(repo):
    write(repo, "README.md", "`data/{kyrie, ite}_IX.ly`")
    assert check_docs(repo) == []


@pytest.mark.parametrize("heading,anchor", [
    ("_Setup_", "setup"),
    ("__Setup__", "setup"),
    ("`_Setup_`", "_setup_"),
    ("A &amp; B", "a--b"),
])
def test_check_docs_heading_formatting_uses_rendered_text(repo, heading, anchor):
    write(repo, "README.md", f"# {heading}\n[go](#{anchor})")
    assert check_docs(repo) == []


def test_check_docs_rooted_path_line_annotation_is_checked(repo):
    write(repo, "README.md", "`data/missing.py:12`")
    assert check_docs(repo) == ["README.md:1: data/missing.py: path does not exist"]


def test_check_docs_glob_ignores_vendor_matches(repo):
    write(repo, "data/vendor/a.py")
    write(repo, "README.md", "`data/**/*.py`")
    assert check_docs(repo) == ["README.md:1: data/**/*.py: glob matches no files"]


def test_check_docs_local_only_paths_are_accepted(repo):
    write(repo, "README.md", "`web/.env`, `.claude/worktrees/` and `web/dist`")
    assert check_docs(repo) == []


def test_check_docs_astro_route_brackets_are_literal(repo):
    write(repo, "web/src/pages/chant/[id].json.ts")
    write(repo, "README.md", "`web/src/pages/chant/[id].json.ts`")
    assert check_docs(repo) == []


@pytest.mark.parametrize('build_exists', [False, True])
def test_check_docs_generated_build_paths_are_local_only(repo, build_exists):
    if build_exists:
        (repo / 'build').mkdir()
    write(repo, 'README.md', '`build/identities/snapshot.json` and `build/mei/stale/stale.json`')
    assert check_docs(repo) == []


@pytest.mark.parametrize("prefix", ["cantusorgani-docs/", "../cantusorgani-docs/"])
@pytest.mark.parametrize("linked", [False, True])
@pytest.mark.parametrize("state", ["ok", "broken", "absent"])
def test_check_docs_sibling_references(repo, prefix, linked, state):
    sibling = repo.parent / "cantusorgani-docs"
    if state != "absent":
        sibling.mkdir()
    if state == "ok":
        write(sibling, "GUIDE.md", "# Setup")
    reference = prefix + "GUIDE.md"
    text = f"[guide]({reference}#setup)" if linked else f"`{reference}`"
    write(repo, "AGENTS.md", text)
    problems = check_docs(repo)
    if state == "broken":
        assert len(problems) == 1
        assert "does not exist" in problems[0]
    else:
        assert problems == []


def test_check_docs_worktree_uses_main_checkout_sibling(repo, monkeypatch):
    main = repo / "main"
    main.mkdir()
    sibling = repo / "cantusorgani-docs"
    write(sibling, "GUIDE.md", "# Setup")
    monkeypatch.setattr("pipeline.doc_paths.subprocess.check_output",
                        lambda *args, **kwargs: str(main / ".git") + "\n")
    write(repo, "AGENTS.md", "`cantusorgani-docs/GUIDE.md`")
    assert check_docs(repo) == []


def test_check_docs_sibling_link_missing_anchor_reports(repo):
    write(repo.parent / "cantusorgani-docs", "GUIDE.md", "# Setup")
    write(repo, "AGENTS.md", "[guide](cantusorgani-docs/GUIDE.md#gone)")
    assert check_docs(repo) == [
        "AGENTS.md:1: cantusorgani-docs/GUIDE.md#gone: anchor does not exist"
    ]


@pytest.mark.parametrize("exists", [True, False])
def test_check_docs_private_non_markdown_link(repo, exists):
    sibling = repo.parent / "cantusorgani-docs"
    sibling.mkdir()
    if exists:
        write(sibling, "ui/routes.json", "[]")
    write(repo, "AGENTS.md", "[routes](cantusorgani-docs/ui/routes.json)")
    expected = [] if exists else [
        "AGENTS.md:1: cantusorgani-docs/ui/routes.json: linked document does not exist"
    ]
    assert check_docs(repo) == expected
