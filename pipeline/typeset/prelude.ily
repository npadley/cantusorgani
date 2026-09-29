% Every rendered format: included right after the house style by
% pipeline/typeset/render.py, before the music. The site's page names the
% part, so the part's name at the start of the first line ("Alleluia I", "I.")
% is left out; with no indent it would be cut off anyway.
\layout {
  \context { \GrandStaff \remove "Instrument_name_engraver" }
  \context { \PianoStaff \remove "Instrument_name_engraver" }
  \context { \Staff \remove "Instrument_name_engraver" }
}
