# Home Assistant

Mit **Home Assistant** kannst du die Box anzeigen und steuern: was gerade läuft (mit Cover), Lautstärke, Pause, Weiter und Zurück, Springen im Titel und wo die Box spielt (Lautsprecher, Kopfhörerbuchse, Bluetooth-Kopfhörer). Dazu zeigt Home Assistant Akkustand, WLAN-Signal, Prozessorlast, Temperatur, Arbeitsspeicher und Speicherplatz. Die Verbindung läuft verschlüsselt (HTTPS) und nur im Heimnetz. In Home Assistant brauchst du dafür die Integration **MuPiBox** aus HACS.

> [!NOTE]
> Das ist die neue Anbindung über die Home-Assistant-Schnittstelle der Box. Die ältere Anbindung über einen MQTT-Broker gibt es weiter ([MQTT und Home Assistant](mqtt.md)). Du brauchst nur eine von beiden.

## Einschalten

Unter **Einstellungen › Dienste › Home Assistant** schaltest du **Home Assistant erlauben** ein. Die Box nimmt dann auf Port 8443 Verbindungen an und meldet sich im Heimnetz (mDNS), damit Home Assistant sie von selbst findet. Ist der Schalter aus, läuft dafür nichts auf der Box.

## Koppeln

1. In der App auf **Koppeln erlauben (60 s)** tippen.
2. In Home Assistant die Integration **MuPiBox** hinzufügen. Die Box erscheint von selbst; sonst die Adresse eingeben, die die App anzeigt.
3. Home Assistant zeigt einen **Schlüssel**. Das Display der Box zeigt denselben. Stimmen sie überein, in Home Assistant bestätigen. Stimmen sie nicht überein, abbrechen.
4. Möchte Home Assistant mehr als anzeigen und steuern (**Nachrichten und Ansagen**, **Neustart und Ausschalten**), fragt das Display zuerst: **Alles erlauben** oder **Nur anzeigen und steuern**.
5. Das Display zeigt einen **sechsstelligen Code** und die Rechte, die Home Assistant bekommt. Den Code in Home Assistant eingeben.

Der Code steht nur auf dem Display der Box. Wer ihn eingibt, hat die Box also vor sich. Er gilt 5 Minuten und nur einmal. Nach fünf falschen Versuchen ist die Kopplung beendet, und es geht nach einer Minute neu. Auch die zusätzlichen Rechte lassen sich nur am Display erlauben. Wer sie später doch geben will, entfernt die Kopplung und koppelt neu.

## Was Home Assistant noch kann

- **Bildschirmfoto**: Home Assistant kann zeigen, was gerade auf dem Display der Box steht.
- **Update**: Home Assistant zeigt, ob es eine neuere Version der Box gibt. Installiert wird das Update weiter in der App.
- **Nachrichten** (Recht „Nachrichten und Ansagen“): Ein kurzer Text erscheint auf dem Display, bis seine Zeit um ist oder jemand darauf tippt.
- **Ansagen** (Recht „Nachrichten und Ansagen“): Die Box spricht einen Text mit der Sprachausgabe. Dafür muss unter **Einstellungen › Audio › Sprachausgabe** eine Stimme eingestellt sein.
- **Neustart und Ausschalten** (Recht „Neustart und Ausschalten“): Die Box startet neu oder fährt herunter, wie mit dem Knopf in der App.

Während einer Ruhezeit zeigt die Box keine Nachrichten und spricht keine Ansagen.

## Gekoppelte Home Assistants

Die App listet unter **Gekoppelt** jedes Home Assistant mit seinen Rechten. **Entfernen** beendet die Kopplung sofort. Danach muss Home Assistant neu gekoppelt werden.

## Gut zu wissen

- Die Lautstärke aus Home Assistant hält sich an das Maximum der Box, bei Kopfhörern an die Grenze für Kopfhörer.
- Die Spielzeit und die Ruhezeiten gelten auch für Home Assistant. Ist die Wiedergabe gesperrt, startet auch Home Assistant nichts.
- Ändern sich die IP-Adresse oder der Name der Box, bleibt die Kopplung bestehen: Der Schlüssel der Box ändert sich dabei nicht.
