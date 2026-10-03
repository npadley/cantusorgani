/**
 * The review queue's kinds (data/review-queue.json, written by `noh catalog`)
 * in plain words, and what an editor can do about each. Three groups, in the
 * order the Review page lists them:
 *
 * - fix:   something the edit form can change; **Correct** opens it.
 * - check: look at the scan and confirm it (**Looks right**) or leave a note
 *          (**Skip**); fixing it needs the pipeline, not a correction.
 * - info:  the site cannot act on it at all; listed last, so it does not swamp
 *          the rest.
 *
 * A kind missing here is shown under "Other" and fails a test (reviewKinds.test.ts
 * reads the committed queue), so a new kind from the pipeline gets words.
 */

export type ReviewGroup = "fix" | "check" | "info";

export interface ReviewKind {
  readonly label: string;
  /** What the editor should look at, in a sentence. */
  readonly look: string;
  readonly group: ReviewGroup;
  /** The confirming button's words: what pressing it says is so ("Looks right" when not given). */
  readonly confirm?: string;
}

/** An item as `noh catalog` writes it: only the fields the Review page reads. */
export interface QueueItem {
  readonly key: string;
  readonly fingerprint: string;
  readonly volume: string;
  readonly kind: string;
  readonly piece?: string | null;
  readonly genre?: string;
  readonly part?: string;
  readonly variant?: string;
  readonly movement?: string;
  readonly title?: string;
  readonly ref?: string;
  readonly pdf_page?: number | null;
  readonly pdf_pages?: readonly number[];
  readonly printed_page?: number;
  readonly printed_pages?: readonly number[];
  readonly first_system?: number;
  readonly best_system?: number;
  readonly score?: number;
  readonly chant_incipit?: string;
  readonly why?: string;
}

export const REVIEW_KINDS: Readonly<Record<string, ReviewKind>> = {
  part_by_order: {
    confirm: "Starts here: right",
    label: "Part placed by its order, not its heading", group: "fix",
    look: "No heading was read for this part, so its start was guessed from the order of the parts. Check the system it starts on.",
  },
  unverified_pairing: {
    confirm: "The chant is right",
    label: "Chant link not confirmed", group: "fix",
    look: "The chant was matched by its words, not confirmed. Check it is the chant printed here.",
  },
  starts_mid_page: {
    confirm: "Starts here: right",
    label: "Piece starts partway down a page", group: "fix",
    look: "Check the piece's first system: the one before it may belong to it, or to the piece before.",
  },
  no_systems: {
    confirm: "No music printed: right",
    label: "No music found for this piece", group: "fix",
    look: "The pages the index gives had no music the pipeline could read. Check the piece's pages and systems.",
  },
  index_unverified: {
    confirm: "The page is right",
    label: "Index page number not confirmed", group: "fix",
    look: "No heading on the page confirmed the index. Check the printed page.",
  },
  range_extended: {
    confirm: "Ends here: right",
    label: "Pages added after the index's end", group: "fix",
    look: "Pages after the index's stated end were unclaimed, so they were added to this piece. Check where it ends.",
  },
  unpaired: {
    confirm: "No chant to link",
    label: "No chant linked", group: "fix",
    look: "No chant is linked to this piece. Link one if the chant is known.",
  },
  segmentation_fallback: {
    confirm: "The staves are right",
    label: "Staves may be paired wrongly", group: "check",
    look: "The staves on this page could not all be paired, so they were paired by the gaps between braces. Check each system has both hands' staves.",
  },
  uncertain_movement: {
    confirm: "Starts here: right",
    label: "Mass movement placed by order", group: "fix",
    look: "Its opening words matched weakly, so it was placed by the Mass's order. Check this system begins the movement named. If it does not, Correct opens the piece: on its Sections screen, start a section on the right system and give it the movement's name (kyrie, gloria, credo, sanctus, agnus or ite) as its own name.",
  },
  hymn_at_page_top: {
    confirm: "The hymn starts here",
    label: "Hymn linked to the top of its page", group: "check",
    look: "No heading placed the hymn, so it links to the page's first system. Check that is where the hymn starts.",
  },
  part_missing: {
    confirm: "Not printed here",
    label: "Part not found", group: "check",
    look: "This part's opening words were not found. The closest system is shown; check whether the part is printed.",
  },
  part_mismatch: {
    confirm: "The part is right",
    label: "Part's opening words do not match", group: "check",
    look: "A heading was found, but the words after it do not match the part. The closest system is shown.",
  },
  part_unsupported: {
    label: "Parts not divided", group: "info",
    look: "No Proper is known for its day, so its parts are not divided. Nothing to do here.",
  },
  part_borrowed_unresolved: {
    label: "Part printed elsewhere, not found", group: "info",
    look: "The book refers to this part on another page, which was not found. Nothing to do here.",
  },
  page_out_of_range: {
    label: "Index page outside the scan", group: "info",
    look: "The index gives a page the scan does not have. Nothing to do here.",
  },
  unmapped_pages: {
    label: "Pages with no printed number", group: "info",
    look: "Pages between the page map's segments (an insert, or a page scanned twice) are not catalogued. Nothing to do here.",
  },
};

const OTHER: ReviewKind = { label: "Other", group: "check", look: "See the pipeline's note." };

/** A kind in words. A Proper's own chant link is on its parts, so an "unpaired"
 * Proper is information only. */
export function reviewKind(item: Pick<QueueItem, "kind" | "genre">): ReviewKind {
  const kind = REVIEW_KINDS[item.kind] ?? OTHER;
  if (item.kind === "unpaired" && item.genre === "proper") {
    return { label: "No chant linked to the Proper as a whole", group: "info",
             look: "A Proper's chants are linked on its parts (Introit, Gradual…), not the piece. Nothing to do here." };
  }
  return kind;
}

export const GROUP_ORDER: readonly ReviewGroup[] = ["fix", "check", "info"];
export const GROUP_LABELS: Readonly<Record<ReviewGroup, string>> = {
  fix: "Can be corrected here",
  check: "Check against the scan",
  info: "For information",
};
