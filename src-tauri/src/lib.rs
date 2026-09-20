// Kalkula — die Rust-Seite.
//
// WAS HIER NICHT PASSIERT
//   Rust liest keine Tabelle und rechnet nichts aus. Es kennt weder eine
//   Preisliste noch eine Position noch einen Zuschlag. Es reicht Bytes durch,
//   öffnet Fenster und merkt sich zwei Pfade. Von den Dateitypen kennt es nur
//   die Endungen, und die allein für die beiden nativen Dialoge.
//
//   Das ist dieselbe Arbeitsteilung wie in docfill und aus demselben Grund:
//   Tabellenlogik in zwei Sprachen zu führen hieße, sie zweimal zu pflegen und
//   an der Grenze zwischen beiden die Fehler zu suchen. Die Oberfläche hat den
//   Katalog, das Rechenmodell und den Satz; Rust hat das Dateisystem.
//
// WAS DIE OBERFLÄCHE NICHT DARF
//   Sie nennt nie einen Pfad. Eine geöffnete Datei bekommt eine Handhabe
//   ("f3"), und nur mit der kann sie überschrieben werden. Ein Ziel aussuchen
//   kann allein der Benutzer, im nativen Dialog. Die Capabilities geben der
//   Oberfläche entsprechend weder Dateisystem noch Dialoge noch Shell frei.

/// Der Druckweg unter macOS: Aufnahme, Zusammenlegen, Dialog.
#[cfg(target_os = "macos")]
mod pdf;

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

#[cfg(unix)]
use std::fs::{DirBuilder, OpenOptions};
#[cfg(unix)]
use std::io::Write;
#[cfg(unix)]
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};

/// Rechte für alles, was Kundendaten trägt: nur der eigene Benutzer. Eine
/// Kalkulation nennt Kunde, Projekt und Preise — das gehört niemandem sonst
/// auf dem Rechner.
#[cfg(unix)]
const DIR_MODE: u32 = 0o700;
#[cfg(unix)]
const FILE_MODE: u32 = 0o600;

/// Eine Preisliste ist ein paar hundert Kilobyte, eine Kalkulation ein paar
/// Dutzend. Die Grenze fängt ab, dass jemand versehentlich eine 2-GB-Datei
/// auswählt und der Webview daran erstickt.
const MAX_DATEI: usize = 40 * 1024 * 1024;

/// Wo eine geöffnete Datei liegt. Die Oberfläche bekommt nur die Handhabe.
///
/// Einträge bleiben, solange das Programm läuft: eine Kalkulation kann über
/// eine Stunde offen sein und soll am Ende dorthin zurückgeschrieben werden,
/// wo sie herkam.
#[derive(Default)]
struct Pfade {
    nach_id: Mutex<HashMap<String, PathBuf>>,
    naechste: Mutex<u64>,
}

/// Nutzlast für ein Nebenfenster, als undurchsichtiges JSON.
///
/// Die beiden Webviews sehen den Speicher des jeweils anderen nicht, also geht
/// die Nutzlast hier durch. Rust schaut nicht hinein — es weiß nicht, was ein
/// Schema ist, und soll es nicht wissen.
#[derive(Default)]
struct Bruecke {
    nutzlast: Mutex<Option<String>>,
}

/// Gibt es etwas zu verlieren? Die Oberfläche meldet es, weil nur hier das
/// Schließen des Fensters abzufangen ist.
#[derive(Default)]
struct Ungespeichert(Mutex<bool>);

/// Eine Datei, wie sie aus dem Öffnen-Dialog zurückkommt.
#[derive(serde::Serialize)]
struct GeoeffneteDatei {
    id: String,
    name: String,
    bytes: Vec<u8>,
    pfad: String,
}

/// Eine Kalkulation kommt als Text zurück, nicht als Bytes: sie ist JSON, und
/// die Oberfläche müsste sie sonst erst selbst entziffern.
#[derive(serde::Serialize)]
struct GeoeffneterText {
    id: String,
    name: String,
    text: String,
}

const FENSTER_DRUCK: &str = "druck";
const FENSTER_KATALOG: &str = "katalog";
const FENSTER_EINST: &str = "einstellungen";

fn intern() -> String {
    "Interner Fehler".to_string()
}

fn ea_fehler(was: &str, e: std::io::Error) -> String {
    let tat = match was {
        "read" => "gelesen",
        "write" => "geschrieben",
        _ => "geöffnet",
    };
    match e.kind() {
        std::io::ErrorKind::PermissionDenied => {
            format!("Keine Berechtigung — die Datei konnte nicht {tat} werden.")
        }
        std::io::ErrorKind::NotFound => "Die Datei gibt es nicht (mehr).".to_string(),
        _ => format!("Die Datei konnte nicht {tat} werden: {e}"),
    }
}

// ---------------------------------------------------------------------------
// EINSTELLUNGEN
// ---------------------------------------------------------------------------
//
// Zwei Kleinigkeiten überleben das Schließen: der Absender und der Pfad der
// zuletzt benutzten Preisliste. Beides steht in einer JSON-Datei im
// Datenordner — kein Format, das jemand von Hand pflegen soll, aber eines, das
// man sich ansehen kann, wenn etwas klemmt.

fn daten_ordner(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|_| "Der Datenordner wurde nicht gefunden.".to_string())
}

fn einstellungen_pfad(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(daten_ordner(app)?.join("einstellungen.json"))
}

fn einstellungen_lesen(app: &tauri::AppHandle) -> HashMap<String, String> {
    einstellungen_pfad(app)
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

fn einstellungen_schreiben(
    app: &tauri::AppHandle,
    werte: &HashMap<String, String>,
) -> Result<(), String> {
    let pfad = einstellungen_pfad(app)?;
    if let Some(ordner) = pfad.parent() {
        eigener_ordner(ordner)?;
    }
    let text = serde_json::to_string_pretty(werte).map_err(|_| intern())?;
    eigene_datei(&pfad, text.as_bytes())
}

#[tauri::command]
async fn settings_get(app: tauri::AppHandle, schluessel: String) -> Result<Option<String>, String> {
    Ok(einstellungen_lesen(&app).get(&schluessel).cloned())
}

#[tauri::command]
async fn settings_set(
    app: tauri::AppHandle,
    schluessel: String,
    wert: String,
) -> Result<(), String> {
    // Nicht unbegrenzt: eine Einstellung ist eine Zeile, kein Ablageort.
    if wert.len() > 8 * 1024 {
        return Err("Der Wert ist zu lang.".into());
    }
    let mut werte = einstellungen_lesen(&app);
    werte.insert(schluessel, wert);
    einstellungen_schreiben(&app, &werte)
}

/// Legt einen Ordner an, den nur der eigene Benutzer betreten darf.
fn eigener_ordner(pfad: &Path) -> Result<(), String> {
    if pfad.exists() {
        return Ok(());
    }
    #[cfg(unix)]
    {
        DirBuilder::new()
            .recursive(true)
            .mode(DIR_MODE)
            .create(pfad)
            .map_err(|e| ea_fehler("write", e))
    }
    #[cfg(not(unix))]
    {
        fs::create_dir_all(pfad).map_err(|e| ea_fehler("write", e))
    }
}

/// Schreibt eine Datei, die nur der eigene Benutzer lesen darf.
fn eigene_datei(pfad: &Path, bytes: &[u8]) -> Result<(), String> {
    #[cfg(unix)]
    {
        let mut datei = OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(FILE_MODE)
            .open(pfad)
            .map_err(|e| ea_fehler("write", e))?;
        datei.write_all(bytes).map_err(|e| ea_fehler("write", e))
    }
    #[cfg(not(unix))]
    {
        fs::write(pfad, bytes).map_err(|e| ea_fehler("write", e))
    }
}

// ---------------------------------------------------------------------------
// DATEIEN
// ---------------------------------------------------------------------------

/// Die Dialoge des Systems sind blockierend; sie laufen deshalb in einem
/// eigenen Kanal und das Ergebnis kommt zurück.
fn dialog_oeffnen(app: &tauri::AppHandle, was: &str, endungen: &[&str]) -> Option<PathBuf> {
    let (sender, empfaenger) = std::sync::mpsc::channel();
    app.dialog()
        .file()
        .add_filter(was, endungen)
        .pick_file(move |gewaehlt| {
            let _ = sender.send(gewaehlt);
        });
    empfaenger
        .recv()
        .ok()
        .flatten()
        .and_then(|p| p.into_path().ok())
}

fn dialog_speichern(app: &tauri::AppHandle, name: &str) -> Option<PathBuf> {
    let (sender, empfaenger) = std::sync::mpsc::channel();
    app.dialog()
        .file()
        .add_filter("Kalkulation", &["kalk"])
        .set_file_name(name)
        .save_file(move |gewaehlt| {
            let _ = sender.send(gewaehlt);
        });
    empfaenger
        .recv()
        .ok()
        .flatten()
        .and_then(|p| p.into_path().ok())
}

fn merken(pfade: &tauri::State<'_, Pfade>, pfad: PathBuf) -> Result<String, String> {
    let id = {
        let mut n = pfade.naechste.lock().map_err(|_| intern())?;
        *n += 1;
        format!("f{n}")
    };
    pfade
        .nach_id
        .lock()
        .map_err(|_| intern())?
        .insert(id.clone(), pfad);
    Ok(id)
}

fn dateiname(pfad: &Path) -> String {
    pfad.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn lesen_begrenzt(pfad: &Path) -> Result<Vec<u8>, String> {
    let groesse = fs::metadata(pfad).map(|m| m.len()).unwrap_or(0);
    if groesse as usize > MAX_DATEI {
        return Err(format!(
            "Die Datei ist zu groß ({} MB). Mehr als {} MB werden nicht gelesen.",
            groesse / 1024 / 1024,
            MAX_DATEI / 1024 / 1024
        ));
    }
    fs::read(pfad).map_err(|e| ea_fehler("read", e))
}

/// Preisliste auswählen. Der Pfad geht mit zurück, damit die Oberfläche ihn
/// zum Merken weiterreichen kann — lesen kann sie damit nichts: `write_back`
/// und Freunde nehmen ausschließlich Handhaben.
#[tauri::command]
async fn pick_catalog(app: tauri::AppHandle) -> Result<Option<GeoeffneteDatei>, String> {
    let Some(pfad) = dialog_oeffnen(&app, "Preisliste", &["xlsx", "xlsm"]) else {
        return Ok(None);
    };
    let bytes = lesen_begrenzt(&pfad)?;
    Ok(Some(GeoeffneteDatei {
        id: String::new(),
        name: dateiname(&pfad),
        bytes,
        pfad: pfad.to_string_lossy().into_owned(),
    }))
}

/// Merkt den Pfad der zuletzt benutzten Preisliste.
#[tauri::command]
async fn catalog_remember(app: tauri::AppHandle, pfad: String) -> Result<(), String> {
    let mut werte = einstellungen_lesen(&app);
    werte.insert("preisliste".into(), pfad);
    einstellungen_schreiben(&app, &werte)
}

/// Lädt die zuletzt benutzte Preisliste, wenn es sie noch gibt.
///
/// Gibt es sie nicht mehr, ist das kein Fehler: die Datei wurde verschoben
/// oder liegt auf einem Netzlaufwerk, das gerade nicht da ist. Dann fängt man
/// eben mit „Auswählen …“ an, statt eine Fehlermeldung wegzuklicken.
#[tauri::command]
async fn catalog_recall(app: tauri::AppHandle) -> Result<Option<GeoeffneteDatei>, String> {
    let Some(pfad) = einstellungen_lesen(&app).get("preisliste").cloned() else {
        return Ok(None);
    };
    let pfad = PathBuf::from(pfad);
    if !pfad.is_file() {
        return Ok(None);
    }
    let bytes = lesen_begrenzt(&pfad)?;
    Ok(Some(GeoeffneteDatei {
        id: String::new(),
        name: dateiname(&pfad),
        bytes,
        pfad: String::new(),
    }))
}

// ---------------------------------------------------------------------------
// LOGO
// ---------------------------------------------------------------------------
//
// Das Logo steht oben links auf jedem Angebot. Es gehört — wie der Absender —
// zum Programm und nicht zur einzelnen Kalkulation, wird also einmal gewählt
// und dann behalten.
//
// Gespeichert wird eine KOPIE im Datenordner, nicht der Pfad. Das abgelöste
// Makro verlangte, dass `AAR_Logo.png` neben der Arbeitsmappe liegt, und ließ
// das Logo wortlos weg, sobald die Datei verschoben wurde. Eine Kopie kann
// nicht verschwinden.

/// So groß darf ein Logo sein. Es wird als data:-URI in die Seite gereicht,
/// und eine 20-MB-Datei ginge dort als 27 MB Text durch.
const MAX_LOGO: usize = 2 * 1024 * 1024;

fn logo_pfad(app: &tauri::AppHandle, endung: &str) -> Result<PathBuf, String> {
    Ok(daten_ordner(app)?.join(format!("logo.{endung}")))
}

/// Bytes zu einem data:-URI. Der Webview darf `data:` als Bildquelle laden
/// (siehe `img-src` in der CSP), eine Datei von der Platte dagegen nicht.
fn als_daten_uri(bytes: &[u8], endung: &str) -> String {
    use base64::Engine;
    let typ = match endung {
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "webp" => "image/webp",
        _ => "image/png",
    };
    format!(
        "data:{typ};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    )
}

#[tauri::command]
async fn logo_pick(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let Some(pfad) = dialog_oeffnen(&app, "Bild", &["png", "jpg", "jpeg", "gif", "svg", "webp"])
    else {
        return Ok(None);
    };
    let bytes = fs::read(&pfad).map_err(|e| ea_fehler("read", e))?;
    if bytes.len() > MAX_LOGO {
        return Err(format!(
            "Das Bild ist zu groß ({} KB). Mehr als {} MB werden nicht übernommen.",
            bytes.len() / 1024,
            MAX_LOGO / 1024 / 1024
        ));
    }
    let endung = pfad
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_else(|| "png".into());

    // Ein früheres Logo mit anderer Endung muss weg, sonst lägen zwei da und
    // `logo_get` fände das falsche.
    logo_entfernen(&app);
    let ziel = logo_pfad(&app, &endung)?;
    if let Some(ordner) = ziel.parent() {
        eigener_ordner(ordner)?;
    }
    eigene_datei(&ziel, &bytes)?;

    let mut werte = einstellungen_lesen(&app);
    werte.insert("logo".into(), endung.clone());
    einstellungen_schreiben(&app, &werte)?;
    Ok(Some(als_daten_uri(&bytes, &endung)))
}

#[tauri::command]
async fn logo_get(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let Some(endung) = einstellungen_lesen(&app).get("logo").cloned() else {
        return Ok(None);
    };
    let pfad = logo_pfad(&app, &endung)?;
    // Fehlt die Kopie, ist das kein Fehler — dann gibt es eben kein Logo.
    let Ok(bytes) = fs::read(&pfad) else {
        return Ok(None);
    };
    Ok(Some(als_daten_uri(&bytes, &endung)))
}

#[tauri::command]
async fn logo_clear(app: tauri::AppHandle) -> Result<(), String> {
    logo_entfernen(&app);
    let mut werte = einstellungen_lesen(&app);
    werte.remove("logo");
    einstellungen_schreiben(&app, &werte)
}

fn logo_entfernen(app: &tauri::AppHandle) {
    for endung in ["png", "jpg", "jpeg", "gif", "svg", "webp"] {
        if let Ok(p) = logo_pfad(app, endung) {
            let _ = fs::remove_file(p);
        }
    }
}

/// Kalkulation öffnen.
#[tauri::command]
async fn pick_calculation(
    app: tauri::AppHandle,
    pfade: tauri::State<'_, Pfade>,
) -> Result<Option<GeoeffneterText>, String> {
    let Some(pfad) = dialog_oeffnen(&app, "Kalkulation", &["kalk", "json"]) else {
        return Ok(None);
    };
    let bytes = lesen_begrenzt(&pfad)?;
    let text = String::from_utf8(bytes)
        .map_err(|_| "Die Datei ist keine Kalkulation (kein lesbarer Text).".to_string())?;
    let name = dateiname(&pfad);
    let id = merken(&pfade, pfad)?;
    Ok(Some(GeoeffneterText { id, name, text }))
}

/// Kalkulation unter einem neuen Namen speichern.
#[tauri::command]
async fn save_calculation(
    app: tauri::AppHandle,
    pfade: tauri::State<'_, Pfade>,
    name: String,
    text: String,
) -> Result<Option<GeoeffneterText>, String> {
    let Some(pfad) = dialog_speichern(&app, &name) else {
        return Ok(None);
    };
    ueberschreiben(&pfad, text.as_bytes())?;
    let name = dateiname(&pfad);
    let id = merken(&pfade, pfad)?;
    Ok(Some(GeoeffneterText {
        id,
        name,
        text: String::new(),
    }))
}

/// Über die Datei schreiben, aus der die Kalkulation kam — ohne zu fragen, das
/// ist der Sinn von „Speichern“. Nur eine Handhabe aus `pick_calculation` oder
/// `save_calculation` nennt einen Pfad.
#[tauri::command]
async fn write_calculation(
    pfade: tauri::State<'_, Pfade>,
    id: String,
    text: String,
) -> Result<String, String> {
    let pfad = pfade
        .nach_id
        .lock()
        .map_err(|_| intern())?
        .get(&id)
        .cloned()
        .ok_or_else(|| {
            "Zu dieser Datei ist kein Pfad bekannt — sie wurde nicht über den Dialog geöffnet."
                .to_string()
        })?;
    ueberschreiben(&pfad, text.as_bytes())?;
    Ok(dateiname(&pfad))
}

/// Daneben schreiben, dann darüberschieben: bricht das Schreiben ab, ist die
/// alte Fassung noch vollständig da. `fs::rename` ersetzt eine vorhandene
/// Datei unter Windows wie unter Unix.
fn ueberschreiben(pfad: &Path, bytes: &[u8]) -> Result<(), String> {
    let vorlaeufig = pfad.with_extension("kalk-neu");
    eigene_datei(&vorlaeufig, bytes)?;
    fs::rename(&vorlaeufig, pfad).map_err(|e| {
        let _ = fs::remove_file(&vorlaeufig);
        ea_fehler("write", e)
    })
}

// ---------------------------------------------------------------------------
// FENSTER
// ---------------------------------------------------------------------------

#[tauri::command]
async fn open_print_window(
    app: tauri::AppHandle,
    bruecke: tauri::State<'_, DruckBruecke>,
    payload: String,
) -> Result<(), String> {
    *bruecke.0.nutzlast.lock().map_err(|_| intern())? = Some(payload.clone());
    // Ein bereits offenes Druckfenster wird nicht mehr geschlossen und neu
    // gebaut, sondern an Ort und Stelle nachgezogen: es kann seinen Inhalt
    // inzwischen selbst neu zeichnen. Das spart das Aufblitzen und behält die
    // Bildlaufstelle.
    if let Some(w) = app.get_webview_window(FENSTER_DRUCK) {
        let _ = app.emit_to(FENSTER_DRUCK, "kalkula://druck-neu", payload);
        let _ = w.unminimize();
        return w
            .set_focus()
            .map_err(|_| "Das Druckfenster ließ sich nicht öffnen.".to_string());
    }
    tauri::WebviewWindowBuilder::new(
        &app,
        FENSTER_DRUCK,
        tauri::WebviewUrl::App("druck.html".into()),
    )
    .title("Angebot — Druckvorschau")
    // Breit genug, dass ein Blatt (841,68 pt = 1122 px) samt Polster ohne
    // Verkleinerung hineinpasst. Schmaler geht auch — die Vorschau passt sich
    // dann ein und zeigt weiterhin ein vollständiges A4 quer.
    .inner_size(1180.0, 820.0)
    .min_inner_size(620.0, 420.0)
    .build()
    .map(|_| ())
    .map_err(|_| "Das Druckfenster ließ sich nicht öffnen.".to_string())
}

#[tauri::command]
async fn print_payload(bruecke: tauri::State<'_, DruckBruecke>) -> Result<String, String> {
    Ok(bruecke
        .0
        .nutzlast
        .lock()
        .map_err(|_| intern())?
        .clone()
        .unwrap_or_else(|| "{}".into()))
}

/// Sagt dem Druckfenster, dass seine Vorschau nicht mehr zum Arbeitsstand
/// passt. Nur ein Wink — die Nutzlast bleibt, wie sie ist; geholt wird sie
/// erst, wenn jemand auf „Aktualisieren" drückt.
///
/// Ist kein Druckfenster offen, passiert nichts. Das Hauptfenster muss dafür
/// nicht wissen, ob eines offen ist.
#[tauri::command]
async fn print_stale(app: tauri::AppHandle) -> Result<(), String> {
    if app.get_webview_window(FENSTER_DRUCK).is_some() {
        let _ = app.emit_to(FENSTER_DRUCK, "kalkula://druck-veraltet", "");
    }
    Ok(())
}

/// Das Druckfenster bittet um den aktuellen Stand.
#[tauri::command]
async fn print_request(app: tauri::AppHandle) -> Result<(), String> {
    app.emit_to("main", "kalkula://druck", "")
        .map_err(|_| intern())
}

/// Das Hauptfenster schickt ihn.
#[tauri::command]
async fn print_refresh(
    app: tauri::AppHandle,
    bruecke: tauri::State<'_, DruckBruecke>,
    payload: String,
) -> Result<(), String> {
    *bruecke.0.nutzlast.lock().map_err(|_| intern())? = Some(payload.clone());
    app.emit_to(FENSTER_DRUCK, "kalkula://druck-neu", payload)
        .map_err(|_| intern())
}

/// Der Ablageort der Aufnahme.
///
/// Nicht `/tmp`: die Aufnahme trägt Kunde, Projekt und Preise. Der Datenordner
/// gehört dem eigenen Benutzer (0700, siehe `eigener_ordner`), das
/// Systemverzeichnis für Temporäres gehört allen.
#[cfg(target_os = "macos")]
fn druck_pdf(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let ordner = daten_ordner(app)?;
    eigener_ordner(&ordner)?;
    Ok(ordner.join("druck.pdf"))
}

/// Nimmt die Blätter der Vorschau als PDF auf.
///
/// Erster von zwei Schritten, und die Teilung ist der Sinn der Sache: für die
/// Aufnahme legt die Vorschau ihre Bildschirmgestalt ab — die Verkleinerung
/// aus `einpassen()`, die Bühne mit ihrem Bildlauf, der dunkle Grund. Erst
/// danach darf der Dialog aufgehen, sonst stünde das Fenster für dessen ganze
/// Dauer in der Aufnahmegestalt da.
///
/// `blaetter` kommt als JSON und nicht als Liste: so bleibt der Befehl auf
/// allen Plattformen derselbe, auch wo es `pdf::Ausschnitt` gar nicht gibt.
///
/// Gibt `true`, wenn eine Aufnahme entstanden ist, und `false`, wo dieser Weg
/// nicht offensteht (Windows, Linux) — dann versucht es die Oberfläche mit
/// `window.print()`.
#[tauri::command]
async fn print_build(app: tauri::AppHandle, blaetter: String) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        let fenster = app
            .get_webview_window(FENSTER_DRUCK)
            .ok_or_else(|| "Das Druckfenster ist nicht offen.".to_string())?;
        let masse: Vec<pdf::Ausschnitt> = serde_json::from_str(&blaetter)
            .map_err(|_| "Die Blattmaße waren nicht lesbar.".to_string())?;
        let ziel = druck_pdf(&app)?;
        pdf::erzeugen(&fenster, &masse, &ziel)?;
        // Dieselbe Strenge wie bei einer gespeicherten Kalkulation: der
        // PDF-Kontext legt die Datei mit den üblichen Rechten an, hier wird
        // sie auf den eigenen Benutzer zurückgenommen.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&ziel, fs::Permissions::from_mode(FILE_MODE));
        }
        Ok(true)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, blaetter);
        Ok(false)
    }
}

/// Öffnet den Druckdialog für die aufgenommene PDF.
///
/// Zweiter Schritt; `print_build` muss vorher gelaufen sein. Gedruckt wird die
/// fertige PDF und nicht mehr der Webview: das Papierformat und das
/// Verkleinern auf den erreichbaren Bereich macht macOS, seitenweise und
/// richtig — siehe `pdf::drucken`.
///
/// AppKit gehört auf den Hauptthread, ein Befehl läuft dort nicht. Der Kanal
/// holt das Ergebnis zurück; er wartet, solange der Dialog offen steht, und
/// blockiert dabei das Arbeitsgespann und nicht den Hauptthread.
#[tauri::command]
async fn print_now(app: tauri::AppHandle) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        let pfad = druck_pdf(&app)?;
        let daten =
            fs::read(&pfad).map_err(|_| "Es liegt nichts zum Drucken bereit.".to_string())?;
        // PDFKit hält die Bytes im Speicher; auf der Platte hat die Aufnahme
        // nichts mehr verloren.
        let _ = fs::remove_file(&pfad);

        let (sender, empfang) = std::sync::mpsc::sync_channel::<Result<(), String>>(1);
        app.run_on_main_thread(move || {
            let _ = sender.send(pdf::drucken(&daten));
        })
        .map_err(|e| format!("Der Druckdialog ließ sich nicht öffnen: {e}"))?;
        empfang
            .recv()
            .map_err(|_| "Der Druckdialog ließ sich nicht öffnen.".to_string())??;
        Ok(true)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Ok(false)
    }
}

#[tauri::command]
async fn close_print_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(FENSTER_DRUCK) {
        let _ = w.close();
    }
    Ok(())
}

#[tauri::command]
async fn open_catalog_window(
    app: tauri::AppHandle,
    bruecke: tauri::State<'_, KatalogBruecke>,
    payload: String,
) -> Result<(), String> {
    *bruecke.0.nutzlast.lock().map_err(|_| intern())? = Some(payload);
    if let Some(w) = app.get_webview_window(FENSTER_KATALOG) {
        let _ = w.unminimize();
        return w
            .set_focus()
            .map_err(|_| "Das Katalogfenster ließ sich nicht öffnen.".to_string());
    }
    tauri::WebviewWindowBuilder::new(
        &app,
        FENSTER_KATALOG,
        tauri::WebviewUrl::App("katalog.html".into()),
    )
    .title("Preisliste")
    .inner_size(660.0, 720.0)
    .min_inner_size(480.0, 400.0)
    .build()
    .map(|_| ())
    .map_err(|_| "Das Katalogfenster ließ sich nicht öffnen.".to_string())
}

#[tauri::command]
async fn catalog_payload(bruecke: tauri::State<'_, KatalogBruecke>) -> Result<String, String> {
    Ok(bruecke
        .0
        .nutzlast
        .lock()
        .map_err(|_| intern())?
        .clone()
        .unwrap_or_else(|| "{}".into()))
}

/// Das Katalogfenster schickt ein korrigiertes Schema ans Hauptfenster.
#[tauri::command]
async fn catalog_submit(app: tauri::AppHandle, payload: String) -> Result<(), String> {
    app.emit_to("main", "kalkula://katalog", payload)
        .map_err(|_| intern())
}

/// Das Hauptfenster schickt den neu gelesenen Stand zurück ans Katalogfenster.
#[tauri::command]
async fn catalog_refresh(
    app: tauri::AppHandle,
    bruecke: tauri::State<'_, KatalogBruecke>,
    payload: String,
) -> Result<(), String> {
    *bruecke.0.nutzlast.lock().map_err(|_| intern())? = Some(payload.clone());
    app.emit_to(FENSTER_KATALOG, "kalkula://katalog-neu", payload)
        .map_err(|_| intern())
}

#[tauri::command]
async fn close_catalog_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(FENSTER_KATALOG) {
        let _ = w.close();
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// EINSTELLUNGSFENSTER
// ---------------------------------------------------------------------------
//
// Dieselbe Brücke wie beim Katalogfenster und aus demselben Grund: die beiden
// Webviews sehen den Speicher des jeweils anderen nicht.
//
// Die Textfelder — Kopfzeile, Fußzeile — und das Logo liest und schreibt das
// Fenster selbst über `settings_*` und `logo_*`; dafür braucht es das
// Hauptfenster nicht. Nur die Preisliste geht über `settings_submit` dorthin
// zurück: gelesen und ausgewertet wird eine Tabelle an genau einer Stelle, und
// das ist das Hauptfenster. Die Bytes zweimal durch die IPC-Grenze zu schieben
// wäre nicht nur langsam, es gäbe auch zwei Stände desselben Katalogs.

#[tauri::command]
async fn open_settings_window(
    app: tauri::AppHandle,
    bruecke: tauri::State<'_, EinstBruecke>,
    payload: String,
) -> Result<(), String> {
    *bruecke.0.nutzlast.lock().map_err(|_| intern())? = Some(payload);
    if let Some(w) = app.get_webview_window(FENSTER_EINST) {
        let _ = w.unminimize();
        return w
            .set_focus()
            .map_err(|_| "Das Einstellungsfenster ließ sich nicht öffnen.".to_string());
    }
    tauri::WebviewWindowBuilder::new(
        &app,
        FENSTER_EINST,
        tauri::WebviewUrl::App("einstellungen.html".into()),
    )
    .title("Einstellungen")
    .inner_size(520.0, 640.0)
    .min_inner_size(420.0, 420.0)
    .build()
    .map(|_| ())
    .map_err(|_| "Das Einstellungsfenster ließ sich nicht öffnen.".to_string())
}

#[tauri::command]
async fn settings_window_payload(bruecke: tauri::State<'_, EinstBruecke>) -> Result<String, String> {
    Ok(bruecke
        .0
        .nutzlast
        .lock()
        .map_err(|_| intern())?
        .clone()
        .unwrap_or_else(|| "{}".into()))
}

/// Das Einstellungsfenster bittet das Hauptfenster um etwas, das nur dort
/// geht — eine Preisliste auswählen oder das Katalogfenster öffnen.
#[tauri::command]
async fn settings_submit(app: tauri::AppHandle, payload: String) -> Result<(), String> {
    app.emit_to("main", "kalkula://einstellungen", payload)
        .map_err(|_| intern())
}

/// Das Hauptfenster schickt den neuen Stand zurück ans Einstellungsfenster.
#[tauri::command]
async fn settings_window_refresh(
    app: tauri::AppHandle,
    bruecke: tauri::State<'_, EinstBruecke>,
    payload: String,
) -> Result<(), String> {
    *bruecke.0.nutzlast.lock().map_err(|_| intern())? = Some(payload.clone());
    app.emit_to(FENSTER_EINST, "kalkula://einstellungen-neu", payload)
        .map_err(|_| intern())
}

#[tauri::command]
async fn close_settings_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(FENSTER_EINST) {
        let _ = w.close();
    }
    Ok(())
}

#[tauri::command]
async fn set_dirty(zustand: tauri::State<'_, Ungespeichert>, dirty: bool) -> Result<(), String> {
    *zustand.0.lock().map_err(|_| intern())? = dirty;
    Ok(())
}

#[tauri::command]
fn app_version(app: tauri::AppHandle) -> String {
    app.package_info().version.to_string()
}

// Zwei Brücken, damit Druck- und Katalogfenster sich nicht gegenseitig die
// Nutzlast überschreiben. Newtypes, weil `manage` nach Typ unterscheidet und
// zweimal `Bruecke` dieselbe Ablage wäre.
#[derive(Default)]
struct DruckBruecke(Bruecke);
#[derive(Default)]
struct KatalogBruecke(Bruecke);
#[derive(Default)]
struct EinstBruecke(Bruecke);

/// Merkt sich, ob schon gefragt wurde — sonst stapelten sich bei zwei schnellen
/// Klicks auf das Schließkreuz zwei Dialoge übereinander.
static FRAGT_GERADE: OnceLock<Mutex<bool>> = OnceLock::new();

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Pfade::default())
        .manage(DruckBruecke::default())
        .manage(KatalogBruecke::default())
        .manage(EinstBruecke::default())
        .manage(Ungespeichert::default())
        .setup(|app| {
            if let Some(haupt) = app.get_webview_window("main") {
                let griff = app.handle().clone();
                haupt.on_window_event(move |ereignis| match ereignis {
                    // Mit dem Hauptfenster endet das Programm — und vorher wird
                    // gefragt, wenn etwas zu verlieren ist. Im Webview fängt
                    // `beforeunload` das nicht zuverlässig ab; hier schon.
                    tauri::WindowEvent::CloseRequested { api, .. } => {
                        let schmutzig = griff
                            .try_state::<Ungespeichert>()
                            .map(|z| *z.0.lock().unwrap_or_else(|e| e.into_inner()))
                            .unwrap_or(false);
                        if !schmutzig {
                            return;
                        }
                        api.prevent_close();
                        let sperre = FRAGT_GERADE.get_or_init(|| Mutex::new(false));
                        {
                            let mut offen = sperre.lock().unwrap_or_else(|e| e.into_inner());
                            if *offen {
                                return;
                            }
                            *offen = true;
                        }
                        let griff2 = griff.clone();
                        griff.dialog()
                            .message("Die Kalkulation ist nicht gespeichert. Beim Schließen gehen die Änderungen verloren.")
                            .title("Ungespeicherte Änderungen")
                            .buttons(tauri_plugin_dialog::MessageDialogButtons::OkCancelCustom(
                                "Trotzdem schließen".into(),
                                "Zurück".into(),
                            ))
                            .show(move |schliessen| {
                                if let Some(sperre) = FRAGT_GERADE.get() {
                                    *sperre.lock().unwrap_or_else(|e| e.into_inner()) = false;
                                }
                                if !schliessen {
                                    return;
                                }
                                if let Some(z) = griff2.try_state::<Ungespeichert>() {
                                    *z.0.lock().unwrap_or_else(|e| e.into_inner()) = false;
                                }
                                if let Some(w) = griff2.get_webview_window("main") {
                                    let _ = w.close();
                                }
                            });
                    }
                    // Die Nebenfenster gehören zum Hauptfenster: ohne es haben
                    // sie nichts anzuzeigen. Ausdrücklich beenden, statt darauf
                    // zu bauen, dass Tauri von selbst geht.
                    tauri::WindowEvent::Destroyed => {
                        for w in griff.webview_windows().values() {
                            if w.label() != "main" {
                                let _ = w.close();
                            }
                        }
                        griff.exit(0);
                    }
                    _ => {}
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pick_catalog,
            catalog_remember,
            catalog_recall,
            pick_calculation,
            save_calculation,
            write_calculation,
            open_print_window,
            print_payload,
            close_print_window,
            print_build,
            print_now,
            print_stale,
            print_request,
            print_refresh,
            open_catalog_window,
            catalog_payload,
            catalog_submit,
            catalog_refresh,
            close_catalog_window,
            open_settings_window,
            settings_window_payload,
            settings_submit,
            settings_window_refresh,
            close_settings_window,
            settings_get,
            settings_set,
            logo_pick,
            logo_get,
            logo_clear,
            set_dirty,
            app_version
        ])
        .run(tauri::generate_context!())
        .expect("Kalkula ließ sich nicht starten");
}
