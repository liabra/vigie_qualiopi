import { cloneElement, useId } from "react";

// Champ de formulaire : libellé TOUJOURS visible au-dessus, aide et erreur
// reliées au contrôle (aria-describedby, aria-invalid). `children` : un seul
// <input>, <select> ou <textarea>.
export function Field({ label, facultatif = false, aide, erreur, className = "", children }) {
  const idAuto = useId();
  const id = children.props.id || idAuto;
  const idAide = aide ? `${id}-aide` : null;
  const idErreur = erreur ? `${id}-erreur` : null;
  const decrit = [idAide, idErreur].filter(Boolean).join(" ") || undefined;
  return (
    <div className={("ui-field " + className).trim()}>
      <label htmlFor={id} className="ui-field__label">
        {label}{facultatif && <span className="ui-field__facultatif"> (facultatif)</span>}
      </label>
      {cloneElement(children, { id, "aria-describedby": decrit, "aria-invalid": erreur ? true : undefined })}
      {aide && <p id={idAide} className="ui-field__aide">{aide}</p>}
      {erreur && <p id={idErreur} className="ui-field__erreur">{erreur}</p>}
    </div>
  );
}

// Case à cocher avec son libellé cliquable.
export function Checkbox({ label, aide, ...props }) {
  return (
    <label className="ui-case">
      <input type="checkbox" {...props} />
      <span>
        {label}
        {aide && <span className="ui-field__aide ui-case__aide">{aide}</span>}
      </span>
    </label>
  );
}

// Section de formulaire : titre + champs en grille.
export function FormSection({ titre, children, colonnes = 2 }) {
  return (
    <fieldset className="ui-form-section">
      <legend className="ui-form-section__titre">{titre}</legend>
      <div className={`ui-form-grille ui-form-grille--${colonnes}`}>{children}</div>
    </fieldset>
  );
}
