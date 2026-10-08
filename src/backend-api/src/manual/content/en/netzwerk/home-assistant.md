# Home Assistant

With **Home Assistant** you can show and control the box: what is playing (with cover), volume, pause, next and previous, seeking in the track, plus battery level and Wi-Fi signal. The connection is encrypted (HTTPS) and only within the home network. In Home Assistant you need the **MuPiBox** integration from HACS.

> [!NOTE]
> This is the new connection through the box's Home Assistant interface. The older connection through an MQTT broker still exists ([MQTT and Home Assistant](mqtt.md)). You only need one of the two.

## Switching on

Under **Settings › Services › Home Assistant** switch on **Allow Home Assistant**. The box then accepts connections on port 8443 and announces itself in the home network (mDNS), so Home Assistant finds it by itself. With the switch off, nothing runs on the box for it.

## Pairing

1. In the app tap **Allow pairing (60 s)**.
2. In Home Assistant add the **MuPiBox** integration. The box shows up by itself; otherwise enter the address the app shows.
3. Home Assistant shows a **key**. The box's display shows the same one. If they match, confirm in Home Assistant. If they do not match, cancel.
4. The display shows a **six-digit code** and the rights Home Assistant gets (see what is playing and control playback). Enter the code in Home Assistant.

The code is shown only on the box's display, so whoever enters it has the box in front of them. It is valid for 5 minutes and only once. After five wrong attempts the pairing ends, and it can be started again after a minute.

## Paired Home Assistants

Under **Paired** the app lists every Home Assistant with its rights. **Remove** ends the pairing at once. Home Assistant then has to be paired again.

## Good to know

- The volume from Home Assistant keeps to the box's maximum, with headphones to the limit for headphones.
- Listening time and quiet times apply to Home Assistant too. If playback is blocked, Home Assistant cannot start anything either.
- Restart and shutdown through Home Assistant are not offered in this version yet.
- If the box's IP address or name changes, the pairing stays: the box's key does not change with it.
