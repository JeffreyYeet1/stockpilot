import { Fragment, useEffect, useMemo, useState } from "react";
import { useFetcher } from "react-router";
import { buildRows, STALE_MS, type Inventory, type SavedRule, type Status } from "../inventory/model";

type DashboardData = { inventory: Inventory | null; rules: SavedRule[]; refreshedAt: string | null; error: string | null };
type ActionResult = { message: string | null; error: string | null };
type Row = ReturnType<typeof buildRows>[number];
type Sort = "score" | "name" | "available" | "reorder";
const statuses: Status[] = ["Out of stock", "Low stock", "Healthy", "Unavailable", "Untracked"];
const PAGE_SIZE = 10;
const number = new Intl.NumberFormat("en");
const tones: Record<Status, string> = {
  "Out of stock": "red", "Low stock": "amber", Healthy: "green", Unavailable: "gray", Untracked: "gray",
};
const format = (value: number | null) => value === null ? "—" : number.format(value);

function Brand({ demo }: { demo?: boolean }) {
  return <div className="sp-brand">
    <span className="sp-logo" aria-hidden="true"><i /><i /><i /></span>
    <strong>StockPilot</strong>
    <span className="sp-brand-divider" />
    <span className="sp-workspace">Inventory</span>
    <span className={`sp-source ${demo ? "sp-source-demo" : ""}`}>{demo ? "Demo mode" : "Shopify Admin"}</span>
  </div>;
}

export function DashboardLoading({ demo, failed }: { demo?: boolean; failed?: boolean }) {
  return <main className="sp">
    <Brand demo={demo} />
    <div className="sp-content">
      <h1>Inventory risk</h1>
      <p role={failed ? "alert" : "status"}>{failed ? "Inventory couldn’t be displayed. Reload the page to try again." : "Loading inventory snapshot…"}</p>
      {!failed && <div className="sp-skeleton" aria-hidden="true"><i /><i /><i /><i /></div>}
    </div>
  </main>;
}

export function Dashboard({ data, demo }: { data: DashboardData; demo?: boolean }) {
  const fetcher = useFetcher<ActionResult>();
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState<{ key: Sort; direction: number }>({ key: "score", direction: -1 });
  const [expanded, setExpanded] = useState("");
  const [page, setPage] = useState(0);
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [data.refreshedAt]);

  const selectedLocation = data.inventory?.locations.some(item => item.id === location) ? location : "";
  const rows = useMemo(() => data.inventory ? buildRows(data.inventory, data.rules, selectedLocation) : [],
    [data.inventory, data.rules, selectedLocation]);
  const out = rows.filter(row => row.status === "Out of stock").length;
  const low = rows.filter(row => row.status === "Low stock").length;
  const shortageLocations = new Set(rows.flatMap(row => row.details
    .filter(detail => detail.status === "Low stock" || detail.status === "Out of stock").map(detail => detail.id))).size;
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return rows.filter(row => (!status || row.status === status) &&
      [row.variant.product.title, row.variant.title, row.variant.sku].some(value => value?.toLowerCase().includes(term)))
      .sort((a, b) => compare(a, b, sort.key, sort.direction));
  }, [rows, query, status, sort]);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1));
  const start = currentPage * PAGE_SIZE;
  const pending = fetcher.state !== "idle";
  const refreshing = pending && fetcher.formData?.get("intent") === "refresh";
  const stale = data.refreshedAt && now - Date.parse(data.refreshedAt) >= STALE_MS;

  function changeSort(key: Sort) {
    setSort({ key, direction: key === sort.key ? -sort.direction : key === "name" || key === "available" ? 1 : -1 });
    setPage(0);
  }

  function sortHead(label: string, key: Sort, className?: string) {
    return <th scope="col" className={className} aria-sort={sort.key === key ? sort.direction > 0 ? "ascending" : "descending" : undefined}>
      <button type="button" onClick={() => changeSort(key)}>{label} <span aria-hidden="true">{sort.key === key ? sort.direction > 0 ? "↑" : "↓" : "↕"}</span></button>
    </th>;
  }

  return <main className="sp">
    <Brand demo={demo} />
    <div className="sp-content">
      <header className="sp-heading">
        <div>
          <h1>Inventory risk</h1>
          <p>Identify shortages and prioritize replenishment across your locations.</p>
        </div>
        <div className="sp-refresh">
          <fetcher.Form method="post">
            <button type="submit" className="sp-primary" name="intent" value="refresh" disabled={pending}>
              <span aria-hidden="true" className={refreshing ? "sp-spin" : ""}>↻</span> {refreshing ? "Refreshing…" : "Refresh inventory"}
            </button>
          </fetcher.Form>
        </div>
      </header>
      {demo && <div className="sp-notice"><strong>Sample inventory</strong><span>Demo data only. Live Shopify inventory is available in the embedded app.</span></div>}
      {stale && <div className="sp-notice sp-warning" role="status"><strong>Stale snapshot</strong><span>Inventory is at least 30 minutes old. Refresh to check current quantities.</span></div>}
      {(fetcher.data?.error || (data.error && !fetcher.data?.message)) &&
        <div className="sp-notice sp-error" role="alert">{fetcher.data?.error || data.error}</div>}
      {fetcher.data?.message && !pending && <div className="sp-notice" role="status">{fetcher.data.message}</div>}

      <div className="sp-overview">
        <h2>Stock overview</h2>
        <span className="sp-timestamp"><i className={stale || !data.refreshedAt ? "sp-dot sp-muted-dot" : "sp-dot"} />
          {data.refreshedAt ? <>Snapshot <time dateTime={data.refreshedAt}>
            {new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(data.refreshedAt))} UTC
          </time></> : "No snapshot yet"}</span>
      </div>
      <section className="sp-metrics" aria-label="Stock overview">
        <Metric label="Out of stock" value={data.inventory ? out : null} hint="Zero or below at any location" tone="red" icon="!" />
        <Metric label="Low stock" value={data.inventory ? low : null} hint="At or below the threshold" tone="amber" icon="↘" />
        <Metric label="Locations with shortages" value={data.inventory ? shortageLocations : null}
          hint={`Of ${selectedLocation ? 1 : data.inventory?.locations.length ?? 0} in view`} tone="green" icon="⌖" />
        <Metric label="Variants in scope" value={data.inventory ? rows.length : null} hint="Across the selected locations" tone="gray" icon="▦" />
      </section>

      <section className="sp-panel" aria-labelledby="sp-table-heading">
        <div className="sp-panel-heading">
          <div><h2 id="sp-table-heading">Variant risk</h2><p>Open a variant to see location quantities and edit its stock rule.</p></div>
          <span className="sp-score-caption">Risk score <b>0–100</b></span>
        </div>
        <div className="sp-filters">
          <label className="sp-search"><span aria-hidden="true">⌕</span><input type="search" aria-label="Search variants"
            placeholder="Search by product, variant or SKU" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} /></label>
          <label><span className="sp-sr">Location</span><select value={selectedLocation} onChange={event => { setLocation(event.target.value); setPage(0); }}>
            <option value="">All locations</option>
            {data.inventory?.locations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></label>
          <label><span className="sp-sr">Stock status</span><select value={status} onChange={event => { setStatus(event.target.value); setPage(0); }}>
            <option value="">All statuses</option>
            {statuses.map(item => <option key={item}>{item}</option>)}
          </select></label>
        </div>
        {filtered.length > 0 ? <div className="sp-table-wrap" tabIndex={0} role="region" aria-label="Sortable variant inventory">
          <table>
            <thead><tr>
              {sortHead("Product / Variant", "name")}
              <th scope="col">SKU</th><th scope="col">Status</th>
              {sortHead("Risk score", "score", "sp-number")}
              {sortHead("Available", "available", "sp-number")}
              {sortHead("Reorder qty", "reorder", "sp-number")}
            </tr></thead>
            <tbody>
              {filtered.slice(start, start + PAGE_SIZE).map(row => {
                const open = expanded === row.variant.id;
                const product = row.variant.product.title;
                const detailId = `stock-${encodeURIComponent(row.variant.id)}`;
                return <Fragment key={row.variant.id}>
                  <tr className={open ? "sp-open" : undefined}>
                    <td><button type="button" className="sp-variant" aria-expanded={open}
                      aria-controls={open ? detailId : undefined}
                      onClick={() => setExpanded(open ? "" : row.variant.id)}>
                      <span className="sp-caret" aria-hidden="true">{open ? "⌄" : "›"}</span>
                      <span className={`sp-tile sp-tile-${product.length % 4}`} aria-hidden="true">{product.trim().split(/\s+/).slice(0, 2).map(word => word[0]).join("")}</span>
                      <span><strong>{product}</strong><small>{row.variant.title}</small></span>
                    </button></td>
                    <td className="sp-sku">{row.variant.sku || "—"}</td>
                    <td><Badge status={row.status} /></td>
                    <td className="sp-number"><span className={`sp-risk sp-${tones[row.status]}`}>{format(row.score)}</span></td>
                    <td className="sp-number">{format(row.available)}{row.covered > 0 && row.covered < row.details.length && <sup title="Some locations have no available quantity">†</sup>}</td>
                    <td className="sp-number"><strong>{format(row.reorder)}</strong></td>
                  </tr>
                  {open && <tr className="sp-detail-row"><td colSpan={6}>
                    <div id={detailId} className="sp-details">
                      <section>
                        <h3>Location breakdown</h3>
                        {row.details.length ? <ul>
                          {row.details.map(detail => <li key={detail.id}>
                            <div><strong>{detail.name}</strong><Badge status={detail.status} /></div>
                            <span>{format(detail.available)} available</span><span>{format(detail.reorder)} suggested</span>
                          </li>)}
                        </ul> : <p>No active locations are available in this snapshot.</p>}
                      </section>
                      <section className="sp-rule">
                        <h3>Stock rule</h3>
                        {row.variant.sku?.trim() ? <fetcher.Form key={`${row.variant.id}:${row.rule.threshold}:${row.rule.target}`} method="post">
                          <input type="hidden" name="sku" value={row.variant.sku.trim()} />
                          <p>Applied to every location for this SKU.</p>
                          <div className="sp-rule-inputs">
                            <label>Low threshold<input name="threshold" type="number" min={1} max={1_000_000} step={1} defaultValue={row.rule.threshold} required /></label>
                            <label>Target stock<input name="target" type="number" min={1} max={1_000_000} step={1} defaultValue={row.rule.target} required /></label>
                          </div>
                          <div className="sp-rule-actions">
                            <button className="sp-primary" type="submit" name="intent" value="save-rule" disabled={pending}>Save rule</button>
                            <button className="sp-secondary" type="submit" name="intent" value="reset-rule" formNoValidate disabled={pending}>Use defaults</button>
                          </div>
                        </fetcher.Form> : <p>This variant uses the default rule. Add a SKU in Shopify to save an override.</p>}
                      </section>
                    </div>
                  </td></tr>}
                </Fragment>;
              })}
            </tbody>
          </table>
        </div> : <div className="sp-empty">
          <h3>{!data.inventory ? "Inventory is unavailable" : !rows.length ? "No variants found" : "No matching variants"}</h3>
          <p>{!data.inventory ? "Refresh inventory to try again." : !rows.length ?
            "Add products in Shopify, then refresh the snapshot." : "Adjust the search or filters to see more inventory."}</p>
        </div>}
        <footer className="sp-table-footer">
          <span>{filtered.length ? `${start + 1}–${Math.min(start + PAGE_SIZE, filtered.length)} of ${format(filtered.length)} variants` : "0 variants"}</span>
          <div className="sp-pager">
            <button type="button" className="sp-secondary" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button>
            <button type="button" className="sp-secondary" disabled={start + PAGE_SIZE >= filtered.length} onClick={() => setPage(currentPage + 1)}>Next</button>
          </div>
        </footer>
      </section>
      <p className="sp-footnote"><strong>Rule-based reorder suggestions.</strong> Each location’s suggestion is the target stock minus available stock, with a minimum of zero. Suggestions use no demand forecast. <strong>†</strong> Partial totals use known quantities.</p>
    </div>
  </main>;
}

function Badge({ status }: { status: Status }) {
  return <span className={`sp-badge sp-${tones[status]}`}><i />{status}</span>;
}

function Metric({ label, value, hint, tone, icon }: { label: string; value: number | null; hint: string; tone: string; icon: string }) {
  return <article className="sp-metric">
    <div><span className={`sp-metric-icon sp-${tone}`} aria-hidden="true">{icon}</span><h3>{label}</h3></div>
    <strong>{format(value)}</strong>
    <p>{hint}</p>
  </article>;
}

function compare(a: Row, b: Row, key: Sort, direction: number) {
  const byName = a.variant.product.title.localeCompare(b.variant.product.title) ||
    a.variant.title.localeCompare(b.variant.title);
  const tie = byName || a.variant.id.localeCompare(b.variant.id);
  if (key === "name") return (byName * direction) || tie;
  const x = a[key], y = b[key];
  if (x === null || y === null) return x === y ? tie : x === null ? 1 : -1;
  return (x - y) * direction || tie;
}
