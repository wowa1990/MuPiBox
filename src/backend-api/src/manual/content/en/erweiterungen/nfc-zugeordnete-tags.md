# NFC: Assigned tags

The sub page **Assigned tags** (**Settings › System › NFC extension › Assigned tags**) shows all tags that have a medium. New tags are added from the library (see [Linking a tag to an album](nfc-tag-zuordnen.md)); this page manages them.

![The Assigned tags page](nfc-tags-page.png)

## The tiles

Every tag is a tile. On a phone (up to 575 pixels wide) there is one tile in each row, from 576 pixels two, from 1000 pixels three side by side.

![Three tiles side by side](nfc-tags-page-wide.png)

From top to bottom a tile shows:

| Item | Meaning |
| --- | --- |
| **Title** | the medium the tag starts |
| **Picture** | the cover of the medium or a picture of your own (see [Changing the picture of a tag](nfc-bild.md)) |
| **Text** | the kind (SD card, NAS, Spotify, radio, podcast or TIDAL), the number of the tag (the UID, for example `04:A1:B2:C3:D4:E5:F6`; for a USB reader the card number as the reader types it) and **Flex tag** when the tag is the flex tag |
| **Buttons** | five symbols, see below |

The newest tags are at the top.

## The five buttons

From left to right:

| Symbol | Effect |
| --- | --- |
| Picture | **Change picture**: choose a picture of your own for the tag, see [Changing the picture of a tag](nfc-bild.md) |
| Arrow back | **Use the cover of the medium**: give up the own picture, the tag shows the cover of the medium again. Greyed out while the tag has no picture of its own |
| Play | **Play album**: starts the medium of the tag as if you had laid the tag on |
| Arrows | **Change tag**: the tag gets another album, see below |
| Bin | **Remove**: takes the tag out of the list, after a question. A removed tag counts as new the next time it is laid on and plays nothing |

A tag you lay on that has no medium is not in the list. It plays nothing.

## The player at the bottom

At the bottom of the page, always in view, is a small player. It shows what the box is playing right now and steers it:

- **Back**, **Play/Pause** and **Next**,
- the cover and the title,
- the time and a bar showing how far the medium is,
- the **volume** (with the box's hearing protection).

When you tap **Play album** on a tile, the player shows the new medium after a second or two. If something is playing already, it is replaced. The player also shows what a tag you lay on or a tap on the display starts.

## Change tag

With **Change tag** the tag gets another album without being laid on:

1. Tap **Change tag** on the tile. The app switches to the **Library**; a note appears at the bottom (with **Cancel**).
2. Open the album, station or podcast the tag is to start from now on.
3. Under the **NFC tag** button there is now **Assign the tag to this album.** Tap it.

The app goes back to **Assigned tags**; the tile shows the new medium. An own picture of the tag goes with that (the tag shows the cover of the new medium), the flex tag stays the flex tag.

![The library waits for the new album](nfc-change-library.png)

![The album with the button "Assign the tag to this album."](nfc-change-sheet.png)

## When taken off

Under the list is the setting **When taken off**: **Pause** (default), **Stop** or **Keep playing**. Only a tag that has a medium triggers this, and only while what it started still plays: if the child chose something else on the display meanwhile, that goes on.

With **Pause** an audio play goes on where it was if the same tag is laid on again within half an hour. With another tag its medium starts as when you tap the tile. A tag laid on again while its medium still plays (with a USB reader: every time it is held there) lets it play on instead of starting it from the beginning. With **Pause** or **Stop**, a tag laid on only briefly and taken off before playback begins starts nothing.

A **USB reader** reports only the laying on, never the taking off. **When taken off** does not work with it; playback just goes on.

## Where the assignments are kept

The assignments are in `tags.json` in the extension's data folder (`~/.mupibox/data/extensions/nfc/`) and stay through updates. The box starts through the **display** (so tile times, playtime and "Continue" count as with a tap); with no display running a tag therefore starts nothing.
