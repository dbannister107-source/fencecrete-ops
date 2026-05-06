// Shared definitions for the contract-readiness UI surfaces.
// Single source of truth for the auto-check labels, manual checklist
// items, and required-vs-optional split. Imported by:
//   - src/features/contracts-workbench/ContractsWorkbenchPage.jsx
//   - src/App.jsx (EditPanel "Contract Readiness" card)
//   - src/App.jsx (CoPilotHome blocked-contracts insight)
//
// Keep this file authoritative — do not redefine these in any consumer.

// Keys must match v_contract_readiness.auto_checks JSONB keys.
//
// 2026-05-06 — `customer_linked` removed per CEO direction. Customer Master
// + the lookup UI in NewProjectForm + EditPanel Details tab stay (recommended
// for commercial), but linking is no longer a contract-advance blocker.
// Migration: 20260506_readiness_gate_drop_customer_linked.
export const AUTO_LABELS = {
  style_set:                 'Style selected',
  color_set:                 'Color selected',
  height_set:                'Height set',
  total_lf_set:              'LF entered',
  contract_value_set:        'Contract value',
  line_items_entered:        'Line items entered',
  line_items_match_contract: 'Line items reconcile to contract',
};

// PIS + Payment terms are universally required (block status advancement).
// The other 4 are optional documentation — Amiee ticks them when they
// happen but they don't block contract advance.
export const MANUAL_ITEMS = [
  { key: 'pis_submitted',        label: 'PIS submitted',        required: true  },
  { key: 'payment_terms',        label: 'Payment terms',        required: true  },
  { key: 'deposit_received',     label: 'Deposit received',     required: false },
  { key: 'tax_cert',             label: 'Tax cert',             required: false },
  { key: 'engineering_drawings', label: 'Engineering drawings', required: false },
  { key: 'wet_signatures',       label: 'Wet signatures',       required: false },
];

export const MANUAL_LABELS = Object.fromEntries(
  MANUAL_ITEMS.map((i) => [i.key, i.label])
);

export const REQUIRED_MANUAL = MANUAL_ITEMS.filter((i) => i.required);
