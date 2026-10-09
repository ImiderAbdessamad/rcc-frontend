/* Modale de l'écran de validation : confirmation de validation. */

import Icon, { ICONS } from "../Icon.jsx";
import Modal from "../Modal.jsx";

export function ValidatedModal({ open, dossier, compliance, onClose }) {
  return (
    <Modal open={open} onClose={onClose} labelledBy="validatedTitle" className="modal-center">
      <div className="modal-check">
        <Icon paths={ICONS.check} size={26} width={2.6} style={{ stroke: "var(--ok)" }} />
      </div>
      <h2 className="modal-title" id="validatedTitle">Dossier validé</h2>
      <p className="modal-sub">
        Les postes RCC contrôlés du dossier <b className="mono">{dossier.id}</b> ont été
        transmis au modèle EKIP. La piste d'audit des corrections est archivée.
      </p>

      <dl className="modal-stats">
        <div>
          <dt>{dossier.overrides.length}</dt>
          <dd>postes contrôlés</dd>
        </div>
        <div>
          <dt style={{ color: "var(--ok-text)" }}>
            {`${compliance.rules_ok}/${compliance.rules_total}`}
          </dt>
          <dd>règles conformes</dd>
        </div>
        <div>
          <dt style={{ fontSize: 13 }}>{dossier.decided_by || "—"}</dt>
          <dd>valideur</dd>
        </div>
      </dl>

      <button
        type="button"
        className="btn btn-primary btn-block"
        data-autofocus=""
        style={{ marginTop: 18 }}
        onClick={onClose}
      >
        Retour aux dossiers
      </button>
    </Modal>
  );
}
