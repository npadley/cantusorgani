% listen_full.ily: the MEI extractor's iteration-time listener (spike S1).
%
% Writes one tab-separated row per record to <output-name>.listen.tsv while
% LilyPond iterates and engraves (no page output is needed: -dno-print-pages).
% The grammar is contracts §4 (docs/superpowers/plans/2026-10-08-export-contracts.md);
% docs/superpowers/experiments/s1-extraction.md explains each row.
%
% The including wrapper may define `listen-full-root` (an absolute directory
% ending in "/") before including this file; locations under it are written
% relative to it, so the TSV never holds an absolute developer path.
%
% This file is trusted and our own. It only reads music and grobs and writes
% the TSV; it never changes what is engraved.

#(define listen-full-version "listen_full/1")

#(define listen-full-root
   (if (defined? 'listen-full-root) listen-full-root ""))

#(define listen-full-port
   (let ((port (open-output-file (string-append (ly:parser-output-name) ".listen.tsv"))))
     (set-port-encoding! port "UTF-8")
     port))

% ---------------------------------------------------------------- formatting

#(define (lf-moment->string m)
   (let ((main (ly:moment-main m)) (grace (ly:moment-grace m)))
     ;; A grace moment is written "main@grace" so that a reader expecting a
     ;; plain rational fails loudly instead of mis-timing a grace note.
     (if (zero? grace)
         (format #f "~a" main)
         (format #f "~a@~a" main grace))))

#(define (lf-now context) (lf-moment->string (ly:context-current-moment context)))

#(define (lf-escape text)
   (let loop ((cs (string->list text)) (out '()))
     (if (null? cs)
         (list->string (reverse out))
         (let ((c (car cs)))
           (loop (cdr cs)
                 (cond ((char=? c #\\) (append (list #\\ #\\) out))
                       ((char=? c #\tab) (append (list #\t #\\) out))
                       ((char=? c #\newline) (append (list #\n #\\) out))
                       ((char=? c #\return) (append (list #\r #\\) out))
                       (else (cons c out))))))))

#(define (lf-emit onset . fields)
   (display (string-join (map (lambda (f) (format #f "~a" f)) (cons onset fields)) "\t")
            listen-full-port)
   (newline listen-full-port)
   (force-output listen-full-port))

#(define (lf-relative file)
   (let ((n (string-length listen-full-root)))
     (if (and (> n 0) (string-prefix? listen-full-root file))
         (substring file n)
         file)))

#(define (lf-loc event)
   (let ((o (and (ly:stream-event? event) (ly:event-property event 'origin))))
     (if (ly:input-location? o)
         (let ((l (ly:input-file-line-char-column o)))
           (format #f "~a:~a:~a" (lf-relative (car l)) (cadr l) (cadddr l)))
         "-")))

#(define (lf-cause grob)
   (let ((c (ly:grob-property grob 'cause)))
     (cond ((ly:stream-event? c) c)
           ((ly:grob? c) (lf-cause c))
           (else #f))))

% ---------------------------------------------------------- context naming

% Staves: the id, or "staff#<n>" in creation order; index is 1-based creation order.
#(define lf-staff-names (make-hash-table))
#(define lf-staff-count 0)
#(define (lf-staff-entry staff)
   (or (hashq-ref lf-staff-names staff)
       (begin
         (set! lf-staff-count (+ lf-staff-count 1))
         (let* ((id (ly:context-id staff))
                (entry (cons (if (string-null? id) (format #f "staff#~a" lf-staff-count) id)
                             lf-staff-count)))
           (hashq-set! lf-staff-names staff entry)
           entry))))
#(define (lf-staff-name staff) (car (lf-staff-entry staff)))
#(define (lf-staff-of context)
   (let ((staff (ly:context-find context 'Staff)))
     (if staff (lf-staff-name staff) "-")))

% Layers: "<home staff>:<voice id or #ordinal>", fixed at the voice's first
% record (so a later \change Staff never renames it). The ordinal counts
% voices in first-record order, as LayerDef.ordinal does.
#(define lf-layer-names (make-hash-table))
#(define lf-layer-count 0)

#(define (lf-voice-command context)
   ;; \voiceOne..\voiceFour (make-voice-props-set n) set Stem.direction to
   ;; 1/-1 (odd n is down) and NoteColumn.horizontal-shift to (quotient n 2).
   (let* ((stem (ly:context-grob-definition context 'Stem))
          (col (ly:context-grob-definition context 'NoteColumn))
          (dir (assq-ref stem 'direction))
          (shift (assq-ref col 'horizontal-shift)))
     (cond ((not (number? dir)) "none")
           ((and (= dir 1) (eqv? shift 0)) "voiceOne")
           ((and (= dir -1) (eqv? shift 0)) "voiceTwo")
           ((and (= dir 1) (eqv? shift 1)) "voiceThree")
           ((and (= dir -1) (eqv? shift 1)) "voiceFour")
           (else "none"))))

#(define (lf-layer context)
   (or (hashq-ref lf-layer-names context)
       (let* ((ordinal lf-layer-count)
              (id (ly:context-id context))
              (home (lf-staff-of context))
              (name (format #f "~a:~a" home (if (string-null? id) (format #f "#~a" ordinal) id))))
         (set! lf-layer-count (+ lf-layer-count 1))
         (hashq-set! lf-layer-names context name)
         (lf-emit (lf-now context) name home "voice" ordinal (lf-voice-command context))
         name)))

#(define lf-lyrics-names (make-hash-table))
#(define lf-lyrics-count 0)
#(define (lf-lyrics-name context)
   (or (hashq-ref lf-lyrics-names context)
       (let* ((id (ly:context-id context))
              (name (format #f "lyrics:~a" (if (string-null? id) (format #f "#~a" lf-lyrics-count) id))))
         (set! lf-lyrics-count (+ lf-lyrics-count 1))
         (hashq-set! lf-lyrics-names context name)
         name)))

% Note events -> the layer that played them, for the staff-level Accidental row.
#(define lf-event-layer (make-hash-table))
#(define lf-staff-clefs (make-hash-table))

% -------------------------------------------------------------- vocabulary

#(define lf-steps #("c" "d" "e" "f" "g" "a" "b"))

#(define (lf-division-kind stencil)
   (cond ((eq? stencil ly:breathing-sign::finalis) "finalis")
         ((eq? stencil ly:breathing-sign::divisio-maxima) "maxima")
         ((eq? stencil ly:breathing-sign::divisio-maior) "maior")
         ((eq? stencil ly:breathing-sign::divisio-minima) "minima")
         (else "other")))

#(define (lf-head-stencil stencil)
   (cond ((eq? stencil ly:note-head::print) "normal")
         ;; noh2.ily \quil: NoteHead.stencil = ly:text-interface::print (scripts.prall glyph)
         ((eq? stencil ly:text-interface::print) "quilisma")
         ((not stencil) "none")
         (else "other")))

#(define (lf-accidental alteration)
   (cond ((not (number? alteration)) "other")
         ((= alteration 0) "natural")
         ((= alteration 1/2) "sharp")
         ((= alteration -1/2) "flat")
         ((= alteration 1) "double-sharp")
         ((= alteration -1) "double-flat")
         (else "other")))

% Grob booleans: an unset property reads as '(), which Guile treats as true.
#(define (lf-true? x) (eq? x #t))
#(define (lf-bool x) (if (lf-true? x) 1 0))
#(define (lf-hidden? grob)
   (or (lf-true? (ly:grob-property grob 'transparent))
       (not (ly:grob-property-data grob 'stencil))))

% A blank lyric token (`_`, or "" in quotes) is written as the empty string.
#(define (lf-lyric-text text)
   (let ((s (if (string? text) text (markup->string text))))
     (if (string-null? (string-trim-both s)) "" (lf-escape s))))

% Source spacing overrides in force for this note (\shiftRight, \sa..\se,
% \voiceLineStyle): read from the Voice's NoteColumn definition, not the
% grob, because noh2.ily's Slur_spacing_engraver rewrites grob extents.
#(define (lf-column context layer event)
   (let* ((def (ly:context-grob-definition context 'NoteColumn))
          (shift (assq-ref def 'force-hshift))
          (extent (assq-ref def 'X-extent)))
     (if (or (number? shift) (pair? extent))
         (lf-emit (lf-now context) layer (lf-staff-of context) "col"
                  (if (number? shift) shift "-")
                  (if (pair? extent) (format #f "~a,~a" (car extent) (cdr extent)) "-")
                  (lf-loc event)))))

% ------------------------------------------------------------------ layout

\layout {
  \context {
    \Score
    \consists #(lambda (context)
      (make-engraver
        ((initialize engraver)
           (lf-emit "0" "-" "-" "version" listen-full-version (lilypond-version)))
        (listeners
          ((line-break-event engraver event)
             (if (eq? (ly:event-property event 'break-permission) 'force)
                 (lf-emit (lf-now context) "-" "-" "break" (lf-loc event)))))))
  }
  \context {
    \Staff
    \consists #(lambda (context)
      (make-engraver
        ((initialize engraver)
           (lf-emit (lf-now context) "-" (lf-staff-name context) "staff"
                    (cdr (lf-staff-entry context))))
        (listeners
          ((key-change-event engraver event)
             (let ((alist (ly:event-property event 'pitch-alist)))
               (lf-emit (lf-now context) "-" (lf-staff-name context) "key"
                        (apply + (map (lambda (pa) (cond ((> (cdr pa) 0) 1) ((< (cdr pa) 0) -1) (else 0))) alist))
                        (lf-loc event)))))
        (acknowledgers
          ((clef-interface engraver grob source-engraver)
             ;; Clef_engraver also makes a clef at every bar line; only a
             ;; change of glyph or position is a record.
             (let ((clef (list (ly:grob-property grob 'glyph) (ly:grob-property grob 'staff-position))))
               (if (not (equal? clef (hashq-ref lf-staff-clefs context)))
                   (begin
                     (hashq-set! lf-staff-clefs context clef)
                     (lf-emit (lf-now context) "-" (lf-staff-name context) "clef"
                              (car clef) (cadr clef) (lf-loc (lf-cause grob)))))))
          ((accidental-interface engraver grob source-engraver)
             (let* ((event (lf-cause grob))
                    (layer (and event (hashq-ref lf-event-layer event))))
               (if (not (lf-hidden? grob))
                   (lf-emit (lf-now context) (or layer "-") (lf-staff-name context) "acc"
                            (lf-accidental (ly:grob-property grob 'alteration))
                            (lf-loc event))))))))
  }
  \context {
    \Voice
    \consists #(lambda (context)
      (make-engraver
        (listeners
          ((note-event engraver event)
             (let* ((p (ly:event-property event 'pitch))
                    (d (ly:event-property event 'duration))
                    (scale (ly:duration-scale d))
                    (layer (lf-layer context)))
               (hashq-set! lf-event-layer event layer)
               (lf-column context layer event)
               (lf-emit (lf-now context) layer (lf-staff-of context) "note"
                        (vector-ref lf-steps (ly:pitch-notename p))
                        (* 2 (ly:pitch-alteration p))
                        (+ 4 (ly:pitch-octave p))
                        (ly:duration-log d) (ly:duration-dot-count d)
                        (numerator scale) (denominator scale)
                        (ly:moment-main (ly:duration->moment d))
                        (lf-loc event))))
          ((rest-event engraver event)
             (let ((d (ly:event-property event 'duration)))
               (lf-emit (lf-now context) (lf-layer context) (lf-staff-of context) "rest"
                        (ly:moment-main (ly:duration->moment d)) (lf-loc event))))
          ((skip-event engraver event)
             (let ((d (ly:event-property event 'duration)))
               (lf-emit (lf-now context) (lf-layer context) (lf-staff-of context) "skip"
                        (ly:moment-main (ly:duration->moment d)) (lf-loc event))))
          ((tie-event engraver event)
             (lf-emit (lf-now context) (lf-layer context) (lf-staff-of context) "tie" (lf-loc event)))
          ((slur-event engraver event)
             (lf-emit (lf-now context) (lf-layer context) (lf-staff-of context) "slur"
                      (ly:event-property event 'span-direction) (lf-loc event)))
          ((glissando-event engraver event)
             (lf-emit (lf-now context) (lf-layer context) (lf-staff-of context) "gliss" (lf-loc event))))
        (acknowledgers
          ((note-head-interface engraver grob source-engraver)
             (let ((event (lf-cause grob)))
               (lf-emit (lf-now context) (lf-layer context) (lf-staff-of context) "head"
                        (lf-bool (ly:grob-property grob 'transparent))
                        (lf-head-stencil (ly:grob-property-data grob 'stencil))
                        (lf-loc event))))
          ((rest-interface engraver grob source-engraver)
             (lf-emit (lf-now context) (lf-layer context) (lf-staff-of context) "rhead"
                      (lf-bool (lf-hidden? grob))
                      (lf-loc (lf-cause grob))))
          ((stem-interface engraver grob source-engraver)
             (lf-emit (lf-now context) (lf-layer context) (lf-staff-of context) "stem"
                      (lf-bool (lf-hidden? grob))
                      (lf-loc (lf-cause grob))))
          ((breathing-sign-interface engraver grob source-engraver)
             (lf-emit (lf-now context) (lf-layer context) (lf-staff-of context) "div"
                      (lf-division-kind (ly:grob-property-data grob 'stencil))
                      (lf-loc (lf-cause grob)))))))
  }
  \context {
    \Lyrics
    \consists #(lambda (context)
      (let ((last-stanza '()))
        (define (assoc-layer)
          (let ((voice (ly:context-property context 'associatedVoiceContext)))
            (if (ly:context? voice) (lf-layer voice) "-")))
        (make-engraver
          (listeners
            ((lyric-event engraver event)
               (let* ((text (ly:event-property event 'text))
                      (stanza (ly:context-property context 'stanza))
                      (fresh (and (not (null? stanza)) (not (eq? stanza last-stanza)))))
                 (if fresh (set! last-stanza stanza))
                 (lf-emit (lf-now context) (lf-lyrics-name context) (assoc-layer) "lyric"
                          (lf-lyric-text text)
                          (if fresh (lf-escape (if (string? stanza) stanza (markup->string stanza))) "-")
                          (lf-loc event))))
            ((hyphen-event engraver event)
               (lf-emit (lf-now context) (lf-lyrics-name context) (assoc-layer) "hyphen" (lf-loc event)))
            ((extender-event engraver event)
               (lf-emit (lf-now context) (lf-lyrics-name context) (assoc-layer) "extender" (lf-loc event)))))))
  }
}
