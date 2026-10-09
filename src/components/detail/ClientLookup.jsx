/*
 * Référentiel clients : n° tiers envoyé à Ekip.
 *  - un seul client trouvé  → n° tiers retenu, définitif ;
 *  - plusieurs clients      → l'analyste en choisit un ;
 *  - aucun / API en panne   → l'analyste saisit le n° tiers.
 */

import { useEffect, useState } from "react";

// Recherche à relancer : échec de l'API, recherche non faite, ou aucun client trouvé.
const RETRYABLE = new Set(["ERROR", "SKIPPED", "NOT_FOUND", null]);

export default function ClientLookup({ identite, onSaveTiers, onRefresh }) {
  const lookup = identite.client_lookup || null;
  const status = lookup?.status || null;
  const matches = lookup?.matches || identite.matched_clients || [];
  const tiers = identite.tiers || null;
  // N° tiers déjà saisi (aucun client, API indisponible) : la recherche n'a plus d'utilité.
  const searchPending = RETRYABLE.has(status) && !tiers;
  const [refreshing, setRefreshing] = useState(false);

  async function refresh() {
    if (refreshing) return;
    setRefreshing(true);
    await onRefresh();
    setRefreshing(false);
  }

  return (
    <div className="client-lookup-block" aria-label="Rapprochement client Wafabail">
      <div className="client-lookup-head">
        <span className="analysis-kicker">Référentiel clients</span>
        <span className="client-lookup-status">
          {onRefresh && searchPending ? (
            <button
              type="button"
              className={`btn btn-ghost btn-sm${refreshing ? " is-busy" : ""}`}
              disabled={refreshing}
              onClick={refresh}
            >
              <span className="btn-label">{refreshing ? "Recherche…" : "Relancer la recherche"}</span>
              <span className="btn-spinner" aria-hidden="true" />
            </button>
          ) : null}
        </span>
      </div>

      {status === "MATCHED" ? (
        <MatchedClient tiers={tiers} client={lookup?.primary || matches[0]} />
      ) : status === "MULTIPLE" ? (
        <ChooseClient
          matches={matches}
          tiers={identite.tiers_source === "selected" ? tiers : null}
          onSaveTiers={onSaveTiers}
        />
      ) : (
        <>
          {searchPending && lookup?.message ? <p className="client-lookup-msg">{lookup.message}</p> : null}
          <ManualTiers tiers={tiers} onSaveTiers={onSaveTiers} />
        </>
      )}
    </div>
  );
}

/** Cas 3 : un seul client, n° tiers retenu automatiquement et définitif. */
function MatchedClient({ tiers, client }) {
  return (
    <p className="client-lookup-chosen">
      N° tiers <b className="mono">{tiers || client?.tiers || "—"}</b>
      {client?.raison_sociale ? <span> · {client.raison_sociale}</span> : null}
    </p>
  );
}

/** Cas 2 : plusieurs clients, l'analyste en choisit un. */
function ChooseClient({ matches, tiers, onSaveTiers }) {
  const [editing, setEditing] = useState(!tiers);
  const [selected, setSelected] = useState(tiers || "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setEditing(!tiers);
    setSelected(tiers || "");
  }, [tiers]);

  if (!editing) {
    const client = matches.find((item) => item.tiers === tiers);
    return (
      <div className="client-lookup-saved">
        <p className="client-lookup-chosen">
          Client retenu · n° tiers <b className="mono">{tiers}</b>
          {client?.raison_sociale ? <span> · {client.raison_sociale}</span> : null}
        </p>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>
          Changer
        </button>
      </div>
    );
  }

  async function save() {
    if (!selected || busy) return;
    setBusy(true);
    const ok = await onSaveTiers(selected, "selected");
    setBusy(false);
    if (ok) setEditing(false);
  }

  return (
    <div className="client-lookup-choice">
      <p className="client-lookup-msg">
        {`${matches.length} clients correspondent aux identifiants extraits : choisissez celui du dossier.`}
      </p>
      <fieldset className="client-lookup-options">
        <legend className="sr-only">Client du dossier</legend>
        {matches.map((item, index) => (
          <label
            key={`${item.tiers || "sans-tiers"}-${index}`}
            className={`client-lookup-option${selected === item.tiers ? " is-checked" : ""}`}
          >
            <input
              type="radio"
              name="client-lookup-choice"
              value={item.tiers || ""}
              disabled={!item.tiers}
              checked={selected === item.tiers}
              onChange={() => setSelected(item.tiers)}
            />
            <span className="client-lookup-option-main">
              <b className="mono">{item.tiers || "sans n° tiers"}</b>
              <span>{item.raison_sociale || "Sans raison sociale"}</span>
            </span>
            <span className="client-lookup-option-ids">
              {[item.ice && `ICE ${item.ice}`, item.rc && `RC ${item.rc}`, item.identifiant_fiscal && `IF ${item.identifiant_fiscal}`]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </label>
        ))}
      </fieldset>
      <div className="client-lookup-actions">
        {tiers ? (
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setEditing(false)}>
            Annuler
          </button>
        ) : null}
        <button
          type="button"
          className={`btn btn-primary btn-sm${busy ? " is-busy" : ""}`}
          disabled={!selected || busy}
          onClick={save}
        >
          <span className="btn-label">Enregistrer ce client</span>
          <span className="btn-spinner" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

/** Cas 1 : aucun client (ou API indisponible), l'analyste saisit le n° tiers. */
function ManualTiers({ tiers, onSaveTiers }) {
  const [editing, setEditing] = useState(!tiers);
  const [value, setValue] = useState(tiers || "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setEditing(!tiers);
    setValue(tiers || "");
  }, [tiers]);

  if (!editing) {
    return (
      <div className="client-lookup-saved">
        <p className="client-lookup-chosen">
          N° tiers saisi <b className="mono">{tiers}</b>
        </p>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>
          Modifier
        </button>
      </div>
    );
  }

  const trimmed = value.trim();

  async function save(event) {
    event.preventDefault();
    if (!trimmed || busy) return;
    setBusy(true);
    const ok = await onSaveTiers(trimmed, "manual");
    setBusy(false);
    if (ok) setEditing(false);
  }

  return (
    <form className="client-lookup-manual" onSubmit={save}>
      <label htmlFor="manualTiers">N° tiers</label>
      <input
        id="manualTiers"
        type="text"
        autoComplete="off"
        maxLength={30}
        placeholder="Saisissez le n° tiers du client"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      {tiers ? (
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setEditing(false)}>
          Annuler
        </button>
      ) : null}
      <button type="submit" className={`btn btn-primary btn-sm${busy ? " is-busy" : ""}`} disabled={!trimmed || busy}>
        <span className="btn-label">Enregistrer</span>
        <span className="btn-spinner" aria-hidden="true" />
      </button>
    </form>
  );
}
