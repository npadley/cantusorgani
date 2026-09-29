% The phone layout: included right after the house style by
% pipeline/typeset/render.py. The book's line breaks (\forceBreak, \break) are
% too long for a phone, so they only allow a break here, and a line may break
% between any two notes (unmetred chant has no bar lines to break at).
forceBreak = { \bar "" }
break = {}
\layout {
  \context { \Score
    forbidBreakBetweenBarLines = ##f
    \override SpacingSpanner.spacing-increment = #0.7
    \override SpacingSpanner.shortest-duration-space = #1.2
  }
  \context { \Lyrics
    \override LyricSpace.minimum-distance = #0.6
    \override LyricHyphen.minimum-distance = #0.4
  }
}
