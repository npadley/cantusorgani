import type { D1Like } from "./store";
export interface SourceDraft { readonly file: string; readonly text: string; readonly baseBlobSha: string; readonly contentHash: string; readonly revision: number }
export interface SourceSnapshot { readonly correctionId: number; readonly file: string; readonly text: string; readonly baseBlobSha: string; readonly contentHash: string }
export async function sourceContentHash(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((n) => n.toString(16).padStart(2, "0")).join("");
}
const DRAFT = "file,text,base_blob_sha AS baseBlobSha,content_hash AS contentHash,revision";
export function typesetStore(db: D1Like) {
  return {
    async getDraft(email: string, file: string): Promise<SourceDraft | null> {
      return db.prepare(`SELECT ${DRAFT} FROM typeset_drafts WHERE editor_email=?1 AND file=?2`).bind(email,file).first<SourceDraft>();
    },
    async saveDraft(email: string, draft: Omit<SourceDraft,"revision">, expectedRevision: number): Promise<SourceDraft | null> {
      return db.prepare(`INSERT INTO typeset_drafts(editor_email,file,text,base_blob_sha,content_hash,revision)
        SELECT ?1,?2,?3,?4,?5,1 WHERE ?6=0 OR EXISTS(SELECT 1 FROM typeset_drafts WHERE editor_email=?1 AND file=?2 AND revision=?6)
        ON CONFLICT(editor_email,file) DO UPDATE SET text=excluded.text,base_blob_sha=excluded.base_blob_sha,
          content_hash=excluded.content_hash,revision=revision+1,updated_at=datetime('now') WHERE revision=?6
        RETURNING ${DRAFT}`).bind(email,draft.file,draft.text,draft.baseBlobSha,draft.contentHash,expectedRevision).first<SourceDraft>();
    },
    async approveDraft(email: string, file: string, expectedRevision: number, note: string, reportId?: number): Promise<number | null> {
      try {
        const result = await db.batch<{id:number}>([
          db.prepare(`INSERT INTO corrections(piece_id,target,field,proposed,note,status,source,editor_email,seen,updated_at)
            SELECT 'typeset','typeset:'||file,'source',content_hash,?4,'approved','editor',editor_email,base_blob_sha,datetime('now')
            FROM typeset_drafts WHERE editor_email=?1 AND file=?2 AND revision=?3
            AND (?5 IS NULL OR EXISTS(SELECT 1 FROM corrections r WHERE r.id=?5 AND r.status='pending' AND r.source='reader'
              AND r.field='issue' AND r.target='typeset:'||file AND r.resolved_by IS NULL)) RETURNING id`)
            .bind(email,file,expectedRevision,note,reportId ?? null),
          db.prepare(`UPDATE corrections SET resolved_by=(SELECT c.id FROM corrections c JOIN typeset_snapshots s ON s.correction_id=c.id
            WHERE c.target=?2 AND c.field='source' AND c.status='approved' AND c.editor_email=?3 AND s.draft_revision=?4),
            editor_email=?3,updated_at=datetime('now') WHERE id=?1 AND status='pending' AND field='issue' AND target=?2
            AND resolved_by IS NULL AND EXISTS(SELECT 1 FROM corrections c JOIN typeset_snapshots s ON s.correction_id=c.id
              WHERE c.target=?2 AND c.field='source' AND c.status='approved' AND c.editor_email=?3 AND s.draft_revision=?4)`)
            .bind(reportId ?? null,`typeset:${file}`,email,expectedRevision),
        ]);
        return result[0]?.results?.[0]?.id ?? null;
      } catch (error) {
        if (error instanceof Error && /UNIQUE/i.test(error.message)) return null;
        throw error;
      }
    },
    async activeSnapshot(file:string):Promise<(SourceSnapshot & {status:string})|null> {
      return db.prepare(`SELECT s.correction_id AS correctionId,s.file,s.text,s.base_blob_sha AS baseBlobSha,s.content_hash AS contentHash,c.status
        FROM typeset_snapshots s JOIN corrections c ON c.id=s.correction_id WHERE s.file=?1 AND c.status IN ('approved','queued')`).bind(file).first();
    },
    async snapshots(ids: readonly number[]): Promise<readonly SourceSnapshot[]> {
      if (!ids.length) return [];
      const rows = await db.prepare(`SELECT correction_id AS correctionId,file,text,base_blob_sha AS baseBlobSha,content_hash AS contentHash
        FROM typeset_snapshots WHERE correction_id IN (${ids.map((_,i)=>`?${i+1}`).join(',')}) ORDER BY correction_id`).bind(...ids).all<SourceSnapshot>();
      return rows.results ?? [];
    },
  };
}
