# Kalkula (Tauri)

Angebote für Rohrleitungsbau kalkulieren: gegliederte Positionen, Preise aus
einer Excel-Preisliste, Angebot als PDF — ohne Excel und ohne Makros.

Kalkula löst das VBA-Kalkulationswerkzeug `Kalkulation.xlsm` ab. Was es anders
macht und warum, steht unter „Was vom Makro übrig blieb“.

## Voraussetzungen
- Rust (https://rustup.rs) und Node.js
- Tauri-Voraussetzungen für das jeweilige Betriebssystem:
  https://tauri.app/start/prerequisites/
- Drucken: nichts weiter. Das Angebot wird im Programm gesetzt und über den
  Druckdialog des Systems ausgegeben — dort steht auch „Als PDF sichern“.
  Kein LibreOffice, kein Word, keine Wandlung im Hintergrund.

  Gedruckt wird unter macOS **nicht der Webview, sondern eine PDF**, die das
  Programm vorher selbst aufnimmt: `print_build` holt je Blatt einen
  Ausschnitt über `createPDFWithConfiguration:`, legt die Aufnahmen zu einem
  Dokument auf A4 quer zusammen, und `print_now` gibt dieses Dokument an den
  Druckdialog. Das Verkleinern auf den Bereich, den ein Drucker wirklich
  erreicht, macht dabei macOS — seitenweise und richtig.

  Der Weg davor ging über den Webview selbst (`Webview::print()`), und daran
  hing alles, was an dieser Stelle schiefging: der Drucker gab 25 pt weniger
  Höhe her als das Blatt, jede Seite lief über, und wo eine Seite endet,
  entschied WebKit — aus vier Blättern wurden sieben. Wer selbst aufnimmt,
  bricht nicht um: je Blatt eine Aufnahme, je Aufnahme eine Seite. Das
  Warum im Einzelnen steht im Kopf von `src-tauri/src/pdf.rs`.

  Wo dieser Weg nicht offensteht (Windows, Linux), meldet `print_build`
  `false` und die Oberfläche nimmt `window.print()`.

## Erster Start
```bash
npm install
npx tauri icon app-icon.png     # erzeugt src-tauri/icons/* (später durch eigenes PNG ersetzen)
npm run dev                      # Entwicklungsfenster
npm run build                    # Installationspakete in src-tauri/target/release/bundle/
```

Beim ersten Start ist keine Preisliste geladen. Über das Zahnrad in der
Seitenleiste (oder „! Keine Preisliste" in der Werkzeugleiste) öffnen sich die
Einstellungen; dort liest „Preisliste → Auswählen …“ eine `.xlsx`. Der Pfad
wird gemerkt und beim nächsten Start wieder geladen. Ohne Preisliste funktioniert alles außer der Materialauswahl — man
kann dann nur Freitextzeilen anlegen.

## Aufbau

- `src/index.html` — das Hauptfenster: Kopfdaten, Sätze und die
  Postentabelle. In der Seitenleiste steht **nur, was zu diesem Angebot
  gehört**; sie lässt sich einklappen (siehe unten). Läuft auch in einem normalen Browser; dort fehlen nur
  Öffnen, Speichern und Drucken. Hier steht `SPALTEN`, die einzige Stelle, an
  der die Spalten der Tabelle beschrieben sind — Kopfzeile, Breite und
  Sichtbarkeit kommen alle von dort.
- `src/einstellungen.html` — die Einstellungen des Programms: Kopfzeile,
  Fußzeile, Logo und welche Preisliste gilt. Es schreibt die Textfelder und das
  Logo selbst; für die Preisliste bittet es das Hauptfenster, weil eine Tabelle
  an genau einer Stelle gelesen wird.
- `src/katalog.html` — das Preislistenfenster: zeigt je Blatt, **was** beim
  Lesen erkannt wurde, und lässt es korrigieren. Es liest keine Datei; es kennt
  nur Beschreibungen. Gelesen wird im Hauptfenster.
- `src/druck.html` — das Angebot auf Papier. Dieselbe Hülle wie das Katalog-
  und das Einstellungsfenster: dunkler Grund, Inhalt scrollt, Bedienelemente
  unten in einer Fußleiste. Hell ist allein das Blatt — es bringt Weiß und
  Calibri selbst mit.
- `src/xlsx.js` — liest eine `.xlsx` so weit, wie eine Preisliste es braucht:
  Blätter, Zellen, verbundene Zellen, Datumsformate. Schreibt nichts.
- `src/katalog.js` — macht aus einer Preisliste einen Katalog
  (Kategorie → Produkt → Größe → Wert) und erkennt dabei die Aufteilung jedes
  Blatts. Siehe „Wie die Preisliste gelesen wird“.
- `src/rechnen.js` — das Rechenmodell: was eine Kalkulation ist, was sie kostet
  und wie man sie umbaut. Kennt weder DOM noch Tauri und ist deshalb ohne
  Fenster prüfbar.
- `src/menu-ui.js` — die Aufklappmenüs. Unverändert aus docfill übernommen; das
  Menü-Element selbst bleibt in der Seite, weil es dort am `<body>` hängen muss.
- `src/app.css` — Farben, Formularfelder, Schaltflächen, Statuszeile, Menü und
  Dialog, von allen drei Seiten benutzt. Muss in jeder Seite **vor** dem eigenen
  `<style>` eingebunden werden.
- `src/vendor/jszip.min.js` — mitgeliefert, damit das Programm offline
  funktioniert. Prüfsumme in `src/vendor/SHA256SUMS`, geprüft bei jedem Bauen.
- `src-tauri/src/lib.rs` — 30 Befehle. Dateien: `pick_catalog`,
  `catalog_remember`, `catalog_recall`, `pick_calculation`, `save_calculation`,
  `write_calculation`. Fenster: `open_print_window`, `print_payload`,
  `close_print_window`, `print_stale`, `print_request`, `print_refresh`,
  `print_build`, `print_now`,
  `open_catalog_window`, `catalog_payload`,
  `catalog_submit`, `catalog_refresh`, `close_catalog_window`,
  `open_settings_window`, `settings_window_payload`, `settings_submit`,
  `settings_window_refresh`, `close_settings_window`. Dazu
  `settings_get`, `settings_set`, `logo_pick`, `logo_get`, `logo_clear`,
  `set_dirty`, `app_version`.
- `src-tauri/src/pdf.rs` — der Druckweg unter macOS: das Angebot als PDF
  aufnehmen (WebKit), die Blätter zusammenlegen (Core Graphics), das fertige
  Dokument drucken (PDFKit). Nur dort, sonst gibt es die Datei nicht.
- `src-tauri/capabilities/default.json` — nur `core:default`; die Oberfläche hat
  keinen Zugriff auf Dateisystem, Dialoge oder Shell.

**Rust liest keine Tabelle und rechnet nichts aus.** Es kennt weder eine
Preisliste noch eine Position noch einen Zuschlag — es reicht Bytes durch,
öffnet Fenster und merkt sich zwei Pfade. Dieselbe Arbeitsteilung wie in
docfill und aus demselben Grund: Tabellenlogik in zwei Sprachen zu führen hieße,
sie zweimal zu pflegen und an der Grenze zwischen beiden die Fehler zu suchen.

Die Oberfläche nennt außerdem **nie einen Pfad**. Eine geöffnete Datei bekommt
eine Handhabe (`"f3"`), und nur damit lässt sie sich überschreiben. Ein Ziel
aussuchen kann allein der Benutzer, im nativen Dialog.

## Wie die Preisliste gelesen wird

Die BWT-Liste beschreibt sich selbst gut genug, dass man ihre Aufteilung nicht
aufschreiben muss. Zwei Anker genügen:

1. **Die Einheitenzeile.** Über jeder Wertspalte steht, was die Zahl darunter
   bedeutet: `€ / m`, `€ / Stück`, `h / Stück`, `€ pro 100 m`. Gesucht wird die
   erste Zeile mit mindestens zwei solchen Zellen. Sie bestimmt, **welche
   Spalten Werte tragen** — und ob eine Zahl ein Preis oder eine Montagezeit ist.
2. **Die Zelle, in der `DN` allein steht.** Sie sitzt links von den Preisen und
   über den Größen. Darüber beginnen die Kopfzeilen des Produktnamens, darunter
   die Datenzeilen.

Daraus ergibt sich alles Übrige: die Kopfzeilen (zwischen `DN` und der
Einheitenzeile), die Datenzeilen (unter der Einheitenzeile, bis die
Achsenspalte leer bleibt) und die Maßspalten Außen-Ø und Wanddicke (zwischen
der Achse und der ersten Wertspalte).

Ein Produktname wird aus den Kopfzeilen seiner Spalte zusammengesetzt, wobei
Wiederholungen wegfallen — `Ventiltechnik (nur Montage)` steht als verbundene
Zelle über acht Spalten und soll nicht achtmal im Namen stehen. Ein Trennstrich
am Zeilenumbruch verschwindet (`Tri-⏎Clamp` → `Tri-Clamp`); die Spalte war nur
zu schmal.

Auf der BWT-Liste 2025 ergibt das genau die Zahlen, die im abgelösten Makro
hartcodiert standen — und zusätzlich das Blatt, das dieses nie erreichte:

| Blatt | Achse | Kopf | Einheit | Daten | Produkte |
| --- | --- | --- | --- | --- | --- |
| ReiheA (0,8µm) | DN | 14–17 | 18 | 19–29 | 16 |
| ReiheA (0,8-0,6µm,e-poliert) | DN | 14–17 | 18 | 19–29 | 15 |
| ReiheB (0,8µm) | DN | 14–17 | 18 | 19–29 | 15 |
| ReiheB (0,8-0,6µm,e-poliert) | DN | 14–17 | 18 | 19–29 | 15 |
| Isolierungen | DN | 7–10 | 11 | 12–23 | 4 |
| **Nebenleistungen** | Bezeichnung | — | 7 | 8–15 | 8 |

### Wenn die Erkennung danebenliegt

Sie kann danebenliegen, ohne zu scheitern: eine verschobene Einheitenzeile
liefert eine Kategorie voller leerer Preise, keinen Fehler. Deshalb wird
gezählt und gezeigt statt still übernommen. „Preisliste → Nachsehen“ öffnet ein
Fenster mit je Blatt den erkannten Zahlen, den ersten Produkten als Beleg und
einem Hinweis, wenn zu wenige Werte gefunden wurden. Die Zahlen stehen dort als
Eingabefelder, weil sie welche sind: wer eine sieht, die nicht stimmt, trägt die
richtige ein und drückt „Übernehmen“. Das Blatt wird dann mit den eingetragenen
Zahlen neu gelesen — durch dieselbe Funktion wie zuvor.

Eine Erkennung, die man nicht nachprüfen kann, ist schlimmer als eine fest
eingetragene Liste: sie irrt sich leise.

## Das Rechenmodell

```
EP VK        = EP EK × (1 + Zuschlag)
Gesamt Mat.  = Menge × EP VK
Gesamt Lohn  = Stunden × Lohn/h
Gesamt VK    = Gesamt Mat. + Gesamt Lohn
EP Gesamt    = Gesamt VK ÷ Menge
```

Dieselben Formeln wie im Makro. Zuschlag und Lohnsatz stehen einmal für die
ganze Kalkulation in der Seitenleiste; eine Zeile darf einen eigenen Wert
tragen, und leer heißt dort „es gilt der Satz der Kalkulation“.

**Eine Kalkulation ist ein Baum.** Positionen enthalten Positionen (bis zu drei
Ebenen tief) und Zeilen. Die Ebene ist die Tiefe im Baum, keine Beschriftung,
und die Positionsnummer (`1.1.1.02`) wird bei jeder Darstellung neu vergeben —
sie kann nach einem Verschieben also nicht veraltet sein. Jede Position summiert
ihre Kinder, über beliebig viele Ebenen.

### Die Seitenleiste einklappen

Übernommen aus docfill, samt Zeichen (‹ / ›) und Verhalten — die beiden
Programme stehen nebeneinander, und was man in einem gelernt hat, soll im
anderen gelten. Eingeklappt bleibt eine **Schiene** stehen statt dass die
Leiste verschwindet: die Schaltfläche behält ihren Platz, und der Weg zurück
muss nicht gesucht werden.

Unter 1100 px Fensterbreite klappt sie von selbst ein und beim Überschreiten
wieder aus; dazwischen gilt, was zuletzt geklickt wurde. Die Grenze liegt höher
als docfills 820 px, weil die Tabelle mit eingeblendeten Kalkulationsspalten
rund 950 px braucht — darunter scrollt sie ohnehin, und dann sind die 330 px
der Leiste besser in der Tabelle angelegt.

Auf der Schiene bleibt der **Zuschlagssatz** — er multipliziert stillschweigend
jeden Einkaufspreis und ist die einzige Angabe der Leiste, die jede Zeile
betrifft.

Weil die Schaltfläche „Speichern" eingeklappt nicht erreichbar ist, tut
**⌘S / Strg-S** dasselbe wie sie.

**Eine neue Zeile zeigt nur, was als Nächstes dran ist.** Vorher standen
fünfzehn Felder da, von denen vierzehn erst dann etwas bedeuten, wenn Kategorie
und Material feststehen — Menge wovon, Preis wofür. Die Zeile folgt jetzt der
Kaskade, die es ohnehin gibt:

| Stufe | es steht | die Zeile zeigt |
| --- | --- | --- |
| 0 | nichts | Kategorie **oder** Freitext |
| 1 | Kategorie | + Material |
| 2 | Material | + Größe (nur wenn das Produkt welche führt) |
| 3 | alles | + Menge, Preise, Stunden |

Eine unfertige Zeile tritt zurück, solange sie nicht bearbeitet wird; nach
einer Wahl springt der Fokus auf das Feld, das gerade erschienen ist. Steht in
einer Zeile schon ein Wert, gilt sie als fertig — Eingegebenes wird nie
versteckt, auch nicht, wenn ein Feld darüber leer ist.

### Verschieben

„Nach oben" und „Nach unten" im Zeilenmenü schieben um **eine Stelle im Blatt**
— nicht nur unter Geschwistern. An der Grenze einer Position geht es weiter,
und ist der Nachbar selbst eine Position, geht es hinein. Hinein dort, wo man
herkommt: nach unten oben hinein, nach oben unten hinein. Damit erreicht jeder
Posten mit wiederholtem Drücken jede Stelle der Gliederung.

Vorher endete das Schieben an der Grenze des Elternblocks — die letzte Zeile
einer Position „nach unten" tat schlicht nichts, und wer sie eine Position
weiter haben wollte, musste sie löschen und neu anlegen.

**Eine Zeile bleibt dabei in einer Position.** Ein Block darf eine Ebene
hinaustreten und notfalls ganz oben stehen, eine Zeile nicht — sie wechselt
stattdessen gleich in die Nachbarposition. Das ist ohnehin die Stelle, die im
Blatt als nächste kommt, und es hält die Nummerierung heil: eine Zeile ohne
Position darüber bekäme die Nummer `0.01`.

**Und eine Zeile bleibt vor den Unterpositionen.** In einem Block stehen erst
die Zeilen, dann die Unterpositionen — `ordnen` in `rechnen.js` hält das fest,
beim Einfügen wie beim Laden einer älteren Datei. Das ist die Ordnung eines
Leistungsverzeichnisses, und die Nummerierung beruht darauf: `1.01` heißt
„erste Zeile dieser Position", `1.1` „erste Unterposition". Die Nummer einer
Zeile sagt nichts darüber, wo sie relativ zu den Unterpositionen steht — stand
sie hinter einer, las sich das Blatt `1.1`, dann `1.01`, und eine
Nummernfolge, die zurückspringt, ist in einem Angebot schlicht falsch.

Darum kann ein Block nicht über eine Zeile steigen und eine Zeile nicht unter
eine Unterposition rutschen. Wo ein Zug nichts bewirken kann, **graut das
Zeilenmenü ihn aus** statt ihn anzubieten und dann zu schweigen — dieselbe
Entscheidung trifft `kannSchieben`, die das Menü fragt, damit die Regel nicht
zweimal im Code steht und mit der Zeit auseinanderläuft.

Ein Block, der in einen anderen nicht mehr hineinpasst, ohne `MAX_TIEFE` zu
sprengen, tauscht stattdessen nur den Platz.

**Nachgezogen wird nichts.** Die Positionsnummern werden in `durchlaufen` aus
dem Platz im Baum abgeleitet und sind nach dem nächsten Zeichnen von selbst
richtig — auch alle Zeilen unterhalb einer verschobenen Position:

```
vorher:     1 Halle A | 1.01 Rohr | 1.02 Bogen | 2 Halle B | 2.01 Ventil
Bogen ↓:    1 Halle A | 1.01 Rohr | 2 Halle B | 2.01 Bogen | 2.02 Ventil
Halle B ↑:  1 Halle A | 1.01 Rohr | 1.1 Halle B | 1.1.01 Bogen | 1.1.02 Ventil
```

**Eine fehlende Zahl ist keine Null.** Steht weder ein Materialpreis noch eine
Montagezeit in einer Zeile, ist ihr Wert *unbekannt* — sie zeigt einen Strich
statt `0,00 €`. In die Summe der Position geht sie trotzdem mit 0 ein (eine
leere Summe wäre unbrauchbar), aber diese Summe wird als vorläufig markiert,
die Fußzeile zählt die offenen Zeilen, und vor dem Drucken wird gefragt. In der
BWT-Liste kommt das vor: „Nebenleistungen“ führt Leistungen, deren Preis
projektspezifisch ist.

### „nur Montage“

Manche Spalten der Preisliste führen keine Preise, sondern Stundenwerte. Das
Makro erkannte sie daran, dass der Produktname zufällig die Zeichenfolge
`nur Montage` enthielt. Kalkula liest es dort, wo es steht: in der
Einheitenzeile. Eine Zahl unter `h / Stück` sind Stunden, eine unter
`€ / Stück` ist ein Preis. Bei einer Stundenspalte wird die Montagezeit mit der
Menge multipliziert und der Materialpreis auf 0 gesetzt — und die Zeit zieht
nach, wenn sich die Menge ändert. Eine von Hand eingetragene Stundenzahl bleibt
unangetastet.

### Preise überschreiben

Der Einkaufspreis einer Zeile kommt aus der Preisliste, lässt sich aber
überschreiben. Ein überschriebener Preis bekommt einen farbigen Rahmen und
bleibt stehen, auch wenn Produkt oder Größe gewechselt werden: wer ihn gesetzt
hat, hat sich etwas dabei gedacht.

Der Tooltip am Feld nennt dann den Wert, von dem abgewichen wurde, und um
wie viel — ohne ihn müsste man die Preisliste daneben aufschlagen:

| Lage | Tooltip |
| --- | --- |
| aus der Liste | „Aus der Preisliste. Ein eigener Wert bleibt bei einem Wechsel der Größe stehen." |
| abweichend | „Von Hand gesetzt. Preisliste: 105,00 €  (+15,00 €)." |
| gleicher Wert | „Von Hand gesetzt. Preisliste: 105,00 €." — die Abweichung entfällt, wenn es keine gibt |
| Liste kennt keinen | „Von Hand gesetzt. Die Preisliste führt für diese Zeile keinen Preis." |
| Stundenspalte | „… nennt Montagezeit, keinen Materialpreis — von dort käme 0,00 €." |

## Das Angebot

Das gedruckte Angebot ist maßgleich mit der Vorlage, die das abgelöste Makro
ausgab (`Kalkulation_3.pdf`). Die Maße sind nicht geschätzt, sondern aus dem
Inhaltsstrom der PDF gelesen: Seitenrahmen 841,68 × 595,2 pt, Satzspiegel ab
x = 38,784 pt und 763,3 pt breit, Zeilenhöhe 20,16 pt, Logo 48 × 47 pt bei
(42,5 | 503,1), Kopflinie 2,88 pt. Übereinandergelegt decken sich beide
Ausdrucke bis auf den Schriftsatz und die drei Abweichungen weiter unten.

**Die PDF selbst lässt sich nicht als Vorlage benutzen.** Sie ist ein fertiger
Ausdruck: die Beispieldaten („Beschreibung …“, DN10, 3.975,00 €) sind als Text
hineingezeichnet, darunter gibt es keine leere Formularebene. Und ihre
Schriften sind Teilmengen (`BCDEEE+Calibri`) — darin stecken nur die Zeichen,
die in genau diesem Dokument vorkommen; ein Kundenname mit einem Buchstaben,
den das Beispiel nicht enthält, ließe sich damit nicht setzen. Übernommen ist
deshalb ihre Geometrie, nicht ihre Datei.

### Wo der Ausdruck bewusst von der Vorlage abweicht

Drei Dinge sind anders, weil die Vorlage sie nur deshalb hinbekam, weil in
ihrem Beispiel nichts zu lang war:

1. **Fester Spalt von 6 pt zwischen den Spalten.** In der Vorlage sind es
   1,82 pt, und dort stieß ein langer Produktname unmittelbar an die DN-Angabe
   daneben.
2. **Zellen brechen um, statt überzulaufen.** `height` wirkt an einer
   Tabellenzelle als Mindesthöhe: eine Zeile mit langem Text wird höher.
   Umbrechen dürfen Kategorie, Leistung und DN; Positionsnummer, Menge,
   Einheit und die Beträge nicht — eine über zwei Zeilen gebrochene Zahl liest
   sich als zwei Zahlen.
3. **Ausrichtung nach Spaltenart.** Pos., Kategorie, Leistung und DN
   linksbündig — sie sind Text und beginnen am selben Rand. Menge, Einheit und
   Gesamt EP mittig: schmale Spalten, in denen ein zentrierter Wert erkennbar
   unter seiner Beschriftung sitzt. „Gesamt VK" als einzige rechts; dort
   fluchten die Beträge untereinander und lassen sich überschlagen. Gleich
   breite Ziffern haben alle Zahlenspalten.

Dazu bekommt der Titel einer Position alle Spalten bis zur Summe. In der
Vorlage stand er in der Kategoriespalte und lief einfach in die leeren
Nachbarn hinein — das ging, solange nichts umbrach.

Die Spaltenbreiten in pt. Ihre Summe ist der Satzspiegel der Vorlage; die
Aufteilung ist eine andere, weil der feste Spalt jeder Spalte von der nutzbaren
Breite abgeht und bei 38,3 pt für „1.1.1.01" zu wenig übrig bliebe:

| | Pos. | Kategorie | Material / Produkt | DN | Menge | Einheit | Gesamt EP | Gesamt VK |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Kalkula | 46,0 | 122,9 | 244,8 | 83,4 | 44,0 | 44,0 | 89,0 | 89,2 |
| Vorlage | 38,3 | 122,9 | 263,9 | 83,4 | 38,3 | 38,3 | 89,0 | 89,2 |

Und die Farbstaffel, deckungsgleich mit `mod_Config` und `ApplyReceiptStyling`:

| Farbe | Herkunft | wofür |
| --- | --- | --- |
| `#003A73` | `C_BRAND_DARK` | Kopfleiste, Spaltenkopf, L1, Gesamtsumme |
| `#809CB9` | `LightenColor(dark, 0.5)` | L2 |
| `#CCD8E3` | `LightenColor(dark, 0.8)` | L3 |
| `#F8FAFD` | `LightenColor(C_BRAND_PALE, 0.5)` | Zebrastreifen |

Der Verlauf ist Absicht und stand so im Makro: Spaltenkopf und Gesamtsumme, die
beiden Enden der Tabelle, tragen dieselbe volle Farbe; L1 beginnt jedes Kapitel
ebenso kräftig, L2 und L3 treten in zwei gleichen Schritten zurück.

Drei Dinge aus der Vorlage stehen nicht fest im Code, sondern in den
Einstellungen: **Logo**, **Kopfzeile** und **Fußzeile**. Das Makro trug Firmenname, Anschrift
und Dateinamen des Logos als Zeichenketten im Quelltext und verlangte, dass
`AAR_Logo.png` neben der Arbeitsmappe liegt — fehlte sie, ließ es das Logo
wortlos weg. Kalkula legt beim Auswählen eine **Kopie** im Datenordner an; die
kann nicht verschwinden, wenn jemand die Datei verschiebt.

Die Schriftgrößen sind ebenfalls die der Vorlage: 9,96 pt für alles, 12 pt für
L1, 11,04 pt für L2 und die Fußzeile, 12,96 pt für die Gesamtsumme. Dass Titel
und Absender nicht größer sind als der Tabellensatz, ist kein Versehen beim
Nachbau: `mod_SheetBuilder` setzte zwar 16 pt für den Titel und 13 pt für
„AAR GMBH", der Export überschrieb aber zuerst den ganzen Bereich mit
`.Font.Size = 10` und setzte die 16 danach auf `Cells(2, 3)` — eine Zelle
mitten im Verbund `B2:C4`, deren Werte nirgends erscheinen.

Der Titel beginnt hinter dem Logokasten (3,72 + 48 pt, plus 2 pt Luft), nicht
an einer festen Textmarke. Die Vorlage löste das anders: `mod_SheetBuilder`
schrieb den Titel als `"    " & Lbl("DOC_TITLE")` — mit **vier führenden
Leerzeichen**, die ihn hinter das Logo schoben. Das trägt genau so weit, wie
das eine Logo breit ist; ein anderes, das seinen Kasten ausfüllt, läge wieder
unter dem „A". Seit das Logo eine Einstellung ist, hängt der Abstand am Kasten.

Der Titel lautet wie auf der Vorlage **„ANGEBOT / KALKULATION"**. Das Makro
wollte für Kundendokumente alles nach dem Schrägstrich wegschneiden
(`„KALKULATION" is internal-tool language`), schrieb dafür aber in
`Cells(2, 3)` — eine Zelle mitten im Verbund `B2:C4`, deren Wert nirgends
erscheint. Der Schnitt hat also nie stattgefunden. Wer nur „ANGEBOT" drucken
will, ändert `TITEL` oben im Skript von `src/druck.html`.

„Vorschau“ ist stumm geschaltet, solange keine Position angelegt ist — eine
Schaltfläche, die auf den Klick hin nur sagen kann „geht gerade nicht", hätte
man besser gar nicht erst angeboten. Sie bietet drei Stufen. Sie ändern nicht, **was** auf dem Angebot
steht — der Umfang bleibt in allen dreien vollständig aufgeführt —, sondern
**wo** ein Preis steht:

| Stufe | ausgepreist |
| --- | --- |
| 1 | nur die Hauptpositionen |
| 2 | jede Position, die Einzelzeilen nicht |
| 3 | auch jede Einzelzeile (zusätzlich mit Einzelpreisspalte) |

Dieselbe Staffelung wie die drei PDF-Schaltflächen des Makros. Die
Kalkulationsspalten — Einkaufspreis, Zuschlag, Stunden, Lohnsatz — stehen auf
keiner Stufe auf dem Angebot.

Gerechnet wird **vor** dem Öffnen des Druckfensters, im Hauptfenster: es
bekommt eine fertige Abschrift und keine Verknüpfung auf den Arbeitsstand. So
ändert sich die Vorschau nicht unter der Hand, und es gibt nur eine Stelle, an
der gerechnet wird. (Das Makro rechnete im Export ein zweites Mal und konnte
damit andere Zahlen zeigen als das Arbeitsblatt.)

### Aktualisieren

Damit aus „ändert sich nicht" kein „zeigt den Stand von vorhin" wird, meldet
das Hauptfenster jede Änderung ans Druckfenster — gedrosselt, denn `aendern()`
läuft bei jedem Tastendruck. Das Fenster zeigt daraufhin **„Aktualisieren"**
und schreibt in die Leiste, dass die Kalkulation inzwischen geändert wurde.
Geholt wird der neue Stand erst auf Klick.

Nicht von selbst nachzeichnen: eine Vorschau, die sich unter dem Blick umbaut,
während man auf „Drucken" zielt, verschiebt einem das Blatt unter der Hand. Der
Wink kostet nichts, das Holen entscheidet der Mensch.

Beim Aktualisieren bleibt die Stufe, mit der das Fenster geöffnet wurde, und
die Bildlaufstelle bleibt stehen — wer gerade die dritte Position ansieht, will
nicht wieder oben anfangen. Ein erneutes „Vorschau" auf ein offenes
Fenster zeichnet es ebenfalls nach, statt es zu schließen und neu zu bauen.

### Seitenumbruch und Übertrag

Der Umbruch wird **gerechnet**, nicht dem Satz überlassen: die Zeilen werden
einmal in ein Blatt gehängt, ihre Höhen abgelesen und dann auf Seiten verteilt.
Das kostet zwei Durchgänge und bringt drei Dinge, die anders nicht zu haben
sind:

* **Die Vorschau zeigt die Seiten, die auch gedruckt werden.** Vorher war sie
  ein durchgehendes Blatt und der Umbruch eine Überraschung des Druckers.
  Sie zeigt immer ein vollständiges **A4 quer**, waagerecht mittig: ist das
  Fenster schmaler als ein Blatt (841,68 pt = 1122 px), verkleinert sich der
  Bogen, statt die Seiten an beiden Rändern abzuschneiden; ist es breiter,
  steht das Blatt in der Mitte statt an einer Kante. Vergrößert wird nie — ein hochskaliertes
  Blatt wäre unscharf und zeigte nichts Neues. Die Verkleinerung ist eine
  `transform` und kein `zoom`: sie lässt den Satz unberührt, also bleiben die
  gemessenen Zeilenhöhen und damit der Umbruch davon unbeeinflusst.
* **Jede Seite trägt ihren Übertrag** — unten den Stand, oben auf der Folgeseite
  denselben Betrag als Anschluss.
* **Die Seitenzahl** („Seite 2 von 3"), wie in der Vorlage. Der CSS-Seitenzähler
  wirkt in der Druckausgabe des Webviews nicht; wer selbst umbricht, weiß es
  ohnehin.

Gemessen wird am echten Satz. Eine gerechnete Zeilenhöhe ginge fehl, sobald
eine Leistungsbeschreibung umbricht.

**Kopfleiste und Trennlinie stehen auf jeder Seite**, dazu der Spaltenkopf —
jedes Blatt eines Angebots soll für sich erkennbar sein, auch wenn nur die
dritte Seite auf dem Tisch liegt. Das abgelöste Makro wiederholte allein die
Spaltenzeile (`PrintTitleRows = "$12:$12"`). Die Angaben — Kunde, Projekt,
Angebots-Nr., Datum, Bearbeiter — bleiben auf der ersten Seite: sie stehen
einmal am Dokument, nicht an jeder Seite. Auf den Folgeseiten treten an ihre
Stelle **zwei Zeilenhöhen** Abstand (`ABSTAND_FOLGE_PT`): auf der ersten Seite
liegen zwischen der letzten Angabenzeile und der Tabelle rund 38 pt, und eine
Folgeseite soll oben genauso atmen.

Eine Positionszeile
bleibt nicht als letzte auf einer Seite stehen — eine Überschrift ohne das, was
sie überschreibt, ist keine Überschrift. Sie wandert mit auf die nächste Seite;
das ist das Gegenstück zu `PreventGroupSplits` im Makro, nur ausgerechnet statt
von Hand gesetzt.

**Der Übertrag zählt auf der Ebene, die die Stufe auspreist**, und nur dort —
sonst zählte man doppelt: auf Stufe 3 tragen die Positionsköpfe dieselben
Beträge wie die Zeilen darunter. Auf Stufe 1 und 2 sind es die
Hauptpositionen, auf Stufe 3 die Einzelzeilen. Beide Summen ergeben genau die
Gesamtsumme; die Kette der Überträge schließt.

**Der Abstand zur Fußzeile bleibt gewahrt.** Der Satzspiegel endet 43,2 pt über
der Blattkante, die Grundlinie der Fußzeile liegt bei 26,4 pt — dazwischen
16,8 pt, in die kein Inhalt läuft. Dazu bleiben unten **zwei Zeilenhöhen**
frei — rund 14 mm: eine Tabelle, die bis an die letzte mögliche Zeile geht,
drängt sich an den Fuß. Gemessen bleiben damit auf einer vollen Seite rund
20 bis 29 mm zwischen der letzten Tabellenzeile und der Fußzeile.

Das ist die einzige Stellschraube dafür: `LUFT_ZEILEN` oben in `druck.html`.
Mehr Zeilen heißt mehr Luft und mehr Seiten. Dafür trägt jede Seite ihren eigenen Fuß,
absolut im Blatt statt `fixed` an der Seite: nur so steht die richtige
Seitenzahl darin, und nur so schneidet Chromium ihn nicht am Satzspiegel ab. Eine **Seitenzahl** steht nicht auf dem Blatt:
CSS-Seitenzähler kennt die Druckausgabe des Webviews nicht. Wer sie braucht,
schaltet sie im Druckdialog unter „Kopf- und Fußzeilen“ ein — dort kommt sie
samt Datum vom System.

### Einstellungen des Programms

Fünf Dinge gehören dem Programm und nicht der einzelnen Kalkulation:
**Kopfzeile**, **Fußzeile**, **Logo** und **welche Preisliste gilt**. Sie sind
bei jedem Angebot dieselben und stehen deshalb im Einstellungsfenster
(Zahnrad in der Fußleiste der Seitenleiste) — nicht in der `.kalk`-Datei.
Eine weitergegebene Kalkulation trägt sie nicht mit sich herum.

In der Seitenleiste bleibt, was zu diesem Angebot gehört: Kunde, Projekt,
Angebots-Nr., Datum, Bearbeiter, Lohnsatz und Zuschlag. Genau das steht auch in
der Datei.

Das Hauptfenster hält **keine Kopie** der Einstellungen. Es liest sie einmal,
beim Drucken, direkt aus dem Einstellungsspeicher — zwei Stände derselben
Angabe liefen sonst auseinander, sobald jemand das Einstellungsfenster offen
lässt und nebenher weiterarbeitet.

Ohne geladene Preisliste bleiben alle Auswahllisten leer. Weil die Preisliste
nicht mehr in der Seitenleiste steht, sagt das jetzt die Werkzeugleiste
(„! Keine Preisliste"); ein Klick darauf öffnet die Einstellungen.

Kopfzeile und Fußzeile sind **zwei** Felder, weil die Vorlage sie verschieden
setzt — im Makro standen sie als zwei getrennte Zeichenketten im Quelltext:

| | wo im Makro | Inhalt |
| --- | --- | --- |
| Kopf | `mod_SheetBuilder`, Zeilen 330–341 | `AAR GmbH` · `Ehlegrund 15  \|  D-39114 Magdeburg` · `mail@aar-gmbh.de  \|  www.aar-gmbh.de` |
| Fuß | `mod_Export`, `PageSetup.LeftFooter` | `AAR GmbH  \|  Ehlegrund 15, D-39114 Magdeburg  \|  mail@aar-gmbh.de` |

Oben also dreizeilig mit Website, unten einzeilig mit Komma und ohne. Beide
sind beim ersten Start mit genau diesen Werten vorbelegt und in der
Seitenleiste zu ändern. Vorbelegt wird nur, solange die Einstellung noch gar
nicht da ist: wer ein Feld leert, behält es leer.

Die Anschriftzeilen stehen einen Ton heller als der Firmenname: `#3D6CB7`
(`C_BRAND_MID`, im Makro als „Mid accent — borders, rules, sub-labels"
beschrieben, also für Nebenangaben gedacht; 5,2:1 auf Weiß). In der
ausgegebenen Vorlage sind alle vier Kopfzeilen dasselbe `#003A73` — im
Inhaltsstrom und am Pixel nachgemessen. Dass die Anschrift dort heller wirkt,
macht allein der Schnitt: der Firmenname steht fett, die Anschrift mager.
`mod_SheetBuilder` hatte die Anschrift ursprünglich auf `C_BRAND_TINT` gesetzt
und der Export sie mit einem pauschalen `.Font.Color = darkBlue` über die
Zeilen 2 bis 4 wieder eingeebnet.

Die erste Zeile der Kopfzeile ist der Firmenname; sie steht oben rechts und
wird versal gesetzt (in der Vorlage stand dort „AAR GMBH" in Großbuchstaben —
hier macht das die Darstellung, damit die Einstellung den Namen so tragen kann,
wie er geschrieben wird). Die doppelten Leerzeichen um die Striche bleiben
erhalten; HTML würde sie sonst zu einem zusammenziehen.



## Das Dateiformat

Eine Kalkulation ist eine `.kalk`-Datei: JSON, eingerückt, mit einem Baum unter
`posten`. Man kann sie lesen und im Notfall von Hand reparieren. Beim Öffnen
wird geprüft, dass die Kennungen eindeutig sind, und aufgefüllt, was eine ältere
Fassung noch nicht hatte.

Die Datei merkt sich den Namen der Preisliste, mit der gerechnet wurde. Ist
beim Öffnen eine andere geladen, wird darauf hingewiesen — die Preise in der
Datei bleiben, wie sie sind.

Gespeichert wird daneben und dann darübergeschoben: bricht das Schreiben ab,
ist die alte Fassung noch vollständig da. Unter Unix gehören Datei und
Datenordner dem eigenen Benutzer allein (`0600`/`0700`) — eine Kalkulation nennt
Kunde, Projekt und Preise.

## Was vom Makro übrig blieb

Was Kalkula anders macht, und warum:

1. **Die Gliederung ist eine Datenstruktur, keine versteckte Spalte.** Das Makro
   hielt sie in Spalte Q: jede Zeile trug dort `L1_HEADER`, `ITEM`, `SUBTOTAL`,
   `SEPARATOR` oder `GRAND_TOTAL`, und daraus leitete es ab, wo ein Block
   anfängt und was zu wem gehört. Eine eingefügte Zeile an der falschen Stelle
   verschob stillschweigend die Zugehörigkeit.
2. **Jede Ebene summiert.** Das Makro bildete Zwischensummen nur auf Ebene 3
   (`SUBTOTAL_LEVEL = 3`) und die Gesamtsumme aus eben diesen — eine
   L1-Position ohne L3-Unterbau ging in die Gesamtsumme **nicht ein**.
3. **Die Preislisten-Aufteilung wird gelesen, nicht aufgeschrieben.** Der
   Kommentar von `mod_CatalogService` versprach ein Konfigurationsblatt und
   „zero VBA changes“ für eine neue Preisliste; darunter stand dann doch die
   feste Liste `RegisterSchema "ReiheA (0,8µm)", "STANDARD", 14, 17, 4, 19, …`.
   Wer eine Spalte einfügte, verschob alle Preise.
4. **„Nebenleistungen“ ist erreichbar.** Die Schleife des Makros lief
   `For i = 1 To wb.Sheets.count - 1` und ließ das letzte Blatt aus. Druckprobe,
   Spülen/Passivieren und Endoskopieren waren im Werkzeug nicht auswählbar.
5. **Ein fehlender Preis ist von einem Preis null zu unterscheiden.** Das Makro
   kannte den Unterschied nicht.
6. **Die Kaskade ist eine Zuweisung.** Kategorie → Produkt → Größe hing dort an
   drei ineinandergreifenden Change-Ereignissen von ActiveX-Steuerelementen, die
   nach jedem Speichern neu verdrahtet werden mussten (`WakeUpAllComboboxes`,
   ausgelöst über `Application.OnTime … + 1 Sekunde`).
7. **Es gibt keine Makro-Sicherheitswarnung** und keine Abhängigkeit davon, dass
   die Preisliste im selben Ordner liegt wie die Arbeitsmappe.

Nicht übernommen wurde die AAR-Marke: Firmenname, Anschrift und Logo standen im
Makro als Zeichenketten im Quelltext (`mod_Config`, `mod_SheetBuilder`). Hier
ist das ein Feld in der Seitenleiste.

## Prüfen

```bash
npm run check
```

Läuft bei jedem `npm run build` mit (`beforeBuildCommand`), weil `frontendDist`
direkt auf `src/` zeigt: der Ordner wird unverändert eingepackt, es gibt keinen
Bundler-Schritt. Ohne diese Prüfung bräche ein Tippfehler in `index.html` den
Build nicht ab — man bekäme einen tadellos „erfolgreichen“ Installer mit
kaputter Oberfläche.

Geprüft werden Syntax und Importe aller Seiten, die Prüfsummen der
mitgelieferten Bibliotheken — und, über docfills Fassung hinaus, **die Namen der
Tauri-Befehle**: was die Oberfläche ruft, muss in `generate_handler!` stehen.
Ein `invoke("catalog_refrsh")` ist syntaktisch tadellos und scheitert sonst erst,
wenn jemand im Preislistenfenster auf „Übernehmen“ drückt.

Was **nicht** auffällt: Laufzeitfehler. Ein Feld, das es nicht gibt, oder eine
Bedingung, die falsch herum steht, findet nur das Ausprobieren.

## Bekannte Grenzen

- **Calibri muss da sein.** Die Grundlinien des Kopfes liegen rechnerisch bei
  `Grundlinie − 0,75 em`, was mit `line-height:1` für Calibri genau aufgeht.
  Eine Ersatzschrift mit anderem Verhältnis von Ober- zu Unterlänge landet
  etwa einen Punkt daneben. Die Spaltenbreiten der Vorlage beruhen auf
  Calibri-Breiten. Fehlt die Schrift, springt Carlito ein (dieselben Metriken,
  freie Lizenz); fehlt auch die, setzt der Webview in der Systemschrift und die
  Umbrüche verschieben sich. Das Druckfenster sagt es in dem Fall in seiner
  Leiste. Auf einem Rechner mit Office ist Calibri da; auf einem Mac ohne
  Office ist sie es nicht.
- **Keine Seitenzahl auf dem Angebot** — siehe oben, sie kommt aus dem
  Druckdialog. In der Vorlage stand „Seite 1 von 1"; das kam von Excel.
- **Der laufende Fuß sitzt etwa 7 mm höher** als in der Vorlage — die
  Vorschau zeigt ihn an derselben Stelle, an der er gedruckt wird. Chromium
  beschneidet feste Elemente am Rand des Satzspiegels; tiefer ginge nur
  außerhalb, und dort fehlten ihm die Enden. Der Textbereich darüber ist
  deckungsgleich, der Umbruch fällt also an denselben Stellen.
- **Die Preisliste wird nur gelesen.** Preise ändert man in Excel (oder in der
  Zeile, für den Einzelfall).
- **Eine Position, die länger ist als eine Seite,** wird umbrochen — der
  Positionskopf steht dann nur auf der ersten. Ein „Fortsetzung"-Vermerk gibt
  es nicht.
- **`.kalk` kennt keine Fassungsmigration** über `fassung: 1` hinaus. Ändert
  sich das Format, muss `kalkulationPruefen` in `rechnen.js` das auffangen.
- **Drei Ebenen** (`MAX_TIEFE`). Tiefer zu gliedern ginge, die Nummerierung
  trägt es — die Einrückung der Tabelle ist aber auf drei ausgelegt.

## Lizenz

MIT, siehe `LICENSE`.
