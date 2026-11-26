# Wetter

Die Erweiterung **Wetter** zeigt das Wetter eines Ortes als **Messuhren** auf dem Display: Temperatur, Luftfeuchte, Windstärke, Windrichtung, Luftdruck und Regenmenge. Sie richtet auf der Box nichts ein; die Werte holt die Box aus dem Internet.

## Einrichten

1. Installiere die Erweiterung unter **Einstellungen › System › Erweiterungen** ([Installieren und verwalten](installieren.md)).
2. Öffne unter **Einstellungen** die Seite **Wetter** und suche unter **Ort** nach dem Namen deines Ortes. Tippe einen Treffer an.

Ist ein Ort gewählt, zeigt das Display oben den Reiter **Wetter**. Ein Tipp darauf öffnet die Messuhren: immer zwei nebeneinander, mit Wischen kommst du zu den nächsten. Der Zurück-Knopf in der Titelleiste schließt sie wieder.

## Einstellungen

Die Einstellungen stehen auf einer eigenen Seite **Wetter** unter **Einstellungen**, in vier Karten: **Wetterserver und Ort**, **Aktualisierung** (nur zur Anzeige), **Einheiten** und **Aussehen der Uhren**.

| Einstellung | Wirkung |
| --- | --- |
| **Wetterserver** | **Open-Meteo** liefert Messwerte der letzten 24 Stunden und Böen. Bei **MET Norway (yr.no)** sind es Werte des Wettermodells; der Regen ist dort die Vorhersage für die nächsten 24 Stunden |
| **Ort** | nach dem Namen suchen und einen Treffer antippen |
| **Aktualisierung** | keine Einstellung, nur die Anzeige: wann die Box zuletzt neue Werte bekommen hat und wann der Wetterserver die nächsten liefert |
| **Temperatur** | °C oder °F |
| **Regen** | mm oder Zoll |
| **Luftdruck** | hPa, inHg, mb oder kPa |
| **Windstärke** | km/h, m/s, mph oder Knoten |
| **Reihenfolge der Uhren** | fasse eine Uhr am Griff an und schiebe sie an eine andere Stelle |
| **Rahmen**, **Hintergrund**, **Zeigerform**, **Zeigerfarbe**, **Knopf** und **Knopffarbe** | das [Aussehen der Uhren](#aussehen-der-uhren) |

## Die Regenuhr

Die Regenuhr zeigt zwei Werte in zwei Anzeigen, wie die Windrichtung: **last 24h** (was in den letzten 24 Stunden gefallen ist) und **next 24h** (was für die nächsten 24 Stunden vorhergesagt ist). Der Zeiger zeigt die letzten 24 Stunden, die Skala reicht für den größeren der beiden Werte. Bei **MET Norway** gibt es nur die Vorhersage; die letzten 24 Stunden holt die Box dann von **Open-Meteo**. Ist das nicht erreichbar, steht dort ein Strich und der Zeiger zeigt die nächsten 24 Stunden.

## Wann es neue Werte gibt

Die Wetterserver liefern nur in festen Abständen neue Werte, deshalb lässt sich die Aktualisierung nicht einstellen. Die Box fragt erst wieder, wenn der Server eine neue Antwort in Aussicht stellt:

| Wetterserver | Neue Werte | Zeit auf der Anzeige |
| --- | --- | --- |
| **MET Norway (yr.no)** | etwa alle 30 Minuten. Die Werte sind stündliche Modellwerte; die Box rechnet sie auf die aktuelle Minute um, sodass sich die Zeiger auch zwischen den vollen Stunden bewegen | die Zeit des Ortes, nicht die der Box |
| **Open-Meteo** | alle 15 Minuten, nach der vollen Viertelstunde | die Zeit des Ortes |

Unten auf der Wetteranzeige stehen **Letzte Aktualisierung** und **Nächste**, auf der Einstellungsseite in der Karte **Aktualisierung**. Die geöffnete Anzeige fragt die Box jede Minute; die Uhren werden nur neu gezeichnet, wenn sich ein Wert geändert hat.

Beide Wetterserver sind kostenlos und brauchen keine Anmeldung. Die Box fragt sie mit den Koordinaten des gewählten Ortes.

## Aussehen der Uhren

Die Uhren zeichnet die Bibliothek **SteelSeries**, und die Namen der Rahmen und Hintergründe sind die ihrer Entwickler. Ohne Auswahl sehen die Uhren aus wie bisher: Rahmen **Metal**, Hintergrund **Beige**, Zeigerform **1**, Zeigerfarbe **Rot**, Knopf **Metall** in **Silber**. Gewählt wird in der Karte **Aussehen der Uhren**. Du kannst mehrere Einstellungen nacheinander ändern, ohne dass sich das Display jedes Mal neu aufbaut: Erst mit **Änderungen übernehmen** lädt es neu und öffnet wieder die Wetteranzeige. Die Änderung gilt, sobald du die Wetteranzeige das nächste Mal öffnest.

**Rahmen:** Black Metal, Metal, Shiny Metal, Brass, Steel, Chrome, Gold, Anthracite, Tilted Gray, Tilted Black und Glossy Metal.

![Die 11 Rahmen](weather-frames.png)

**Hintergrund:** Dark Gray, Satin Gray, Light Gray, White, Black, Beige, Brown, Red, Green, Blue, Anthracite, Mud, Punched Sheet, Carbon, Stainless, Brushed Metal, Brushed Stainless und Turned.

![Die 18 Hintergründe](weather-backgrounds.png)

**Zeigerform:** 16 Formen, von **1** bis **16**. Sie gilt für die runden Uhren; die Windrichtung behält ihre zwei Zeiger, einen roten für den aktuellen Wert und einen blauen für den Mittelwert.

![Die 16 Zeigerformen](weather-pointers.png)

**Zeigerfarbe:** Rot, Grün, Blau, Orange, Gelb, Cyan, Magenta, Weiß, Grau, Schwarz, Raith, Jug Green und Green LCD.

![Die 13 Zeigerfarben](weather-colours.png)

**Knopf** und **Knopffarbe:** der Knopf in der Mitte der Uhr, **Standard** oder **Metall**, in **Schwarz**, **Messing** oder **Silber**.

![Die Knöpfe](weather-knobs.png)

## Wenn kein Wetter erscheint

- Ist ein **Ort** gewählt? Ohne Ort gibt es den Reiter **Wetter** nicht.
- Die Ortssuche und die Werte brauchen Internet.
- Ist die Erweiterung unter **Einstellungen › System › Erweiterungen** eingeschaltet?
