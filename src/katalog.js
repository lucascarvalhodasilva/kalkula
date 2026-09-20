// Aus einer Preisliste einen Katalog machen: Kategorie → Produkt → Größe → Wert.
//
// WARUM DAS ERKANNT UND NICHT AUFGESCHRIEBEN WIRD
//   Das Makro, das diese App ablöst, trug die Zeilen- und Spaltennummern jeder
//   Kategorie im Quelltext: `RegisterSchema "ReiheA (0,8µm)", "STANDARD", 14,
//   17, 4, 19, 18, 19, 29, 1, 2, 3`. Sein eigener Kommentar versprach, das alles
//   käme aus einem Konfigurationsblatt und eine neue Preisliste brauche keine
//   Änderung am Code — nur stand darunter dann doch die feste Liste. Wer eine
//   Spalte einfügte, verschob stillschweigend alle Preise.
//
//   Hier wird die Aufteilung stattdessen aus dem Blatt gelesen. Die Preisliste
//   beschreibt sich selbst gut genug: sie schreibt "DN" über die Größenspalte
//   und "€ / m" oder "h / Stück" über jede Preisspalte. Das sind die beiden
//   Anker, an denen alles andere hängt.
//
//   Was erkannt wurde, bleibt sichtbar und lässt sich überschreiben — siehe
//   `schemaPruefen` und das Katalogfenster. Eine Erkennung, die man nicht
//   nachsehen kann, ist schlimmer als eine feste Liste: sie irrt sich leise.
//
// WAS DAS MAKRO NICHT KONNTE
//   Seine Schleife lief `For i = 1 To wb.Sheets.count - 1` und ließ damit das
//   letzte Blatt aus. In der BWT-Liste ist das "Nebenleistungen" — Druckprobe,
//   Spülen, Endoskopieren. Die waren im Kalkulationswerkzeug nicht erreichbar.
//   Hier sind sie es, weil ein Blatt ohne DN-Spalte kein Sonderfall ist,
//   sondern nur eine andere Achse.

import { mappeLesen, nummerZuSpalte } from "./xlsx.js";

// Über einer Preisspalte steht, was die Zahl darunter bedeutet: "€ / m",
// "€ / Stück", "h / Stück", "€ pro 100 m". Das ist der zweite Anker der
// Erkennung — und zugleich die Antwort auf die Frage, ob die Zahl ein Preis
// oder eine Montagezeit ist.
const EINHEIT = /^\s*(€|EUR|h|Std\.?)\s*(?:\/|pro)\s*(.+?)\s*$/i;

// Kurzformen für die Anzeige. "Stück" ist in einer Tabellenspalte zu breit,
// und "St" steht so auch im abgelösten Makro.
const KURZ = { "stück": "St", "stueck": "St", "stk": "St", "stk.": "St" };

/**
 * "h / Stück" → { einheit: "St", istStunden: true }.
 * Was nicht passt, gibt null — die Spalte ist dann keine Wertspalte.
 */
export function einheitLesen(text) {
  const m = EINHEIT.exec(String(text || ""));
  if (!m) return null;
  const roh = m[2].trim();
  return {
    einheit: KURZ[roh.toLowerCase()] || roh,
    istStunden: /^(h|Std\.?)$/i.test(m[1]),
  };
}

/**
 * Sucht die Zeile, in der die Einheiten stehen — die erste Zeile des Blatts,
 * in der mindestens zwei Zellen wie eine Einheit aussehen.
 *
 * Zwei und nicht eine: in "Nebenleistungen" steht "Projektspezifisch" neben
 * echten Preisen, und irgendwo im Blatt steht auch mal "€ pro Stück" im
 * Fließtext einer Fußnote. Zwei nebeneinander sind kein Zufall mehr.
 * Blätter mit genau einer Wertspalte fängt der zweite Durchgang.
 */
function einheitZeileSuchen(blatt) {
  let einzeln = 0;
  for (let z = 1; z <= blatt.zeilen; z++) {
    let treffer = 0;
    for (let s = 1; s <= blatt.spalten; s++) {
      if (blatt.belegt(z, s) && einheitLesen(blatt.wert(z, s))) treffer++;
    }
    if (treffer >= 2) return z;
    if (treffer === 1 && !einzeln) einzeln = z;
  }
  return einzeln;   // 0, wenn das Blatt gar keine Einheit nennt
}

/** Die Spalten, über denen in `zeile` eine Einheit steht. */
function wertSpalten(blatt, zeile) {
  const spalten = [];
  for (let s = 1; s <= blatt.spalten; s++) {
    const e = blatt.belegt(zeile, s) ? einheitLesen(blatt.wert(zeile, s)) : null;
    if (e) spalten.push({ spalte: s, ...e });
  }
  return spalten;
}

/**
 * Sucht die Größenspalte: die Zelle, in der "DN" allein steht. Sie sitzt links
 * von den Preisen und über den Größen.
 *
 * Gesucht wird nur links der ersten Wertspalte — "DN" kommt in der BWT-Liste
 * auch mitten in einer Kopfzeile vor ("T-Stück / Abgang / DN"), und das ist
 * eine Produktspalte, keine Achse.
 */
function achsSpalteSuchen(blatt, bisSpalte, bisZeile) {
  for (let s = 1; s < bisSpalte; s++) {
    for (let z = 1; z <= bisZeile; z++) {
      if (blatt.belegt(z, s) && /^DN$/i.test(blatt.wert(z, s))) return { spalte: s, zeile: z };
    }
  }
  return null;
}

/**
 * Liest die Aufteilung eines Blatts.
 *
 * Ergebnis ist ein Schema, das genauso aussieht wie eines, das man von Hand
 * hinschreibt — erkannt und eingetragen sind später nicht zu unterscheiden.
 * `herkunft` sagt, woher es kam, damit das Katalogfenster es sagen kann.
 */
export function schemaErkennen(blatt) {
  const einheitZeile = einheitZeileSuchen(blatt);
  if (!einheitZeile) return null;

  const werte = wertSpalten(blatt, einheitZeile);
  if (!werte.length) return null;

  const ersteWert = werte[0].spalte;
  const achse = achsSpalteSuchen(blatt, ersteWert, einheitZeile);

  // Die Datenzeilen fangen unter der Einheitenzeile an und hören auf, wo die
  // Achsenspalte nichts mehr hergibt. Eine Leerzeile beendet den Block: was
  // darunter steht ("Preise inklusive Lieferung und Montage"), ist Fußnote.
  const achsSpalte = achse ? achse.spalte : 1;
  let datenVon = einheitZeile + 1, datenBis = einheitZeile;
  while (datenVon <= blatt.zeilen && !blatt.belegt(datenVon, achsSpalte)) datenVon++;
  for (let z = datenVon; z <= blatt.zeilen; z++) {
    if (!blatt.belegt(z, achsSpalte)) break;
    datenBis = z;
  }
  if (datenBis < datenVon) return null;

  // Die Kopfzeilen des Produktnamens: zwischen der Zeile, in der "DN" steht,
  // und der Einheitenzeile. Ohne DN-Anker ab der ersten belegten Zeile über der
  // Einheit — in "Nebenleistungen" ist das die Zeile mit der Überschrift.
  const kopfVon = achse ? achse.zeile : einheitZeile;
  const kopfBis = einheitZeile - 1;

  // Zwischen Achse und erster Wertspalte stehen die Maße, die eine Größe näher
  // beschreiben: Außen-Ø und Wanddicke. Sie sind kein Preis und kein Produkt,
  // sondern gehören an die Größe — "DN 25 (29 x 1.5)".
  const masse = [];
  if (achse) {
    for (let s = achse.spalte + 1; s < ersteWert; s++) {
      const titel = blatt.wert(kopfVon, s) || blatt.wert(einheitZeile - 1, s);
      if (titel) masse.push({ spalte: s, titel });
    }
  }

  return {
    blatt: blatt.name,
    achse: achse ? "dn" : "name",
    achsSpalte,
    kopfVon, kopfBis,
    einheitZeile,
    datenVon, datenBis,
    spalten: werte,          // [{ spalte, einheit, istStunden }]
    masse,                   // [{ spalte, titel }]
    herkunft: "erkannt",
  };
}

/**
 * Setzt den Produktnamen aus den Kopfzeilen einer Spalte zusammen.
 *
 * Wiederholungen fallen weg: "Ventiltechnik (nur Montage)" steht als
 * verbundene Zelle über acht Spalten, und ohne diese Prüfung hieße jedes
 * Produkt darunter "Ventiltechnik … Ventiltechnik …". Verglichen wird nur mit
 * dem zuletzt genommenen Stück, nicht mit allen — "T-Stück / Abgang / DN" darf
 * das "DN" behalten, auch wenn es weiter oben schon einmal vorkam.
 */
function produktName(blatt, schema, spalte) {
  const teile = [];
  for (let z = schema.kopfVon; z <= schema.kopfBis; z++) {
    const t = blatt.wert(z, spalte);
    if (t && teile[teile.length - 1] !== t) teile.push(t);
  }
  return teile.join(" ");
}

/** "DN 25 (29 x 1,5)" — die Maße in Klammern, wenn das Blatt welche führt. */
function groessenName(blatt, schema, zeile) {
  const roh = blatt.wert(zeile, schema.achsSpalte);
  if (!roh) return "";
  if (schema.achse !== "dn") return roh;
  const label = /^DN/i.test(roh) ? roh : `DN ${roh}`;
  const masse = schema.masse.map(m => blatt.wert(zeile, m.spalte)).filter(Boolean);
  return masse.length ? `${label} (${masse.join(" × ")})` : label;
}

/**
 * Baut aus einem Blatt eine Kategorie.
 *
 * Hier fällt die Unterscheidung, die das Makro als zwei getrennte Parser führte
 * ("STANDARD" und "MATRIX"), in sich zusammen: beide Blätter haben Produkte in
 * den Spalten und Größen in den Zeilen, sie fangen nur woanders an. Was sie
 * wirklich unterscheidet — ob es Außen-Ø und Wanddicke gibt — steht im Schema.
 *
 * Der dritte Fall ist neu: ein Blatt ohne DN-Achse ("Nebenleistungen"). Dort
 * steht das Produkt in der Zeile, und eine Größe gibt es nicht.
 */
export function kategorieBauen(blatt, schema) {
  const produkte = [];

  if (schema.achse === "dn") {
    const groessen = [];
    for (let z = schema.datenVon; z <= schema.datenBis; z++) {
      const name = groessenName(blatt, schema, z);
      if (name) groessen.push({ zeile: z, name });
    }
    for (const sp of schema.spalten) {
      const name = produktName(blatt, schema, sp.spalte);
      if (!name) continue;
      // Gleichnamige Spalten kommen vor (zwei Blätter derselben Reihe führen
      // "Rohr" doppelt). Die erste gewinnt, wie im abgelösten Makro.
      if (produkte.some(p => p.name === name)) continue;
      produkte.push({
        name,
        einheit: sp.einheit,
        istStunden: sp.istStunden,
        groessen: groessen.map(g => ({
          name: g.name,
          wert: blatt.zahl(g.zeile, sp.spalte),
        })),
      });
    }
  } else {
    // Produkt in der Zeile. Mehrere Wertspalten werden zu Größen — dann heißt
    // die Größe wie die Spalte darüber.
    const mehrspaltig = schema.spalten.length > 1;
    for (let z = schema.datenVon; z <= schema.datenBis; z++) {
      const name = blatt.wert(z, schema.achsSpalte);
      if (!name || produkte.some(p => p.name === name)) continue;
      const erste = schema.spalten[0];
      produkte.push({
        name,
        einheit: erste.einheit,
        istStunden: erste.istStunden,
        groessen: mehrspaltig
          ? schema.spalten.map(sp => ({
              name: produktName(blatt, schema, sp.spalte) || nummerZuSpalte(sp.spalte),
              wert: blatt.zahl(z, sp.spalte),
            }))
          : [{ name: "", wert: blatt.zahl(z, erste.spalte) }],
      });
    }
  }

  return { name: blatt.name, schema, produkte };
}

/**
 * Prüft ein Schema gegen das Blatt und sammelt, was auffällt.
 *
 * Die Erkennung kann danebenliegen, ohne zu scheitern — eine verschobene
 * Einheitenzeile liefert eine Kategorie voller leerer Preise, keinen Fehler.
 * Deshalb wird gezählt und gezeigt, statt still zu übernehmen.
 */
export function schemaPruefen(kategorie) {
  const hinweise = [];
  const p = kategorie.produkte;
  if (!p.length) {
    hinweise.push("Keine Produkte erkannt.");
    return hinweise;
  }
  const felder = p.reduce((n, x) => n + x.groessen.length, 0);
  const gefuellt = p.reduce((n, x) => n + x.groessen.filter(g => g.wert !== null).length, 0);
  if (gefuellt === 0) hinweise.push("Kein einziger Wert hinterlegt — entweder ist das Blatt eine leere Vorlage, oder die Einheitenzeile steht falsch.");
  else if (gefuellt < felder / 4) hinweise.push(`Nur ${gefuellt} von ${felder} Feldern haben einen Wert.`);
  const ohneName = p.filter(x => !x.name.trim()).length;
  if (ohneName) hinweise.push(`${ohneName} Produkt(e) ohne Namen.`);
  return hinweise;
}

/**
 * Liest eine ganze Preisliste.
 *
 * Blätter, in denen keine Aufteilung zu erkennen ist, fallen heraus statt das
 * Lesen abzubrechen — eine Preisliste darf ein Deckblatt haben. Was fehlt,
 * steht in `uebergangen` und wird in der Oberfläche genannt; stillschweigend
 * verschwinden soll nichts.
 */
export async function katalogLesen(bytes, dateiName) {
  const mappe = await mappeLesen(bytes);
  const kategorien = [];
  const uebergangen = [];

  for (const blatt of mappe.blaetter) {
    const schema = schemaErkennen(blatt);
    if (!schema) { uebergangen.push({ blatt: blatt.name, grund: "keine Preisspalten gefunden" }); continue; }
    const kat = kategorieBauen(blatt, schema);
    if (!kat.produkte.length) { uebergangen.push({ blatt: blatt.name, grund: "keine Produkte erkannt" }); continue; }
    kat.hinweise = schemaPruefen(kat);
    kategorien.push(kat);
  }

  if (!kategorien.length) {
    throw new Error("In dieser Datei war keine Preisliste zu erkennen.");
  }
  // Die gelesene Mappe geht mit zurück: das Preislistenfenster kann ein
  // korrigiertes Schema schicken, und dann muss das Blatt noch einmal
  // durchgegangen werden. Die Datei ein zweites Mal zu entpacken wäre nicht
  // nur langsamer — es wären zwei Stände derselben Sache.
  return { datei: dateiName, kategorien, uebergangen, mappe, gelesen: new Date().toISOString() };
}

/**
 * Baut eine Kategorie mit einem von Hand geänderten Schema neu.
 *
 * Das ist die Einlösung des Versprechens oben: was erkannt wurde, lässt sich
 * korrigieren, ohne den Quelltext anzufassen. Die geänderten Zahlen gehen
 * durch dieselbe Funktion wie die erkannten — ein korrigiertes Schema ist von
 * einem erkannten nicht zu unterscheiden, außer an `herkunft`.
 */
export function kategorieNeuBauen(mappe, blattName, schemaRoh) {
  const blatt = mappe.blatt(blattName);
  if (!blatt) throw new Error(`Das Blatt „${blattName}“ gibt es in dieser Datei nicht.`);

  const zahl = (v, ersatz) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : ersatz;
  };
  const alt = schemaErkennen(blatt) || {};
  const schema = {
    blatt: blattName,
    achse: schemaRoh.achse === "name" ? "name" : "dn",
    achsSpalte: zahl(schemaRoh.achsSpalte, alt.achsSpalte ?? 1),
    kopfVon: zahl(schemaRoh.kopfVon, alt.kopfVon ?? 1),
    kopfBis: zahl(schemaRoh.kopfBis, alt.kopfBis ?? 1),
    einheitZeile: zahl(schemaRoh.einheitZeile, alt.einheitZeile ?? 1),
    datenVon: zahl(schemaRoh.datenVon, alt.datenVon ?? 1),
    datenBis: zahl(schemaRoh.datenBis, alt.datenBis ?? 1),
    masse: Array.isArray(schemaRoh.masse) ? schemaRoh.masse : (alt.masse ?? []),
    herkunft: "eingetragen",
  };

  // Die Wertspalten werden immer aus der eingetragenen Einheitenzeile neu
  // gelesen: wer die Zeile verschiebt, meint genau das — andere Spalten.
  schema.spalten = wertSpalten(blatt, schema.einheitZeile);
  if (!schema.spalten.length) {
    throw new Error(`In Zeile ${schema.einheitZeile} steht keine Einheit („€ / m“, „h / Stück“).`);
  }

  const kat = kategorieBauen(blatt, schema);
  kat.hinweise = schemaPruefen(kat);
  return kat;
}

/** Ein Produkt im Katalog nachschlagen. Gibt null, wenn es das nicht (mehr) gibt. */
export function nachschlagen(katalog, kategorieName, produktName, groessenName) {
  const kat = katalog?.kategorien.find(k => k.name === kategorieName);
  if (!kat) return null;
  const prod = kat.produkte.find(p => p.name === produktName);
  if (!prod) return null;
  // Ohne Größenwahl hat das Produkt genau einen Wert.
  const groesse = prod.groessen.length === 1 && !prod.groessen[0].name
    ? prod.groessen[0]
    : prod.groessen.find(g => g.name === groessenName);
  return { kategorie: kat, produkt: prod, groesse: groesse || null };
}
