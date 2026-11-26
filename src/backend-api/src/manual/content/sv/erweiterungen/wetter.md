# Väder

Tillägget **Väder** visar vädret på en ort som **mätare** på displayen: temperatur, luftfuktighet, vindstyrka, vindriktning, lufttryck och regnmängd. Det ställer inte in något på boxen; värdena hämtar boxen från internet.

## Ställa in

1. Installera tillägget under **Inställningar › System › Tillägg** ([Installera och hantera](installieren.md)).
2. Öppna sidan **Väder** under **Inställningar** och sök under **Ort** efter namnet på din ort. Tryck på en träff.

Är en ort vald visar displayen fliken **Väder** överst. Ett tryck på den öppnar mätarna: alltid två bredvid varandra, och med svepning kommer du till nästa. Tillbaka-knappen i titellisten stänger dem igen.

## Inställningar

Inställningarna finns på en egen sida, **Väder**, under **Inställningar**, i fyra kort: **Väderserver och ort**, **Uppdatering** (bara en visning), **Enheter** och **Mätarnas utseende**.

| Inställning | Verkan |
| --- | --- |
| **Väderserver** | **Open-Meteo** levererar mätvärden för de senaste 24 timmarna och vindbyar. Hos **MET Norway (yr.no)** är det värden från vädermodellen; regnet är där prognosen för de närmaste 24 timmarna |
| **Ort** | sök på namnet och tryck på en träff |
| **Uppdatering** | ingen inställning, bara en visning: när boxen senast fick nya värden och när väderservern levererar nästa |
| **Temperatur** | °C eller °F |
| **Regn** | mm eller tum |
| **Lufttryck** | hPa, inHg, mb eller kPa |
| **Vindstyrka** | km/h, m/s, mph eller knop |
| **Mätarnas ordning** | ta tag i en mätare vid handtaget och flytta den till en annan plats |
| **Ram**, **Bakgrund**, **Visarform**, **Visarfärg**, **Knopp** och **Knoppfärg** | [mätarnas utseende](#maetarnas-utseende) |

## Regnmätaren

Regnmätaren visar två värden i två displayer, som vindriktningen: **last 24h** (vad som har fallit de senaste 24 timmarna) och **next 24h** (vad som är prognosticerat för de närmaste 24 timmarna). Visaren visar de senaste 24 timmarna, och skalan räcker för det större av de två värdena. **MET Norway** har bara prognosen; boxen hämtar då de senaste 24 timmarna från **Open-Meteo**. Går det inte att nå står det ett streck där, och visaren visar de närmaste 24 timmarna.

## När det finns nya värden

Väderservrarna ger nya värden bara med fasta mellanrum, därför går uppdateringen inte att ställa in. Boxen frågar först igen när servern utlovar ett nytt svar:

| Väderserver | Nya värden | Visad tid |
| --- | --- | --- |
| **MET Norway (yr.no)** | ungefär var 30:e minut. Värdena är timvärden från modellen; boxen räknar om dem till den aktuella minuten, så visarna rör sig också mellan hela timmarna | ortens tid, inte boxens |
| **Open-Meteo** | var 15:e minut, efter hel kvart | ortens tid |

Längst ned i väderbilden står **Senaste uppdatering** och **Nästa**, och på inställningssidan i kortet **Uppdatering**. Den öppna bilden frågar boxen varje minut; mätarna ritas bara om när ett värde har ändrats.

Båda väderservrarna är gratis och kräver ingen inloggning. Boxen frågar dem med koordinaterna för den valda orten.

## Mätarnas utseende

Mätarna ritas av biblioteket **SteelSeries**, och namnen på ramar och bakgrunder är utvecklarnas egna. Utan val ser mätarna ut som förut: ram **Metal**, bakgrund **Beige**, visarform **1**, visarfärg **Röd**, knopp **Metall** i **Silver**. Du väljer i kortet **Mätarnas utseende**. Du kan ändra flera inställningar efter varandra utan att displayen byggs om varje gång: först med **Verkställ ändringar** laddas den om och öppnar väderbilden igen. Ändringen gäller nästa gång du öppnar väderbilden.

**Ram:** Black Metal, Metal, Shiny Metal, Brass, Steel, Chrome, Gold, Anthracite, Tilted Gray, Tilted Black och Glossy Metal.

![De 11 ramarna](weather-frames.png)

**Bakgrund:** Dark Gray, Satin Gray, Light Gray, White, Black, Beige, Brown, Red, Green, Blue, Anthracite, Mud, Punched Sheet, Carbon, Stainless, Brushed Metal, Brushed Stainless och Turned.

![De 18 bakgrunderna](weather-backgrounds.png)

**Visarform:** 16 former, från **1** till **16**. Den gäller de runda mätarna; vindriktningen behåller sina två visare, en röd för det aktuella värdet och en blå för medelvärdet.

![De 16 visarformerna](weather-pointers.png)

**Visarfärg:** Röd, Grön, Blå, Orange, Gul, Cyan, Magenta, Vit, Grå, Svart, Raith, Jug Green och Green LCD.

![De 13 visarfärgerna](weather-colours.png)

**Knopp** och **Knoppfärg:** knoppen i mitten av mätaren, **Standard** eller **Metall**, i **Svart**, **Mässing** eller **Silver**.

![Knopparna](weather-knobs.png)

## Om inget väder visas

- Är en **ort** vald? Utan ort finns inte fliken **Väder**.
- Ortssökningen och värdena behöver internet.
- Är tillägget påslaget under **Inställningar › System › Tillägg**?
