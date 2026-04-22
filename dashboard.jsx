import { useState, useEffect, useCallback, useRef } from "react";

// ─── Config ───────────────────────────────────────────────────────────────────
const API_BASE = "http://localhost:3001";

// ─── API helpers ──────────────────────────────────────────────────────────────
async function apiFetch(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const S = {
  root: {
    minHeight: "100vh",
    background: "#0a0c0f",
    color: "#c8cdd6",
    fontFamily: "'DM Mono', 'Fira Mono', 'Courier New', monospace",
    display: "flex",
    flexDirection: "column",
  },
  header: {
    borderBottom: "1px solid #1e2228",
    padding: "0 32px",
    height: 56,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    background: "#0c0f13",
  },
  logo: {
    fontSize: 13,
    letterSpacing: "0.18em",
    color: "#e2e6ec",
    fontWeight: 600,
    display: "flex",
    alignItems: "center",
    gap: 10,
  },
  logoDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: "#3de682",
    boxShadow: "0 0 8px #3de682",
    animation: "pulse 2s infinite",
  },
  nav: { display: "flex", gap: 4 },
  navBtn: (active) => ({
    padding: "6px 14px",
    fontSize: 11,
    letterSpacing: "0.1em",
    background: active ? "#1a2030" : "transparent",
    color: active ? "#7eb8f7" : "#555d6e",
    border: active ? "1px solid #263048" : "1px solid transparent",
    borderRadius: 4,
    cursor: "pointer",
    transition: "all 0.15s",
  }),
  main: { flex: 1, padding: "28px 32px", maxWidth: 1200, width: "100%", margin: "0 auto" },
  sectionTitle: {
    fontSize: 11,
    letterSpacing: "0.16em",
    color: "#4a5266",
    marginBottom: 16,
    textTransform: "uppercase",
  },

  // Stats
  statsRow: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 28 },
  statCard: (accent) => ({
    background: "#0e1116",
    border: `1px solid ${accent}22`,
    borderTop: `2px solid ${accent}`,
    borderRadius: 6,
    padding: "16px 20px",
  }),
  statVal: { fontSize: 28, fontWeight: 700, color: "#e2e6ec", lineHeight: 1 },
  statLabel: { fontSize: 10, color: "#4a5266", letterSpacing: "0.12em", marginTop: 6, textTransform: "uppercase" },

  // Table
  tableWrap: {
    background: "#0e1116",
    border: "1px solid #1a1f28",
    borderRadius: 6,
    overflow: "hidden",
    marginBottom: 28,
  },
  tableHead: { background: "#111520", borderBottom: "1px solid #1a1f28" },
  th: {
    padding: "10px 16px",
    fontSize: 10,
    letterSpacing: "0.12em",
    color: "#4a5266",
    textAlign: "left",
    textTransform: "uppercase",
    fontWeight: 600,
  },
  tr: (hover) => ({
    borderBottom: "1px solid #131820",
    background: hover ? "#111825" : "transparent",
    transition: "background 0.1s",
    cursor: "default",
  }),
  td: {
    padding: "11px 16px",
    fontSize: 12,
    color: "#9aa3b0",
    verticalAlign: "middle",
  },

  // Badges
  badge: (status) => {
    const map = {
      confirmed: { bg: "#0d2218", color: "#3de682", border: "#173824" },
      needs_review: { bg: "#221a09", color: "#f5a623", border: "#3a2a0a" },
      rejected: { bg: "#1e0d0d", color: "#e05454", border: "#311515" },
      parsed: { bg: "#111520", color: "#7eb8f7", border: "#1a2338" },
    };
    const c = map[status] || map.parsed;
    return {
      display: "inline-block",
      padding: "2px 8px",
      borderRadius: 3,
      fontSize: 10,
      letterSpacing: "0.1em",
      fontWeight: 600,
      background: c.bg,
      color: c.color,
      border: `1px solid ${c.border}`,
      textTransform: "uppercase",
    };
  },

  // Buttons
  btn: (variant) => {
    const v = {
      confirm: { bg: "#0d2218", color: "#3de682", border: "#173824", hover: "#112b1e" },
      reject: { bg: "#1e0d0d", color: "#e05454", border: "#311515", hover: "#261010" },
      primary: { bg: "#1a2a44", color: "#7eb8f7", border: "#263048", hover: "#1f3052" },
      ghost: { bg: "transparent", color: "#555d6e", border: "#1a1f28", hover: "#111520" },
    }[variant] || {};
    return {
      padding: "6px 12px",
      fontSize: 11,
      letterSpacing: "0.08em",
      background: v.bg,
      color: v.color,
      border: `1px solid ${v.border}`,
      borderRadius: 4,
      cursor: "pointer",
      transition: "background 0.15s",
      fontFamily: "inherit",
    };
  },

  // Input
  input: {
    background: "#111520",
    border: "1px solid #1e2430",
    borderRadius: 4,
    padding: "8px 12px",
    color: "#c8cdd6",
    fontSize: 12,
    fontFamily: "inherit",
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
  },

  // Toast
  toast: (type) => ({
    position: "fixed",
    bottom: 24,
    right: 24,
    padding: "12px 20px",
    borderRadius: 6,
    fontSize: 12,
    background: type === "error" ? "#1e0d0d" : "#0d2218",
    color: type === "error" ? "#e05454" : "#3de682",
    border: `1px solid ${type === "error" ? "#311515" : "#173824"}`,
    zIndex: 999,
    boxShadow: "0 4px 24px #00000080",
    maxWidth: 360,
  }),

  // Modal
  overlay: {
    position: "fixed", inset: 0,
    background: "#00000090",
    display: "flex", alignItems: "center", justifyContent: "center",
    zIndex: 100,
  },
  modal: {
    background: "#0e1116",
    border: "1px solid #1e2430",
    borderRadius: 8,
    padding: 28,
    width: 420,
    maxWidth: "90vw",
  },
  modalTitle: { fontSize: 13, color: "#e2e6ec", letterSpacing: "0.1em", marginBottom: 20 },

  // Chart
  chartRow: { display: "flex", gap: 4, alignItems: "flex-end", height: 60, marginTop: 8 },
  chartBar: (h, color) => ({
    flex: 1,
    height: `${Math.max(4, h)}%`,
    background: color,
    borderRadius: "2px 2px 0 0",
    opacity: 0.85,
    transition: "height 0.3s",
    minWidth: 8,
  }),
};

// ─── Toast ────────────────────────────────────────────────────────────────────
function Toast({ message, type, onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3000);
    return () => clearTimeout(t);
  }, [onDone]);
  return <div style={S.toast(type)}>{message}</div>;
}

// ─── Confirm Modal ────────────────────────────────────────────────────────────
function ConfirmModal({ order, onClose, onConfirm }) {
  const [name, setName] = useState(order.name);
  const [item, setItem] = useState(order.item);
  const [qty, setQty] = useState(String(order.quantity));

  function handleSubmit() {
    const quantity = parseInt(qty, 10);
    if (!quantity || quantity < 1) return;
    onConfirm(order.id, { name, item, quantity });
  }

  return (
    <div style={S.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={S.modal}>
        <div style={S.modalTitle}>CONFIRM ORDER — REVIEW & EDIT</div>
        <div style={{ fontSize: 10, color: "#4a5266", marginBottom: 16, letterSpacing: "0.08em" }}>
          RAW INPUT
        </div>
        <div style={{
          background: "#0a0c0f", border: "1px solid #1a1f28", borderRadius: 4,
          padding: "8px 12px", fontSize: 11, color: "#7eb8f7", marginBottom: 20,
        }}>
          {order.raw_input}
        </div>

        {[
          ["NAME", name, setName, "text"],
          ["ITEM", item, setItem, "text"],
          ["QUANTITY", qty, setQty, "number"],
        ].map(([label, val, setter, type]) => (
          <div key={label} style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, color: "#4a5266", letterSpacing: "0.08em", marginBottom: 6 }}>
              {label}
            </div>
            <input
              style={S.input}
              type={type}
              value={val}
              onChange={(e) => setter(e.target.value)}
              min={type === "number" ? 1 : undefined}
            />
          </div>
        ))}

        <div style={{ display: "flex", gap: 10, marginTop: 20, justifyContent: "flex-end" }}>
          <button style={S.btn("ghost")} onClick={onClose}>CANCEL</button>
          <button style={S.btn("confirm")} onClick={handleSubmit}>CONFIRM ORDER</button>
        </div>
      </div>
    </div>
  );
}

// ─── Parse Modal ──────────────────────────────────────────────────────────────
function ParseModal({ onClose, onParsed }) {
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState(null);
  const [err, setErr] = useState("");

  async function handleParse() {
    if (!msg.trim()) return;
    setLoading(true);
    setErr("");
    try {
      const res = await apiFetch("/api/orders", {
        method: "POST",
        body: JSON.stringify({ message: msg }),
      });
      setPreview(res);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={S.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={S.modal}>
        <div style={S.modalTitle}>SUBMIT ORDER MESSAGE</div>
        <textarea
          style={{ ...S.input, height: 80, resize: "vertical", marginBottom: 12 }}
          placeholder={"John: 2 pizzas\nOrder – Mary, 3 sodas\nI need 5 chapati – James"}
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
        />
        {err && <div style={{ color: "#e05454", fontSize: 11, marginBottom: 10 }}>{err}</div>}
        {preview && (
          <div style={{
            background: "#0a0c0f", border: "1px solid #1a1f28", borderRadius: 4,
            padding: 12, marginBottom: 14, fontSize: 11,
          }}>
            {[
              ["Name", preview.order?.name],
              ["Item", preview.order?.item],
              ["Qty", preview.order?.quantity],
              ["Status", preview.order?.status],
              ["Duplicate", preview.duplicate ? "yes" : "no"],
            ].map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ color: "#4a5266" }}>{k}</span>
                <span style={{ color: "#c8cdd6" }}>{String(v ?? "—")}</span>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button style={S.btn("ghost")} onClick={onClose}>CLOSE</button>
          <button style={S.btn("primary")} onClick={handleParse} disabled={loading}>
            {loading ? "PARSING…" : "PARSE & STORE"}
          </button>
          {preview && (
            <button style={S.btn("confirm")} onClick={() => { onParsed(); onClose(); }}>
              DONE
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Order Row ────────────────────────────────────────────────────────────────
function OrderRow({ order, onAction }) {
  const [hover, setHover] = useState(false);

  const flags = order.review_flags || {};
  const flagList = [
    flags.nameUnknown && "no-name",
    flags.itemEmpty && "no-item",
    flags.quantityDefault && "qty-default",
  ].filter(Boolean);

  return (
    <tr
      style={S.tr(hover)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <td style={S.td}>
        <span style={{ color: "#3a4255", fontSize: 10 }}>{order.id.slice(0, 8)}</span>
      </td>
      <td style={{ ...S.td, color: "#e2e6ec", fontWeight: 600 }}>{order.name}</td>
      <td style={S.td}>{order.item || <span style={{ color: "#3a4255" }}>—</span>}</td>
      <td style={{ ...S.td, color: "#7eb8f7" }}>{order.quantity}</td>
      <td style={S.td}><span style={S.badge(order.status)}>{order.status.replace("_", " ")}</span></td>
      <td style={S.td}>
        {flagList.length > 0 ? (
          <span style={{ fontSize: 10, color: "#f5a623" }}>{flagList.join(", ")}</span>
        ) : (
          <span style={{ color: "#3a4255" }}>—</span>
        )}
      </td>
      <td style={{ ...S.td, color: "#3a4255", fontSize: 10 }}>
        {new Date(order.created_at).toLocaleTimeString()}
      </td>
      <td style={S.td}>
        <div style={{ display: "flex", gap: 6 }}>
          {order.status !== "confirmed" && order.status !== "rejected" && (
            <>
              <button style={{ ...S.btn("confirm"), padding: "4px 10px" }}
                onClick={() => onAction("confirm", order)}>✓</button>
              <button style={{ ...S.btn("reject"), padding: "4px 10px" }}
                onClick={() => onAction("reject", order)}>✗</button>
            </>
          )}
          {order.status === "confirmed" && (
            <span style={{ fontSize: 10, color: "#3de68270" }}>✓ DONE</span>
          )}
          {order.status === "rejected" && (
            <span style={{ fontSize: 10, color: "#e0545470" }}>✗ VOID</span>
          )}
        </div>
      </td>
    </tr>
  );
}

// ─── Metrics View ─────────────────────────────────────────────────────────────
function MetricsView() {
  const [metrics, setMetrics] = useState(null);

  useEffect(() => {
    apiFetch("/api/metrics").then(setMetrics).catch(() => {});
  }, []);

  if (!metrics) return (
    <div style={{ color: "#3a4255", fontSize: 12, padding: 32 }}>Loading metrics…</div>
  );

  const { totals, daily, duplicates } = metrics;
  const successRate = totals.total > 0
    ? Math.round(100 * (totals.confirmed + totals.parsed) / totals.total)
    : 0;

  const maxDaily = Math.max(...(daily || []).map(d => d.total), 1);

  return (
    <div>
      <div style={S.sectionTitle}>PIPELINE METRICS</div>
      <div style={S.statsRow}>
        {[
          ["TOTAL ORDERS", totals.total, "#7eb8f7"],
          ["CONFIRMED", totals.confirmed, "#3de682"],
          ["NEEDS REVIEW", totals.needs_review, "#f5a623"],
          ["DUPLICATES BLOCKED", duplicates, "#e05454"],
        ].map(([label, val, color]) => (
          <div key={label} style={S.statCard(color)}>
            <div style={{ ...S.statVal, color }}>{val ?? 0}</div>
            <div style={S.statLabel}>{label}</div>
          </div>
        ))}
      </div>

      <div style={{ ...S.tableWrap, padding: "20px 24px", marginBottom: 28 }}>
        <div style={S.sectionTitle}>PARSE SUCCESS RATE — {successRate}%</div>
        <div style={{
          height: 6, background: "#111520", borderRadius: 3, overflow: "hidden",
        }}>
          <div style={{
            height: "100%", width: `${successRate}%`,
            background: `linear-gradient(90deg, #7eb8f7, #3de682)`,
            borderRadius: 3, transition: "width 0.6s",
          }} />
        </div>
      </div>

      <div style={{ ...S.tableWrap, padding: "20px 24px" }}>
        <div style={S.sectionTitle}>DAILY VOLUME — LAST 14 DAYS</div>
        <div style={S.chartRow}>
          {(daily || []).slice().reverse().map((d) => (
            <div key={d.day} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
              <div style={S.chartBar((d.clean / Math.max(d.total, 1)) * 100, "#7eb8f7")} title={`${d.day}: ${d.total} orders`} />
              <span style={{ fontSize: 8, color: "#3a4255", transform: "rotate(-45deg)", transformOrigin: "center" }}>
                {d.day?.slice(5)}
              </span>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 16, marginTop: 12 }}>
          {[["#7eb8f7", "Clean"], ["#f5a623", "Review"]].map(([c, l]) => (
            <span key={l} style={{ fontSize: 10, color: "#4a5266", display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 8, height: 8, background: c, borderRadius: 2, display: "inline-block" }} />
              {l}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Orders View ──────────────────────────────────────────────────────────────
function OrdersView() {
  const [orders, setOrders] = useState([]);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState("");
  const [confirmTarget, setConfirmTarget] = useState(null);
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showParseModal, setShowParseModal] = useState(false);
  const pollRef = useRef(null);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const qs = statusFilter ? `?status=${statusFilter}` : "";
      const data = await apiFetch(`/api/orders${qs}`);
      setOrders(data.orders || []);
      setTotal(data.total || 0);
    } catch (e) {
      showToast(e.message, "error");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchOrders();
    pollRef.current = setInterval(fetchOrders, 8000);
    return () => clearInterval(pollRef.current);
  }, [fetchOrders]);

  function showToast(message, type = "success") {
    setToast({ message, type });
  }

  async function handleAction(action, order) {
    if (action === "confirm") {
      setConfirmTarget(order);
      return;
    }
    try {
      await apiFetch(`/api/orders/${order.id}/reject`, { method: "PATCH" });
      showToast("Order rejected");
      fetchOrders();
    } catch (e) {
      showToast(e.message, "error");
    }
  }

  async function handleConfirm(id, overrides) {
    try {
      await apiFetch(`/api/orders/${id}/confirm`, {
        method: "PATCH",
        body: JSON.stringify(overrides),
      });
      setConfirmTarget(null);
      showToast("Order confirmed ✓");
      fetchOrders();
    } catch (e) {
      showToast(e.message, "error");
    }
  }

  const reviewCount = orders.filter(o => o.status === "needs_review").length;

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <div style={S.sectionTitle}>ORDERS — {total} TOTAL</div>
          {reviewCount > 0 && (
            <span style={{
              background: "#221a09", color: "#f5a623", border: "1px solid #3a2a0a",
              borderRadius: 10, padding: "1px 8px", fontSize: 10,
            }}>
              {reviewCount} NEED REVIEW
            </span>
          )}
          {loading && <span style={{ fontSize: 10, color: "#3a4255" }}>syncing…</span>}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <select
            style={{ ...S.input, width: "auto", padding: "6px 10px", fontSize: 11 }}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">ALL STATUS</option>
            <option value="needs_review">NEEDS REVIEW</option>
            <option value="parsed">PARSED</option>
            <option value="confirmed">CONFIRMED</option>
            <option value="rejected">REJECTED</option>
          </select>
          <button style={S.btn("primary")} onClick={() => setShowParseModal(true)}>
            + PARSE MESSAGE
          </button>
        </div>
      </div>

      {/* Table */}
      <div style={S.tableWrap}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead style={S.tableHead}>
            <tr>
              {["ID", "NAME", "ITEM", "QTY", "STATUS", "FLAGS", "TIME", "ACTIONS"].map(h => (
                <th key={h} style={S.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 && (
              <tr>
                <td colSpan={8} style={{ ...S.td, textAlign: "center", color: "#3a4255", padding: 40 }}>
                  {loading ? "Loading…" : "No orders yet — submit a message to get started"}
                </td>
              </tr>
            )}
            {orders.map((o) => (
              <OrderRow key={o.id} order={o} onAction={handleAction} />
            ))}
          </tbody>
        </table>
      </div>

      {/* Modals */}
      {confirmTarget && (
        <ConfirmModal
          order={confirmTarget}
          onClose={() => setConfirmTarget(null)}
          onConfirm={handleConfirm}
        />
      )}
      {showParseModal && (
        <ParseModal
          onClose={() => setShowParseModal(false)}
          onParsed={fetchOrders}
        />
      )}
      {toast && (
        <Toast message={toast.message} type={toast.type} onDone={() => setToast(null)} />
      )}
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState("orders");

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #0a0c0f; }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        select option { background: #0e1116; color: #c8cdd6; }
        textarea::placeholder { color: #2a3040; }
        input[type=number]::-webkit-inner-spin-button { opacity: 0.3; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: #0a0c0f; }
        ::-webkit-scrollbar-thumb { background: #1a1f28; border-radius: 3px; }
      `}</style>

      <div style={S.root}>
        {/* Header */}
        <div style={S.header}>
          <div style={S.logo}>
            <div style={S.logoDot} />
            ORDER CAPTURE SYSTEM
          </div>
          <nav style={S.nav}>
            {[["orders", "ORDERS"], ["metrics", "METRICS"]].map(([key, label]) => (
              <button key={key} style={S.navBtn(tab === key)} onClick={() => setTab(key)}>
                {label}
              </button>
            ))}
          </nav>
        </div>

        {/* Main */}
        <main style={S.main}>
          {tab === "orders" && <OrdersView />}
          {tab === "metrics" && <MetricsView />}
        </main>

        {/* Footer */}
        <div style={{
          borderTop: "1px solid #111520", padding: "10px 32px",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <span style={{ fontSize: 10, color: "#2a3040", letterSpacing: "0.08em" }}>
            ORDER CAPTURE v1.0 — SQLITE + SHEETS
          </span>
          <span style={{ fontSize: 10, color: "#2a3040" }}>
            {new Date().toLocaleDateString()} · auto-refreshes every 8s
          </span>
        </div>
      </div>
    </>
  );
}
