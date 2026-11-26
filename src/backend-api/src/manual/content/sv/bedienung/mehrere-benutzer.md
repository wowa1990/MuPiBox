# Flera användare

Delar flera barn på en box får var och en sitt eget bibliotek, sin egen speltid och sina egna vilotider och egna inställningar. Allt om det står i appen under **Inställningar › Flera användare**. Som standard är det av: boxen har då en användare, som förut.

## Slå på

Slå på **Flera användare**. Boxens hittillsvarande tillstånd blir den första användaren **Standard**, som du kan döpa om. Med **Lägg till användare** kommer ett barn till:

- **Börja tomt**: ett tomt bibliotek.
- **Kopia av biblioteket från …**: en annan användares bibliotek som start, med hens Spotify-prenumerationer.

Inställningarna (tema, volym, startsida …) tar en ny användare över från den aktiva användaren, vid en kopia från den som kopieras. Varje användare har en egen **färg**. Displayen visar den som en prick uppe till höger. Det finns nio färger, alltså högst nio användare.

## Vad varje barn har för sig själv

| Eget | Gemensamt för hela boxen |
| --- | --- |
| bibliotek med rutor, Spotify-prenumerationer och poddar | inloggningar hos Spotify, TIDAL, Jellyfin, Audible |
| senast spelat, fortsätt lyssna, lyssnade avsnitt | Wi-Fi, NAS, delningar |
| [lyssningshistorik](../spielzeit/hoer-verlauf.md) och statistik | boxens egna filer (mediamappen) |
| [dagsgränser](../spielzeit/tageslimits.md), [vilotider](../spielzeit/ruhezeiten.md), [rutgränser](../spielzeit/kachel-limit.md) | själva fotoalbumen |
| bildtid och vilka fotoalbum displayen visar | NFC-kort, knappar, OLED och andra tillägg |
| tema, volymer, startsida, klocka, ljusstyrka | Telegram, Home Assistant, MQTT, insomningstimer |
| inställningar för ett tillägg som är markerade med **per användare** (till exempel klubbarna i [Fotboll](../erweiterungen/fussball.md)) | |

Egna filer visar boxen för alla barn. Varje barn har sina egna dolda omslag: med **Inget omslag** döljer du ett för det barn som just lyssnar.

## Byta

**I appen** byter du på startsidan eller under **Inställningar › Flera användare** med **Byt**. Bytet tar ungefär en sekund. Det som spelas stannar, och displayen laddas om med det andra barnets tema, startsida och bibliotek.

**På displayen** trycker man på den färgade **pricken** uppe till höger. **Vem lyssnar?** öppnas med en ruta per barn. Hur man byter där ställer du in under **Byte på skärmen**:

| Inställning | Verkan |
| --- | --- |
| **Tryck** | ett tryck på rutan byter |
| **Håll** | håll rutan tre sekunder, så byter ingen av misstag |
| **Bara i appen** | pricken visar bara vem som lyssnar, byte sker bara i appen |

Det går även från **spärrbilden**. Speltiden gäller ju per barn: har ett syskon tid kvar får det lyssna. En paus som du sätter i appen eller i Telegram med **Vila nu** gäller däremot för hela boxen, även efter ett byte.

## PIN

Varje användare kan få en **PIN** på fyra siffror (**PIN** på hens rad). Displayen frågar efter den innan den byter **till den här användaren**. Så kommer inget barn åt en vuxens bibliotek eller ett syskons speltid. Efter fem felaktiga försök tar displayen inte emot någon PIN på en minut. Appen, Telegram, Home Assistant och MQTT frågar inte efter någon PIN. [En knapp för en användare](#en-knapp-foer-en-anvaendare) frågar bara om du ställer in det.

## En knapp för en användare

Varje användare kan få en **knapp** på boxen: en tryckknapp på ett **ledigt GPIO-stift** som kopplas mot **GND**. Ett tryck på den byter genast till den användaren. På hens rad väljer du stiftet under **Knapp**; **Ingen pin** tar bort knappen igen. Listan erbjuder bara stift som inget annat använder (boxen, ett tillägg, en vridratt, en annan användare) och säger vem som håller de övriga.

Att byta med knappen går också vid **Bara i appen**, eftersom en knapp på boxen är som appen eller MQTT: den som kan trycka på den står vid boxen. Om knappen kräver en PIN ställer du in på samma ark, med **Fråga efter PIN på skärmen först**:

| Inställning | Vad ett tryck på knappen gör |
| --- | --- |
| av | byter genast, utan PIN, även om en PIN är inställd på skärmen för användaren |
| på | skärmen visar sifferpanelen för användaren, och bytet sker först med rätt PIN. Samma spärr gäller som vid varje byte på skärmen: efter fem felaktiga försök tar den inte emot någon PIN på en minut |

Frågan hänger bara på den här inställningen, inte på sättet att byta. Har användaren ingen [PIN](#pin) finns inget att fråga efter, och knappen byter genast. Knapparna gäller så länge **Flera användare** är på; därefter är deras stift lediga igen. Knappen kopplar stiftet mot GND, stiftet har själv sin pull-up (se [GPIO-belägging](../anhang/gpio.md)).

## Redigera ett annat barn utan att byta

På sidorna **Bibliotek**, **Speltid** och **Lyssnarhistorik** finns högst upp ett val för vilket barn du just arbetar. Du kan ändra ett barns bibliotek, prenumerationer, gränser och vilotider medan ett annat lyssnar. Ändringarna gäller så fort det barnet är i tur. Bonusminuter för i dag räknas likadant.

Bara för det aktiva barnet fungerar **Spela upp**, **Häv spärr**, **Vila nu**, **Inget omslag** och att behålla enskilda avsnitt offline, eftersom de verkar på det boxen just gör eller visar. Att slå Smart-Sync på och av och dess konflikter (**Bibliotek › Spotify**) gäller likaså det aktiva barnet.

## Vad som körs i bakgrunden för alla

- **Smart-Sync**: boxen stämmer av varje barns Spotify-prenumerationer, var och en in i sitt eget bibliotek, var och en med sitt eget intervall. Det slås på och av per barn, medan barnet är aktivt (**Bibliotek › Spotify**). Ett barn med tomt bibliotek börjar utan Smart-Sync: nya prenumerationer kommer då en gång till boxen, senare avsnitt först när dess Smart-Sync är på.
- **Offline-avsnitt** av poddar ligger en gång på SD-kortet. Ett avsnitt blir kvar så länge något barn vill behålla det. Har ett barn ställt in 1 avsnitt och ett annat 3 ligger de 3 nyaste där.
- **Telegram**: ett namn i slutet av ett kommando avser det barnet, utan namn det aktiva (`/status Leni`, `/extend 30 Leni`, se [Telegram](../netzwerk/telegram.md)). Veckosammanfattningen kommer för varje barn för sig.

## NFC-kort

Kort gäller för hela boxen och byter aldrig barn. Ligger det som ett kort startar inte i det aktiva barnets bibliotek spelas ingenting och displayen säger det kort. Vid tvekan spelar kortet hellre: egna filer och NAS spelas alltid, likaså ett album ur en artist, en serie eller en sökning i biblioteket.

## Stänga av

Stänger du av **Flera användare** väljer du med vem boxen fortsätter. De andra vilar med allt de har: deras prenumerationer stäms inte av, deras offline-avsnitt blir kvar. Slår du på det igen är de tillbaka.

## Ta bort och papperskorg

**Ta bort** lägger en användare i papperskorgen i 30 dagar, med bibliotek, inställningar och PIN. Därifrån hämtar du tillbaka hen. Den aktiva användaren kan du inte ta bort, byt först.

## Säkerhetskopia

En [säkerhetskopia](../wartung/backup.md) innehåller alla användare: deras lista, deras bibliotek och inställningar, inte papperskorgen. Vid återställning kommer alla tillbaka som de var i säkerhetskopian. Användare som säkerhetskopian inte känner till hamnar i papperskorgen.
