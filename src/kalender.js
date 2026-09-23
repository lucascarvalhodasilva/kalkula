// Das Datumsfeld: Eingabe, Deutung und ein eigener Kalender.
//
// WARUM SELBSTGEBAUT
//   Vorher stand hier ein `input[type=date]` mit dem Kalender des Systems.
//   Zwei Dinge daran waren nicht zu ändern, beides am laufenden Fenster
//   nachgemessen:
//
//   Gestalten ließ er sich nicht. `::-webkit-calendar-picker-indicator` und
//   `::-webkit-datetime-edit-day-field:focus` greifen in WKWebView nicht — das
//   Kalenderblatt und die Hervorhebung der gewählten Zifferngruppe blieben in
//   den Farben des Systems, mitten in einem sonst dunklen Fenster.
//
//   Und zuklappen ließ er sich nur über einen Umweg. `showPicker()` hat kein
//   Gegenstück; `disabled` kurz an und aus, `display:none`, ein `type`-Tausch
//   — alles wirkungslos, der Kalender blieb offen. Es wirkte allein `blur()`,
//   und auch das nur, wenn dem Feld vorher eigens der Fokus gegeben wurde.
//
//   Der Preis für den Ersatz ist, was das Systemfeld umsonst mitbrachte und
//   hier nun steht: die Deutung des Getippten, die Prüfung, der Wochenanfang,
//   die Monatsnamen und die ganze Tastaturbedienung. Ersatzlos weggefallen ist
//   das Hochzählen einer Zifferngruppe mit ↑/↓ im Feld — wer das benutzt hat,
//   tippt künftig.
//
// AUF OBERSTER EBENE WIRD KEIN DOM ANGEFASST
//   Das Modul deklariert nur Funktionen und zwei `Intl`-Formatierer. Deshalb
//   lässt sich der Parser ohne Fenster und ohne Tauri ausprobieren:
//
//     node -e 'import("./src/kalender.js").then(m => console.log(m.datumLesen("1.9.26")))'
//
//   Das ist der Grund für ein eigenes Modul — nicht, dass ein zweites Fenster
//   einen Kalender bräuchte, sondern dass diese eine Stelle prüfbar bleibt.
//   Im Inline-Skript von index.html wäre sie es nicht.

// ---------------------------------------------------------------------------
// DATUM LESEN UND ZEIGEN
// ---------------------------------------------------------------------------
//
// Zwei Formate, und sie werden streng auseinandergehalten:
//
//   ISO   `JJJJ-MM-TT`   was in der Kalkulation und in der Datei steht
//   Satz  `TT.MM.JJJJ`   was im Feld steht
//
// `datumLesen` geht von Satz nach ISO, `datumZeigen` zurück. Dazwischen gibt
// es nichts — insbesondere kein `Date` im Modell, weil ein Zeitpunkt etwas
// anderes ist als ein Kalendertag und die Zeitzone sonst mitreden würde.

// Die Richtung zählt: das Bedienelement darf vom Rechenmodell abhängen, das
// Modell nie vom Bedienelement — sonst verlöre `rechnen.js` seine
// Fensterfreiheit und ließe sich nicht mehr ohne Browser prüfen.
import { heuteIso } from "./rechnen.js";

const z2 = n => String(n).padStart(2, "0");

/** Ein `Date` als JJJJ-MM-TT, nach Ortszeit. */
export function isoAus(d) {
  return `${d.getFullYear()}-${z2(d.getMonth() + 1)}-${z2(d.getDate())}`;
}

/** JJJJ-MM-TT als `Date` auf Mitternacht Ortszeit. */
export function ausIso(iso) {
  const [j, m, t] = String(iso).split("-").map(Number);
  return new Date(j, m - 1, t);
}

/**
 * Deutet, was jemand ins Feld getippt hat.
 *
 * Gibt die ISO-Form, `""` für ein leeres Feld (ein Angebot ohne Datum ist
 * erlaubt) und `null` für „das ist kein Datum".
 *
 * GEDULDET WIRD
 *   01.09.2026   die Maske selbst
 *   1.9.2026     ohne führende Nullen
 *   1.9.26       zweistelliges Jahr
 *   1.9.  /  1.9 ohne Jahr — dann das laufende
 *   1-9-26  1/9/26  1 9 26   jedes Nichtziffernzeichen trennt
 *   01092026  010926         auf dem Zehnerblock liegt kein Punkt
 *
 * NICHT GEDULDET wird eine allein stehende Zahl. `24` sähe nach „der 24.
 * dieses Monats" aus, ist aber häufiger ein halb getippter Anschlag — und es
 * änderte den Monat stillschweigend mit, sobald der laufende kürzer ist als
 * die Zahl.
 *
 * Ein zweistelliges Jahr ist immer `2000 + JJ`, ohne gleitendes Fenster um
 * das laufende Jahr. Ein Angebotsdatum liegt nahe an heute; eine Regel, die
 * man in einem Satz sagen kann, ist hier mehr wert als eine, die 1970 richtig
 * behandelt. In diesem Programm wird kein Angebot aus dem 20. Jahrhundert
 * kalkuliert.
 */
export function datumLesen(text) {
  const roh = String(text ?? "").trim();
  if (!roh) return "";
  // Was weder Ziffer noch ein üblicher Trenner ist, macht die Eingabe
  // ungültig. Ohne diese Zeile schluckte `split(/\D+/)` ein angehängtes „x"
  // stillschweigend, und aus „1.9.2026x" würde klaglos ein Datum.
  if (/[^\d.,\-/ ]/.test(roh)) return null;

  let t, m, j;
  if (/^\d+$/.test(roh) && (roh.length === 8 || roh.length === 6)) {
    t = roh.slice(0, 2); m = roh.slice(2, 4); j = roh.slice(4);
  } else {
    // `filter(Boolean)` wirft das leere Stück hinter dem Schlusspunkt weg:
    // „1.9." zerfällt in ["1", "9", ""].
    const teile = roh.split(/\D+/).filter(Boolean);
    if (teile.length < 2 || teile.length > 3) return null;
    [t, m, j] = teile;
  }

  if (!/^\d{1,2}$/.test(t) || !/^\d{1,2}$/.test(m)) return null;
  if (j === undefined) j = String(new Date().getFullYear());
  else if (/^\d{2}$/.test(j)) j = String(2000 + Number(j));
  else if (!/^\d{4}$/.test(j)) return null;

  const [jj, mm, tt] = [Number(j), Number(m), Number(t)];
  if (mm < 1 || mm > 12 || tt < 1 || tt > 31) return null;
  // Gibt es diesen Tag wirklich? `new Date` rechnet Unfug still weiter — aus
  // dem 31.02.2026 würde der 03.03.2026. Also das Ergebnis zurücklesen,
  // statt Monatslängen und Schaltjahrregeln ein zweites Mal aufzuschreiben.
  const d = new Date(jj, mm - 1, tt);
  if (d.getFullYear() !== jj || d.getMonth() !== mm - 1 || d.getDate() !== tt) return null;
  return isoAus(d);
}

/**
 * JJJJ-MM-TT → TT.MM.JJJJ.
 *
 * Was kein ISO-Datum ist, geht unverändert durch — genau wie `datum()` in
 * druck.html. Eine von Hand verbogene `.kalk`-Datei zeigt dann ihren Unfug
 * an, statt ihn zu verschlucken.
 */
export function datumZeigen(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ""));
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(iso ?? "");
}

// ---------------------------------------------------------------------------
// DAS KALENDERBLATT
// ---------------------------------------------------------------------------

// Feste Locale wie bei den Zahlenformaten in index.html: das Angebot wird auf
// Deutsch gedruckt, also ist auch der Kalender deutsch, gleich wie der Rechner
// eingestellt ist.
const F_KOPF = new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" });
const F_TAG = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

// Die Kürzel aus derselben Quelle statt aus einer abgeschriebenen Liste. Der
// 1.1.2024 war ein Montag — damit steht der Wochenanfang im Code und nicht in
// einer Zeile, die jemand nachzählen müsste.
//
// Der Schlusspunkt fällt weg: in diesem WKWebView liefert ICU „Mo", andere
// Fassungen liefern „Mo." — in einer zwei Zeichen breiten Spalte ist er
// Ballast, und so sieht es überall gleich aus.
const WOCHE = [...Array(7)].map((_, i) =>
  new Intl.DateTimeFormat("de-DE", { weekday: "short" })
    .format(new Date(2024, 0, 1 + i)).replace(/\.$/, ""));

const tagePlus = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/**
 * `n` Monate weiter, den Tag so weit wie möglich behaltend.
 *
 * Aus dem 31.03. wird ein Monat weiter der 30.04. und nicht der 1. Mai —
 * `new Date(j, m, 31)` rechnete stillschweigend über das Monatsende hinaus.
 * `new Date(j, m + 1, 0)` ist der letzte Tag des Zielmonats.
 */
function monatVersetzen(d, n) {
  const j = d.getFullYear(), m = d.getMonth() + n;
  return new Date(j, m, Math.min(d.getDate(), new Date(j, m + 1, 0).getDate()));
}

/** Der Montag der Woche, in der der Erste dieses Monats liegt. */
function rasterAnfang(jahr, monat) {
  const d = new Date(jahr, monat, 1);
  // `getDay()` zählt von Sonntag. Montag als Wochenanfang heißt, den Sonntag
  // als siebten Tag zu zählen — das ist die ganze Umstellung.
  d.setDate(1 - (d.getDay() + 6) % 7);
  return d;
}

/**
 * Verdrahtet Feld, Knopf und Blatt einer Seite.
 *
 * `waehlen(iso)` läuft, sobald ein Datum feststeht — dort hängt die Seite ihr
 * Modell an. `melden(text, art)` ist für Unlesbares. `vorAuf()` läuft, bevor
 * aufgeklappt wird; die Seite schließt dort, was sonst noch offen steht.
 *
 * Zurück kommt `{ setzen, zuklappen, offen }`. `setzen(iso)` ist der einzige
 * Weg, dem Feld einen Wert zu geben: so übersetzt genau eine Stelle zwischen
 * der ISO-Form der Datei und der Satzform des Feldes.
 */
export function kalenderVerdrahten({ blatt, feld, knopf, waehlen, melden, vorAuf }) {
  const tabelle = blatt.querySelector("table");
  const titel = blatt.querySelector(".titel");
  const st = { offen: false, jahr: 0, monat: 0, fokus: "", gewaehlt: "", heute: "" };
  // Der zuletzt gültige Wert. Er ist die Wahrheit, auf die das Feld
  // zurückspringt, wenn jemand Unsinn tippt.
  let gemerkt = "";

  // Die Wochentagszeile ändert sich nie — einmal füllen, nicht bei jedem
  // Zeichnen.
  const kopfzeile = blatt.querySelector("thead tr");
  for (const name of WOCHE) {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = name;
    kopfzeile.append(th);
  }

  function setzen(iso) {
    gemerkt = iso ?? "";
    feld.value = datumZeigen(gemerkt);
  }

  /**
   * Schreibt fest, was im Feld steht.
   *
   * BEIM TIPPEN WIRD NICHTS FESTGESCHRIEBEN. Kein Modellschreiben, keine
   * Meldung — das geschieht bei `change`, bei Enter und bevor der Kalender
   * aufgeht. Das ist die Antwort darauf, warum aus einer getippten „1" kein
   * Datum wird.
   *
   * Die Punkte setzt `maskieren` allerdings schon währenddessen; gedeutet
   * wird deshalb noch lange nichts.
   */
  function uebernehmen() {
    const iso = datumLesen(feld.value);
    if (iso === null) {
      // Nichts ins Modell, und das Feld zeigt wieder, was in der Datei steht.
      // Ein Feld, das nach dem Verlassen etwas anderes zeigt als die Datei,
      // wäre eine zweite Wahrheit. Der Rücksprung ist zugleich die Antwort —
      // man sieht, dass die Eingabe nicht angenommen wurde; die Meldung sagt
      // nur, warum.
      melden?.(`„${feld.value.trim()}“ ist kein Datum. Erwartet wird TT.MM.JJJJ.`, "error");
      setzen(gemerkt);
      return;
    }
    const alt = gemerkt;
    setzen(iso);
    if (iso !== alt) waehlen?.(iso);
  }

  /**
   * Zeichnet den angezeigten Monat.
   *
   * IMMER SECHS ZEILEN, auch wo vier reichten. Die Höhe des Blattes wird
   * einmal gemessen, bevor es gestellt wird; ein Blatt, das beim Blättern
   * wächst, liefe unten aus dem Fenster oder klappte unter der Hand um. Der
   * feste Umriss ist der Preis dafür, dass die Stellung nur einmal gerechnet
   * werden muss — und nebenbei springt beim Durchblättern nichts.
   *
   * Nachgemessen sind es 252 × 293 px. Die Unterkante des Datumsfeldes liegt
   * rund 278 px unter dem Fensteroberrand; bei der Vorgabehöhe von 780 px
   * geht das Blatt also bequem nach unten auf, bei der Mindesthöhe von 520 px
   * passt es weder darüber noch darunter und verdeckt dann das Feld.
   *
   * Die Tage der Nachbarmonate stehen mit da, nur zurückgenommen: eine leere
   * Zelle sähe aus wie ein Loch, und bei Montagsanfang beginnt jeder dritte
   * Monat mit sechs leeren Feldern. Anklickbar sind sie auch — wer auf den
   * 1. Oktober zielt, während September steht, meint den 1. Oktober.
   *
   * ACHTUNG: dieser Aufruf ersetzt den `<tbody>` und damit die Schaltfläche,
   * auf der womöglich gerade der Fokus liegt. Jeder Weg hierher muss ihn
   * danach neu setzen — `blaettern`, `fokusSetzen` und „Heute" tun das.
   */
  function zeichnen() {
    titel.textContent = F_KOPF.format(new Date(st.jahr, st.monat, 1));
    const koerper = document.createElement("tbody");
    const d = rasterAnfang(st.jahr, st.monat);
    for (let w = 0; w < 6; w++) {
      const tr = koerper.insertRow();
      for (let s = 0; s < 7; s++) {
        const iso = isoAus(d), td = tr.insertCell();
        const b = document.createElement("button");
        b.type = "button";
        b.dataset.iso = iso;
        b.textContent = String(d.getDate());
        b.setAttribute("aria-label", F_TAG.format(d));
        b.tabIndex = iso === st.fokus ? 0 : -1;
        if (d.getMonth() !== st.monat) b.className = "fremd";
        if (iso === st.heute) b.setAttribute("aria-current", "date");
        if (iso === st.gewaehlt) td.setAttribute("aria-selected", "true");
        td.append(b);
        // `setDate` rechnet auf dem Kalender und nicht auf Millisekunden: die
        // Zeitumstellung verschiebt hier nichts.
        d.setDate(d.getDate() + 1);
      }
    }
    tabelle.tBodies[0]?.remove();
    tabelle.append(koerper);
  }

  /** Setzt den Fokus auf einen Tag und blättert dorthin, wenn nötig. */
  function fokusSetzen(iso) {
    const d = ausIso(iso);
    const anderswo = d.getFullYear() !== st.jahr || d.getMonth() !== st.monat;
    st.fokus = iso;
    if (anderswo) {
      st.jahr = d.getFullYear(); st.monat = d.getMonth();
      zeichnen();
    } else {
      // Innerhalb des Monats nur umhängen statt neu zu zeichnen: ein Raster,
      // das bei jedem Pfeildruck neu entsteht, nimmt der Vorlesehilfe den
      // Faden.
      const alt = tabelle.querySelector('button[tabindex="0"]');
      if (alt) alt.tabIndex = -1;
    }
    const b = tabelle.querySelector(`button[data-iso="${iso}"]`);
    if (b) { b.tabIndex = 0; b.focus(); }
  }

  function blaettern(n) {
    const warDrin = blatt.contains(document.activeElement);
    const d = monatVersetzen(ausIso(st.fokus), n);
    st.jahr = d.getFullYear(); st.monat = d.getMonth(); st.fokus = isoAus(d);
    zeichnen();
    // Das neue Raster hat die alte Schaltfläche nicht mehr. Lag der Fokus
    // darin, muss er mit umziehen — sonst fiele er auf den <body> und das
    // Blatt bekäme keine Taste mehr zu sehen. Lag er auf ‹ oder ›, bleibt er.
    if (warDrin && !blatt.contains(document.activeElement)) {
      tabelle.querySelector('button[tabindex="0"]')?.focus();
    }
  }

  /**
   * Stellt das Blatt unter das Feld — oder darüber, wenn unten kein Platz ist.
   *
   * Erst einblenden, dann messen, dann stellen: die Höhe steht nur an einem
   * sichtbaren Element fest. Dasselbe Verfahren wie in menu-ui.js und beim
   * Dateimenü. Zwischen Einblenden und Stellen liegt kein Bildaufbau —
   * `offsetHeight` erzwingt ein Rechnen des Satzes, kein Zeichnen —, also
   * flackert nichts.
   */
  function stellen() {
    const anker = feld.closest(".datumfeld") ?? feld;
    const r = anker.getBoundingClientRect();
    blatt.hidden = false;
    const w = blatt.offsetWidth, h = blatt.offsetHeight;

    const unten = r.bottom + 4, oben = r.top - 4 - h;
    // Vorzug hat unten. Nach oben wird nur geklappt, wenn es unten nicht
    // reicht und oben schon — sonst spränge das Blatt beim Vergrößern des
    // Fensters von einer Seite auf die andere.
    const y = (unten + h <= innerHeight - 4 || oben < 4) ? unten : oben;

    blatt.style.left = Math.max(4, Math.min(r.left, innerWidth - w - 4)) + "px";
    // Das Klemmen bleibt als letzte Instanz stehen: bei Mindesthöhe passt das
    // Blatt weder über noch unter das Feld. Dann verdeckt es das Feld — so wie
    // der Systemkalender es auch tat. Gebraucht wird es währenddessen nicht.
    blatt.style.top = Math.max(4, Math.min(y, innerHeight - h - 4)) + "px";
  }

  function aufklappen() {
    if (st.offen) return;
    // Erst festschreiben, was im Feld steht. Das schreibt `feld.value` neu und
    // löscht damit die Änderungsmarke des Feldes — der gleich folgende
    // Fokuswechsel löst deshalb kein zweites `change` aus, das dieselbe
    // Meldung ein zweites Mal brächte.
    uebernehmen();
    vorAuf?.();
    // Ein Fenster kann über Mitternacht offen stehen: „heute" wird beim
    // Aufklappen bestimmt, nicht beim Laden der Seite.
    st.heute = heuteIso();
    st.gewaehlt = gemerkt || "";
    st.fokus = st.gewaehlt || st.heute;
    const d = ausIso(st.fokus);
    st.jahr = d.getFullYear(); st.monat = d.getMonth();
    zeichnen();
    stellen();
    st.offen = true;
    knopf.setAttribute("aria-expanded", "true");
    tabelle.querySelector('button[tabindex="0"]')?.focus();
  }

  function zuklappen(zumFeld) {
    if (!st.offen) return;
    blatt.hidden = true;
    st.offen = false;
    knopf.setAttribute("aria-expanded", "false");
    if (zumFeld) feld.focus();
  }

  function nehmen(iso) {
    setzen(iso);
    waehlen?.(iso);
    zuklappen(true);
  }

  // ---- Zeigen ----
  // Kein Klick im Blatt verschiebt den Fokus. Ohne diesen Griff nähme ein
  // Klick auf ‹ den Fokus dem Tag weg, mit dem die Pfeiltasten danach
  // weiterarbeiten — und auf dem Knopf entschiede die Reihenfolge zweier
  // Ereignisse darüber, ob der nächste Druck auf- oder zuklappt.
  blatt.addEventListener("mousedown", e => e.preventDefault());
  knopf.addEventListener("mousedown", e => e.preventDefault());
  knopf.addEventListener("click", () => st.offen ? zuklappen(true) : aufklappen());

  blatt.addEventListener("click", e => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.iso) return nehmen(b.dataset.iso);
    if (b.dataset.zu) return blaettern(Number(b.dataset.zu));
    if (b.dataset.heute !== undefined) {
      const h = heuteIso();
      st.heute = h;
      nehmen(h);
    }
  });

  /**
   * Setzt die Punkte, wo niemand welche getippt hat.
   *
   * NUR IN EINE REINE ZIFFERNFOLGE. Wer selbst trennt — „1.9.26", „1-9-26" —
   * bekommt keine zweite Meinung. Das ist die Bedingung dafür, dass die
   * geduldige Deutung erhalten bleibt: ein Punkt, der sich in „1.9.26"
   * dazwischendrängte, machte daraus „19.26" und aus dem 1. September den
   * 19. eines Monats, den es nicht gibt.
   *
   * Darum wird nur an zwei Stellen eingegriffen, und beide sind eindeutig:
   * hinter genau zwei Ziffern („01" → „01.") und hinter „TT.MM" („01.09" →
   * „01.09."). Eine einzelne Ziffer bleibt unberührt — „1" könnte der 1. oder
   * der Anfang des 12. sein, und das weiß nur, wer weitertippt.
   *
   * Dazu der Fall aus der Zwischenablage: eine Folge von drei bis acht
   * Ziffern wird in einem Zug gegliedert.
   *
   * BEIM LÖSCHEN GESCHIEHT NICHTS. Sonst stünde hinter „01" sofort wieder der
   * Punkt, den die Rücktaste eben weggenommen hat, und man käme nicht mehr
   * zurück.
   *
   * Die Schreibmarke wird nicht gemerkt, sondern nachgezählt: ein Zuweisen von
   * `value` setzt sie ans Ende, und ihre alte Stelle stimmte nach dem
   * Einfügen eines Punktes ohnehin nicht mehr. Gezählt wird in Ziffern —
   * die überleben das Umformen, Trennzeichen nicht.
   */
  function maskieren(e) {
    if (e.inputType?.startsWith("delete")) return;
    const alt = feld.value;
    let neu;
    if (/^\d{2}$/.test(alt) || /^\d{2}\.\d{2}$/.test(alt)) {
      neu = alt + ".";
    } else if (/^\d{3,8}$/.test(alt)) {
      neu = alt.slice(0, 2) + "." + alt.slice(2, 4) + (alt.length > 4 ? "." + alt.slice(4) : "");
    } else {
      return;
    }
    const zifferVor = alt.slice(0, feld.selectionStart ?? alt.length).replace(/\D/g, "").length;
    feld.value = neu;
    let i = 0, n = 0;
    while (i < neu.length && n < zifferVor) {
      if (neu[i] >= "0" && neu[i] <= "9") n++;
      i++;
    }
    // Und über den eben gesetzten Punkt hinweg: bliebe die Marke davor, tippte
    // man hinter ihm weiter und schöbe ihn vor sich her — aus „01092026" würde
    // „01092026.". Nachgemessen, bevor diese zwei Zeilen hier standen.
    while (i < neu.length && !(neu[i] >= "0" && neu[i] <= "9")) i++;
    feld.setSelectionRange(i, i);
  }

  // ---- Das Feld ----
  feld.addEventListener("input", maskieren);
  feld.addEventListener("change", uebernehmen);
  feld.addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); uebernehmen(); return; }
    // ↓ klappt auf, wie bei einer Auswahlliste. `Alt` mit, weil manche das so
    // gelernt haben; beide tun dasselbe.
    if (e.key === "ArrowDown") { e.preventDefault(); aufklappen(); }
  });

  // ---- Tastatur im Blatt ----
  // Der Horcher hängt am Blatt und nicht am Fenster. menu-ui.js hat einen
  // Fensterhorcher für ↑/↓; er kehrt zwar früh zurück, solange kein Menü offen
  // ist, und offen sein können nie beide. Mit `stopPropagation` hängt die
  // Sache aber nicht davon ab, dass diese Überlegung auch morgen noch stimmt.
  blatt.addEventListener("keydown", e => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); zuklappen(true); return; }
    if (e.key === "Tab") { e.preventDefault(); weiterTab(e.shiftKey); return; }

    const b = e.target.closest("button[data-iso]");
    if (!b) return;                       // ‹, › und „Heute" bedient der Browser
    const d = ausIso(b.dataset.iso);
    const schritt = e.shiftKey ? 12 : 1;  // Umschalt macht aus dem Monat ein Jahr
    let ziel = null;

    switch (e.key) {
      case "ArrowLeft":  ziel = tagePlus(d, -1); break;
      case "ArrowRight": ziel = tagePlus(d, +1); break;
      case "ArrowUp":    ziel = tagePlus(d, -7); break;
      case "ArrowDown":  ziel = tagePlus(d, +7); break;
      case "PageUp":     ziel = monatVersetzen(d, -schritt); break;
      case "PageDown":   ziel = monatVersetzen(d, +schritt); break;
      case "Home": case "End": {
        const versatz = (d.getDay() + 6) % 7;                  // Montag = 0
        ziel = tagePlus(d, -versatz + (e.key === "End" ? 6 : 0)); break;
      }
      // `preventDefault` erst, wenn feststeht, dass wir zuständig sind — wie
      // in menu-ui.js. Enter und Leertaste nehmen den Tag, und zwar von
      // selbst: es sind wirkliche Schaltflächen.
      default: return;
    }
    e.preventDefault();
    e.stopPropagation();
    fokusSetzen(isoAus(ziel));
  });

  /** Die Haltestellen im Blatt: ‹, ›, der Tag mit dem Fokus, „Heute". */
  function weiterTab(rueckwaerts) {
    const s = [...blatt.querySelectorAll("button")]
      .filter(b => !b.dataset.iso || b.tabIndex === 0);
    const i = s.indexOf(document.activeElement);
    s[(i + (rueckwaerts ? -1 : 1) + s.length) % s.length]?.focus();
  }

  // ---- Wege nach draußen ----
  // Nach dem Vorbild von menu-ui.js. Ausgenommen ist das ganze `.datumfeld`
  // und nicht nur der Knopf: ein Klick in die Ziffern soll weitertippen
  // lassen, und ohne die Ausnahme schlösse das `mousedown` auf dem Knopf das
  // Blatt, das der folgende Klick sofort wieder aufrisse.
  addEventListener("mousedown", e => {
    if (!st.offen || blatt.contains(e.target)) return;
    if (feld.closest(".datumfeld")?.contains(e.target)) return;
    zuklappen(false);
  });
  addEventListener("contextmenu", e => { if (st.offen && !blatt.contains(e.target)) zuklappen(false); });
  addEventListener("blur", () => zuklappen(false));
  // Neu rechnen wäre möglich, Zuklappen ist ehrlicher: unter 1100 px ist das
  // Feld gleich ganz fort. Dasselbe tut menu-ui.js.
  addEventListener("resize", () => zuklappen(false));

  return { setzen, zuklappen, offen: () => st.offen };
}
