"""Strict proofreading must detect errors the chant matcher tolerates."""
from fractions import Fraction

from pipeline.typeset import proof_notes as p


def sequence(steps):
    return p.NoteSequence(tuple(p.Note(n) for n in steps))


def test_complete_transposition_and_local_change():
    exact = p.compare_notes(sequence([3, 5, 7, 6]), sequence([0, 2, 4, 3]))
    assert exact.diatonic_equal and exact.transposition == 3
    changed = p.compare_notes(sequence([3, 5, 8, 6]), sequence([0, 2, 4, 3]))
    assert not changed.diatonic_equal
    assert any(op[0] == 'replace' for op in changed.opcodes)


def test_extra_missing_and_tail_notes_cannot_pass():
    chant = sequence([0, 2, 4, 3, 0])
    for ours in ([0, 2, 2, 4, 3, 0], [0, 2, 3, 0], [0, 2, 4, 3]):
        assert not p.compare_notes(sequence(ours), chant).diatonic_equal


def test_repeated_attacks_are_not_collapsed():
    assert not p.compare_notes(sequence([0, 0, 1]), sequence([0, 1])).diatonic_equal
    assert [n.step for n in p.read_gabc('(c4) A(jvvksss)').notes] == [0, 0, 1, 1, 1]


def test_gabc_accidental_is_a_glyph_not_an_attack_and_scope_is_flagged():
    seq = p.read_gabc('(c4) A(ixi) B(j+) C(j)')
    assert [n.step for n in seq.notes] == [-1, 0]
    assert seq.notes[0].alteration is None
    assert any('accidental' in f for f in seq.flags)


def test_gabc_flat_clef_and_changed_clef():
    seq = p.read_gabc('(cb4) A(ij) (f3) B(hg)')
    assert [n.step for n in seq.notes] == [-1, 0, 3, 2]
    assert any('accidental' in f for f in seq.flags)


def test_explicit_repeats_preserve_attack_counts_and_origins():
    seq = p.read_gabc('(c4) Ky(jk)ri(l)e(kj) <i>iij.</i>(::) Chri(kl)ste(j) (::)', expand=True)
    assert [n.step for n in seq.notes] == [0, 1, 2, 1, 0] * 3 + [1, 2, 0]
    assert seq.transformations == ('phrase repeated 3 times',)
    assert seq.notes[5].origin == seq.notes[0].origin


def test_malformed_and_unsupported_gabc_are_not_clean():
    for gabc in ('(c4) A(jk', '(c4) A(j[nm1])', '(c4) A({j}k)', 'A(jk)'):
        assert p.read_gabc(gabc).flags
    assert not p.compare_notes(sequence([]), sequence([])).diatonic_equal


def test_event_reader_joins_real_ties_preserves_alterations_and_maps_lines():
    tsv = '\n'.join([
        '0\tup:chant\tnote\t2\t-1/2\t0\t2\t0\t1\t1/4\t6:2',
        '0\tlyrics\tlyric\tKy\t',
        '0\tup:chant\ttie',
        '1/4\tup:chant\tnote\t2\t-1/2\t0\t2\t0\t1\t1/4\t6:8',
        '1/2\tup:chant\tnote\t3\t0\t0\t2\t0\t1\t1/4\t7:1',
        '1/2\tlyrics\tlyric\trie\t',
    ])
    seq = p.read_events(tsv, inserted_after=2)
    assert [n.step for n in seq.notes] == [2, 3]
    assert seq.notes[0].alteration == Fraction(-1, 2)
    assert seq.notes[0].origin == '5:2'
    assert seq.notes[0].lyric == 'Ky'
    assert not seq.flags


def test_invalid_ties_and_simultaneous_voices_are_flagged():
    row = '0\tup:chant\tnote\t0\t0\t0\t2\t0\t1\t1/4\t5:1'
    assert p.read_events(row + '\n0\tup:chant\ttie').flags
    assert p.read_events(row + '\n' + row.replace('up:chant', 'down:chant')).flags
    changed = row + '\n0\tup:chant\ttie\n' + row.replace('0\tup', '1/4\tup').replace('note\t0', 'note\t1')
    assert len(p.read_events(changed).notes) == 2
    assert p.read_events(changed).flags


def test_chromatic_difference_is_separate_from_diatonic_agreement():
    ours = p.NoteSequence((p.Note(0), p.Note(1, Fraction(-1, 2)), p.Note(2)))
    chant = sequence([0, 1, 2])
    result = p.compare_notes(ours, chant)
    assert result.diatonic_equal and not result.chromatic_equal
