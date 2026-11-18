// Archive ZIP minimale (méthode « deflate »), sans dépendance : suffisante pour un dossier d'audit
// (quelques fichiers texte). Les noms de fichiers sont fixés par le code, jamais par l'utilisateur.
import zlib from "node:zlib";

export function creerZip(fichiers) {
  const locaux = []; const centraux = []; let decalage = 0;
  const maintenant = new Date();
  const heure = (maintenant.getHours() << 11) | (maintenant.getMinutes() << 5) | (maintenant.getSeconds() >> 1);
  const jour = ((maintenant.getFullYear() - 1980) << 9) | ((maintenant.getMonth() + 1) << 5) | maintenant.getDate();
  for (const { nom, contenu } of fichiers) {
    const donnees = Buffer.isBuffer(contenu) ? contenu : Buffer.from(String(contenu), "utf8");
    const compresse = zlib.deflateRawSync(donnees);
    const crc = zlib.crc32(donnees);
    const n = Buffer.from(nom, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(heure, 10); local.writeUInt16LE(jour, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compresse.length, 18); local.writeUInt32LE(donnees.length, 22); local.writeUInt16LE(n.length, 26); local.writeUInt16LE(0, 28);
    locaux.push(local, n, compresse);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(8, 10);
    central.writeUInt16LE(heure, 12); central.writeUInt16LE(jour, 14); central.writeUInt32LE(crc, 16); central.writeUInt32LE(compresse.length, 20);
    central.writeUInt32LE(donnees.length, 24); central.writeUInt16LE(n.length, 28); central.writeUInt32LE(decalage, 42);
    centraux.push(central, n);
    decalage += local.length + n.length + compresse.length;
  }
  const tailleCentral = centraux.reduce((s, b) => s + b.length, 0);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(fichiers.length, 8); fin.writeUInt16LE(fichiers.length, 10);
  fin.writeUInt32LE(tailleCentral, 12); fin.writeUInt32LE(decalage, 16);
  return Buffer.concat([...locaux, ...centraux, fin]);
}

// CSV « ; » (Excel français), champs protégés contre l'injection de formules (=, +, -, @ en tête).
export function csv(entetes, lignes) {
  const cellule = (v) => {
    let t = v === null || v === undefined ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; // fix : injection de formule dans un tableur
    return /[";\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return "﻿" + [entetes, ...lignes].map((l) => l.map(cellule).join(";")).join("\r\n") + "\r\n";
}

export const echapperHtml = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
