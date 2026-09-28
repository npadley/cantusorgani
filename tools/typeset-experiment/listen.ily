% Logs every musical event LilyPond engraves, as tab-separated lines on the
% file named by the `events-out` define: which voice, when, and what.
#(define events-port (open-output-file (string-append (ly:parser-output-name) ".events.tsv")))
#(define voice-numbers (make-hash-table))
#(define (voice-of context)
   (let* ((id (ly:context-id context))
          (staff (ly:context-find context 'Staff))
          (staff-id (if staff (ly:context-id staff) "")))
     (if (not (hashq-ref voice-numbers context))
         (hashq-set! voice-numbers context (hash-count (const #t) voice-numbers)))
     (format #f "~a:~a" staff-id (if (string-null? id) (hashq-ref voice-numbers context) id))))
#(define (now context) (exact->inexact (ly:moment-main (ly:context-current-moment context))))
#(define (now-exact context) (ly:moment-main (ly:context-current-moment context)))
#(define (emit context . fields)
   (display (string-join (map (lambda (f) (format #f "~a" f)) (cons (now-exact context) fields)) "\t") events-port)
   (newline events-port) (force-output events-port))
#(define (origin event)
   (let ((o (ly:event-property event 'origin)))
     (if (ly:input-location? o) (let ((l (ly:input-file-line-char-column o))) (format #f "~a:~a" (cadr l) (cadddr l))) "")))

\layout {
  \context {
    \Voice
    \consists #(lambda (context)
      (make-engraver
        (listeners
          ((note-event engraver event)
             (let ((p (ly:event-property event 'pitch)) (d (ly:event-property event 'duration)))
               (emit context (voice-of context) "note"
                     (ly:pitch-notename p) (ly:pitch-alteration p) (ly:pitch-octave p)
                     (ly:duration-log d) (ly:duration-dot-count d) (ly:duration-scale d)
                     (ly:moment-main (ly:duration->moment d)) (origin event))))
          ((rest-event engraver event)
             (let ((d (ly:event-property event 'duration)))
               (emit context (voice-of context) "rest" (ly:moment-main (ly:duration->moment d)))))
          ((skip-event engraver event)
             (let ((d (ly:event-property event 'duration)))
               (emit context (voice-of context) "skip" (ly:moment-main (ly:duration->moment d)))))
          ((slur-event engraver event)
             (emit context (voice-of context) "slur" (ly:event-property event 'span-direction)))
          ((tie-event engraver event) (emit context (voice-of context) "tie"))
          ((breathing-event engraver event) (emit context (voice-of context) "breathe" (origin event))))))
  }
  \context {
    \Staff
    \consists #(lambda (context)
      (make-engraver
        (listeners
          ((key-change-event engraver event)
             (emit context (ly:context-id context) "key"
                   (ly:pitch-notename (ly:event-property event 'tonic))
                   (ly:pitch-alteration (ly:event-property event 'tonic))
                   (length (filter (lambda (pa) (not (= 0 (cdr pa)))) (ly:event-property event 'pitch-alist)))
                   (apply + (map (lambda (pa) (if (> (cdr pa) 0) 1 (if (< (cdr pa) 0) -1 0))) (ly:event-property event 'pitch-alist))))))))
  }
  \context {
    \Lyrics
    \consists #(lambda (context)
      (make-engraver
        (listeners
          ((lyric-event engraver event)
             (let ((text (ly:event-property event 'text)) (stanza (ly:context-property context 'stanza)))
               (emit context "lyrics" "lyric" (if (string? text) text (markup->string text))
                     (if (string? stanza) stanza ""))
               (ly:context-set-property! context 'stanza '())))
          ((hyphen-event engraver event) (emit context "lyrics" "hyphen"))
          ((extender-event engraver event) (emit context "lyrics" "extender")))))
  }
}
