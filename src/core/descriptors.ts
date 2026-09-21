/**
 * The local descriptor bank behind the Randomize button.
 *
 * Every entry is canned prose, so a visitor can start a run with no API key
 * and no round trip. Entries stay short because each one is serialized into
 * the Jev state alongside the code and the candidates.
 *
 * Each one describes a single property rather than a product. A blurb about a
 * whole app leaves the models guessing which field is even at stake, and five
 * names for an unspecified thing cannot disagree about anything; a property
 * with a unit, a nullability and a job gives them something to disagree over.
 * The prose says what the value means and never what it might be called, since
 * a name in the description is a name the run would only ever echo back.
 */
export const DESCRIPTOR_BANK: readonly string[] = [
  'A DeliveryJob in a courier dispatch system, holding the pickup address, the drop-off address, the time the driver has to arrive by and the moment the parcel was collected. The property to name is the weight of that parcel, recorded in whole grams at the depot scale and never absent. Dispatch sums it across a van load to check against the axle limit, so the name has to hold its own beside a capacity figure.',
  'A SupportTicket in a helpdesk queue, with a subject, a body, an owning agent and a thread of replies. The property to name is the stretch of time between the reporter writing in and an agent answering for the first time, held in whole seconds and left null while nobody has answered. Weekly reports average it per team against a target, so the name has to say which two moments are being measured between.',
  'A Playlist a listener either assembled by hand or received as a feed built from listening history. The property to name is the flag that separates those two origins: true when a person chose the tracks, false when the service did. The reorder handle is hidden when it is false, so the name has to stay readable when a caller negates it.',
  'An InboundShipment receiving scans in against a purchase order, carrying the carrier, the tracking reference and the date the pallet was expected. The property to name is the count of cartons that arrived undamaged, a whole number that is often lower than the count the supplier promised. Reconciliation subtracts it from that promised figure, so a name that could be read as either one is a real invoice dispute.',
  'A ClassBooking holding a member spot in a studio session, at a start time, for a fixed run of minutes. The property to name is whether the member turned up, which nobody knows until the class has run and is therefore three-valued rather than a plain boolean. The no-show policy reads it weeks later, so the name has to leave room for not yet known.',
  'A Transfer between two accounts, with a payer, a recipient and a reference line that prints on both statements. The property to name is the sum being moved, an integer in the currency minor units — 1250 for twelve pounds fifty — and never a decimal. A caller who reads it as pounds is out by a hundredfold, so carrying the unit is the whole naming problem.',
  'A Reservation for a room type over a stretch of nights, with a card on file and a count of adults and children. The property to name is the instant after which cancelling still costs the guest the first night; it is a timestamp in the hotel local zone, and it is absent on rates that can be cancelled free until arrival. Confirmation emails print it, so the name has to read as a deadline and not a duration.',
  'A SensorReading from a probe in a cold room, tagged with the device identifier and the moment it was sampled. The property to name is the temperature itself, in degrees Celsius, as a float that is negative for most of the working day. The battery level at the time of sampling sits in the field beside it, so a bare value would not say which of the two this is.',
  'A RecipeStep with an ordinal position, an instruction to follow and the ingredients it consumes. The property to name is how long the cook then waits — a rest, a proof or a simmer — in seconds, and absent for a step that is finished the moment the instruction is done. It is not how long the instruction itself takes, and the name has to keep the two apart.',
  'A Claim a policyholder filed after an incident, gathering documents on its way through review to a decision. The property to name is the money actually approved, in minor units, which is frequently less than was asked for and is absent until an assessor has decided. The requested figure lives beside it in the same type, so a name that reads as either one becomes an audit finding.',
  'A ParkingSession for a vehicle plate in a numbered bay, inside a zone with an hourly rate of its own. The property to name is the latest instant the driver may still be parked before the maximum stay is breached: a timestamp fixed when the session starts, not a length of time. A warden app compares it against the current moment, so the name has to make that comparison read the right way round.',
  'An Episode a show published, with a title, show notes and an audio file. The property to name is the running time of that audio in whole seconds, which the player turns into a scrub bar and the RSS feed prints as a duration. The size of the file on disk is a separate field, so the name has to say time rather than length.',
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
