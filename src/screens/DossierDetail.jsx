/* Écran de validation — visionneuse à gauche, formulaire RCC à droite. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import * as api from "../lib/api.js";
import { STATUS_META } from "../lib/fields.js";
import { formatAmount, formatCompletenessPct, formatDate, pluralize } from "../lib/format.js";
import Icon, { ICONS } from "../components/Icon.jsx";
import { HeroMark } from "../components/AppShell.jsx";
import { Badge, ErrorState, SkeletonRows } from "../components/States.jsx";
import Banner from "../components/detail/Banner.jsx";
import CompliancePanel from "../components/detail/CompliancePanel.jsx";
import FieldGroups from "../components/detail/FieldGroups.jsx";
import ViewerPane from "../components/detail/ViewerPane.jsx";
import ClientLookup from "../components/detail/ClientLookup.jsx";
import { ValidatedModal } from "../components/detail/DetailModals.jsx";
import { useToasts } from "../hooks/useToasts.jsx";

const SAVE_DEBOUNCE = 650;

// Panneau du document replié par défaut ; le dernier choix de l'analyste est mémorisé.
const DOCUMENT_COLLAPSED_KEY = "rcc.detail.documentCollapsed";

function readDocumentCollapsed() {
  try {
    const stored = localStorage.getItem(DOCUMENT_COLLAPSED_KEY);
    return stored === null ? true : stored === "1";
  } catch {
    return true;
  }
}

function saveDocumentCollapsed(collapsed) {
  try {
    localStorage.setItem(DOCUMENT_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    /* stockage indisponible : le choix vaut pour la session */
  }
}

export default function DossierDetail({ onDossierChanged }) {
  const { dossierId } = useParams();
  const navigate = useNavigate();
  const { toast, announce } = useToasts();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [paneTab, setPaneTab] = useState("doc");
  const [activeCode, setActiveCode] = useState(null);
  const [activeEvidencePage, setActiveEvidencePage] = useState(null);
  // Incrémenté à chaque « Voir » : le lecteur PDF recentre la valeur, même au second clic.
  const [documentFocusTick, setDocumentFocusTick] = useState(0);
  const [targetCode, setTargetCode] = useState(null);
  const [savingCodes, setSavingCodes] = useState(new Set());
  const [formOnly, setFormOnly] = useState(readDocumentCollapsed);
  const [modal, setModal] = useState(null); // "validated"
  const [busyAction, setBusyAction] = useState(null);
  const [busyExport, setBusyExport] = useState(null);
  const [busyBilan, setBusyBilan] = useState(false);

  const pendingEdits = useRef(new Map()); // code → valeur en attente
  const timers = useRef(new Map());
  const inFlightSaves = useRef(new Set());
  const lastSaveError = useRef(null);
  const rowNodes = useRef(new Map());

  const registerRow = useCallback((code, node) => {
    if (node) rowNodes.current.set(code, node);
    else rowNodes.current.delete(code);
  }, []);

  // Seul ce bouton enregistre le choix : les ouvertures automatiques ne le modifient pas.
  function toggleDocument() {
    const collapsed = !formOnly;
    setFormOnly(collapsed);
    saveDocumentCollapsed(collapsed);
  }

  /* ------------------------------------------------------------ chargement --- */

  const load = useCallback(
    async (id, { silent = false } = {}) => {
      if (!silent) {
        setLoading(true);
        setError(null);
      }
      try {
        const payload = await api.dossiers.get(id);
        setData(payload);
        // Sans liasse, le panneau de gauche sert à l'importer : il s'ouvre (sans changer le choix mémorisé).
        if (!payload.dossier.has_document) {
          setPaneTab("import");
          setFormOnly(false);
        }
        setError(null);
      } catch (err) {
        if (err.isAuth) return;
        setError(err.message);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    setActiveCode(null);
    setActiveEvidencePage(null);
    setPaneTab("doc");
    setFormOnly(readDocumentCollapsed());
    load(dossierId);
  }, [dossierId, load]);

  // Les corrections en attente partent avant de quitter l'écran ou l'onglet.
  const flushAll = useCallback(async ({ strict = false } = {}) => {
    for (const [code, timer] of timers.current) {
      clearTimeout(timer);
      timers.current.delete(code);
      if (pendingEdits.current.has(code)) saveFieldRef.current(code);
    }
    const results = await Promise.allSettled([...inFlightSaves.current]);
    const failed = results.find((result) => result.status === "rejected");
    if (strict && (failed || lastSaveError.current)) {
      throw failed?.reason || lastSaveError.current;
    }
    return results;
  }, []);

  const saveFieldRef = useRef(() => {});

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") flushAll();
    };
    window.addEventListener("beforeunload", flushAll);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("beforeunload", flushAll);
      document.removeEventListener("visibilitychange", onHide);
      flushAll();
    };
  }, [flushAll]);

  /* ------------------------------------------------------ enregistrement --- */

  const markSaving = useCallback((code, on) => {
    setSavingCodes((current) => {
      const next = new Set(current);
      if (on) next.add(code);
      else next.delete(code);
      return next;
    });
  }, []);

  const saveField = useCallback(
    (code) => {
      if (!pendingEdits.current.has(code)) return Promise.resolve();
      const value = pendingEdits.current.get(code);
      pendingEdits.current.delete(code);
      markSaving(code, true);

      const request = (async () => {
        try {
          const updated = await api.dossiers.saveOverrides(dossierId, [
            { field_code: code, corrected_value: value },
          ]);
          setData(updated);
          onDossierChanged?.(updated.dossier);
          announce(`${code} enregistré.`);
          lastSaveError.current = null;
          return updated;
        } catch (err) {
          lastSaveError.current = err;
          if (!err.isAuth) {
            toast(err.message, { title: "Correction non enregistrée", type: "bad" });
            // Retour arrière : on recharge l'état serveur qui fait autorité.
            load(dossierId, { silent: true });
          }
          throw err;
        } finally {
          markSaving(code, false);
        }
      })();

      inFlightSaves.current.add(request);
      const clearRequest = () => inFlightSaves.current.delete(request);
      request.then(clearRequest, clearRequest);
      return request;
    },
    [announce, dossierId, load, markSaving, onDossierChanged, toast]
  );

  saveFieldRef.current = saveField;

  const onEdit = useCallback(
    (code, value, { cancel = false } = {}) => {
      const timer = timers.current.get(code);
      if (timer) clearTimeout(timer);

      if (cancel) {
        pendingEdits.current.delete(code);
        timers.current.delete(code);
        return;
      }

      lastSaveError.current = null;
      pendingEdits.current.set(code, value);
      timers.current.set(
        code,
        setTimeout(() => {
          timers.current.delete(code);
          void saveField(code).catch(() => {});
        }, SAVE_DEBOUNCE)
      );
    },
    [saveField]
  );

  const onCommit = useCallback(
    (code) => {
      const timer = timers.current.get(code);
      if (timer) {
        clearTimeout(timer);
        timers.current.delete(code);
      }
      if (pendingEdits.current.has(code)) void saveField(code).catch(() => {});
    },
    [saveField]
  );

  const onVerify = useCallback(
    async (code) => {
      markSaving(code, true);
      lastSaveError.current = null;
      const request = api.dossiers.saveOverrides(dossierId, [
        { field_code: code, corrected_value: null, verified: true },
      ]);
      inFlightSaves.current.add(request);
      try {
        const updated = await request;
        setData(updated);
        onDossierChanged?.(updated.dossier);
        announce(`${code} marqué comme vérifié.`);
        lastSaveError.current = null;
      } catch (err) {
        lastSaveError.current = err;
        if (!err.isAuth) toast(err.message, { title: "Vérification non enregistrée", type: "bad" });
      } finally {
        inFlightSaves.current.delete(request);
        markSaving(code, false);
      }
    },
    [announce, dossierId, markSaving, onDossierChanged, toast]
  );

  /* -------------------------------------------------------------- actions --- */

  const focusField = useCallback(
    (code, { openDoc = false, scroll = true, pageNumber = null } = {}) => {
      setActiveCode(code);
      setActiveEvidencePage(pageNumber);
      if (openDoc && data?.dossier.has_document) {
        setPaneTab("doc");
        setFormOnly(false); // « voir dans le PDF » rouvre le document s'il était replié
        setDocumentFocusTick((tick) => tick + 1);
      }
      if (!scroll) return;

      const row = rowNodes.current.get(code);
      if (row) {
        row.scrollIntoView({ behavior: "smooth", block: "center" });
        setTargetCode(code);
        setTimeout(() => setTargetCode(null), 1300);
        row.querySelector("input:not([readonly])")?.focus();
      }
    },
    [data?.dossier.has_document]
  );

  const patchDossier = useCallback(
    async (payload, { successTitle, successText }) => {
      try {
        const updated = await api.dossiers.patch(dossierId, payload);
        setData(updated);
        onDossierChanged?.(updated.dossier);
        toast(successText, { title: successTitle, type: "ok" });
        return updated;
      } catch (err) {
        if (!err.isAuth) toast(err.message, { title: "Action impossible", type: "bad" });
        return null;
      }
    },
    [dossierId, onDossierChanged, toast]
  );

  async function onValidate() {
    setBusyAction("validate");
    const updated = await patchDossier(
      { status: "validated" },
      { successTitle: "Dossier validé", successText: `${dossierId} a été transmis au modèle EKIP.` }
    );
    setBusyAction(null);
    if (updated) setModal("validated");
  }

  async function onExport(kind) {
    setBusyExport(kind);
    try {
      await flushAll({ strict: true });
      const fresh = await api.dossiers.get(dossierId);
      setData(fresh);
      await api.dossiers.exportFile(fresh.dossier.id, "json");
      toast(
        "Le JSON contient uniquement les postes métier (chiffre d'affaires, valeur ajoutée, etc.).",
        { title: "JSON téléchargé", type: "ok" }
      );
    } catch (err) {
      toast(err.message || "L'export n'a pas pu être généré.", { title: "Export impossible", type: "bad" });
    } finally {
      setBusyExport(null);
    }
  }

  /** Enregistre le n° tiers choisi (`selected`) ou saisi (`manual`) ; renvoie true si c'est fait. */
  async function saveTiers(tiers, source) {
    try {
      const payload = await api.dossiers.setTiers(dossierId, { tiers, source });
      setData(payload);
      onDossierChanged?.(payload.dossier);
      toast(`Le n° tiers ${tiers} sera envoyé à Ekip avec le bilan.`, {
        title: source === "selected" ? "Client retenu" : "N° tiers enregistré",
        type: "ok",
      });
      return true;
    } catch (err) {
      if (!err.isAuth) toast(err.message, { title: "N° tiers non enregistré", type: "bad", timeout: 7000 });
      return false;
    }
  }

  /** Relance la recherche du client dans le référentiel ; le résultat remplace l'ancien. */
  async function refreshClientLookup() {
    try {
      const payload = await api.dossiers.refreshClientLookup(dossierId);
      setData(payload);
      onDossierChanged?.(payload.dossier);
      const lookup = payload.dossier?.identite?.client_lookup;
      const status = lookup?.status;
      toast(lookup?.message || "Recherche relancée.", {
        title: status === "MATCHED" ? "Client trouvé"
          : status === "MULTIPLE" ? "Plusieurs clients à départager"
            : status === "ERROR" ? "API clients toujours indisponible"
              : "Référentiel clients",
        type: status === "MATCHED" || status === "MULTIPLE" ? "ok" : "warn",
        timeout: 7000,
      });
    } catch (err) {
      if (!err.isAuth) toast(err.message, { title: "Recherche impossible", type: "bad", timeout: 7000 });
    }
  }

  async function onPushBilan() {
    if (busyBilan) return;
    // N° tiers retenu par le backend : unique, choisi ou saisi dans le référentiel clients.
    const tiers = data?.dossier?.identite?.tiers;
    if (!tiers) {
      toast(
        "Renseignez le n° tiers dans le bloc « Référentiel clients » avant l'envoi vers Ekip.",
        { title: "Envoi Ekip impossible", type: "bad", timeout: 8000 }
      );
      return;
    }
    setBusyBilan(true);
    try {
      await flushAll({ strict: true });
      const outcome = await api.dossiers.pushBilan(dossierId);
      setData((current) => {
        if (!current) return current;
        return {
          ...current,
          dossier: {
            ...current.dossier,
            bilans_push: outcome.bilans_push || current.dossier.bilans_push,
          },
        };
      });
      toast(
        outcome.message || `Bilan transmis · n° tiers ${tiers}`,
        { title: "Bilan envoyé", type: "ok" }
      );
      announce(`Bilan du dossier ${dossierId} envoyé (tiers ${tiers}).`);
    } catch (err) {
      if (!err.isAuth) {
        toast(err.message || "L'API bilans a refusé l'envoi.", {
          title: "Envoi bilan impossible",
          type: "bad",
          timeout: 8000,
        });
      }
    } finally {
      setBusyBilan(false);
    }
  }

  /* ---------------------------------------------------------------- rendu --- */

  if (loading) {
    return (
      <section className="view view-detail is-entering">
        <header className="topbar topbar-detail topbar-hero">
        <HeroMark />
          <div className="skeleton sk-title" style={{ width: 220 }} />
        </header>
        <div className="split">
          <div className="split-viewer">
            <div className="pane-scroll">
              <SkeletonRows count={4} widths={[140, 200, 90]} />
            </div>
          </div>
          <div className="split-form scroll">
            <div className="panel">
              <SkeletonRows count={7} widths={[180, 260, 120, 140]} />
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (error || !data) {
    return (
      <section className="view view-detail is-entering">
        <header className="topbar topbar-detail topbar-hero">
        <HeroMark />
          <button
            type="button"
            className="btn-icon detail-back"
            aria-label="Retour à la liste des dossiers"
            onClick={() => navigate("/dossiers")}
          >
            <Icon paths={ICONS.chevronLeft} size={15} />
          </button>
          <div className="detail-name">Dossier indisponible</div>
        </header>
        <div className="scroll">
          <ErrorState title="Dossier introuvable" message={error} onRetry={() => load(dossierId)}>
            <button type="button" className="btn btn-ghost" onClick={() => navigate("/dossiers")}>
              Retour à la liste
            </button>
          </ErrorState>
        </div>
      </section>
    );
  }

  const { dossier, compliance } = data;
  const overrides = new Map(dossier.overrides.map((o) => [o.field_code, o]));
  const meta = STATUS_META[dossier.status] || STATUS_META.pending;
  const balance = dossier.result?.controls.find((c) => c.code === "bilan_equilibre");
  const fields = dossier.result?.fields ?? [];
  // The server applies analyst overrides and derived-field rules when it
  // computes compliance. Reuse that authoritative count so this summary can
  // never disagree with the conformity panel below it.
  const populatedFields = Math.min(20, Math.max(0, 20 - (compliance?.missing_fields?.length ?? 0)));
  const averageConfidence = fields.length
    ? Math.round(100 * fields.reduce((sum, field) => sum + (field.confidence || 0), 0) / fields.length)
    : 0;
  const controlsPassed = (dossier.result?.controls ?? []).filter((control) => control.status === "passed").length;
  const identite = dossier.identite || dossier.result?.identite || {};

  return (
    <section className="view view-detail is-entering">
      <header className="topbar topbar-detail topbar-hero">
        <HeroMark />
        <button
          type="button"
          className="btn-icon detail-back"
          aria-label="Retour à la liste des dossiers"
          onClick={() => { flushAll(); navigate("/dossiers"); }}
        >
          <Icon paths={ICONS.chevronLeft} size={15} />
        </button>

        <div>
          <div className="detail-head-top">
            <span className="detail-id">{dossier.id}</span>
            <h1 className="detail-name">{identite.raison_sociale || dossier.client_name || "Client à identifier"}</h1>
            <Badge tone={meta.cls.replace("badge-", "")} dot>{meta.label}</Badge>
            {dossier.overrides.length ? (
              <Badge>{pluralize(dossier.overrides.length, "poste contrôlé", "postes contrôlés")}</Badge>
            ) : null}
          </div>

          <div className="detail-head-meta">
            <HeadFact label="Exercice" value={exercisePeriod(identite, dossier)} />
            {identite.tiers ? <HeadFact label="N° tiers" value={identite.tiers} mono /> : null}
            <HeadFact label="ICE" value={identite.ice || dossier.ice} mono />
            <HeadFact label="IF" value={identite.identifiant_fiscal} mono />
            <HeadFact label="TP" value={identite.taxe_professionnelle} mono />
            {dossier.has_document ? null : (
              <HeadFact label="Liasse" value="Non rattachée" tone="bad" />
            )}
          </div>
        </div>

      </header>

      <div className={`split${formOnly ? " is-form-only" : ""}`}>
        <ViewerPane
          dossier={dossier}
          tab={paneTab}
          onTabChange={setPaneTab}
          activeCode={activeCode}
          activeEvidencePage={activeEvidencePage}
          focusTick={documentFocusTick}
          onFocusField={focusField}
          onAttached={async (jobId) => {
            try {
              await api.dossiers.attach(dossier.id, { job_id: jobId });
              toast("Extraction rattachée au dossier.", { title: "Liasse importée", type: "ok" });
              setPaneTab("doc");
              await load(dossier.id, { silent: true });
              onDossierChanged?.(dossier);
            } catch (err) {
              if (!err.isAuth) toast(err.message, { title: "Rattachement impossible", type: "bad" });
            }
          }}
        />

        {/* Ordinateur : poignée sur la séparation, ou bande verticale quand le document est replié. */}
        <button
          type="button"
          className="split-dock"
          aria-expanded={!formOnly}
          aria-label={formOnly ? "Afficher le document" : "Replier le document"}
          title={formOnly ? "Afficher le document" : "Replier le document"}
          onClick={toggleDocument}
        >
          <span className="split-dock-knob" aria-hidden="true" />
          <span className="split-dock-label" aria-hidden="true">Document</span>
        </button>

        {/* Petits écrans : barre pleine largeur entre document et formulaire. */}
        <button
          type="button"
          className="split-toggle"
          aria-expanded={!formOnly}
          onClick={toggleDocument}
        >
          <span className="split-toggle-label">
            {formOnly ? "Voir le document" : "Voir le formulaire"}
          </span>
        </button>

        {/* Formulaire défilant + barre d'actions fixée en bas, toujours visible. */}
        <div className="split-main">
        <div className="split-form scroll">
          {balance?.status === "failed" ? (
            <Banner
              tone="bad"
              title="Incohérence comptable détectée — Total Actif ≠ Total Passif"
              text={`Actif ${formatAmount(balance.expected)} · Passif ${formatAmount(balance.observed)} · écart de ${formatAmount(Math.abs(balance.difference ?? 0))} MAD. La validation est bloquée tant que l'équilibre n'est pas rétabli.`}
            >
              <button
                type="button"
                className="btn btn-danger-solid btn-sm"
                onClick={() => focusField(balance.affected_fields?.[0] || "TOTAL_BILAN", { openDoc: true })}
              >
                Voir le poste concerné
              </button>
            </Banner>
          ) : balance?.status === "passed" ? (
            <Banner
              tone="ok"
              title="Équilibre comptable vérifié."
              text={`Total Actif = Total Passif = ${formatAmount(balance.observed)} MAD.`}
            />
          ) : !dossier.has_document ? (
            <Banner
              tone="bad"
              title="Liasse manquante."
              text="Aucune extraction n'est rattachée à ce dossier : la validation reste bloquée jusqu'à l'import du bilan scanné."
            >
              <button
                type="button"
                className="btn btn-danger-solid btn-sm"
                onClick={() => { setPaneTab("import"); setFormOnly(false); }}
              >
                Importer la liasse
              </button>
            </Banner>
          ) : null}

          <IdentityCard identite={identite} onSaveTiers={saveTiers} onRefreshLookup={refreshClientLookup} />

          <div className="legend">
            <h2>Données financières extraites</h2>
            <div className="legend-keys">
              <LegendKey label="Confiance OCR élevée" bg="var(--ok-soft)" border="var(--ok)" />
              <LegendKey label="À vérifier (< 80 %)" bg="var(--warn-soft)" border="var(--warn)" />
              <LegendKey label="Incohérence / non lu" bg="var(--bad-soft)" border="var(--bad)" />
              <LegendKey label="Calculé — verrouillé" bg="#F1F5F9" border="#CBD5E1" />
            </div>
          </div>

          {/* Conteneur des 4 groupes : 2 colonnes quand le document est replié sur grand écran. */}
          <div className="field-groups">
            <FieldGroups
              fields={dossier.result?.fields ?? []}
              overrides={overrides}
              activeCode={activeCode}
              savingCodes={savingCodes}
              targetCode={targetCode}
              onEdit={onEdit}
              onCommit={onCommit}
              onVerify={onVerify}
              onFocusField={focusField}
              registerRow={registerRow}
            />
          </div>

          {/* Masqué à la demande du métier (détail technique) — réactivable en décommentant.
          <ControlsPanel controls={dossier.result?.controls ?? []} />
          */}

          <ScoringPanel scoring={dossier.result?.scoring} />

          {/* Masqué à la demande du métier (journal technique) — réactivable en décommentant.
          <ExtractionWarnings warnings={dossier.result?.warnings ?? []} />
          */}

          {/* Masqué à la demande du métier (synthèse de l'analyse) — réactivable en décommentant.
          <DossierSnapshot
            dossier={dossier}
            compliance={compliance}
            populatedFields={populatedFields}
            averageConfidence={averageConfidence}
            controlsPassed={controlsPassed}
          />
          */}

          <CompliancePanel compliance={compliance} onFocusField={focusField} />
        </div>

        <footer className="detail-actionbar" aria-label="Actions sur le dossier">
          <span
            className={`detail-actionbar-state ${
              dossier.status === "validated" || compliance.can_validate ? "conf-ok" : "conf-bad"
            }`}
          >
            {dossier.status === "validated"
              ? "Dossier validé"
              : compliance.can_validate
                ? "Toutes les règles de conformité sont satisfaites"
                : `${pluralize(compliance.blockers, "règle")} de conformité non ${compliance.blockers > 1 ? "satisfaites" : "satisfaite"}`}
          </span>

          <div className="detail-actions">
            <button type="button" className="btn btn-ghost" disabled={Boolean(busyExport)} onClick={() => onExport("json")}>
              <Icon paths={ICONS.file} size={14} width={1.9} />
              {busyExport === "json" ? "Génération…" : "Exporter JSON"}
            </button>
            <button
              type="button"
              className={`btn btn-primary hint${busyBilan ? " is-busy" : ""}`}
              disabled={busyBilan || !dossier.has_document || !identite.tiers}
              data-hint={
                !dossier.has_document
                  ? "Rattachez d'abord la liasse du dossier"
                  : identite.tiers
                    ? `Envoyer le bilan vers Ekip (n° tiers ${identite.tiers})`
                    : "Renseignez le n° tiers dans le bloc « Référentiel clients »"
              }
              onClick={onPushBilan}
            >
              <Icon paths={ICONS.upload} size={14} width={1.9} />
              <span className="btn-label">
                {busyBilan
                  ? "Envoi…"
                  : dossier.bilans_push?.status === "sent"
                    ? "Renvoyer Ekip"
                    : "Envoyer Ekip"}
              </span>
              <span className="btn-spinner" aria-hidden="true" />
            </button>
            {/* Masqué à la demande du métier — réactivable en décommentant.
            <button
              type="button"
              className={`btn ${compliance.can_validate ? "btn-ok" : "btn-ghost"} hint${busyAction === "validate" ? " is-busy" : ""}`}
              disabled={!compliance.can_validate || dossier.status === "validated" || busyAction === "validate"}
              data-hint={
                dossier.status === "validated"
                  ? "Ce dossier est déjà validé"
                  : compliance.can_validate
                    ? "Transmettre les postes RCC au modèle EKIP"
                    : `${pluralize(compliance.blockers, "règle")} de conformité bloquante(s) à lever avant validation`
              }
              onClick={onValidate}
            >
              <Icon paths={ICONS.check} size={14} width={2.4} />
              <span className="btn-label">Valider le dossier</span>
              <span className="btn-spinner" aria-hidden="true" />
            </button>
            */}
          </div>
        </footer>
        </div>
      </div>

      <ValidatedModal
        open={modal === "validated"}
        dossier={dossier}
        compliance={compliance}
        onClose={() => { setModal(null); navigate("/dossiers"); }}
      />
    </section>
  );
}

/** Donnée de l'en-tête : libellé en petites majuscules, valeur en gras ; « non détecté » si vide. */
function HeadFact({ label, value, mono = false, tone = null }) {
  const missing = !value;
  const className = ["head-fact", missing ? "is-missing" : null, tone ? `is-${tone}` : null]
    .filter(Boolean)
    .join(" ");
  return (
    <span className={className}>
      <small>{label}</small>
      <b className={mono && !missing ? "mono" : undefined}>{missing ? "non détecté" : value}</b>
    </span>
  );
}

function exercisePeriod(identite, dossier) {
  const start = identite.period_start;
  const end = identite.period_end || (dossier.exercice_date ? formatDate(dossier.exercice_date) : null);
  if (!start && !end) return null;
  return `${start || "—"} → ${end || "—"}`;
}

function LegendKey({ label, bg, border }) {
  return (
    <span className="legend-key">
      <span className="legend-swatch" style={{ background: bg, borderColor: border }} />
      {label}
    </span>
  );
}

function ControlsPanel({ controls }) {
  if (!controls.length) {
    return (
      <div className="panel panel-pad">
        <h2 style={{ fontSize: "12.5px", fontWeight: 700 }}>Contrôles de cohérence</h2>
        <p style={{ fontSize: "11.5px", color: "var(--muted)", marginTop: 6 }}>
          Aucun contrôle comptable n'a pu être exécuté sur ce dossier.
        </p>
      </div>
    );
  }

  return (
    <section className="panel panel-pad controls-panel">
      <div className="controls-head">
        <div>
          <h2>Contrôles de cohérence</h2>
          <p>Vérifications automatiques déterminantes pour la validation.</p>
        </div>
        <Badge>{`${controls.filter((control) => control.status === "passed").length}/${controls.length} conformes`}</Badge>
      </div>
      {controls.map((control) => {
        const tone = control.status === "passed" ? "conf-ok"
          : control.status === "failed" ? "conf-bad" : "conf-lock";
        const dot = control.status === "passed" ? "var(--ok)"
          : control.status === "failed" ? "var(--bad)" : "var(--muted-2)";
        const verdict = control.status === "passed" ? "Conforme"
          : control.status === "failed" ? "Écart" : "Non testable";

        return (
          <div key={control.code} className="control-row">
            <span className="control-dot" style={{ background: dot }} aria-hidden="true" />
            <span className="control-label">{control.label}</span>
            <span className="comp-detail" title={control.message}>{control.message}</span>
            <span className={`control-verdict ${tone}`}>{verdict}</span>
          </div>
        );
      })}
    </section>
  );
}

function DossierSnapshot({ dossier, compliance, populatedFields, averageConfidence, controlsPassed }) {
  const extraction = dossier.result?.extraction;
  const controlsTotal = dossier.result?.controls?.length ?? 0;
  const scoring = dossier.result?.scoring;
  const sourceLabels = {
    born_digital: "PDF natif",
    hybrid: "Document hybride",
    image_only: "Document scanné",
  };

  const summary = [
    `${populatedFields}/20 postes`,
    `confiance OCR ${averageConfidence} %`,
    controlsTotal ? `${controlsPassed}/${controlsTotal} contrôles` : "aucun contrôle",
    compliance.can_validate ? "prêt à transmettre" : `${compliance.blockers} bloquant(s)`,
  ].join(" · ");

  // Accordéon fermé par défaut, en bas de page, au design du panneau « Conformité RCC ».
  return (
    <details className="panel panel-pad comp-accordion analysis-accordion" aria-label="Synthèse de l'analyse RCC">
      <summary className="comp-head">
        <div>
          <h2 className="comp-title">Synthèse de l'analyse</h2>
          <p className="comp-sub">{summary}</p>
        </div>
        <div className="engine-tags" aria-label="Pipeline d'extraction utilisé">
          <span>{sourceLabels[extraction?.source_kind] || "Source non qualifiée"}</span>
          {(extraction?.engines || []).map((engine) => <span key={engine}>{engine}</span>)}
        </div>
        <span className="comp-chevron" aria-hidden="true" />
      </summary>
      <div className="analysis-metrics">
        <article>
          <small>Postes RCC renseignés</small>
          <strong>{populatedFields}<span>/20</span></strong>
          <p>{formatCompletenessPct(dossier.completeness_pct)}% de complétude</p>
        </article>
        <article>
          <small>Confiance OCR moyenne</small>
          <strong>{averageConfidence}<span>%</span></strong>
          <p>{dossier.overrides.length} contrôle(s) analyste</p>
        </article>
        <article>
          <small>Contrôles comptables</small>
          <strong>{controlsPassed}<span>/{controlsTotal}</span></strong>
          <p>{controlsTotal ? "vérifications exécutées" : "aucun contrôle disponible"}</p>
        </article>
        <article className={compliance.can_validate ? "is-ready" : "is-blocked"}>
          <small>Décision RCC</small>
          <strong>{compliance.pct}<span>%</span></strong>
          <p>{compliance.can_validate ? "prêt à transmettre" : `${compliance.blockers} bloquant(s)`}</p>
        </article>
        <article>
          <small>Ratios financiers</small>
          <strong>{scoring ? scoring.calculable_ratio_count : "—"}<span>{scoring ? `/${scoring.total_ratio_count}` : ""}</span></strong>
          <p>{scoring ? "calculables" : "non disponibles"}</p>
        </article>
      </div>
    </details>
  );
}

function ScoringPanel({ scoring }) {
  if (!scoring) return null;

  return (
    <section className="panel scoring-panel">
      <div className="scoring-head">
        <div>
          <span className="analysis-kicker">Scoring financier</span>
          <h2>Ratios issus de la même extraction RCC</h2>
          <p>Aucun second passage OCR : les valeurs et leur provenance restent identiques.</p>
        </div>
        <Badge>{`${scoring.calculable_ratio_count}/${scoring.total_ratio_count} calculables`}</Badge>
      </div>
      {scoring.policy_status !== "approved" ? (
        <div className="scoring-policy">
          <strong>Score final volontairement désactivé.</strong>
          <span>Les pondérations et seuils de décision ne sont pas encore approuvés.</span>
        </div>
      ) : null}
      <div className="ratio-grid">
        {(scoring.ratios || []).map((ratio) => (
          <article className={`ratio-card is-${ratio.status}`} key={ratio.code}>
            <div>
              <small>{ratio.code.replace(/_/g, " ")}</small>
              <h3>{ratio.label}</h3>
            </div>
            <strong>{ratio.value == null ? "—" : `${formatAmount(ratio.value, { decimals: true })}${ratio.unit ? ` ${ratio.unit}` : ""}`}</strong>
            <p>{ratio.status.replace(/_/g, " ")}</p>
            <code>{ratio.formula}</code>
          </article>
        ))}
      </div>
    </section>
  );
}

function IdentityCard({ identite, onSaveTiers, onRefreshLookup }) {
  const activite = String(identite.activite || "").trim();
  const activiteClean = /^raison sociale\b/i.test(activite) ? "" : activite;
  // Raison sociale, exercice, N° tiers, ICE, IF et TP sont dans l'en-tête, toujours
  // visible : ce bloc ne reprend que les informations complémentaires.
  const rows = [
    ["RC", identite.rc],
    ["Activité", activiteClean],
    ["Secteur", identite.secteur],
    ["Adresse", identite.adresse],
    ["Ville", identite.ville],
    ["Date de déclaration", identite.declaration_date],
    ["Heure de déclaration", identite.declaration_time],
    ["Référence", identite.reference],
  ];

  return (
    <section className="panel panel-pad identity-card" aria-label="Informations complémentaires de l'entreprise">
      <div className="identity-card-head">
        <span className="analysis-kicker">Identité extraite</span>
        <h2>Informations complémentaires</h2>
      </div>
      <dl className="identity-grid">
        {rows.map(([label, value]) => (
          <div key={label} className="identity-item">
            <dt>{label}</dt>
            <dd>{value || "—"}</dd>
          </div>
        ))}
      </dl>

      <ClientLookup identite={identite} onSaveTiers={onSaveTiers} onRefresh={onRefreshLookup} />
    </section>
  );
}

function ExtractionWarnings({ warnings }) {
  if (!warnings.length) return null;

  return (
    <section className="panel extraction-warnings">
      <div className="extraction-warnings-summary">
        <span className="extraction-warning-icon" aria-hidden="true">!</span>
        <div>
          <h2>Points d'attention de l'extraction</h2>
          <p>{`${warnings.length} signalement${warnings.length > 1 ? "s" : ""} technique${warnings.length > 1 ? "s" : ""} conservé${warnings.length > 1 ? "s" : ""} pour l'audit.`}</p>
        </div>
      </div>
      <details>
        <summary>Consulter le journal technique</summary>
        <ul>
          {warnings.map((warning) => <li key={warning}>{humanizeWarning(warning)}</li>)}
        </ul>
      </details>
    </section>
  );
}

function humanizeWarning(warning) {
  return String(warning)
    .replace(/_/g, " ")
    .replace(/\bconflicting\b/gi, "présente des valeurs divergentes")
    .replace(/\bexclus\b/gi, "écartés")
    .replace(/\binvalidé\b/gi, "invalidé")
    .replace(/\s+/g, " ")
    .trim();
}
