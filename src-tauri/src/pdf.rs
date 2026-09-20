//! Ein Angebot als PDF — und von dort aus in den Druckdialog.
//!
//! # Warum überhaupt eine PDF
//!
//! Vorher ging der Druck den Weg, den ein Webview von Haus aus anbietet:
//! `NSPrintOperation` über die Seite. Daran hing alles, was an dieser Stelle
//! schiefgehen konnte. Der Drucker gibt nicht das ganze Papier her, sondern
//! nur den erreichbaren Bereich — auf dem Rechner, an dem das entstand, 25 pt
//! weniger in der Höhe. Jede Seite lief über. Und wo die Seite endet, entschied
//! WebKit: mit `break-after:page` kamen aus vier Blättern sieben Seiten, ohne
//! wanderte der Inhalt von Seite zu Seite nach oben.
//!
//! `createPDFWithConfiguration:` geht am Drucksystem vorbei. Der Ausschnitt
//! wird hier vorgegeben, ein Aufruf je Blatt, und die Vorschau rechnet ihre
//! Seitenaufteilung ohnehin selbst aus. Damit ist sie endgültig unsere: eine
//! leere Zwischenseite kann es nicht mehr geben, weil niemand mehr umbricht.
//!
//! Gedruckt wird anschließend die fertige PDF. Das Verkleinern auf den
//! erreichbaren Bereich übernimmt dabei macOS, seitenweise und richtig —
//! `PageScaleDownToFit` verkleinert nur, wo es nötig ist, und lässt sonst die
//! Originalgröße stehen.
//!
//! # Der Maßstab
//!
//! Der Satz rechnet in CSS-Pixeln, eine PDF in Punkten. Welches Verhältnis
//! `createPDF` daraus macht, steht nirgends verlässlich geschrieben — darum
//! wird es nicht angenommen, sondern gemessen: `zusammenlegen` liest die
//! Seitengröße der Aufnahme ab und rechnet sie auf A4 quer um. Stimmt das
//! Verhältnis schon, ist der Maßstab 1 und es passiert nichts.

use std::path::Path;
use std::sync::mpsc::sync_channel;
use std::time::Duration;

use block2::RcBlock;
use objc2::{AllocAnyThread, MainThreadMarker};
use objc2_app_kit::NSPrintInfo;
use objc2_core_foundation::{CFData, CFString, CFURL, CFURLPathStyle, CGPoint, CGRect, CGSize};
use objc2_core_graphics::{
    CGContext, CGDataProvider, CGPDFBox, CGPDFContextClose, CGPDFDocument, CGPDFPage,
};
use objc2_foundation::{NSData, NSError};
use objc2_pdf_kit::{PDFDocument, PDFPrintScalingMode};
use objc2_web_kit::{WKPDFConfiguration, WKWebView};

/// A4 quer in Punkten. Jede erzeugte Seite bekommt genau dieses Maß.
const A4_QUER: CGSize = CGSize { width: 841.89, height: 595.28 };

/// Ein Blattausschnitt, wie die Vorschau ihn sieht — in CSS-Pixeln.
#[derive(serde::Deserialize, Clone, Copy, Debug)]
pub struct Ausschnitt {
    pub x: f64,
    pub y: f64,
    pub breite: f64,
    pub hoehe: f64,
}

/// Nimmt einen Ausschnitt der Vorschau als einseitige PDF auf.
///
/// `with_webview` führt den Block auf dem Hauptthread aus, und dort muss er
/// auch laufen. Der Rückruf von `createPDF` kommt später und ebenfalls dort —
/// deshalb der Kanal: dieser Aufruf wartet auf dem Arbeitsthread, ohne den
/// Hauptthread zu blockieren. Blockierte er ihn, käme der Rückruf nie.
fn blatt_aufnehmen(fenster: &tauri::WebviewWindow, a: Ausschnitt) -> Result<Vec<u8>, String> {
    let (sender, empfang) = sync_channel::<Result<Vec<u8>, String>>(1);

    fenster
        .with_webview(move |plattform| {
            // Sicherheit: der Zeiger kommt von Tauri und zeigt auf die
            // WKWebView dieses Fensters, solange das Fenster lebt. Der Block
            // läuft auf dem Hauptthread, wo AppKit ihn erwartet.
            let web: &WKWebView = unsafe { &*(plattform.inner() as *const WKWebView) };

            // Der Block läuft auf dem Hauptthread — hier ist die Zusicherung
            // dafür zu haben, die `WKPDFConfiguration` verlangt.
            let Some(mtm) = MainThreadMarker::new() else {
                let _ = sender.send(Err(
                    "Die Aufnahme muss vom Hauptthread aus laufen.".to_string()
                ));
                return;
            };
            let konfig = unsafe { WKPDFConfiguration::new(mtm) };
            unsafe {
                konfig.setRect(CGRect {
                    origin: CGPoint { x: a.x, y: a.y },
                    size: CGSize { width: a.breite, height: a.hoehe },
                });
            }

            let rueckruf = RcBlock::new(move |daten: *mut NSData, fehler: *mut NSError| {
                let ergebnis = if daten.is_null() {
                    Err(if fehler.is_null() {
                        "Die Seite ließ sich nicht aufnehmen.".to_string()
                    } else {
                        unsafe { (*fehler).localizedDescription() }.to_string()
                    })
                } else {
                    Ok(unsafe { (*daten).to_vec() })
                };
                let _ = sender.send(ergebnis);
            });

            unsafe { web.createPDFWithConfiguration_completionHandler(Some(&konfig), &rueckruf) };
        })
        .map_err(|e| format!("Die Vorschau war nicht erreichbar: {e}"))?;

    empfang
        .recv_timeout(Duration::from_secs(30))
        .map_err(|_| "Die Seite ließ sich nicht aufnehmen: keine Antwort.".to_string())?
}

/// Legt die einseitigen Aufnahmen zu einem Dokument zusammen, jede Seite auf
/// A4 quer gerechnet und mittig gesetzt.
fn zusammenlegen(seiten: &[Vec<u8>], ziel: &Path) -> Result<(), String> {
    let pfad = CFString::from_str(&ziel.to_string_lossy());
    let url = CFURL::with_file_system_path(
        None,
        Some(&pfad),
        CFURLPathStyle::CFURLPOSIXPathStyle,
        false,
    )
    .ok_or_else(|| "Der Zielpfad war nicht lesbar.".to_string())?;

    let blatt = CGRect { origin: CGPoint { x: 0.0, y: 0.0 }, size: A4_QUER };
    let ctx = unsafe { objc2_core_graphics::CGPDFContextCreateWithURL(Some(&url), &blatt, None) }
        .ok_or_else(|| "Die PDF-Datei ließ sich nicht anlegen.".to_string())?;

    for roh in seiten {
        let daten = CFData::from_bytes(roh);
        let quelle = CGDataProvider::with_cf_data(Some(&daten))
            .and_then(|p| CGPDFDocument::with_provider(Some(&p)))
            .ok_or_else(|| "Eine aufgenommene Seite war unlesbar.".to_string())?;
        let seite: objc2_core_foundation::CFRetained<CGPDFPage> =
            CGPDFDocument::page(Some(&quelle), 1)
                .ok_or_else(|| "Eine aufgenommene Seite war leer.".to_string())?;

        // Nicht annehmen, sondern ablesen: wie groß die Aufnahme wirklich ist.
        let kasten = CGPDFPage::box_rect(Some(&seite), CGPDFBox::MediaBox);
        let (qb, qh) = (kasten.size.width, kasten.size.height);
        if qb <= 0.0 || qh <= 0.0 {
            return Err("Eine aufgenommene Seite hatte kein Maß.".to_string());
        }
        let massstab = (A4_QUER.width / qb).min(A4_QUER.height / qh);
        let (versatz_x, versatz_y) = (
            (A4_QUER.width - qb * massstab) / 2.0,
            (A4_QUER.height - qh * massstab) / 2.0,
        );

        unsafe {
            CGContext::begin_page(Some(&ctx), &blatt);
            CGContext::save_g_state(Some(&ctx));
            CGContext::translate_ctm(Some(&ctx), versatz_x, versatz_y);
            CGContext::scale_ctm(Some(&ctx), massstab, massstab);
            CGContext::draw_pdf_page(Some(&ctx), Some(&seite));
            CGContext::restore_g_state(Some(&ctx));
            CGContext::end_page(Some(&ctx));
        }
    }

    CGPDFContextClose(Some(&ctx));
    Ok(())
}

/// Öffnet den Druckdialog für eine fertige PDF-Datei.
///
/// `PageScaleDownToFit` ist die richtige der drei Arten: sie verkleinert auf
/// den erreichbaren Bereich, wenn es sein muss, und lässt sonst die
/// Originalgröße stehen. `PageScaleToFit` würde auch vergrößern.
///
/// Gedreht wird nichts (`auto_rotate: false`) — die Seiten sind schon quer,
/// und das Papierformat steht daneben ausdrücklich auf A4 quer.
pub fn drucken(daten: &[u8]) -> Result<(), String> {
    let mtm = MainThreadMarker::new()
        .ok_or_else(|| "Der Druck muss vom Hauptthread aus laufen.".to_string())?;

    let nsdaten = NSData::with_bytes(daten);
    let dok = unsafe { PDFDocument::initWithData(PDFDocument::alloc(), &nsdaten) }
        .ok_or_else(|| "Die erzeugte PDF war nicht lesbar.".to_string())?;

    // Erst das Format, dann die Ausrichtung: `setOrientation` dreht ein bereits
    // gesetztes Papierformat mit.
    let info = NSPrintInfo::sharedPrintInfo();
    info.setPaperSize(CGSize { width: 595.28, height: 841.89 });
    info.setOrientation(objc2_app_kit::NSPaperOrientation::Landscape);
    info.setScalingFactor(1.0);

    let auftrag = unsafe {
        dok.printOperationForPrintInfo_scalingMode_autoRotate(
            Some(&info),
            PDFPrintScalingMode::PageScaleDownToFit,
            false,
            mtm,
        )
    }
    .ok_or_else(|| "Der Druckauftrag ließ sich nicht anlegen.".to_string())?;

    auftrag.setShowsPrintPanel(true);
    auftrag.setShowsProgressPanel(true);
    auftrag.runOperation();
    Ok(())
}

/// Nimmt alle Blätter auf und legt sie in `ziel` ab.
pub fn erzeugen(
    fenster: &tauri::WebviewWindow,
    blaetter: &[Ausschnitt],
    ziel: &Path,
) -> Result<(), String> {
    if blaetter.is_empty() {
        return Err("Es gibt nichts zu drucken.".to_string());
    }
    let mut seiten = Vec::with_capacity(blaetter.len());
    for a in blaetter {
        seiten.push(blatt_aufnehmen(fenster, *a)?);
    }
    zusammenlegen(&seiten, ziel)
}
