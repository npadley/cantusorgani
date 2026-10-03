import pytest

from pipeline.gregobase import Chant


def test_research_metadata_is_bound_to_the_actual_hymn_source():
    from pipeline.hymnpairings import compile_pairings
    piece={'slug':'creator','genre':'hymn','systems':['noh7/0040/000']}
    chant=Chant(2134,'Creator alme siderum','hy','4','(c4)Cre(f)á(f)tor(g)',None)
    row={'slug':'creator','ref':'noh7/0040/000','title':'Creator alme siderum','gregobase_id':2134,
         'status':'verified','evidence':'Printed words and melody checked','sources':['https://gregobase.selapa.net/chant.php?id=2134']}
    result,ids=compile_pairings([row],{'pieces':[piece]},[(chant,False)])
    assert ids=={2134}
    assert result[row['ref']]['status']=='verified'
    assert result[row['ref']]['incipit']=='Creator alme siderum'
    with pytest.raises(ValueError,match='source'):
        compile_pairings([{**row,'ref':'noh7/0040/003'}],{'pieces':[piece]},[(chant,False)])
    with pytest.raises(ValueError,match='copyright'):
        compile_pairings([row],{'pieces':[piece]},[(chant,True)])

def test_candidate_links_do_not_publish_unverified_notation():
    from pipeline.hymnpairings import compile_pairings
    p={'slug':'test','genre':'hymn','systems':['noh7/0040/000']}
    c=Chant(1,'Related hymn','hy','4','(c4)Notes(f)',None)
    r={'slug':'test','ref':p['systems'][0],'title':'Related','gregobase_id':1,'status':'unverified',
       'evidence':'Relevant words; melody not yet confirmed','sources':['https://gregobase.selapa.net/chant.php?id=1']}
    result,ids=compile_pairings([r],{'pieces':[p]},[(c,False)])
    assert result[r['ref']]['id']==1
    assert ids==set()

def test_a_verified_newer_match_with_unknown_permission_is_link_only():
    from pipeline.hymnpairings import compile_pairings
    p={'slug':'new','genre':'hymn','systems':['noh8/0309/000']}
    c=Chant(19359,'Jesu corona','hy','2','(c4)Notes(f)',None)
    r={'slug':'new','ref':p['systems'][0],'title':'Jesu corona','gregobase_id':19359,'status':'verified',
       'evidence':'Opening melody and words checked','sources':['https://gregobase.selapa.net/chant.php?id=19359']}
    result,ids=compile_pairings([r],{'pieces':[p]},[(c,None)])
    assert result[r['ref']]['status']=='verified'
    assert result[r['ref']]['notation_available'] is False
    assert ids==set()
