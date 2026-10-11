# Export layout catalogue audit (October 2026)

Date: 2026-10-09. Command: `uv run noh typeset-mei-audit --out build/typeset/mei/audit.json`

A text scan of the LilyPond sources (no LilyPond run). Counts are candidate signals only; the extractor and validators are the authority.

## Totals

- Sources: 859
- Classification: 859 candidate, 0 unknown-feature, 0 source-check-failed, 0 compile-failed
- `absent_targets`: 0
- `unknown_commands`: empty

## Feature families

| Family | Total occurrences | Files containing it |
|---|---:|---:|
| cross-staff | 6 | 4 |
| divisio-maior | 7962 | 722 |
| divisio-maxima | 7155 | 706 |
| divisio-minima | 15223 | 824 |
| finalis | 8468 | 858 |
| force-break | 3680 | 597 |
| hidden-stem | 0 | 0 |
| quilisma | 153 | 45 |
| stanza-marker | 1528 | 801 |
| voice-line-glissando | 251 | 84 |
| voice-line-voice | 857 | 857 |

## Proposed pilot (5 files)

1. `vol-5/missa-ix/kyrie_IX.ly`
2. `vol-3/al_ego_dilecto.csv.ly`
3. `vol-5/missa-ix/agnus_IX.ly`
4. `vol-5/missa-i/ite_Ib.ly`
5. `vol-2/co_inclina_aurem_tuam.csv.ly`

`proposed_pilot` equals `PILOT_FIXTURES`.
