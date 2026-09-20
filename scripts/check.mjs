// Prüft die Oberfläche, bevor gebaut wird.
//
// Nötig, weil `frontendDist` in tauri.conf.json direkt auf src/ zeigt: der
// Ordner wird unverändert eingepackt, es gibt keinen Bundler-Schritt. Ohne
// diese Prüfung bricht ein Tippfehler in index.html den Build nicht ab — man
// bekommt einen tadellos „erfolgreichen“ Installer mit kaputter Oberfläche.
// Geprüft würde sonst allein die Rust-Seite, vom Compiler.
//
// Was hier auffällt:
//   * Syntaxfehler in den Seiten und in den Modulen
//   * Importe, die ins Leere zeigen (falscher Pfad, Datei fehlt)
//   * benannte Importe, die es im Modul gar nicht gibt
//   * mitgelieferte Bibliotheken, die nicht mehr zu src/vendor/SHA256SUMS passen
//   * Tauri-Befehle, die die Oberfläche ruft, die es in lib.rs aber nicht gibt
//
// Der letzte Punkt ist der Grund, warum dieses Skript über docfills Fassung
// hinausgeht: ein `invoke("catalog_refrsh")` ist syntaktisch tadellos und
// scheitert erst, wenn jemand im Katalogfenster auf „Übernehmen“ drückt. Die
// Namen stehen auf beiden Seiten der IPC-Grenze getrennt, also muss sie jemand
// vergleichen.
//
// Was NICHT auffällt: Laufzeitfehler. Ein Feld, das es nicht gibt, oder eine
// Bedingung, die falsch herum steht, findet nur das Ausprobieren. Und die
// Prüfsummen sagen, dass eine Bibliothek unverändert ist — nicht, dass sie
// fehlerfrei ist.
//
// Es wird nichts geschrieben (`write: false`) und nichts in src/ abgelegt —
// alles, was dort liegt, landet sonst im Installer.

import { build } from "esbuild";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import path from "node:path";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const LIB = fileURLToPath(new URL("../src-tauri/src/lib.rs", import.meta.url));

// Die Seiten tragen ihr Skript inline, damit sie ohne Bauschritt auskommen.
// `resolveDir` sorgt dafür, dass ./rechnen.js & Co. trotzdem aufgelöst werden.
const MODULE_SCRIPT = /<script type="module">([\s\S]*?)<\/script>/g;

async function seitePruefen(datei) {
  const html = await readFile(path.join(SRC, datei), "utf8");
  const skripte = [...html.matchAll(MODULE_SCRIPT)].map(m => m[1]);
  if (!skripte.length) return [`${datei}: kein <script type="module"> gefunden`];

  const probleme = [];
  for (const [i, inhalt] of skripte.entries()) {
    const wo = skripte.length > 1 ? `${datei} (Skript ${i + 1})` : datei;
    try {
      await build({
        stdin: { contents: inhalt, resolveDir: SRC, sourcefile: datei, loader: "js" },
        bundle: true,
        write: false,
        format: "esm",
        // Die Seiten benutzen `await` auf oberster Ebene (die Nutzlast des
        // Fensters), was nur in einem Modul erlaubt ist.
        target: "es2022",
        logLevel: "silent",
      });
    } catch (e) {
      for (const err of e.errors ?? [{ text: String(e) }]) {
        const bei = err.location ? ` (Zeile ${err.location.line})` : "";
        probleme.push(`${wo}${bei}: ${err.text}`);
      }
    }
  }
  return probleme;
}

// Die beiden Seiten der IPC-Grenze vergleichen: was die Oberfläche ruft, muss
// in `generate_handler!` stehen.
async function befehlePruefen() {
  const rust = await readFile(LIB, "utf8");
  const block = /generate_handler!\[([\s\S]*?)\]/.exec(rust);
  if (!block) return ["src-tauri/src/lib.rs: generate_handler![…] nicht gefunden"];
  const bekannt = new Set(
    block[1].split(",").map(s => s.trim()).filter(Boolean)
  );

  const probleme = [];
  const dateien = (await readdir(SRC)).filter(f => f.endsWith(".html") || f.endsWith(".js"));
  for (const datei of dateien) {
    if (datei.startsWith("vendor/")) continue;
    const text = await readFile(path.join(SRC, datei), "utf8");
    // invoke("name"), ruf("name") — beide Formen, einfache und doppelte
    // Anführungszeichen. Ein zusammengesetzter Name wäre hier nicht zu sehen;
    // deshalb gibt es im Projekt keinen.
    for (const m of text.matchAll(/\b(?:invoke|ruf)\(\s*["'`]([a-z_][a-z0-9_]*)["'`]/gi)) {
      if (!bekannt.has(m[1])) {
        probleme.push(`src/${datei}: ruft „${m[1]}“ — diesen Befehl gibt es in lib.rs nicht`);
      }
    }
  }
  return probleme;
}

// Die mitgelieferte Bibliothek liegt als Datei im Baum, nicht in package.json —
// kein Installationsschritt prüft sie also.
async function vendorPruefen() {
  const ordner = path.join(SRC, "vendor");
  let summen;
  try {
    summen = await readFile(path.join(ordner, "SHA256SUMS"), "utf8");
  } catch {
    return ["src/vendor/SHA256SUMS fehlt — die mitgelieferten Bibliotheken sind ungeprüft"];
  }

  const probleme = [];
  for (const zeile of summen.split("\n")) {
    const treffer = zeile.trim().match(/^([0-9a-f]{64})\s+(\S+)$/);
    if (!treffer) continue;
    const [, erwartet, datei] = treffer;
    try {
      const inhalt = await readFile(path.join(ordner, datei));
      const ist = createHash("sha256").update(inhalt).digest("hex");
      if (ist !== erwartet) {
        probleme.push(`src/vendor/${datei}: Prüfsumme weicht ab (erwartet ${erwartet.slice(0, 12)}…, ist ${ist.slice(0, 12)}…)`);
      }
    } catch {
      probleme.push(`src/vendor/${datei}: steht in SHA256SUMS, fehlt aber`);
    }
  }
  return probleme;
}

const seiten = (await readdir(SRC)).filter(f => f.endsWith(".html")).sort();
const probleme = [
  ...(await Promise.all(seiten.map(seitePruefen))).flat(),
  ...(await befehlePruefen()),
  ...(await vendorPruefen()),
];

if (probleme.length) {
  console.error("Die Oberfläche hat Fehler — es wird nicht gebaut:\n");
  for (const p of probleme) console.error("  " + p);
  console.error("");
  process.exit(1);
}
console.log(`Oberfläche geprüft: ${seiten.join(", ")} — in Ordnung.`);
console.log("Tauri-Befehle: alle gerufenen Namen gibt es in lib.rs.");
console.log("Mitgelieferte Bibliotheken: Prüfsummen stimmen.");
