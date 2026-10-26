# Scanning: modes, batch queue and the camera

## Three modes

| Mode                    | What it does                                                                            | AI readings |
| ----------------------- | --------------------------------------------------------------------------------------- | ----------- |
| Single bottle (default) | One label photo, reviewed, one bottle by default.                                       | 1           |
| Same wine               | One label photo; the bottle form starts at 2 and the quantity covers every bottle.      | 1           |
| Batch                   | A photo per wine (camera or several library photos), each read and reviewed on its own. | 1 per photo |

Switching mode never discards a batch: its photos stay in the tray, and no photo is sent by switching.

## Recognition cache (identical photos)

In every mode, a photo that is byte-for-byte identical (after processing) to one this household already
**confirmed** is answered from that confirmation without a vision call. It does not spend the scan budget or add
an `ai_usage` row. The answer is still a suggestion in the usual review ("You confirmed this exact photo
before"), so the person confirms it as always.

Readings nobody confirmed are never remembered. Corrections and removals change the answer at once. Other
households never benefit. Another photo of the same bottle is not recognised this way.

Details and the plans for different-photo recognition: `docs/RECOGNITION-ROADMAP.md`.

## Batch queue (`apps/web/src/features/scan/queue.ts`)

- At most two readings at once; at most 20 photos per batch (well inside the 40/hour scan limit).
- Each reading carries a run number: a removed photo never comes back, a late answer never overwrites a retry.
- Retries are explicit and per photo ("Try again" after a network failure, "Read again (1 scan)" after an
  unread answer). Nothing is retried by itself.
- When the household scan limit (`limit`) or the platform AI budget (`budget`) stops a reading, the photos not
  yet sent are paused, uncharged, until the person resumes.
- The same photo added twice (same bytes) is held with a warning and not read unless the person says so.
  Different photos that read as the same wine are flagged; the person decides whether they are more bottles.
- A photo read earlier is matched again against the current wines when it is opened, so a wine created from
  photo 2 is found for photo 3 instead of being created twice.
- Nothing is added without the person confirming it; failed and skipped photos never create bottles, and a
  photo can only be finished once (double taps are ignored).

## Camera permission: what CELLR controls, and what the browser does

CELLR now:

- asks for the camera only when the person wants the live camera (the "Use the camera" button), or by itself
  when the browser already reports the permission as granted, or the person chose the live camera earlier in
  the same visit (session storage);
- never starts the camera for choosing photos from the library;
- keeps one camera stream for the whole scan screen: moving from the viewfinder to a review and back does not
  ask again. While reviewing, the picture is paused (tracks disabled) and released after 90 seconds;
- releases the camera at once when the app goes to the background or the scan screen is left, and asks for it
  again on return only if it was in use;
- keeps the phone's own camera (file input) as the fallback whenever there is no live picture.

Up to the browser (CELLR cannot change this):

- whether a permission prompt is shown at all, and how long a grant lasts. iOS Safari and Home Screen apps
  (standalone PWAs) may forget the grant when the app is closed or after a while, so a prompt can appear again
  on a new launch even though CELLR asks only once per visit;
- the "Allow / Don't allow" choice itself. CELLR never bypasses the prompt and cannot grant permission
  permanently; a blocked camera is changed in the browser or system settings.
