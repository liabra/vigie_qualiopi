import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { Formations, GestionPrescripteurs } from "../Sessions.jsx";
import { Alert, LoadingState, PageHeader } from "../ui/index.js";
import { useTitrePage } from "./titre.js";

// Formations et Prescripteurs sortent de la page Sessions (UX-1A) : même
// code, désormais sur leur propre page, ouverte par défaut.

export function FormationsPage() {
  useTitrePage("Formations");
  const [formations, setFormations] = useState(null);
  const [err, setErr] = useState(null);
  const charger = useCallback(async () => {
    try { setFormations((await api("/api/formations")).formations); } catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => { charger(); }, [charger]);
  return (
    <>
      <PageHeader
        fil={[{ libelle: "Formation" }, { libelle: "Formations" }]}
        titre="Formations"
        description="Catalogue des formations. Réviser une formation crée une nouvelle version ; les sessions existantes gardent la leur."
      />
      {err && <Alert ton="error">{err}</Alert>}
      {formations
        ? <Formations formations={formations} onChange={charger} erreur={setErr} ouvert />
        : !err && <LoadingState texte="Chargement des formations…" />}
    </>
  );
}

export function PrescripteursPage() {
  useTitrePage("Prescripteurs");
  const [prescripteurs, setPrescripteurs] = useState(null);
  const [err, setErr] = useState(null);
  const charger = useCallback(async () => {
    try { setPrescripteurs((await api("/api/prescripteurs")).prescripteurs); } catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => { charger(); }, [charger]);
  return (
    <>
      <PageHeader
        fil={[{ libelle: "Paramètres" }, { libelle: "Prescripteurs" }]}
        titre="Prescripteurs"
        description="Liste proposée lors de l'inscription d'un stagiaire. Désactiver un prescripteur ne modifie pas les inscriptions existantes."
      />
      {err && <Alert ton="error">{err}</Alert>}
      {prescripteurs
        ? <GestionPrescripteurs prescripteurs={prescripteurs} onChange={charger} erreur={setErr} ouvert />
        : !err && <LoadingState texte="Chargement des prescripteurs…" />}
    </>
  );
}
