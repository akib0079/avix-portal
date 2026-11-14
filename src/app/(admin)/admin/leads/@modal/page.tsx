/**
 * The board itself (/admin/leads). Matching it here clears the slot, so a
 * soft navigation back to the board (after deleting a lead, say) closes the
 * popup instead of leaving the last one open.
 */
export default function BoardNoModal() {
  return null;
}
