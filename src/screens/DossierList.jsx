/* Écran « Validation RCC » — file de validation. */

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import * as api from "../lib/api.js";
import { STATUS_META } from "../lib/fields.js";
import { clampCompletenessPct, formatAmountMad, formatDate, pluralize } from "../lib/format.js";
import Icon, { ICONS } from "../components/Icon.jsx";
import Modal, { BusyButton } from "../components/Modal.jsx";
import { Badge, EmptyState, ErrorState, SkeletonRows } from "../components/States.jsx";
import { HeroMark, TopBar } from "../components/AppShell.jsx";
import { useDebouncedValue } from "../hooks/index.js";
import { useToasts } from "../hooks/useToasts.jsx";

// Choix « masquer les dossiers Étude de risque », gardé dans ce navigateur (activé par défaut).
const HIDE_SCORING_KEY = "rcc.hideScoring";

function readHideScoring() {
  try {
    return window.localStorage.getItem(HIDE_SCORING_KEY) !== "0";
  } catch {
    return true;
  }
}

const FILTERS = [
  { key: "pending", label: "À réviser" },
  { key: "validated", label: "Validés" },
  { key: "all", label: "Tous" },
];

export default function DossierList({ activeId }) {
  const navigate = useNavigate();
  const { announce, toast } = useToasts();
  const [params, setParams] = useSearchParams();

  const status = params.get("statut") || "pending";
  const [search, setSearch] = useState(params.get("q") || "");
  const debouncedSearch = useDebouncedValue(search, 280);

  const [data, setData] = useState({ items: [], counts: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [hideTarget, setHideTarget] = useState(null);
  const [hiding, setHiding] = useState(false);
  const [hideScoring, setHideScoring] = useState(readHideScoring);
  const abortRef = useRef(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);

    try {
      const payload = await api.dossiers.list({
        status,
        search: debouncedSearch.trim(),
        hideScoring,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setData(payload);
      announce(`${pluralize(payload.items.length, "dossier")} affiché(s).`);
    } catch (err) {
      if (err.name === "AbortError" || controller.signal.aborted || err.isAuth) return;
      setError(err.message);
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setLoading(false);
      }
    }
  }, [status, debouncedSearch, hideScoring, announce]);

  useEffect(() => {
    setLoading(true);
    load();
    return () => abortRef.current?.abort();
  }, [load]);

  // L'URL porte le filtre et la recherche : un lien reste reproductible.
  useEffect(() => {
    const next = new URLSearchParams();
    if (status !== "pending") next.set("statut", status);
    if (debouncedSearch.trim()) next.set("q", debouncedSearch.trim());
    setParams(next, { replace: true });
  }, [status, debouncedSearch, setParams]);

  function setStatus(nextStatus) {
    const next = new URLSearchParams(params);
    if (nextStatus === "pending") next.delete("statut");
    else next.set("statut", nextStatus);
    setParams(next, { replace: true });
  }

  function toggleHideScoring() {
    const next = !hideScoring;
    setHideScoring(next);
    try {
      window.localStorage.setItem(HIDE_SCORING_KEY, next ? "1" : "0");
    } catch {
      /* stockage indisponible : le choix vaut pour cette session */
    }
  }

  async function confirmHide() {
    if (!hideTarget || hiding) return;
    setHiding(true);
    try {
      await api.dossiers.hide(hideTarget.id);
      const hiddenId = hideTarget.id;
      setHideTarget(null);
      toast(`Le dossier ${hiddenId} n'apparaît plus dans RCC. Il reste disponible dans Étude de risque.`, {
        title: "Dossier masqué",
        type: "ok",
      });
      await load();
    } catch (err) {
      toast(err.message, { title: "Masquage impossible", type: "bad", timeout: 7000 });
    } finally {
      setHiding(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await api.dossiers.remove(deleteTarget.id);
      const deletedId = deleteTarget.id;
      setDeleteTarget(null);
      toast(`Le dossier ${deletedId} et son document associé ont été supprimés.`, {
        title: "Suppression terminée",
        type: "ok",
      });
      await load();
    } catch (err) {
      toast(err.message, { title: "Suppression impossible", type: "bad", timeout: 7000 });
    } finally {
      setDeleting(false);
    }
  }

  const counts = data.counts || {};
  const searching = Boolean(debouncedSearch.trim());
  const hiddenByFilter = searching && status !== "all";
  const filterLabel = FILTERS.find((f) => f.key === status)?.label ?? "";

  const stats = [
    { status: "pending", label: "À valider", value: counts.pending ?? 0, note: "Dossiers extraits par l'OCR, à contrôler avant l'envoi vers EKIP." },
    { status: "validated", label: "Validés", value: counts.validated ?? 0, note: "Dossiers contrôlés et transmis à EKIP." },
  ];

  return (
    <section className="view is-entering">
      <TopBar
        title="Validation RCC"
        subtitle="Bilans extraits par OCR en attente de contrôle humain avant enrichissement du modèle EKIP."
      />

      <div className="scroll">
        <div className="wrap wrap-wide">
          <div className="stats">
            {stats.map((card) => (
              <button
                type="button"
                className={`stat${status === card.status ? " is-selected" : ""}`}
                key={card.label}
                aria-pressed={status === card.status}
                aria-label={`${card.label} : ${card.value}`}
                onClick={() => setStatus(card.status)}
              >
                <span className="stat-head">
                  <span className="stat-label">{card.label}</span>
                  <span className="stat-value" aria-hidden="true">{card.value}</span>
                </span>
                <span className="stat-note">{card.note}</span>
                <span className="stat-link">
                  Afficher la file <Icon paths={ICONS.chevronRight} size={14} width={2} />
                </span>
              </button>
            ))}
          </div>

          <div className="panel">
            <div className="table-toolbar">
              <div className="segmented" role="tablist" aria-label="Filtrer par statut">
                {FILTERS.map((filter) => (
                  <button
                    key={filter.key}
                    type="button"
                    role="tab"
                    aria-selected={status === filter.key}
                    onClick={() => setStatus(filter.key)}
                  >
                    {filter.label}
                    {counts[filter.key] != null ? (
                      <span className="seg-count">{counts[filter.key]}</span>
                    ) : null}
                  </button>
                ))}
              </div>

              <div className="search">
                <Icon paths={ICONS.search} size={14} width={2} />
                <label className="sr-only" htmlFor="listSearch">
                  Rechercher un dossier
                </label>
                <input
                  id="listSearch"
                  type="search"
                  autoComplete="off"
                  placeholder="N° de dossier, raison sociale ou ICE…"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") setSearch("");
                  }}
                />
                {search && search !== debouncedSearch ? (
                  <span className="search-spinner" aria-hidden="true" />
                ) : null}
              </div>

              <label className="switch">
                <input type="checkbox" checked={hideScoring} onChange={toggleHideScoring} />
                <span className="switch-track" aria-hidden="true" />
                Masquer les dossiers Étude de risque
              </label>

              <span className="table-count" aria-live="polite">
                {loading ? "" : pluralize(data.items.length, "dossier")}
              </span>
            </div>

            <div className="table-scroll">
              <div className="table" role="table" aria-label="Dossiers RCC">
                <div className="tr th" role="row">
                  <span role="columnheader" className="c-id">N° de dossier</span>
                  <span role="columnheader" className="c-name">Client / Raison sociale</span>
                  <span role="columnheader" className="c-date">Date d'exercice</span>
                  <span role="columnheader" className="c-amount">Crédit demandé</span>
                  <span role="columnheader" className="c-quality">Qualité RCC</span>
                  <span role="columnheader" className="c-status">Statut du dossier</span>
                  <span role="columnheader" className="c-actions">Actions</span>
                </div>

                <div role="rowgroup">
                  {loading ? (
                    <SkeletonRows count={6} widths={[96, 210, 110, 130, 120]} />
                  ) : error ? (
                    <ErrorState message={error} onRetry={load} />
                  ) : data.items.length === 0 ? (
                    <EmptyState
                      title={searching ? "Aucun résultat" : `Aucun dossier « ${filterLabel.toLowerCase()} »`}
                      text={
                        searching
                          ? hiddenByFilter
                            ? `Aucun dossier « ${filterLabel.toLowerCase()} » ne correspond à « ${debouncedSearch.trim()} ». Il existe peut-être sous un autre statut.`
                            : `Aucun dossier ne correspond à « ${debouncedSearch.trim()} ». Essayez un autre numéro, une raison sociale ou un ICE.`
                          : "Les dossiers apparaissent ici dès qu'une liasse fiscale a été importée et extraite par le moteur OCR."
                      }
                    >
                      {hiddenByFilter ? (
                        <button type="button" className="btn btn-primary" onClick={() => setStatus("all")}>
                          Chercher dans tous les statuts
                        </button>
                      ) : null}
                      {searching ? (
                        <button type="button" className="btn btn-ghost" onClick={() => setSearch("")}>
                          Effacer la recherche
                        </button>
                      ) : (
                        <button type="button" className="btn btn-primary" onClick={() => navigate("/import")}>
                          Importer une liasse
                        </button>
                      )}
                    </EmptyState>
                  ) : (
                    data.items.map((dossier) => (
                      <DossierRow
                        key={dossier.id}
                        dossier={dossier}
                        active={dossier.id === activeId}
                        onOpen={() => navigate(`/validation/${encodeURIComponent(dossier.id)}`)}
                        onDelete={() => setDeleteTarget(dossier)}
                        onHide={() => setHideTarget(dossier)}
                      />
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <ConfirmModal
        open={Boolean(hideTarget)}
        dossier={hideTarget}
        busy={hiding}
        onClose={() => setHideTarget(null)}
        onConfirm={confirmHide}
        titleId="hideDossierTitle"
        icon={ICONS.eyeOff}
        title="Masquer le dossier"
        badge={<Badge tone="neutral" className="badge-xs">Étude de risque</Badge>}
        effects={[
          { tone: "neutral", text: "Le dossier n'apparaît plus dans la liste RCC." },
          { tone: "ok", text: "Le dossier, sa liasse et son analyse restent intacts dans Étude de risque." },
        ]}
        confirmLabel="Masquer dans RCC"
        confirmClass="btn btn-primary"
      />

      <ConfirmModal
        open={Boolean(deleteTarget)}
        dossier={deleteTarget}
        busy={deleting}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        titleId="deleteDossierTitle"
        danger
        icon={ICONS.trash}
        title="Supprimer le dossier"
        badge={
          deleteTarget ? (
            <Badge tone={deleteTarget.has_document ? "bad" : "neutral"} className="badge-xs">
              {deleteTarget.has_document ? "PDF inclus" : "Sans PDF"}
            </Badge>
          ) : null
        }
        effects={[
          { tone: "bad", text: "La liasse PDF du dossier est supprimée." },
          { tone: "bad", text: "Les corrections et l'historique associés sont supprimés." },
        ]}
        note="Cette action est irréversible."
        confirmLabel="Supprimer définitivement"
        confirmClass="btn btn-danger-solid"
      />
    </section>
  );
}

/** Confirmation d'une action sur un dossier : bandeau de tête, récapitulatif, conséquences. */
function ConfirmModal({
  open, dossier, busy, onClose, onConfirm, titleId, danger = false, icon, title,
  badge, effects, note, confirmLabel, confirmClass,
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy={titleId}
      dismissible={!busy}
      className={`confirm-modal${danger ? " is-danger" : ""}`}
    >
      <header className="confirm-head">
        <HeroMark />
        <span className="confirm-icon" aria-hidden="true">
          <Icon paths={icon} size={20} width={1.8} />
        </span>
        <div className="confirm-heading">
          {dossier ? <span className="confirm-eyebrow">Dossier {dossier.id}</span> : null}
          <h2 id={titleId}>{title}</h2>
        </div>
      </header>

      <div className="confirm-body">
        {dossier ? (
          <div className="confirm-recap">
            <span>
              <strong title={dossier.client_name}>{dossier.client_name || "Client non renseigné"}</strong>
              <small>
                {[dossier.ice ? `ICE ${dossier.ice}` : null, formatAmountMad(dossier.credit_amount)]
                  .filter(Boolean)
                  .join(" · ")}
              </small>
            </span>
            {badge}
          </div>
        ) : null}

        <ul className="confirm-effects">
          {effects.map((effect) => (
            <li key={effect.text} className={`is-${effect.tone}`}>
              <Icon
                paths={effect.tone === "ok" ? ICONS.check : effect.tone === "bad" ? ICONS.trash : ICONS.eyeOff}
                size={13}
                width={2}
              />
              {effect.text}
            </li>
          ))}
        </ul>
        {note ? <p className="confirm-note">{note}</p> : null}
      </div>

      <footer className="confirm-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy} data-autofocus="">
          Annuler
        </button>
        <BusyButton busy={busy} className={confirmClass} onClick={onConfirm}>
          {confirmLabel}
        </BusyButton>
      </footer>
    </Modal>
  );
}

function DossierRow({ dossier, active, onOpen, onDelete, onHide }) {
  // Dossier venant d'Étude de risque : on le masque, on ne le supprime pas.
  const fromScoring = dossier.origin === "scoring";
  const meta = STATUS_META[dossier.status] || STATUS_META.pending;
  const tone = meta.cls.replace("badge-", "");
  // N° tiers retenu par le backend (vide tant qu'un client reste à choisir).
  const tiers = dossier.tiers || dossier.identite?.tiers;

  return (
    <div
      className={`row tr${active ? " is-active" : ""}`}
      role="row"
      tabIndex={0}
      aria-label={`Dossier ${dossier.id}, ${dossier.client_name}, ${meta.label}`}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <span className="c-id" role="cell">
        <span className="row-id">{dossier.id}</span>
      </span>

      <span className="c-name" role="cell">
        <span className="row-name" title={dossier.client_name}>
          {dossier.client_name || "—"}
        </span>
        <span className="row-sub">
          <span className="row-sector">{
            (() => {
              const label = dossier.activite || dossier.sector || "";
              if (!label || /^raison sociale\b/i.test(label.trim())) return "Secteur non renseigné";
              return label;
            })()
          }</span>
          {fromScoring ? <Badge tone="neutral" className="badge-xs">Étude de risque</Badge> : null}
          {tiers ? <span className="row-sector">Tiers {tiers}</span> : null}
          {dossier.ice ? <span className="row-sector">ICE {dossier.ice}</span> : null}
          {dossier.identifiant_fiscal ? <span className="row-sector">IF {dossier.identifiant_fiscal}</span> : null}
          <Badge tone={dossier.has_document ? "ok" : "bad"} className="badge-xs">
            {dossier.has_document ? "Liasse OCR ✓" : "Liasse manquante"}
          </Badge>
          {dossier.bilans_push?.status === "sent" ? (
            <Badge tone="ok" className="badge-xs">Bilan envoyé</Badge>
          ) : null}
        </span>
      </span>

      <span className="c-date row-date" role="cell">{formatDate(dossier.exercice_date)}</span>
      <span className="c-amount row-amount" role="cell">{formatAmountMad(dossier.credit_amount)}</span>

      <span className="c-quality" role="cell">
        <span className="quality-line">
          <span>{Math.round(clampCompletenessPct(dossier.completeness_pct))} %</span>
          <span>{dossier.override_count ? `${dossier.override_count} revu(s)` : "OCR"}</span>
        </span>
        <span className="quality-track" aria-label={`Complétude RCC ${Math.round(clampCompletenessPct(dossier.completeness_pct))} %`}>
          <span style={{ width: `${clampCompletenessPct(dossier.completeness_pct)}%` }} />
        </span>
      </span>

      <span className="c-status" role="cell">
        <Badge tone={tone} dot>{meta.label}</Badge>
      </span>

      <span className="c-actions" role="cell">
        <button
          type="button"
          className="btn-icon hint"
          data-hint="Ouvrir le dossier"
          aria-label={`Ouvrir ${dossier.id}`}
          onClick={(event) => { event.stopPropagation(); onOpen(); }}
        >
          <Icon paths={ICONS.eye} size={14} width={1.8} style={{ stroke: "#64748B" }} />
        </button>
        {fromScoring ? (
          <button
            type="button"
            className="btn-icon hint"
            data-hint="Masquer dans RCC"
            aria-label={`Masquer ${dossier.id} dans RCC`}
            onClick={(event) => { event.stopPropagation(); onHide(); }}
          >
            <Icon paths={ICONS.eyeOff} size={14} width={1.8} style={{ stroke: "#64748B" }} />
          </button>
        ) : (
          <button
            type="button"
            className="btn-icon btn-icon-danger hint"
            data-hint="Supprimer le dossier"
            aria-label={`Supprimer ${dossier.id}`}
            onClick={(event) => { event.stopPropagation(); onDelete(); }}
          >
            <Icon paths={ICONS.trash} size={13} width={1.8} />
          </button>
        )}
      </span>
    </div>
  );
}
