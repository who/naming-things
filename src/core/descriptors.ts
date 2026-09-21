/**
 * The local descriptor bank behind the Randomize button.
 *
 * Every entry is canned prose, so a visitor can start a run with no API key
 * and no round trip. Entries stay short because each one is serialized into
 * the Jev state alongside the code and the candidates.
 */
export const DESCRIPTOR_BANK: readonly string[] = [
  'A courier delivery job. Dispatch hands the driver a pickup address, a drop-off address, a window to arrive in, and the weight of the parcel. The job moves from accepted to collected to delivered, and each hop is stamped with the time it happened and the driver who did it.',
  'A customer support ticket. Someone writes in with a subject and a body, an agent takes ownership, and the conversation collects replies until it is resolved. The ticket carries how urgent the reporter said it was, how urgent the team decided it was, and how long it has waited for a first reply.',
  'A music playlist. A listener names it, marks it public or private, and adds tracks in an order they care about. The playlist knows how many tracks it holds, how long it runs end to end, when it was last played, and whether it was assembled by a person or generated from listening history.',
  'A warehouse shipment. A supplier sends a pallet of cartons against a purchase order, and receiving scans it in. The shipment records the carrier, the tracking reference, the expected arrival date, the actual arrival date, the count of cartons promised, and the count that turned up undamaged.',
  'A gym class booking. A member reserves a spot in a class at a studio, on a date, at a start time that runs for a fixed number of minutes. The booking can be confirmed, waitlisted or cancelled, and it remembers whether the member actually turned up and whether a credit was refunded.',
  'A bank transfer between two accounts. The payer names the recipient, an amount in minor units, a currency, and a reference line that appears on both statements. The transfer settles instantly or sits pending overnight, and a failed transfer carries a reason code the support team reads.',
  'A hotel reservation. A guest books a room type for a stretch of nights, for a number of adults and children, at a nightly rate that may differ per night. The reservation holds a card on file, tracks whether breakfast is included, and records the cancellation deadline after which the first night is charged.',
  'A temperature sensor reading. A device in a cold room reports a value in degrees Celsius every minute, tagged with the device identifier, the moment it was sampled, and the battery level at the time. A reading can be flagged as suspect when the device reports faster than its configured interval.',
  'A step in a recipe. The step has an ordinal position, an instruction to follow, an optional duration to wait, and a target temperature for the oven or pan. It lists which of the recipe ingredients it consumes and whether it can run while an earlier step is still going.',
  'An insurance claim. A policyholder reports an incident on a date, describes what happened, and asks for an amount. The claim gathers documents, moves through review to a decision, and ends with an approved payout that may be less than asked, or a rejection with a reason the regulator can audit.',
  'A parking session. A driver starts a session for a vehicle plate in a numbered bay, in a zone with its own hourly rate. The session runs until the driver stops it or the maximum stay expires, and the charge is worked out from elapsed minutes, the zone rate, and any resident discount.',
  'A podcast episode. A show publishes an episode with a number within its season, a title, show notes, and an audio file of a known length in seconds. The episode records its publication moment, whether it is marked explicit, and which guests appear alongside the regular hosts.',
]

/**
 * Return a descriptor from the bank, avoiding the one already on screen.
 *
 * `exclude` is the descriptor the visitor is looking at, so Randomize always
 * visibly changes something. When excluding it would leave nothing to choose
 * from, the whole bank is used again rather than retrying forever.
 */
export function pickRandomDescriptor(exclude?: string): string {
  const remaining = DESCRIPTOR_BANK.filter((descriptor) => descriptor !== exclude)
  const source = remaining.length > 0 ? remaining : DESCRIPTOR_BANK
  const picked = source[Math.floor(Math.random() * source.length)] ?? source[0]

  if (picked === undefined) {
    throw new Error('pickRandomDescriptor: the descriptor bank is empty')
  }

  return picked
}
