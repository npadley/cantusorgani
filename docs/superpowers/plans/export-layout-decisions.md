# Export Layout — Decision Log

Append-only. Each entry: date, ID, decision, evidence, owner. Spikes (S0–S7) append their outcomes here before any dependent task starts. Agents must not reopen a recorded decision; raise a blocker to the coordinator instead.

| ID | Date | Decision | Evidence / reason | Owner |
|---|---|---|---|---|
| D1 | 2026-10-08 | **MEI/Verovio in-browser reflow is v1.** Pre-rendered LilyPond presets and server-side LilyPond are not v1. Server-side native LilyPond (reusing `render.py::wrap`) is the named fallback **only** if gate G1 (musical fidelity) or G2 (PDF fidelity) fails. | Organist request: change page size, staff size and number of systems and have the music reflow. Kyrie IX experiment matched all 358 pitches and onsets in MEI. CEO review's presets-first recommendation was considered and rejected. | User |
| D2 | 2026-10-08 | Core use case: an organist fits music to a custom printed page **or to an iPad reader app such as forScore**. FIT controls (music size, systems per page) are primary. | User statement 2026-10-08. | User |
| D3 | 2026-10-08 | v1 controls: page size, orientation, margins, music size, systems per page, line breaks, **manual break editing**, sung text size, space between systems. **Deferred:** music-font choice (Bravura) and text-font choice (serif/sans). v1 ships Leipzig and one bundled text face; the controls are not rendered. | User selection. Reviews flagged both font choices as unproven (Verovio text metrics, Bravura PDF). | User |
| D4 | 2026-10-08 | Page sizes are **Print** (Letter, A4, A5) / **iPad** (mini, 11-inch, 13-inch at physical screen size) / **Custom** (90–450 mm per side, ratio ≤ 3). Margins 3–25 mm; default 12 print, 4 iPad/Custom; advisory under 6 mm on print. Preset dimensions provisional until S7. | User selection of the design review's proposal. | User |
| D5 | 2026-10-08 | "Customize export" button renders only when at least one segment on the page has an approved conversion. | Design review §1.8; avoids an elaborate paper picker for scans-only pages. Coordinator default; user may override. | Coordinator |
| D6 | 2026-10-08 | **Pilot:** Kyrie IX (`movement:ordinarium-missae-ix/kyrie`, `vol-5/missa-ix/kyrie_IX.ly`) is the only public pilot. Converter work must also pass fixtures F2–F5 (`PILOT_FIXTURES` in contracts §2): `vol-3/al_ego_dilecto.csv.ly`, `vol-5/missa-ix/agnus_IX.ly`, `vol-5/missa-i/ite_Ib.ly`, `vol-2/co_inclina_aurem_tuam.csv.ly`. G1 cannot pass on Kyrie alone. | Eng review: 857/859 sources carry a hidden `voiceLines` voice, 92 use `\voiceLine`, 45 use `\quil`; Kyrie IX uses none. All five fixtures are matched in `data/typeset/manifest.json`. | User |
| D7 | 2026-10-08 | Container is a full-screen native `<dialog>` with a history entry (Back closes). Not a drawer or route. | Design review §6: selection state lives in page DOM; preview needs the full iPad screen; native dialog gives focus containment. | Coordinator |
| D8 | 2026-10-08 | Verovio runs at `scale: 100`, page in 0.1 mm units; staff `unit` 7/9/12 = 5.6/7.2/9.6 mm. The experiment's `scale: 40` results (incl. "4 + 1 systems on Letter/Large") are not acceptance criteria. | Eng review §2c. | Coordinator |
| D9 | 2026-10-08 | Kyrie IX experiment artifacts are checked in by S0. python-ly `xml-export.ily` (GPL) is **not** vendored (repo is CC0). | Eng review §2a/b. | Coordinator |
| D10 | 2026-10-08 | Execution: Opus coordinates and runs spikes S1–S4, S7; Sonnet and Haiku implement per the execution packet. Gates G0–G4 retained. Escalation checkpoints (not kill switches): if S1 + A2 + A3 together exceed 4 weeks, or S4 exceeds 2 weeks, the coordinator stops and reviews with the user before continuing. | CEO review time-box recommendation, adapted to D1. | Coordinator |
| D11 | 2026-10-08 | Add export analytics (task B0): one GoatCounter event per export recording quick vs custom, page preset, orientation, staff size, systems cap, line policy. No personal data. | CEO review: no demand data exists; informs which presets matter. | Coordinator |

## Spike outcomes

_(S0–S7 append here: date, spike, decision, evidence paths, consequences for downstream tasks.)_
