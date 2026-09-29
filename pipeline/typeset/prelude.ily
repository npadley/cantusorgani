% Every rendered format: included right after the house style by
% pipeline/typeset/render.py, before the music. The site's page names the
% part, so the part's name at the start of the first line ("Alleluia I", "I.")
% is left out, and so is the indent kept for it (the house style's own
% \layout sets one, which a \paper setting cannot override).
\layout {
  indent = 0
  short-indent = 0
  \context { \GrandStaff \remove "Instrument_name_engraver" }
  \context { \PianoStaff \remove "Instrument_name_engraver" }
  \context { \Staff \remove "Instrument_name_engraver" }
}
