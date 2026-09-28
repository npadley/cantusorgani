"""Compare the notes LilyPond plays (its MIDI) with the notes in our MusicXML."""
import sys
import xml.etree.ElementTree as ET
from collections import Counter
from fractions import Fraction

import mido

STEP = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}

def from_midi(path):
    mid = mido.MidiFile(path)
    tpq = mid.ticks_per_beat
    notes = []
    for track in mid.tracks:
        t, on = 0, {}
        for msg in track:
            t += msg.time
            if msg.type == "note_on" and msg.velocity > 0:
                on.setdefault((msg.channel, msg.note), []).append(t)
            elif msg.type in ("note_off", "note_on"):
                start = on[(msg.channel, msg.note)].pop(0)
                notes.append((Fraction(start, tpq * 4), msg.note, Fraction(t - start, tpq * 4)))
    return Counter(notes)

def from_musicxml(path):
    root = ET.parse(path).getroot()
    div = int(root.find(".//divisions").text)
    t = Fraction(0)
    held = {}
    notes = []
    for m in root.iter("measure"):
        for el in m:
            if el.tag == "backup":
                t -= Fraction(int(el.find("duration").text), div * 4)
            elif el.tag == "forward":
                t += Fraction(int(el.find("duration").text), div * 4)
            elif el.tag == "note":
                d = Fraction(int(el.find("duration").text), div * 4)
                p = el.find("pitch")
                midi = 12 * (int(p.find("octave").text) + 1) + STEP[p.find("step").text] + int(float(p.findtext("alter") or 0))
                v = el.findtext("voice")
                ties = {x.get("type") for x in el.findall("tie")}
                key = (v, midi)
                if "stop" in ties and key in held:
                    start, length = held.pop(key)
                    length += d
                else:
                    start, length = t, d
                if "start" in ties:
                    held[key] = (start, length)
                else:
                    notes.append((start, midi, length))
                t += d
    return Counter(notes)

a, b = from_midi(sys.argv[1]), from_musicxml(sys.argv[2])
print(f"LilyPond MIDI: {sum(a.values())} sounding notes; MusicXML: {sum(b.values())}")
missing, extra = a - b, b - a
print("identical" if not missing and not extra else f"only in MIDI: {sorted(missing.elements())[:8]}\nonly in MusicXML: {sorted(extra.elements())[:8]}")
