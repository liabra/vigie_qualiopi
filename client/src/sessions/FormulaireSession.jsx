import { Field, FormSection } from "../ui/index.js";
import { STATUTS_SESSION } from "./format.js";

// Champs d'une session, partagés par la création et la modification.
// Mêmes champs métier qu'avant UX-2 ; seule la présentation change.
export const SESSION_VIDE = {
  formation_id: "", reference: "", date_debut: "", date_fin: "",
  lieu: "", formateur: "", duree_heures_reelle: "", horaire: "",
};

export const valeursDepuisSession = (s) => ({
  reference: s.reference || "", date_debut: s.date_debut, date_fin: s.date_fin,
  lieu: s.lieu || "", formateur: s.formateur || "",
  duree_heures_reelle: s.duree_heures_reelle ?? "", horaire: s.horaire || "", statut: s.statut,
});

// Contrôles côté client limités à ce que l'écran vérifiait déjà ; le
// serveur reste seul juge (dates, bornes des absences/évaluations…).
export function erreursSession(v, mode) {
  const e = {};
  if (mode === "creation" && !v.formation_id) e.formation_id = "Choisissez une formation.";
  if (!v.date_debut) e.date_debut = "La date de début est obligatoire.";
  if (!v.date_fin) e.date_fin = "La date de fin est obligatoire.";
  return e;
}

export function FormulaireSession({ mode, valeurs, onChange, formations = [], erreurs = {} }) {
  const champ = (cle) => (e) => onChange({ ...valeurs, [cle]: e.target.value });
  return (
    <div className="ui-form">
      <FormSection titre="Formation">
        {mode === "creation" && (
          <Field label="Formation" erreur={erreurs.formation_id}>
            <select value={valeurs.formation_id} onChange={champ("formation_id")} required>
              <option value="">Choisir une formation…</option>
              {formations.map((f) => <option key={f.id} value={f.id}>{f.intitule} (version {f.version_numero})</option>)}
            </select>
          </Field>
        )}
        <Field label="Référence" facultatif aide="Identifiant interne de la session, imprimé sur les documents.">
          <input value={valeurs.reference} onChange={champ("reference")} />
        </Field>
      </FormSection>

      <FormSection titre="Planning">
        <Field label="Date de début" erreur={erreurs.date_debut}>
          <input type="date" value={valeurs.date_debut} onChange={champ("date_debut")} required />
        </Field>
        <Field label="Date de fin" erreur={erreurs.date_fin}>
          <input type="date" value={valeurs.date_fin} onChange={champ("date_fin")} required />
        </Field>
        <Field label="Horaire" facultatif>
          <input value={valeurs.horaire} onChange={champ("horaire")} placeholder="8h30–12h00 / 13h00–16h30" />
        </Field>
        <Field label="Durée prévue (heures)" facultatif aide="À défaut, la durée par défaut de la formation est utilisée.">
          <input type="number" min="0" step="0.5" inputMode="decimal" value={valeurs.duree_heures_reelle} onChange={champ("duree_heures_reelle")} />
        </Field>
      </FormSection>

      <FormSection titre="Organisation">
        <Field label="Lieu" facultatif>
          <input value={valeurs.lieu} onChange={champ("lieu")} />
        </Field>
        <Field label="Formateur" facultatif>
          <input value={valeurs.formateur} onChange={champ("formateur")} />
        </Field>
      </FormSection>

      {mode === "modification" && (
        <FormSection titre="Suivi">
          <Field label="Statut" aide="Le statut n'est jamais modifié automatiquement : il reflète votre décision.">
            <select value={valeurs.statut} onChange={champ("statut")}>
              {Object.entries(STATUTS_SESSION).map(([v, s]) => <option key={v} value={v}>{s.libelle}</option>)}
            </select>
          </Field>
        </FormSection>
      )}
    </div>
  );
}
