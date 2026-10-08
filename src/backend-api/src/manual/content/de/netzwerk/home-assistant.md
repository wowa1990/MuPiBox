# Home Assistant

Mit **Home Assistant** kannst du die Box anzeigen und steuern: was gerade läuft (mit Cover), Lautstärke, Pause, Weiter und Zurück, Springen im Titel, dazu Akkustand und WLAN-Signal. Die Verbindung läuft verschlüsselt (HTTPS) und nur im Heimnetz. In Home Assistant brauchst du dafür die Integration **MuPiBox** aus HACS.

> [!NOTE]
> Das ist die neue Anbindung über die Home-Assistant-Schnittstelle der Box. Die ältere Anbindung über einen MQTT-Broker gibt es weiter ([MQTT und Home Assistant](mqtt.md)). Du brauchst nur eine von beiden.

## Einschalten

Unter **Einstellungen › Dienste › Home Assistant** schaltest du **Home Assistant erlauben** ein. Die Box nimmt dann auf Port 8443 Verbindungen an und meldet sich im Heimnetz (mDNS), damit Home Assistant sie von selbst findet. Ist der Schalter aus, läuft dafür nichts auf der Box.

## Koppeln

1. In der App auf **Koppeln erlauben (60 s)** tippen.
2. In Home Assistant die Integration **MuPiBox** hinzufügen. Die Box erscheint von selbst; sonst die Adresse eingeben, die die App anzeigt.
3. Home Assistant zeigt einen **Schlüssel**. Das Display der Box zeigt denselben. Stimmen sie überein, in Home Assistant bestätigen. Stimmen sie nicht überein, abbrechen.
4. Das Display zeigt einen **sechsstelligen Code** und die Rechte, die Home Assistant bekommt (sehen, was läuft, und die Wiedergabe steuern). Den Code in Home Assistant eingeben.

Der Code steht nur auf dem Display der Box. Wer ihn eingibt, hat die Box also vor sich. Er gilt 5 Minuten und nur einmal. Nach fünf falschen Versuchen ist die Kopplung beendet, und es geht nach einer Minute neu.

## Gekoppelte Home Assistants

Die App listet unter **Gekoppelt** jedes Home Assistant mit seinen Rechten. **Entfernen** beendet die Kopplung sofort. Danach muss Home Assistant neu gekoppelt werden.

## Gut zu wissen

- Die Lautstärke aus Home Assistant hält sich an das Maximum der Box, bei Kopfhörern an die Grenze für Kopfhörer.
- Die Spielzeit und die Ruhezeiten gelten auch für Home Assistant. Ist die Wiedergabe gesperrt, startet auch Home Assistant nichts.
- Neustart und Ausschalten über Home Assistant gibt es in dieser Version noch nicht.
- Ändern sich die IP-Adresse oder der Name der Box, bleibt die Kopplung bestehen: Der Schlüssel der Box ändert sich dabei nicht.
