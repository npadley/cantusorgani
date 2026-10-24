import { describe, expect, it } from 'vitest';
import { checkPreviewResponses, type RecordedResponse } from './check-preview';

// Recorded response shapes, with bodies reduced to relevant HTML. No network.
const origin = 'https://abc123.cantusorgani.pages.dev';
function fixtures(): RecordedResponse[] {
  return [
    ...['/', '/kyriale/i/', '/piece/dominica-i-adventus/', '/corrections/'].map(path => ({
      path, status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8', 'x-robots-tag': 'noindex, nofollow' },
      body: `<html><head><link href="https://cantusorgani.org${path}" rel="canonical"></head><body>${path === '/corrections/' ? 'Corrections are not configured in this build.' : 'Music'}</body></html>`,
    })),
    { path: '/__preview-check-missing__/', status: 404,
      headers: { 'content-type': 'text/html', 'x-robots-tag': 'noindex' }, body: '<html>Not found</html>' },
    { path: '/piece/ordinarium-missae-i/', status: 200, headers: { 'content-type': 'text/html; charset=utf-8' },
      body: '<html><head><meta http-equiv="refresh" content="0;url=/kyriale/i/"><link rel="canonical" href="https://cantusorgani.org/kyriale/i/"></head></html>' },
    { path: '/piece/noh1-p156/', status: 301, headers: { location: '/piece/feria-iv-cinerum/' }, body: '' },
    { path: '/admin/', status: 302,
      headers: { location: 'https://padley.cloudflareaccess.com/cdn-cgi/access/login/abc' }, body: '' },
  ];
}
function change(path: string, patch: Partial<RecordedResponse>): RecordedResponse[] {
  return fixtures().map(record => record.path === path ? { ...record, ...patch } : record);
}

describe('checkPreviewResponses', () => {
  it('accepts an isolated preview with production canonicals and Access protection', () => {
    expect(checkPreviewResponses(origin, fixtures())).toEqual([]);
  });
  it('accepts the deliberate Kyriale meta refresh page', () => {
    expect(checkPreviewResponses(origin, fixtures())).toEqual([]);
  });
  it('accepts a 308 Kyriale redirect with an absolute preview URL', () => {
    expect(checkPreviewResponses(origin, change('/piece/ordinarium-missae-i/', {
      status: 308, headers: { Location: `${origin}/kyriale/i/` },
    }))).toEqual([]);
  });
  it.each(['/', '/kyriale/i/', '/piece/dominica-i-adventus/', '/__preview-check-missing__/'])('rejects HTML without noindex: %s', path => {
    expect(checkPreviewResponses(origin, change(path, { headers: { 'content-type': 'text/html', 'x-robots-tag': 'nofollow' } }))).toContain(`${path}: expected X-Robots-Tag noindex`);
  });
  it.each(['', '<link rel="canonical" href="https://abc123.cantusorgani.pages.dev/">',
    '<link rel="canonical" href="https://cantusorgani.org.evil.test/">',
  ])('rejects absent or non-production canonicals', body => {
    expect(checkPreviewResponses(origin, change('/', { body }))).toContain('/: expected a canonical on https://cantusorgani.org');
  });
  it('handles header casing and single-quoted canonical attributes', () => {
    expect(checkPreviewResponses(origin, change('/', { headers: { 'Content-Type': 'text/html', 'X-Robots-Tag': 'NOINDEX' },
      body: "<link rel='canonical' href='https://cantusorgani.org/'>" }))).toEqual([]);
  });
  it('rejects a soft 404', () => {
    expect(checkPreviewResponses(origin, change('/__preview-check-missing__/', { status: 200 }))).toContain('/__preview-check-missing__/: expected HTTP 404, got 200');
  });
  it('checks the static rule from public/_redirects as well as the required Kyriale rule', () => {
    expect(checkPreviewResponses(origin, change('/piece/noh1-p156/', { status: 200 }))).toContain('/piece/noh1-p156/: expected 301/308 to /piece/feria-iv-cinerum/');
  });
  it('accepts a permanent Kyriale HTTP redirect', () => {
    expect(checkPreviewResponses(origin, change('/piece/ordinarium-missae-i/', {
      status: 308, headers: { Location: `${origin}/kyriale/i/` }, body: '',
    }))).toEqual([]);
  });
  it.each([
    { status: 302, headers: { location: '/kyriale/i/' }, body: '' },
    { status: 200, headers: { 'content-type': 'text/html' }, body: '<meta http-equiv="refresh" content="0;url=/kyriale/ii/">' },
    { status: 200, headers: { 'content-type': 'text/html' }, body: '<meta http-equiv="refresh" content="0;url=/kyriale/i/"><link rel="canonical" href="https://cantusorgani.org.evil.test/">' },
  ])('rejects an invalid Kyriale response: %j', patch => {
    expect(checkPreviewResponses(origin, change('/piece/ordinarium-missae-i/', patch))).toContain('/piece/ordinarium-missae-i/: expected 301/308 to /kyriale/i/ or a 200 meta refresh to /kyriale/i/');
  });
  it.each<Partial<RecordedResponse>>([
    { status: 200, headers: {} },
    { status: 403, headers: {} },
    { status: 302, headers: { location: '/admin/login/' } },
    { status: 302, headers: { location: 'https://cloudflareaccess.com.evil.test/' } },
    { status: 302, headers: { location: 'http://padley.cloudflareaccess.com/' } },
  ])('rejects an admin response without an HTTPS Access redirect: %j', patch => {
    expect(checkPreviewResponses(origin, change('/admin/', patch))).toContain('/admin/: expected a redirect to cloudflareaccess.com');
  });
  it('rejects an error or non-HTML response for a public page', () => {
    expect(checkPreviewResponses(origin, change('/piece/dominica-i-adventus/', { status: 503 }))).toContain('/piece/dominica-i-adventus/: expected HTTP 200, got 503');
    expect(checkPreviewResponses(origin, change('/', { headers: { 'content-type': 'application/json' } }))).toContain('/: expected HTML');
  });
  it('rejects a missing recorded request', () => {
    expect(checkPreviewResponses(origin, fixtures().filter(r => r.path !== '/admin/'))).toContain('/admin/: missing response');
  });
  it('rejects a preview that still has corrections configured', () => {
    expect(checkPreviewResponses(origin, change('/corrections/', { body: '<html>Submit</html>' }))).toContain('/corrections/: expected the not configured notice');
  });
});
