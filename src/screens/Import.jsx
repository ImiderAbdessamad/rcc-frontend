/* Écran « Import & extraction OCR ». */

import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as api from "../lib/api.js";
import { TopBar } from "../components/AppShell.jsx";
import Banner from "../components/detail/Banner.jsx";
import ImportPanel from "../components/ImportPanel.jsx";
import { useToasts } from "../hooks/useToasts.jsx";
import Icon, { ICONS } from "../components/Icon.jsx";

const WORKFLOW = [
  {
    number: "01", icon: ICONS.file, title: "Contrôle du document", summary: "Format, taille et lisibilité de la liasse",
    detail: "Le fichier est vérifié avant traitement pour éviter les PDF vides, corrompus ou trop volumineux.",
    output: "Document conforme et prêt pour la lecture",
  },
  {
    number: "02", icon: ICONS.eye, title: "Lecture intelligente", summary: "Classification des pages et extraction OCR",
    detail: "Chaque page est orientée, classée puis lue avec le modèle le plus adapté à son contenu financier.",
    output: "Valeurs, libellés, pages sources et confiance OCR",
  },
  {
    number: "03", icon: ICONS.clipboardCheck, title: "Contrôles RCC", summary: "Résolution des postes et cohérence comptable",
    detail: "Les valeurs candidates sont rapprochées des 20 postes RCC puis soumises aux contrôles arithmétiques.",
    output: "Dossier structuré avec anomalies signalées",
  },
  {
    number: "04", icon: ICONS.user, title: "Validation analyste", summary: "Revue des preuves avant transmission",
    detail: "L’analyste compare chaque valeur à sa preuve, corrige si nécessaire et prend la décision finale.",
    output: "Décision traçable et prête pour EKIP",
  },
];

export default function Import({ onDossierCreated }) {
  const navigate = useNavigate();
  const { toast } = useToasts();
  const [engine, setEngine] = useState({ status: "checking", label: "Vérification du moteur OCR" });
  const [activeStep, setActiveStep] = useState(0);
  const selectedStep = WORKFLOW[activeStep];

  const checkEngine = useCallback(async () => {
    setEngine((current) => ({ ...current, status: "checking", label: "Vérification du moteur OCR" }));
    try {
      setEngine(await api.system.ocrHealth());
    } catch {
      setEngine({ status: "offline", label: "Moteur OCR en attente", models_count: 0 });
    }
  }, []);

  useEffect(() => { checkEngine(); }, [checkEngine]);

  const onCompleted = useCallback(
    async (jobId) => {
      try {
        const created = await api.dossiers.create({ job_id: jobId });
        const dossierId = created.dossier.id;
        toast(`Dossier ${dossierId} créé et placé dans la file de validation.`, {
          title: "Extraction terminée",
          type: "ok",
        });
        onDossierCreated?.(created.dossier);
        return {
          dossierId,
          onOpen: () => navigate(`/validation/${encodeURIComponent(dossierId)}`),
        };
      } catch (err) {
        if (!err.isAuth) {
          toast(err.message, { title: "Création du dossier impossible", type: "bad" });
        }
        return null;
      }
    },
    [navigate, onDossierCreated, toast]
  );

  return (
    <section className="view is-entering">
      <TopBar
        title="Centre d’import"
        subtitle="Transformez une liasse fiscale en dossier RCC contrôlable : le moteur identifie les états financiers, extrait les postes utiles et prépare les preuves de chaque valeur."
      />

      <div className="scroll">
        <div className="wrap import-workspace">
          {/* Parcours en étapes, mis à jour par l'extraction. */}
          <nav className="import-steps" aria-label="Parcours d’extraction">
            <ol>
              {/* Ligne reliant les étapes : verte seulement entre deux étapes terminées. */}
              <li className="import-steps-track" aria-hidden="true">
                <span style={{ width: `${(Math.max(0, activeStep - 1) / (WORKFLOW.length - 1)) * 100}%` }} />
              </li>
              {WORKFLOW.map((step, index) => (
                <li key={step.number} className={`${index === activeStep ? "is-active" : ""}${index < activeStep ? " is-complete" : ""}`}>
                  <div className="import-step" aria-current={index === activeStep ? "step" : undefined}>
                    <span className="import-step-dot">
                      <Icon paths={index < activeStep ? ICONS.check : step.icon} size={18} width={1.8} />
                    </span>
                    <span className="import-step-label">{step.title}</span>
                  </div>
                </li>
              ))}
            </ol>
            <p className="import-step-detail" aria-live="polite">
              <b>{selectedStep.summary}.</b> {selectedStep.detail}
            </p>
          </nav>

          {engine.status === "offline" ? (
            <Banner tone="warn" title="Moteur OCR non disponible" text="Vous pouvez préparer vos fichiers, mais attendez que l’indicateur passe au vert avant de lancer une extraction." />
          ) : null}

          <section className="import-card">
            <header className="import-card-head">
              <h2>Nouveau dossier RCC</h2>
              <p>Déposez la liasse fiscale de la société : un PDF par société, annexes comprises.</p>
            </header>
            <ImportPanel onCompleted={onCompleted} onWorkflowStepChange={setActiveStep} />
          </section>

          <div className="import-checklist">
            <div><Icon paths={ICONS.check} size={16} /><span><strong>Avant de déposer</strong><small>Vérifiez que le document est complet et lisible.</small></span></div>
            <div><Icon paths={ICONS.file} size={16} /><span><strong>Un PDF par société</strong><small>Les annexes peuvent rester dans le même fichier.</small></span></div>
            <div><Icon paths={ICONS.lock} size={16} /><span><strong>Contrôle humain obligatoire</strong><small>Aucune valeur n’est transmise sans validation.</small></span></div>
          </div>
        </div>
      </div>
    </section>
  );
}
