"""Contract checks for external job boundaries not exercised by local API/browser fixtures."""
from pathlib import Path

import yaml


def workflow(name):
    return yaml.safe_load(Path(f'.github/workflows/{name}.yml').read_text())

def test_preview_render_is_separated_from_secret_upload():
    jobs=workflow('typeset-preview')['jobs']
    render=jobs['render'];upload=jobs['upload']
    assert render['permissions']=={}
    assert 'secrets.' not in yaml.safe_dump(render)
    assert all(s.get('with',{}).get('persist-credentials') is False for s in render['steps'] if s.get('uses','').startswith('actions/checkout'))
    assert 'NOH_SANDBOX' in yaml.safe_dump(render) and 'ulimit' in yaml.safe_dump(render)
    assert upload['needs']=='render'
    commands='\n'.join(s.get('run','') for s in upload['steps'])
    assert 'typeset-preview-publish' in commands and 'typeset-preview-render' not in commands and 'lilypond' not in commands

def test_source_batch_validates_ref_before_checkout_and_does_not_render_with_app_token():
    jobs=workflow('corrections-batch')['jobs'];source=jobs['source-check'];publish=jobs['open-pull-request']
    assert source['permissions']=={} and 'secrets.' not in yaml.safe_dump(source)
    assert publish['needs']=='source-check'
    steps=publish['steps'];validate=next(i for i,s in enumerate(steps) if s.get('name')=='Read the batch');checkout=next(i for i,s in enumerate(steps) if s.get('uses','').startswith('actions/checkout'))
    assert validate<checkout and steps[checkout]['with']['ref']=='${{ steps.batch.outputs.ref }}'
    commands='\n'.join(s.get('run','') for s in steps)
    assert 'typeset-source-batch' not in commands and 'lilypond' not in commands
    assert 'typeset-manifest' in commands and 'source-batch-evidence' in yaml.safe_dump(steps)
