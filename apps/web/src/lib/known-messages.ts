/**
 * The server and the shared checks speak English. The sentences a person can run into are listed here once, so the
 * screen can show them in the person's language (`errors.known.*`). A sentence that is not listed is still shown as
 * the server wrote it; `known-messages.test.ts` keeps this list in step with the code.
 */
export const KNOWN_MESSAGES = {
  // Checks shared with the server (packages/domain).
  "Enter the 6-digit code from your email.": "otpCode",
  "Enter 6 digits.": "sixDigits",
  "Choose a PIN that is harder to guess.": "weakPin",
  "Use a 2-letter country code.": "countryCode",
  "Who makes it?": "producer",
  "What is it called?": "wineName",
  "Give it a name.": "giveName",
  "Give yourself a name.": "displayName",
  "A place needs a shelf and a position.": "shelfAndPosition",
  "Nothing to update.": "nothingToUpdate",
  "No two dots in a row.": "doubleDot",
  "Choose a friend.": "chooseFriend",
  "Use a 3-letter currency code, like EUR.": "currency",
  "Give your household a name.": "householdName",
  "Invite codes have 12 letters and numbers.": "inviteCode",
  "Say what the occasion is.": "occasion",
  "Ask a question.": "askQuestion",
  "Say something about it: give it stars, a word or a note.": "tastingEmpty",
  // Answers from the server.
  "This setting is not available yet.": "settingNotYet",
  "Ratings go in tenths of a star.": "ratingTenths",
  "Choose one of your friends.": "chooseOneFriend",
  "Create or join a household first.": "householdFirst",
  "Only the household's owner can delete a place.": "ownerDeletePlace",
  "Only the household's owner can do that.": "ownerOnly",
  "Open the bottle first, then tell us how it was.": "openFirst",
  "Pick a different wine to merge with.": "mergeSame",
  "That already exists.": "exists",
  "That bottle can't be put back.": "cantPutBack",
  "That bottle has already been opened.": "alreadyOpened",
  "That bottle is no longer in the cellar.": "notInCellar",
  "That is still in use, so it can't be removed yet.": "inUse",
  "That name is taken. Try another one.": "nameTaken",
  "That photo is too large. Try a smaller one.": "photoTooLarge",
  "That recommendation is no longer there.": "recommendationGone",
  "That request is no longer there.": "requestGone",
  "That request is too large.": "tooLarge",
  "That spot doesn't exist in this place.": "spotMissing",
  "That spot doesn't exist in this rack.": "spotMissing",
  "That spot was just taken. Pick another.": "spotTaken",
  "A bottle can't trade places with itself.": "swapSelf",
  "One of these bottles is no longer in the cellar or has no place. Nothing was changed.":
    "swapGone",
  "One of these bottles was just moved by someone else. Nothing was changed.": "swapStale",
  "That wine comes from the shared catalogue, so it can't be edited.": "catalogueWine",
  "That wine is already on your wishlist.": "onWishlist",
  "There are still bottles in it. Move them out first.": "stillBottles",
  "There are still bottles in the part you're removing. Move them first.": "stillBottlesPart",
  "Type your email address exactly to confirm.": "confirmEmail",
  "We couldn't find that bottle.": "bottleMissing",
  "We couldn't find that photo.": "photoMissing",
  "We couldn't find that place.": "placeMissing",
  "We couldn't find that wine.": "wineMissing",
  "We couldn't finish deleting your account. Try again.": "deleteAccountFailed",
  "We couldn't save that.": "saveFailed",
  "You already have a place with that name.": "placeExists",
  "You already have a wine with that name from this producer.": "wineExists",
  "You are not friends (any more).": "notFriends",
  "You have already rated this bottle.": "alreadyRated",
  "You're the last owner. Delete the household instead, or hand it over first.": "lastOwner",
  "No price with a trustworthy source was found.": "noPrice",
  "The import came out uneven, so it was taken back.": "importUneven",
  "Not allowed.": "notAllowed",
} as const;

/** Sentences with a part that changes, or a family of sentences that all mean the same to the person. */
const KNOWN_PATTERNS = [
  // Setup steps the owner of the app still has to take; the person can only wait.
  [/one more database step/, "notReady"],
  [/(isn't|aren't|is not|are not) (switched on|configured|set up)/, "notSwitchedOn"],
  [/^You are the only owner of .+, which still has other people in it/, "onlyOwnerOf"],
  [/^That is more than we can bring in at once/, "importTooBig"],
] as const;

export type KnownKey =
  (typeof KNOWN_MESSAGES)[keyof typeof KNOWN_MESSAGES] | (typeof KNOWN_PATTERNS)[number][1];

/** The `errors.known.*` key for an English sentence, or null when it isn't one we know. */
export function knownMessage(text: string | null | undefined): KnownKey | null {
  if (!text) return null;
  const exact = (KNOWN_MESSAGES as Record<string, KnownKey>)[text];
  if (exact) return exact;
  for (const [pattern, key] of KNOWN_PATTERNS) if (pattern.test(text)) return key;
  return null;
}

/** All keys, for the test that checks every one has a translation. */
export const KNOWN_KEYS: KnownKey[] = [
  ...new Set([...Object.values(KNOWN_MESSAGES), ...KNOWN_PATTERNS.map(([, key]) => key)]),
];
