# NFC: Zugeordnete Tags

Die Unterseite **Zugeordnete Tags** (**Einstellungen › System › NFC-Extension › Zugeordnete Tags**) zeigt alle Tags, die ein Medium haben. Neue Tags kommen aus der Bibliothek dazu (siehe [Tag mit einem Album verknüpfen](nfc-tag-zuordnen.md)); diese Seite verwaltet sie.

![Die Seite Zugeordnete Tags](nfc-tags-page.png)

## Die Kacheln

Jeder Tag ist eine Kachel. Auf dem Handy (bis 575 Pixel Breite) steht eine Kachel in jeder Reihe, ab 576 Pixel zwei, ab 1000 Pixel drei nebeneinander.

![Drei Kacheln nebeneinander](nfc-tags-page-wide.png)

Eine Kachel zeigt von oben nach unten:

| Angabe | Bedeutung |
| --- | --- |
| **Titel** | das Medium, das der Tag startet |
| **Bild** | das Cover des Mediums oder ein eigenes Bild (siehe [Bild des Tags ändern](nfc-bild.md)) |
| **Text** | die Art (SD-Karte, NAS, Spotify, Radio, Podcast oder TIDAL), die Nummer des Tags (die UID, zum Beispiel `04:A1:B2:C3:D4:E5:F6`; bei einem USB-Leser die Kartennummer, wie der Leser sie tippt) und **Flex-Tag**, wenn der Tag der Flex-Tag ist |
| **Knöpfe** | fünf Symbole, siehe unten |

Die neuesten Tags stehen oben.

## Die fünf Knöpfe

Von links nach rechts:

| Symbol | Wirkung |
| --- | --- |
| Bild | **Bild ändern**: ein eigenes Bild für den Tag wählen, siehe [Bild des Tags ändern](nfc-bild.md) |
| Pfeil zurück | **Cover des Mediums nehmen**: das eigene Bild wieder abgeben, der Tag zeigt wieder das Cover des Mediums. Ausgegraut, solange der Tag kein eigenes Bild hat |
| Abspielen | **Album abspielen**: startet das Medium des Tags, als hättest du den Tag aufgelegt |
| Pfeile | **Tag ändern**: der Tag bekommt ein anderes Album, siehe unten |
| Papierkorb | **Entfernen**: nimmt den Tag aus der Liste, nach einer Rückfrage. Ein entfernter Tag gilt beim nächsten Auflegen wieder als neu und spielt nichts |

Ein Tag, den du auflegst, der aber kein Medium hat, steht nicht in der Liste. Er spielt nichts.

## Der Player am unteren Rand

Am unteren Rand der Seite steht, immer sichtbar, ein kleiner Player. Er zeigt, was die Box gerade spielt, und steuert es:

- **Zurück**, **Abspielen/Pause** und **Weiter**,
- das Cover und den Titel,
- die Zeit und einen Balken, wie weit das Medium ist,
- die **Lautstärke** (mit dem Hörschutz der Box).

Tippst du bei einer Kachel auf **Album abspielen**, zeigt der Player nach ein, zwei Sekunden das neue Medium. Spielt schon etwas, wird es ersetzt. Der Player zeigt auch, was ein aufgelegter Tag oder ein Tipp am Display startet.

## Tag ändern

Mit **Tag ändern** bekommt der Tag ein anderes Album, ohne dass du ihn auflegen musst:

1. Tippe auf der Kachel auf **Tag ändern**. Die App wechselt in die **Bibliothek**; unten steht ein Hinweis (mit **Abbrechen**).
2. Öffne dort das Album, den Sender oder den Podcast, den der Tag künftig starten soll.
3. Unter dem Knopf **NFC-Tag** steht jetzt **Weise den NFC-Tag diesem Album zu**. Tippe darauf.

Die App geht zurück auf **Zugeordnete Tags**; die Kachel zeigt das neue Medium. Ein eigenes Bild des Tags geht dabei weg (der Tag zeigt das Cover des neuen Mediums), der Flex-Tag bleibt der Flex-Tag.

![Die Bibliothek wartet auf das neue Album](nfc-change-library.png)

![Das Album mit dem Knopf „Weise den NFC-Tag diesem Album zu“](nfc-change-sheet.png)

## Beim Abnehmen

Unter der Liste steht die Einstellung **Beim Abnehmen**: **Pausieren** (Standard), **Stoppen** oder **Weiterspielen**. Nur ein Tag, der ein Medium hat, löst das aus, und nur, solange noch läuft, was er gestartet hat: Hat das Kind inzwischen am Display etwas anderes gewählt, läuft das weiter.

Mit **Pausieren** geht ein Hörspiel dort weiter, wo es war, wenn derselbe Tag innerhalb einer halben Stunde wieder aufliegt. Bei einem anderen Tag startet dessen Medium wie bei einem Tipp auf die Kachel. Liegt ein Tag wieder auf, während sein Medium noch läuft (beim USB-Leser bei jedem Vorhalten), spielt es einfach weiter und beginnt nicht von vorn. Wird ein Tag mit **Pausieren** oder **Stoppen** nur kurz aufgelegt und gleich wieder abgenommen, bevor die Wiedergabe beginnt, startet nichts.

Ein **USB-Leser** meldet nur das Auflegen, nie das Abnehmen. Für ihn wirkt **Beim Abnehmen** nicht; die Wiedergabe läuft einfach weiter.

## Wo die Zuordnungen stehen

Die Zuordnungen stehen in `tags.json` im Datenordner der Erweiterung (`~/.mupibox/data/extensions/nfc/`) und bleiben bei Updates erhalten. Beim Start geht die Box über das **Display** (so zählen Kachel-Zeiten, Spielzeit und „Fortsetzen“ wie bei einem Tipp); ohne laufendes Display startet ein Tag also nichts.
