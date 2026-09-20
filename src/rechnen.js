// Das Rechenmodell: was eine Kalkulation ist und was sie kostet.
//
// WARUM DAS EIN BAUM IST UND KEINE ZEILENLISTE
//   Das abgelöste Makro hielt die Gliederung in einer versteckten Spalte Q:
//   jede Zeile trug dort "L1_HEADER", "ITEM", "SUBTOTAL", "SEPARATOR" oder
//   "GRAND_TOTAL", und aus dieser Zeichenkette leitete es alles ab — wo ein
//   Block anfängt, wo er aufhört, was zu wem gehört. Eine eingefügte Zeile an
//   der falschen Stelle verschob damit stillschweigend die Zugehörigkeit.
//
//   Hier ist die Gliederung die Datenstruktur selbst. Ein Block hat Kinder,
//   und eine Ebene ist die Tiefe im Baum, keine Beschriftung. Damit gibt es
//   keinen Zustand mehr, der falsch sein kann: ein Posten hängt dort, wo er
//   hängt.
//
// WAS SICH DADURCH MITERLEDIGT
//   Das Makro bildete Zwischensummen nur auf Ebene 3 (`SUBTOTAL_LEVEL = 3`)
//   und die Gesamtsumme aus eben diesen — eine L1-Position ohne L3-Unterbau
//   ging in die Gesamtsumme nicht ein. `summe()` rechnet hier jede Ebene aus
//   ihren Kindern, also stimmt jede Zwischensumme und die Gesamtsumme immer.

export const MAX_TIEFE = 3;

/** Vorgaben, die im Makro als Konstanten im Code standen. */
export const VORGABE = {
  lohnsatz: 72,     // €/h — COL_LOHN_H wurde dort mit 72 vorbelegt
  zuschlag: 0,      // Anteil, nicht Prozent: 0,15 sind 15 %
};

let zaehler = 0;
/** Eine Kennung, die nur in dieser Sitzung eindeutig sein muss. */
export function neueId() {
  return `p${Date.now().toString(36)}${(zaehler++).toString(36)}`;
}

/** Eine leere Kalkulation. */
export function neueKalkulation() {
  return {
    fassung: 1,
    kopf: {
      kunde: "",
      projekt: "",
      angebotsNr: "",
      datum: new Date().toISOString().slice(0, 10),
      bearbeiter: "",
    },
    lohnsatz: VORGABE.lohnsatz,
    zuschlag: VORGABE.zuschlag,
    katalogDatei: "",
    posten: [],
  };
}

/** Ein Gliederungsblock (Position). */
export function neuerBlock(titel = "") {
  return { art: "block", id: neueId(), titel, kinder: [] };
}

/**
 * Eine Materialzeile. Ohne Katalogbezug ist sie eine Freitextzeile — der
 * Unterschied ist genau der, und keine zweite Zeilenart.
 */
export function neueZeile(vorgabe = {}) {
  return {
    art: "zeile",
    id: neueId(),
    kategorie: "",
    produkt: "",
    groesse: "",
    text: "",            // nur gesetzt, wenn die Zeile freier Text ist
    menge: 0,
    einheit: "",
    ek: null,            // Einkaufspreis je Einheit, null = kein Wert
    ekEigen: false,      // true: von Hand gesetzt, Katalog überschreibt nicht
    zuschlag: null,      // null = der Satz der Kalkulation gilt
    stunden: 0,
    lohnsatz: null,      // null = der Satz der Kalkulation gilt
    ...vorgabe,
  };
}

/** Ist das eine Freitextzeile? */
export function istFrei(zeile) {
  return zeile.art === "zeile" && !zeile.kategorie;
}

// ---------------------------------------------------------------------------
// RECHNEN
// ---------------------------------------------------------------------------
//
// Die Formeln stammen eins zu eins aus dem abgelösten Makro, wo sie als
// Excel-Formeln in die Zellen geschrieben wurden:
//
//   EP VK        = EP EK × (1 + Zuschlag)
//   Gesamt Mat.  = Menge × EP VK
//   Gesamt Lohn  = Stunden × Lohn/h
//   Gesamt VK    = Gesamt Mat. + Gesamt Lohn
//   EP Gesamt    = Gesamt VK ÷ Menge
//
// Der Unterschied: dort rechnete Excel und das Makro schrieb nur die Formeln
// hin — wer eine Zeile verschob, verschob auch die Bezüge. Hier rechnet die
// Anwendung, und eine Zeile kennt nur sich selbst.

/** Der Zuschlag dieser Zeile: ihr eigener, sonst der der Kalkulation. */
export function zuschlagVon(zeile, kalk) {
  return zeile.zuschlag ?? kalk.zuschlag ?? 0;
}

/** Der Lohnsatz dieser Zeile: ihr eigener, sonst der der Kalkulation. */
export function lohnsatzVon(zeile, kalk) {
  return zeile.lohnsatz ?? kalk.lohnsatz ?? 0;
}

/**
 * Rechnet eine Zeile durch.
 *
 * Ohne Einkaufspreis bleibt der Materialteil leer statt null zu werden: eine
 * Zeile, deren Preis noch fehlt, soll als Lücke zu sehen sein und nicht als
 * "0,00 €" durchgehen. Der Lohnteil wird trotzdem gerechnet, denn Montagezeit
 * ohne Materialpreis ist ein gültiger Posten ("nur Montage").
 */
export function zeileRechnen(zeile, kalk) {
  const menge = zahl(zeile.menge);
  const stunden = zahl(zeile.stunden);
  const lohnsatz = zahl(lohnsatzVon(zeile, kalk));
  const ek = zeile.ek === null || zeile.ek === "" ? null : zahl(zeile.ek);
  const zuschlag = zahl(zuschlagVon(zeile, kalk));

  const epVk = ek === null ? null : ek * (1 + zuschlag);
  const material = epVk === null ? null : menge * epVk;
  const lohn = stunden * lohnsatz;
  // Kein Materialpreis UND keine Montagezeit heißt: der Wert dieser Zeile ist
  // unbekannt, nicht null. Der Unterschied ist der zwischen „kostet nichts"
  // und „da fehlt noch der Preis" — und in einem Angebot ist das der
  // Unterschied zwischen geschenkt und vergessen. In der Preisliste kommt das
  // vor: „Nebenleistungen" führt Leistungen, deren Preis projektspezifisch
  // ist, und die Vorlage lässt die Zelle leer.
  const gesamt = material === null && lohn === 0 ? null : (material ?? 0) + lohn;

  return {
    menge, stunden, lohnsatz, ek, zuschlag,
    epVk, material, lohn, gesamt,
    epGesamt: menge && gesamt !== null ? gesamt / menge : null,
    // Eine Zeile ohne alles ist noch nicht ausgefüllt, keine Nullposition.
    leer: ek === null && !menge && !stunden,
  };
}

/**
 * Die Summe eines Knotens — bei einem Block die seiner Kinder, bei einer Zeile
 * ihr eigener Wert. Rechnet über beliebig viele Ebenen, nicht nur über eine.
 */
export function summe(knoten, kalk) {
  if (knoten.art === "zeile") {
    const r = zeileRechnen(knoten, kalk);
    // Eine Zeile ohne Preis zählt in der Summe als 0 — sie darf die Summe der
    // Position nicht unbekannt machen. Aber sie wird GEZÄHLT: eine Position,
    // deren Zeilen keinen Preis haben, zeigte sonst „0,00 €", und auf einem
    // Angebot liest sich das als „kostenlos" statt als „fehlt noch".
    return {
      material: r.material ?? 0, lohn: r.lohn, stunden: r.stunden,
      gesamt: r.gesamt ?? 0,
      offen: r.gesamt === null && !r.leer ? 1 : 0,
    };
  }
  return knoten.kinder.reduce((s, k) => {
    const t = summe(k, kalk);
    return {
      material: s.material + t.material,
      lohn: s.lohn + t.lohn,
      stunden: s.stunden + t.stunden,
      gesamt: s.gesamt + t.gesamt,
      offen: s.offen + t.offen,
    };
  }, { material: 0, lohn: 0, stunden: 0, gesamt: 0, offen: 0 });
}

/** Die Gesamtsumme der Kalkulation. */
export function gesamtsumme(kalk) {
  return summe({ art: "block", kinder: kalk.posten }, kalk);
}

function zahl(v) {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

// ---------------------------------------------------------------------------
// NUMMERIEREN
// ---------------------------------------------------------------------------

/**
 * Vergibt die Positionsnummern: 1, 1.1, 1.1.1 für Blöcke, 1.1.1.01 für Zeilen.
 *
 * Die Nummer wird nicht gespeichert, sondern bei jeder Darstellung neu
 * vergeben — sie ist eine Eigenschaft des Platzes im Baum, kein Feld. Damit
 * kann sie nach einem Verschieben nicht veraltet sein. Das Makro schrieb sie
 * in die Zelle und musste sie nach jeder Änderung nachziehen (`RefreshNumbers`).
 *
 * Gibt eine flache Liste in Anzeigereihenfolge, mit Tiefe und Elternkette —
 * genau das, was sowohl die Tabelle als auch der Druck brauchen.
 */
export function durchlaufen(kalk) {
  const flach = [];
  const gehen = (knoten, praefix, tiefe, eltern) => {
    let blockNr = 0, zeilenNr = 0;
    for (const kind of knoten) {
      if (kind.art === "block") {
        blockNr++;
        const nummer = praefix ? `${praefix}.${blockNr}` : String(blockNr);
        flach.push({ knoten: kind, nummer, tiefe, eltern });
        gehen(kind.kinder, nummer, tiefe + 1, [...eltern, kind]);
      } else {
        zeilenNr++;
        // Zweistellig, damit Zeile 2 und Zeile 10 untereinander ausgerichtet
        // stehen — wie im Makro (`Format(itemCounters, "00")`).
        const nummer = `${praefix || "0"}.${String(zeilenNr).padStart(2, "0")}`;
        flach.push({ knoten: kind, nummer, tiefe, eltern });
      }
    }
  };
  gehen(kalk.posten, "", 1, []);
  return flach;
}

// ---------------------------------------------------------------------------
// UMBAUEN
// ---------------------------------------------------------------------------
//
// Alles, was den Baum verändert, geht durch diese vier Funktionen. Sie geben
// den veränderten Baum nicht zurück, sondern ändern ihn an Ort und Stelle —
// die Oberfläche zeichnet danach ohnehin alles neu, und eine Kopie brächte nur
// die Frage mit, welche der beiden gerade gilt.

/** Findet den Knoten und seinen Elternteil. */
export function finden(kalk, id) {
  const suchen = (liste, eltern) => {
    for (let i = 0; i < liste.length; i++) {
      if (liste[i].id === id) return { knoten: liste[i], liste, index: i, eltern };
      if (liste[i].art === "block") {
        const t = suchen(liste[i].kinder, liste[i]);
        if (t) return t;
      }
    }
    return null;
  };
  return suchen(kalk.posten, null);
}

/** Die Tiefe eines Knotens (1 = oberste Ebene). */
export function tiefeVon(kalk, id) {
  const eintrag = durchlaufen(kalk).find(e => e.knoten.id === id);
  return eintrag ? eintrag.tiefe : 0;
}

/**
 * Hängt einen neuen Knoten hinter `nachId` ein, oder ans Ende von `inId`.
 * Ohne beides ans Ende der obersten Ebene.
 */
export function einfuegen(kalk, neu, { inId = null, nachId = null } = {}) {
  if (nachId) {
    const t = finden(kalk, nachId);
    if (t) { t.liste.splice(t.index + 1, 0, neu); return neu; }
  }
  if (inId) {
    const t = finden(kalk, inId);
    if (t && t.knoten.art === "block") { t.knoten.kinder.push(neu); return neu; }
  }
  kalk.posten.push(neu);
  return neu;
}

/** Entfernt einen Knoten samt allem, was darunter hängt. */
export function entfernen(kalk, id) {
  const t = finden(kalk, id);
  if (!t) return null;
  return t.liste.splice(t.index, 1)[0];
}

/** Wie viele Ebenen ein Knoten selbst tief ist: eine Zeile 0, ein Block 1 + . */
function hoehe(knoten) {
  if (knoten.art !== "block") return 0;
  return 1 + knoten.kinder.reduce((m, k) => Math.max(m, k.art === "block" ? hoehe(k) : 0), 0);
}

/** Passt `knoten` noch in `block`, ohne MAX_TIEFE zu sprengen? */
function passtHinein(kalk, block, knoten) {
  const tiefe = tiefeVon(kalk, block.id);
  return tiefe > 0 && tiefe + hoehe(knoten) <= MAX_TIEFE;
}

/** Hängt den gefundenen Knoten an eine andere Stelle um. */
function umhaengen(t, zielListe, pos) {
  t.liste.splice(t.index, 1);
  zielListe.splice(pos, 0, t.knoten);
  return true;
}

/**
 * Schiebt einen Knoten eine Stelle nach oben oder unten.
 *
 * Nicht nur unter Geschwistern: an der Grenze einer Position geht es weiter,
 * und ist der Nachbar selbst eine Position, geht es hinein. Damit erreicht
 * jeder Posten mit wiederholtem Drücken jede Stelle der Gliederung.
 *
 * Vorher endete das Schieben an der Grenze des Elternblocks: die letzte Zeile
 * einer Position „nach unten" tat schlicht nichts, und wer sie eine Position
 * tiefer haben wollte, musste sie löschen und neu anlegen. Das sah aus, als
 * sei die Schaltfläche kaputt.
 *
 * Hinein geht es dort, wo man herkommt: nach unten oben hinein, nach oben
 * unten hinein. Alles andere ließe den Posten springen.
 *
 * EINE ZEILE BLEIBT IN EINER POSITION. Ein Block darf eine Ebene hinaustreten
 * und notfalls ganz oben stehen; eine Zeile nicht — sie wechselt stattdessen
 * gleich in die Nachbarposition. Das ist ohnehin die Stelle, die im Blatt als
 * nächste kommt, und es hält die Nummerierung heil: eine Zeile ohne Position
 * darüber hätte keine Nummer, die etwas bedeutet.
 *
 * Die Positionsnummern zieht niemand nach — sie werden in `durchlaufen` aus
 * dem Platz im Baum abgeleitet und sind nach dem nächsten Zeichnen von selbst
 * richtig, auch für alle Zeilen unterhalb einer verschobenen Position.
 *
 * Gibt false, wenn sich nichts tut: ganz oben, ganz unten, oder wenn der
 * Zielblock zu tief läge.
 */
export function schieben(kalk, id, richtung) {
  const t = finden(kalk, id);
  if (!t) return false;
  const istZeile = t.knoten.art !== "block";
  const ziel = t.index + richtung;

  // 1. Es gibt einen Nachbarn in derselben Liste.
  if (ziel >= 0 && ziel < t.liste.length) {
    const nachbar = t.liste[ziel];
    if (nachbar.art === "block" && passtHinein(kalk, nachbar, t.knoten)) {
      return umhaengen(t, nachbar.kinder, richtung > 0 ? 0 : nachbar.kinder.length);
    }
    const [k] = t.liste.splice(t.index, 1);
    t.liste.splice(ziel, 0, k);
    return true;
  }

  // 2. Am Rand der Liste. Oberste Ebene: weiter geht es nicht.
  if (!t.eltern) return false;
  const e = finden(kalk, t.eltern.id);
  if (!e) return false;

  // Ein Block tritt eine Ebene hinaus.
  if (!istZeile) return umhaengen(t, e.liste, richtung > 0 ? e.index + 1 : e.index);

  // Eine Zeile wechselt in die Nachbarposition.
  const nachbarIdx = e.index + richtung;
  if (nachbarIdx < 0 || nachbarIdx >= e.liste.length) return false;
  const nachbar = e.liste[nachbarIdx];
  if (nachbar.art !== "block" || !passtHinein(kalk, nachbar, t.knoten)) {
    // Nebenan steht keine Position, sondern eine Zeile — dort stehen also
    // ohnehin Zeilen auf dieser Ebene, und die Zeile darf dazu.
    return umhaengen(t, e.liste, richtung > 0 ? e.index + 1 : e.index);
  }
  return umhaengen(t, nachbar.kinder, richtung > 0 ? 0 : nachbar.kinder.length);
}

/** Zählt, was unter einem Knoten hängt — für die Rückfrage vor dem Löschen. */
export function zaehlen(knoten) {
  if (knoten.art !== "block") return 0;
  return knoten.kinder.reduce((n, k) => n + 1 + zaehlen(k), 0);
}

// ---------------------------------------------------------------------------
// KATALOG UND ZEILE ZUSAMMENBRINGEN
// ---------------------------------------------------------------------------

/**
 * Überträgt einen Katalogeintrag in eine Zeile.
 *
 * Hier sitzt die Regel, die im Makro als Zeichenkettenvergleich stand:
 * `If InStr(productName, "nur Montage") > 0`. Das war ein Behelf — der
 * Produktname musste die Zeichenfolge zufällig enthalten. Die Preisliste sagt
 * es aber selbst, und zwar sauber: über der Spalte steht "h / Stück" statt
 * "€ / Stück". Eine Zahl unter "h /" sind Stunden, und danach richtet sich,
 * ob sie in den Preis oder in die Montagezeit geht.
 *
 * Ein von Hand gesetzter Preis (`ekEigen`) bleibt stehen. Wer ihn überschrieben
 * hat, hat sich etwas dabei gedacht; ein Wechsel der Größe soll das nicht
 * stillschweigend zurücknehmen.
 */
export function ausKatalog(zeile, treffer) {
  if (!treffer) return zeile;
  const { produkt, groesse } = treffer;
  zeile.einheit = produkt.einheit;
  const wert = groesse ? groesse.wert : null;

  if (produkt.istStunden) {
    // Die Zahl ist Montagezeit je Einheit. Material kostet die Zeile nichts.
    zeile.stundenJeEinheit = wert;
    zeile.stunden = wert === null ? 0 : wert * (Number(zeile.menge) || 0);
    if (!zeile.ekEigen) zeile.ek = 0;
  } else {
    zeile.stundenJeEinheit = null;
    if (!zeile.ekEigen) zeile.ek = wert;
  }
  return zeile;
}

/**
 * Zieht die Montagezeit nach, wenn sich die Menge ändert.
 *
 * Nur bei Zeilen, deren Stundenwert aus dem Katalog kommt — eine von Hand
 * eingetragene Stundenzahl gehört dem Bearbeiter und wird nicht überschrieben.
 */
export function mengeGeaendert(zeile) {
  if (zeile.stundenJeEinheit != null) {
    zeile.stunden = zeile.stundenJeEinheit * (Number(zeile.menge) || 0);
  }
  return zeile;
}

// ---------------------------------------------------------------------------
// DATEI
// ---------------------------------------------------------------------------

/**
 * Prüft, ob das Gelesene eine Kalkulation ist, und füllt auf, was eine ältere
 * Fassung noch nicht hatte. Lieber hier auffangen als später mit einer
 * halben Kalkulation weiterrechnen.
 */
export function kalkulationPruefen(roh) {
  if (!roh || typeof roh !== "object" || !Array.isArray(roh.posten)) {
    throw new Error("Das ist keine Kalkulationsdatei.");
  }
  const kalk = { ...neueKalkulation(), ...roh };
  kalk.kopf = { ...neueKalkulation().kopf, ...(roh.kopf || {}) };

  // Kennungen müssen eindeutig sein, sonst findet `finden` den falschen Knoten.
  // Eine von Hand bearbeitete Datei darf daran nicht scheitern.
  const gesehen = new Set();
  const durch = liste => {
    for (const k of liste) {
      if (!k.id || gesehen.has(k.id)) k.id = neueId();
      gesehen.add(k.id);
      if (k.art === "block") durch(k.kinder || (k.kinder = []));
    }
  };
  durch(kalk.posten);
  return kalk;
}
