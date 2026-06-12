/**
 * Pre-reveal contact screen (USER_FLOWS §8.3): until the booking confirms
 * (threads.contact_revealed_at), outgoing messages are checked for phone and
 * email patterns. Policy is WARN AND FLAG — the message still sends, the
 * sender sees a notice, and `contact_flagged` surfaces the thread for admin
 * review. Nothing is ever silently dropped.
 *
 * Spelled-out evasions ("four oh four…") are out of MVP scope; admin review
 * of flagged threads is the backstop.
 */

/** 10-digit North American numbers in the usual shapes: 404-555-0100,
 *  (404) 555 0100, 404.555.0100, +1 404 555 0100, 4045550100. The lookarounds
 *  keep longer digit runs (order numbers, license numbers) from matching. */
const PHONE = /(?<!\d)(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/;

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

export function detectsContactInfo(body: string): boolean {
  return EMAIL.test(body) || PHONE.test(body);
}
