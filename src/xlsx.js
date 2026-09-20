// Eine .xlsx-Arbeitsmappe lesen — so viel davon, wie eine Preisliste braucht.
//
// Dasselbe Muster wie in docfill: die Datei ist ein ZIP-Archiv voller XML, und
// gelesen wird sie hier im Frontend. Rust bekommt die Datei nie zu Gesicht; es
// reicht die Bytes durch und kennt von der Tabelle nur die Endung.
//
// WAS HIER NICHT DRIN IST, UND WARUM
//   * Formeln werden nicht gerechnet. In der Zelle steht neben `<f>` auch das
//     zuletzt von Excel errechnete `<v>` — das nehmen wir. Eine Preisliste, die
//     ihre Preise erst beim Öffnen ausrechnet, gäbe es ohnehin nicht.
//   * Zahlenformate werden nicht ausgewertet, mit einer Ausnahme: ein Datum ist
//     in der Tabelle eine Zahl, und ohne das Format sähe man ihr das nicht an.
//     Für Preise und Größen ist die rohe Zahl genau das, was wir wollen — der
//     Nachkommastellen wegen, die eine Anzeigeformatierung wegrunden würde.
//   * Geschrieben wird nichts. Die Preisliste ist eine fremde Datei; sie wird
//     gelesen und sonst nichts angefasst.
//
// Zellbezüge sind hier durchweg 1-basiert (Zeile 1, Spalte 1 = A1), wie in der
// Tabelle selbst. Ein 0-basierter Index wäre beim Nachschlagen in der geöffneten
// Datei eine ständige Fehlerquelle.

/** "AC" → 29. Führende Ziffern werden überlesen, "AC19" geht also auch. */
export function spalteZuNummer(bezug) {
  let n = 0;
  for (const ch of String(bezug)) {
    const c = ch.toUpperCase().charCodeAt(0);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n;
}

/** 29 → "AC". */
export function nummerZuSpalte(n) {
  let s = "";
  while (n > 0) {
    const rest = (n - 1) % 26;
    s = String.fromCharCode(65 + rest) + s;
    n = (n - rest - 1) / 26;
  }
  return s;
}

/** "AC19" → { zeile: 19, spalte: 29 }. */
function bezugZerlegen(bezug) {
  const m = /^([A-Z]+)(\d+)$/.exec(String(bezug).toUpperCase());
  return m ? { zeile: Number(m[2]), spalte: spalteZuNummer(m[1]) } : null;
}

// Der Tabellen-Namensraum. Kommt in jeder Datei vor, wird aber gelegentlich
// anders abgekürzt — deshalb wird über die lokalen Namen gesucht und nicht über
// das Präfix.
const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

function kinder(el, name) {
  return el ? [...el.getElementsByTagNameNS(NS, name)] : [];
}

/**
 * Der gemeinsame Zeichenketten-Vorrat. Text steht in einer Tabelle nicht in der
 * Zelle, sondern einmal hier; die Zelle nennt nur die Nummer. Eine Zeichenkette
 * kann aus mehreren Stücken bestehen (`<r>`), wenn Teile verschieden formatiert
 * sind — die werden wieder zusammengesetzt, denn uns geht es um den Text.
 */
function vorratLesen(doc) {
  if (!doc) return [];
  return kinder(doc.documentElement, "si").map(si =>
    kinder(si, "t").map(t => t.textContent).join("")
  );
}

// Zahlenformate, an denen ein Datum zu erkennen ist. Die eingebauten Formate
// haben feste Nummern (14–17, 22, 45–47); eigene bringen ihre Beschreibung mit,
// und dort verrät ein y/m/d außerhalb von Anführungszeichen das Datum.
const DATUM_EINGEBAUT = new Set([14, 15, 16, 17, 22, 45, 46, 47]);

function datumsformate(styles) {
  const istDatum = new Set();
  if (!styles) return istDatum;
  const eigen = new Map();
  for (const f of kinder(styles.documentElement, "numFmt")) {
    const code = String(f.getAttribute("formatCode") || "").replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "");
    eigen.set(Number(f.getAttribute("numFmtId")), /[ymd]/i.test(code) && !/[#0?]/.test(code.replace(/[ymdhs:.\/\\ -]/gi, "")));
  }
  // Nur die Formate der Zellen selbst (cellXfs), nicht die der Vorlagen.
  const cellXfs = kinder(styles.documentElement, "cellXfs")[0];
  kinder(cellXfs, "xf").forEach((xf, i) => {
    const id = Number(xf.getAttribute("numFmtId") || 0);
    if (DATUM_EINGEBAUT.has(id) || eigen.get(id)) istDatum.add(i);
  });
  return istDatum;
}

/**
 * Eine gelesene Arbeitsmappe.
 *
 * `blaetter` steht in der Reihenfolge der Reiter, weil die in einer Preisliste
 * eine Aussage trägt: was vorne liegt, wird am häufigsten gebraucht.
 */
export class Mappe {
  constructor(blaetter) {
    this.blaetter = blaetter;
  }
  /** Ein Blatt über seinen Reiternamen. */
  blatt(name) {
    return this.blaetter.find(b => b.name === name) || null;
  }
  get namen() {
    return this.blaetter.map(b => b.name);
  }
}

/**
 * Ein einzelnes Arbeitsblatt, als Karte von Zellen.
 *
 * Verbundene Zellen sind der Grund, warum es `wert()` und nicht nur die Karte
 * gibt: in einem Verbund steht der Wert allein in der Zelle oben links, alle
 * anderen sind leer. Eine Kopfzeile, die sich über acht Spalten zieht, wäre
 * sonst in sieben davon nicht zu sehen. `wert()` schlägt deshalb immer zuerst
 * nach, ob die Zelle zu einem Verbund gehört.
 */
export class Blatt {
  constructor(name, zellen, verbuende, zeilen, spalten) {
    this.name = name;
    this.zellen = zellen;         // Map "zeile,spalte" → { text, zahl, datum }
    this.verbuende = verbuende;   // [{ von:{zeile,spalte}, bis:{zeile,spalte} }]
    this.zeilen = zeilen;         // letzte belegte Zeile
    this.spalten = spalten;       // letzte belegte Spalte
    // Nachschlagekarte für den Verbund: jede überdeckte Zelle zeigt auf die
    // Zelle oben links. Einmal gebaut, weil `wert()` in den Schleifen über
    // Kopfzeilen und Spalten sehr oft gefragt wird.
    this._ankerVon = new Map();
    for (const v of verbuende) {
      for (let z = v.von.zeile; z <= v.bis.zeile; z++) {
        for (let s = v.von.spalte; s <= v.bis.spalte; s++) {
          if (z !== v.von.zeile || s !== v.von.spalte) {
            this._ankerVon.set(`${z},${s}`, `${v.von.zeile},${v.von.spalte}`);
          }
        }
      }
    }
  }

  /** Die Zelle, oder — wenn sie in einem Verbund liegt — dessen obere linke. */
  zelle(zeile, spalte) {
    const k = `${zeile},${spalte}`;
    return this.zellen.get(this._ankerVon.get(k) ?? k) || null;
  }

  /** Der angezeigte Text einer Zelle, Verbund aufgelöst, leer wenn nichts da ist. */
  wert(zeile, spalte) {
    const z = this.zelle(zeile, spalte);
    return z ? z.text : "";
  }

  /** Die Zahl einer Zelle, oder null — auch bei "-", "kein Vorgabe" und leer. */
  zahl(zeile, spalte) {
    const z = this.zelle(zeile, spalte);
    return z && z.zahl !== null ? z.zahl : null;
  }

  /** Steht in dieser Zelle etwas? Verbund wird NICHT aufgelöst. */
  belegt(zeile, spalte) {
    return this.zellen.has(`${zeile},${spalte}`);
  }
}

/**
 * Liest eine .xlsx aus ihren Bytes.
 *
 * `JSZip` kommt als Global aus vendor/jszip.min.js — dieselbe Bibliothek, die
 * docfill für die .docx benutzt, und dieselbe Prüfsumme.
 */
export async function mappeLesen(bytes) {
  if (typeof JSZip === "undefined") throw new Error("JSZip fehlt.");
  let zip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new Error("Die Datei ließ sich nicht öffnen — ist es wirklich eine Excel-Datei?");
  }

  const xml = async pfad => {
    const eintrag = zip.file(pfad);
    if (!eintrag) return null;
    const doc = new DOMParser().parseFromString(await eintrag.async("string"), "application/xml");
    // Der DOMParser meldet einen Fehler nicht, er baut ihn ins Ergebnis ein.
    if (doc.getElementsByTagName("parsererror").length) return null;
    return doc;
  };

  const workbook = await xml("xl/workbook.xml");
  if (!workbook) throw new Error("Die Arbeitsmappe ist beschädigt oder keine .xlsx-Datei.");

  const vorrat = vorratLesen(await xml("xl/sharedStrings.xml"));
  const datumsStile = datumsformate(await xml("xl/styles.xml"));

  // Der Reiter nennt eine Beziehungs-Id, erst die Beziehungsliste nennt die
  // Datei. Die Reihenfolge in workbook.xml ist die der Reiter; die Dateinamen
  // (sheet1.xml …) sagen darüber nichts — sheetId 4 kann der erste Reiter sein.
  const relsDoc = await xml("xl/_rels/workbook.xml.rels");
  const ziele = new Map();
  if (relsDoc) {
    for (const r of [...relsDoc.documentElement.getElementsByTagName("*")]) {
      if (r.localName === "Relationship") ziele.set(r.getAttribute("Id"), r.getAttribute("Target"));
    }
  }

  const blaetter = [];
  for (const sh of kinder(workbook.documentElement, "sheet")) {
    // Ausgeblendete Reiter überspringen: was in Excel nicht zu sehen ist, soll
    // hier keine Kategorie werden.
    if ((sh.getAttribute("state") || "visible") !== "visible") continue;
    const ziel = ziele.get(sh.getAttributeNS(NS_REL, "id") || sh.getAttribute("r:id"));
    if (!ziel) continue;
    const pfad = ziel.startsWith("/") ? ziel.slice(1) : `xl/${ziel.replace(/^\.\//, "")}`;
    const doc = await xml(pfad);
    if (!doc) continue;
    blaetter.push(blattLesen(sh.getAttribute("name") || "", doc, vorrat, datumsStile));
  }

  if (!blaetter.length) throw new Error("Die Arbeitsmappe enthält kein sichtbares Blatt.");
  return new Mappe(blaetter);
}

// Der Nullpunkt der Tabellenzeitrechnung. Excel zählt Tage ab dem 30.12.1899,
// weil es 1900 fälschlich für ein Schaltjahr hält und dieser Versatz den Fehler
// für alle Datumsangaben ab März 1900 wieder ausgleicht.
const TAG_NULL = Date.UTC(1899, 11, 30);

function blattLesen(name, doc, vorrat, datumsStile) {
  const zellen = new Map();
  let maxZeile = 0, maxSpalte = 0;

  for (const c of kinder(doc.documentElement, "c")) {
    const bez = bezugZerlegen(c.getAttribute("r") || "");
    if (!bez) continue;
    const typ = c.getAttribute("t") || "n";

    let text = "", zahl = null, datum = null;
    if (typ === "inlineStr") {
      text = kinder(c, "t").map(t => t.textContent).join("");
    } else {
      const v = kinder(c, "v")[0];
      const roh = v ? v.textContent : "";
      if (typ === "s") {
        text = vorrat[Number(roh)] ?? "";
      } else if (typ === "b") {
        text = roh === "1" ? "WAHR" : "FALSCH";
      } else if (typ === "e") {
        text = roh;           // #NV, #WERT! … — als Text, damit man es sieht
      } else if (roh !== "") {
        zahl = Number(roh);
        if (!Number.isFinite(zahl)) { zahl = null; text = roh; }
        else {
          const stil = Number(c.getAttribute("s") || 0);
          if (datumsStile.has(stil)) {
            datum = new Date(TAG_NULL + Math.round(zahl) * 86400000);
            text = datum.toISOString().slice(0, 10);
          } else {
            // Nicht toLocaleString: der Text dient dem Wiedererkennen von
            // Kopfzeilen, nicht der Anzeige. Gerechnet wird mit `zahl`.
            text = String(zahl);
          }
        }
      }
    }

    // Zeilenumbrüche in Kopfzeilen sind Satz, nicht Inhalt: die Spalte war zu
    // schmal, mehr steckt nicht dahinter. Steht vor dem Umbruch ein
    // Trennstrich, wurde ein Wort getrennt ("Tri-\nClamp") — dann fällt der
    // Umbruch ersatzlos weg, sonst hieße das Produkt "Tri- Clamp".
    text = text.replace(/-\s*\r?\n\s*/g, "-").replace(/\s*\r?\n\s*/g, " ").trim();
    if (text === "" && zahl === null) continue;

    zellen.set(`${bez.zeile},${bez.spalte}`, { text, zahl, datum });
    if (bez.zeile > maxZeile) maxZeile = bez.zeile;
    if (bez.spalte > maxSpalte) maxSpalte = bez.spalte;
  }

  const verbuende = [];
  for (const m of kinder(doc.documentElement, "mergeCell")) {
    const [a, b] = String(m.getAttribute("ref") || "").split(":");
    const von = bezugZerlegen(a), bis = bezugZerlegen(b || a);
    if (von && bis) verbuende.push({ von, bis });
  }

  return new Blatt(name, zellen, verbuende, maxZeile, maxSpalte);
}
