export const SOURCE_LABEL: Record<string, string> = {
  order: "From an order", playbook: "Playbook", ecourts: "eCourts", whatsapp: "WhatsApp", manual: "Manual", client_update: "Client update", hearing_note: "Hearing note", system: "Nyaay",
};
export const STATUS_LABEL: Record<string, string> = { active: "Active", on_hold: "On hold", closed: "Closed" };
export const DETAIL_FIELDS: Record<string, string> = {
  complainant_name: "Complainant (payee) name", complainant_address: "Complainant address",
  accused_name: "Accused (drawer) name", accused_address: "Accused address",
  cheque_no: "Cheque number", cheque_amount: "Cheque amount (₹)", drawee_bank: "Drawee bank and branch",
  liability: "Debt or liability the cheque was given for", return_reason: "Reason on the bank return memo",
  advocate_name: "Advocate name", advocate_address: "Advocate address or chamber", court_place: "Court and place of filing",
};
