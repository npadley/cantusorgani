# REFERENCE ONLY. Line-number voice selection and the slur/lyric heuristic are forbidden in production (PA Global Constraints).
"""Throwaway Kyrie IX probe. Input is LilyPond's compiler-resolved XML.

Not a general converter: selects this score's four voices, uses common
voice onsets as unmetered layout containers, and maps its slur-driven lyrics.
"""
from pathlib import Path
from fractions import Fraction as F
import xml.etree.ElementTree as E
import json
import verovio

OUT = Path(__file__).parent
root = E.parse(OUT/'lilypond-resolved.xml')
def sub(parent, tag, text=None, **attrs):
    x = E.SubElement(parent, tag, {k:str(v) for k,v in attrs.items()})
    if text is not None: x.text = str(text)
    return x
def duration(x):
    m = x.find('property[@name="length"]/moment')
    return F(int(m.get('main-numer')),int(m.get('main-denom')))

voices=[]
divisions={}
breaks=set()
for index,line in enumerate(['165','168','175','178']):
    ctx=next(x for x in root.findall('.//music[@name="ContextSpeccedMusic"]')
        if x.findtext('property[@name="context-type"]/symbol')=='Voice'
        and x.find('origin') is not None and x.find('origin').get('line')==line)
    notes=[]; t=F(0); slur=False; tied=False
    for x in ctx.iter('music'):
        kind=x.get('name')
        if kind in ['NoteEvent','SkipEvent']:
            d=x.find('duration'); p=x.find('pitch')
            slurs=[int(s.findtext('property[@name="span-direction"]/number')) for s in x.findall('articulations/music[@name="SlurEvent"]')]
            n=dict(id=f'v{index+1}n{len(notes)+1}',start=t,duration=duration(x),
                dur=2**int(d.get('log')),dots=int(d.get('dots')),
                mult=F(int(d.get('numer')),int(d.get('denom'))),
                pitch=None if p is None else ('cdefgab'[int(p.get('notename'))],int(p.get('octave'))+4,F(p.get('alteration'))*2),
                slur_start=-1 in slurs,slur_stop=1 in slurs,
                tie_start=x.find('articulations/music[@name="TieEvent"]') is not None,
                tie_stop=tied,lyric_eligible=not slur)
            notes.append(n);t+=n['duration'];tied=n['tie_start']
            if -1 in slurs: slur=True
            if 1 in slurs: slur=False
        elif index==0 and kind=='BreathingEvent':
            # Source include line identifies the Gregorian division stencil.
            origin=x.find('origin'); divisions[t]='dbl' if origin.get('line')=='40' else 'minima'
        elif index==0 and kind=='LineBreakEvent': breaks.add(t)
    voices.append(notes)

lyrics=root.findall('.//music[@name="LyricEvent"]')
eligible=[n for n in voices[0] if n['lyric_eligible']]
assert len(eligible)==len(lyrics),(len(eligible),len(lyrics))
in_word=False
for n,l in zip(eligible,lyrics):
    text=l.findtext('property[@name="text"]/string')
    if not text.strip(): continue
    hyphen=l.find('articulations/music[@name="HyphenEvent"]') is not None
    n['lyric']=text;n['syllabic']=('middle' if in_word else 'begin') if hyphen else ('end' if in_word else 'single')
    in_word=hyphen

ends=[v[-1]['start']+v[-1]['duration'] for v in voices]
assert len(set(ends))==1,ends
total=ends[0]
common=set.intersection(*[{n['start'] for n in v}|{total} for v in voices])
bounds=sorted(common)
assert set(divisions).issubset(common),(set(divisions)-common)
segments=[(a,b) for a,b in zip(bounds,bounds[1:])]

# MusicXML: two staves in one part, four voices, no prescribed meter.
mx=E.Element('score-partwise',version='4.0')
sub(sub(mx,'work'),'work-title','Kyrie IX — format experiment')
pl=sub(mx,'part-list');sp=sub(pl,'score-part',id='P1');sub(sp,'part-name','Organ')
part=sub(mx,'part',id='P1')
types={1:'whole',2:'half',4:'quarter',8:'eighth',16:'16th'}
for si,(a,b) in enumerate(segments):
    measure=sub(part,'measure',number=si+1,implicit='yes')
    if a in breaks: sub(measure,'print',**{'new-system':'yes'})
    if si==0:
        att=sub(measure,'attributes');sub(att,'divisions',4)
        sub(sub(att,'key'),'fifths',1);sub(sub(att,'time'),'senza-misura')
        sub(att,'staves',2)
        for no,sign,line in [(1,'G',2),(2,'F',4)]:
            clef=sub(att,'clef',number=no);sub(clef,'sign',sign);sub(clef,'line',line)
    for vi,voice in enumerate(voices):
        if vi: sub(sub(measure,'backup'),'duration',int((b-a)*16))
        for n in voice:
            if not a<=n['start']<b: continue
            attrs={'id':n['id']}
            if n['pitch'] is None:attrs['print-object']='no'
            note=sub(measure,'note',**attrs)
            if n['pitch']:
                name,octave,alter=n['pitch'];pitch=sub(note,'pitch');sub(pitch,'step',name.upper())
                if alter:sub(pitch,'alter',int(alter))
                sub(pitch,'octave',octave)
            else: sub(note,'rest')
            sub(note,'duration',int(n['duration']*16))
            for k in ['stop','start']:
                if n[f'tie_{k}']:sub(note,'tie',type=k)
            sub(note,'voice',vi+1);sub(note,'type',types[n['dur']])
            for _ in range(n['dots']):sub(note,'dot')
            if n['mult']!=1:
                tm=sub(note,'time-modification');sub(tm,'actual-notes',n['mult'].denominator);sub(tm,'normal-notes',n['mult'].numerator)
            sub(note,'stem','none');sub(note,'staff',1 if vi<2 else 2)
            nt=sub(note,'notations')
            if n['mult']!=1:
                tu=sub(nt,'tuplet',type='start',bracket='no',**{'show-number':'none'})
                sub(sub(tu,'tuplet-actual'),'tuplet-number',n['mult'].denominator)
                sub(sub(tu,'tuplet-normal'),'tuplet-number',n['mult'].numerator)
                sub(nt,'tuplet',type='stop')
            for k in ['stop','start']:
                if n[f'tie_{k}']:sub(nt,'tied',type=k)
                if n[f'slur_{k}']:sub(nt,'slur',type=k,number=1,placement='above')
            if 'lyric' in n:
                ly=sub(note,'lyric',placement='above');sub(ly,'syllabic',n['syllabic']);sub(ly,'text',n['lyric'])
    bar=sub(measure,'barline',location='right')
    sub(bar,'bar-style','light-light' if divisions.get(b)=='dbl' else 'none')
    if divisions.get(b)=='minima':
        # Approximation: MusicXML breath mark in place of quarter division.
        last=next(n for n in reversed(measure.findall('note')) if n.findtext('voice')=='1')
        sub(sub(last.find('notations'),'articulations'),'breath-mark','comma')
E.indent(mx);E.ElementTree(mx).write(OUT/'kyrie-ix.musicxml',encoding='utf-8',xml_declaration=True)

# Independently build MEI from the same compiler events (not MusicXML import).
NS='http://www.music-encoding.org/ns/mei'
mei=E.Element('mei',xmlns=NS,meiversion='5.0')
head=sub(mei,'meiHead');fd=sub(head,'fileDesc');sub(sub(fd,'titleStmt'),'title','Kyrie IX — format experiment');sub(fd,'pubStmt')
score=sub(sub(sub(sub(sub(mei,'music'),'body'),'mdiv'),'score'),'section')
sc=mei.find('.//score');sd=E.Element('scoreDef',{'keysig':'1s','mnum.visible':'false'});sc.insert(0,sd)
grp=sub(sd,'staffGrp',symbol='brace',**{'bar.thru':'true'})
for no,shape,line in [(1,'G',2),(2,'F',4)]:sub(grp,'staffDef',n=no,lines=5,**{'clef.shape':shape,'clef.line':line})
slur_starts={};tie_starts={};note_measures={}
for si,(a,b) in enumerate(segments):
    if a in breaks:sub(score,'sb')
    m=sub(score,'measure',n=si+1,metcon='false',right='dbl' if divisions.get(b)=='dbl' else 'invis')
    for st in [1,2]:
        staff=sub(m,'staff',n=st)
        for layerno in [1,2]:
            vi=(st-1)*2+layerno-1;layer=sub(staff,'layer',n=layerno)
            for n in voices[vi]:
                if not a<=n['start']<b:continue
                parent=layer
                if n['mult']!=1:parent=sub(layer,'tuplet',num=n['mult'].denominator,numbase=n['mult'].numerator,**{'num.visible':'false','bracket.visible':'false'})
                attrs={'xml:id':n['id'],'dur':n['dur']}
                if n['dots']:attrs['dots']=n['dots']
                if n['pitch']:
                    name,octave,alter=n['pitch'];attrs.update(pname=name,oct=octave,**{'stem.visible':'false'})
                    node=sub(parent,'note',**attrs)
                    if alter:sub(node,'accid',**{'accid.ges':{1:'s',-1:'f'}[int(alter)]})
                else:node=sub(parent,'space',**attrs)
                note_measures[n['id']]=m
                if 'lyric' in n:
                    verse=sub(node,'verse',n=1,place='above')
                    attrs={'con':'d' if n['syllabic'] in ['begin','middle'] else 's'}
                    if n['syllabic']!='single':attrs['wordpos']={'begin':'i','middle':'m','end':'t'}[n['syllabic']]
                    sub(verse,'syl',n['lyric'],**attrs)
                if n['slur_stop']:
                    start=slur_starts.pop(vi)
                    sub(note_measures[start],'slur',startid='#'+start,endid='#'+n['id'],curvedir='above')
                if n['slur_start']:slur_starts[vi]=n['id']
                if n['tie_stop']:
                    start=tie_starts.pop(vi)
                    sub(note_measures[start],'tie',startid='#'+start,endid='#'+n['id'])
                if n['tie_start']:tie_starts[vi]=n['id']
    if divisions.get(b)=='minima':
        last=next(n for n in reversed(voices[0]) if n['start']<b)
        sub(m,'breath',startid='#'+last['id'],staff=1)
E.indent(mei);E.ElementTree(mei).write(OUT/'kyrie-ix.mei',encoding='utf-8',xml_declaration=True)

options=dict(pageWidth=2100,pageHeight=2970,pageMarginLeft=100,pageMarginRight=100,pageMarginTop=100,pageMarginBottom=100,scale=40,breaks='line',svgViewBox=True,header='none',footer='none',evenNoteSpacing=True,spacingLinear=0.25,spacingNonLinear=0.6,mnumInterval=0)
stats={'verovio':verovio.toolkit().getVersion(),'voices':[len(v) for v in voices],'total_whole_note_duration':str(total),'layout_containers':len(segments),'lyric_syllables':sum('lyric' in n for n in voices[0]),'original_breaks':list(map(str,sorted(breaks))),'options':options}
for ext,inputfrom in [('musicxml','xml'),('mei','mei')]:
    tk=verovio.toolkit();tk.setOptions(dict(options,inputFrom=inputfrom))
    assert tk.loadFile(str(OUT/f'kyrie-ix.{ext}'))
    stats[ext]={'pages':tk.getPageCount(),'log':tk.getLog()}
    tm=tk.renderToTimemap()
    starts={id:F(str(event['qstamp'])) for event in tm for id in event.get('on',[])}
    errors=[n['id'] for v in voices for n in v if n['pitch'] and starts.get(n['id'])!=n['start']*4]
    stats[ext]['onset_mismatches']=errors
    pitch_errors=[]
    semitones=dict(c=0,d=2,e=4,f=5,g=7,a=9,b=11)
    for v in voices:
        for n in v:
            if n['pitch']:
                name,octave,alter=n['pitch']
                expected=(octave+1)*12+semitones[name]+int(alter)
                if tk.getMIDIValuesForElement(n['id']).get('pitch')!=expected: pitch_errors.append(n['id'])
    stats[ext]['pitch_mismatches']=pitch_errors
    assert not errors and not pitch_errors,stats[ext]
    for p in range(1,tk.getPageCount()+1):(OUT/f'{ext}-{p}.svg').write_text(tk.renderToSVG(p))
    if ext=='musicxml':(OUT/'musicxml-imported.mei').write_text(tk.getMEI())
(OUT/'validation.json').write_text(json.dumps(stats,indent=2))
print(json.dumps(stats,indent=2))
