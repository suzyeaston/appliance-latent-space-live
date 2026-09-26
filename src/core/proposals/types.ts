/**
 * The proposal boundary.
 *
 * This is the seam a future AI adapter plugs into. It exists now, with a deterministic
 * implementation behind it, so that the day something smarter is added the surrounding rules
 * are already true:
 *
 *   1. A proposal is text in the same pattern language, and it goes through the same parser as
 *      anything typed by hand. A provider cannot return an object that skips validation.
 *   2. A proposal never becomes the composition on arrival. It is a separate artefact that has
 *      to be auditioned and accepted.
 *   3. Accepting is undoable. The pattern that was replaced is kept.
 *
 * Nothing in this milestone makes a network request, and no provider here is an AI. The one
 * shipped provider is labelled "Variation" for that reason.
 */

export interface ProposalRequest {
  /** The player's current pattern, as text. */
  pattern: string;
  /** Free text such as "keep the bass, make the rhythm less predictable". Unused for now. */
  instruction?: string;
  /** Providers that vary their output must do so from this, so a result can be reproduced. */
  seed: number;
}

export interface Proposal {
  providerId: string;
  /** Shown to the player. Must describe what actually produced it. */
  label: string;
  /** Candidate pattern text, still unvalidated from the host's point of view. */
  pattern: string;
  /** Plain-language description of each change, for the proposal panel. */
  notes: string[];
  seed: number;
}

export type ProposalOutcome =
  | { ok: true; proposal: Proposal }
  | { ok: false; reason: string };

export interface ProposalProvider {
  id: string;
  label: string;
  /** Shown next to the label so nobody has to guess what is behind it. */
  description: string;
  /** True only for providers that leave the machine. Keeps the offline promise checkable. */
  usesNetwork: boolean;
  propose(request: ProposalRequest): Promise<ProposalOutcome>;
}
