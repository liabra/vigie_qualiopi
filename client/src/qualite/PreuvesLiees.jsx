import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { Alert, Badge, Button, ConfirmDialog, Drawer, Field, LoadingState } from "../ui/index.js";
import { STATUTS_PREUVE } from "../preuves/format.js";

// Lien externe rendu seulement s'il est http(s). // fix
const lienSur = (url) => (typeof url === "string" && /^https?:\/\//i.test(url) ? url : null);

// Section « Preuves » d'une fiche qualité (action ou signalement).
// Seule la RELATION est gérée ici : la preuve, ses fichiers Drive et son
// indicateur ne sont jamais modifiés. `base` : chemin API de l'objet
// (/api/actions-qualite/3, /api/signalements/1). `modifiable` : admin ET
// objet ni clôturé ni annulé (même règle que le serveur).
export function PreuvesLiees({ base, preuves = [], modifiable = false, onChange, idTitre = "preuves-liees" }) {
  const [selecteur, setSelecteur] = useState(false);
  const [aRetirer, setARetirer] = useState(null);
  const [retrait, setRetrait] = useState(false);
  const [erreur, setErreur] = useState(null);

  async function retirer() {
    setRetrait(true);
    setErreur(null);
    try {
      await api(`${base}/preuves/${aRetirer.id}`, { method: "DELETE" });
      setARetirer(null);
      await onChange?.();
    } catch (e) {
      setErreur(e.message);
      setARetirer(null);
    } finally { setRetrait(false); }
  }

  return (
    <section className="qualite-section" aria-labelledby={idTitre}>
      <h2 id={idTitre} className="qualite-section__titre">Preuves</h2>
      <div className="qualite-fiche">
        {modifiable && (
          <div className="preuves-liees__actions">
            <Button compact onClick={() => { setErreur(null); setSelecteur(true); }}>Rattacher une preuve</Button>
            <Link to="/preuves">Créer / importer une preuve</Link>
          </div>
        )}
        {erreur && <Alert ton="error" titre="Le lien n'a pas été retiré.">{erreur}</Alert>}
        {preuves.length === 0 ? <p className="sess-secondaire">Aucune preuve liée.</p> : (
          <ul className="signalement-liste">
            {preuves.map((p) => {
              const st = STATUTS_PREUVE[p.statut_effectif || p.statut];
              const fichiers = (p.fichiers || []).filter((f) => lienSur(f.url));
              return (
                <li key={p.id} className="preuve-liee">
                  <div className="preuve-liee__tete">
                    <strong>{p.titre}</strong>
                    {st && <Badge ton={st.ton}>{st.libelle}</Badge>}
                  </div>
                  <span className="sess-secondaire">
                    Indicateur {p.indicateur}{p.indicateur_libelle ? ` — ${p.indicateur_libelle}` : ""}
                    {p.session_reference ? ` · Session ${p.session_reference}` : ""}
                  </span>
                  {fichiers.length > 0 && (
                    <ul className="preuve-liee__fichiers">
                      {fichiers.map((f) => (
                        <li key={f.id}>
                          <a href={lienSur(f.url)} target="_blank" rel="noopener noreferrer">{f.nom || "Ouvrir sur le Drive"}</a>
                        </li>
                      ))}
                    </ul>
                  )}
                  {modifiable && (
                    <div>
                      <Button compact variante="ghost" aria-label={`Retirer le lien avec la preuve ${p.titre}`}
                        onClick={() => { setErreur(null); setARetirer(p); }}>Retirer le lien</Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {selecteur && (
        <SelecteurPreuve base={base} dejaLiees={preuves.map((p) => p.id)} onFermer={() => setSelecteur(false)}
          onRattachee={async () => { setSelecteur(false); await onChange?.(); }} />
      )}
      <ConfirmDialog ouvert={!!aRetirer} titre="Retirer le lien avec cette preuve ?" libelleConfirmer="Retirer le lien"
        ton="primary" enCours={retrait} onConfirmer={retirer} onAnnuler={() => setARetirer(null)}>
        <p>« {aRetirer?.titre} » ne sera plus liée à cette fiche.</p>
        <p>La preuve elle-même, ses fichiers sur Google Drive et son indicateur restent inchangés.</p>
      </ConfirmDialog>
    </section>
  );
}

// Choix d'une preuve EXISTANTE, par la recherche serveur de /api/preuves
// (titre). Seuls id, titre, indicateur, session et statut sont conservés.
function SelecteurPreuve({ base, dejaLiees, onFermer, onRattachee }) {
  const [q, setQ] = useState("");
  const [resultats, setResultats] = useState(null);
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState(null);
  const [enCours, setEnCours] = useState(null);
  const verrou = useRef(false);

  useEffect(() => {
    const t = q.trim();
    if (t.length < 2) { setResultats(null); return undefined; }
    let actif = true;
    setChargement(true);
    const minuteur = setTimeout(() => {
      api(`/api/preuves?q=${encodeURIComponent(t)}`)
        .then((r) => {
          if (!actif) return;
          setResultats((r.preuves || []).map((p) => ({ id: p.id, titre: p.titre, indicateur: p.indicateur, session_reference: p.session_reference, statut: p.statut_effectif || p.statut })));
          setErreur(null);
        })
        .catch((e) => { if (actif) setErreur(e.message); })
        .finally(() => { if (actif) setChargement(false); });
    }, 250);
    return () => { actif = false; clearTimeout(minuteur); };
  }, [q]);

  async function rattacher(p) {
    if (verrou.current) return; // fix : jamais de double rattachement
    verrou.current = true;
    setEnCours(p.id);
    setErreur(null);
    try {
      await api(`${base}/preuves`, { method: "POST", body: JSON.stringify({ preuve_id: p.id }) });
      await onRattachee();
    } catch (e) {
      setErreur(e.message);
      verrou.current = false;
      setEnCours(null);
    }
  }

  const proposees = (resultats || []).filter((p) => !dejaLiees.includes(p.id));
  return (
    <Drawer ouvert onFermer={onFermer} fermable={enCours === null} titre="Rattacher une preuve"
      description="Choisissez une preuve existante ; elle reste rattachée à son propre indicateur.">
      <div className="ui-form">
        {erreur && <Alert ton="error" titre="La preuve n'a pas été rattachée.">{erreur}</Alert>}
        <Field label="Rechercher une preuve" aide="Au moins 2 caractères du titre.">
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} />
        </Field>
        {chargement && <LoadingState texte="Recherche…" />}
        {resultats && !chargement && (proposees.length === 0
          ? <p className="sess-secondaire">Aucune preuve disponible pour « {q.trim()} ».</p>
          : (
            <ul className="signalement-liste" aria-label="Preuves trouvées">
              {proposees.map((p) => (
                <li key={p.id} className="preuve-choix">
                  <span>
                    <strong>{p.titre}</strong>
                    <span className="sess-secondaire"> · Indicateur {p.indicateur}{p.session_reference ? ` · Session ${p.session_reference}` : ""}</span>
                  </span>
                  <Button compact onClick={() => rattacher(p)} disabled={enCours !== null} aria-label={`Rattacher la preuve ${p.titre}`}>
                    {enCours === p.id ? "Rattachement…" : "Rattacher"}
                  </Button>
                </li>
              ))}
            </ul>
          ))}
        <p className="sess-secondaire">Preuve absente ? <Link to="/preuves">Créer / importer une preuve</Link> depuis l'écran Preuves.</p>
      </div>
    </Drawer>
  );
}
