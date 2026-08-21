/**
 * Lists every WhatsApp message template on the configured Business Account,
 * with the exact name and language code Meta has stored for each.
 *
 * Read-only: it sends no messages and prints no credentials.
 *
 * Why this exists: the Meta UI shows a human-readable language ("English"),
 * but a template is addressed by its language CODE (en, en_US, en_GB). A
 * mismatch fails with error #132001 "Template name does not exist in the
 * translation", which reads like a missing template rather than a wrong code.
 * This prints the codes so the value for WHATSAPP_TEMPLATE_LANG is not a guess.
 *
 * Usage:
 *   1. Add your WhatsApp Business Account ID to backend/.env:
 *        WHATSAPP_WABA_ID=123456789012345
 *      (Meta for Developers -> your App -> WhatsApp -> API Setup)
 *   2. npm run whatsapp:templates
 */
require('dotenv').config();

const VERSION = process.env.WHATSAPP_API_VERSION || 'v21.0';
const TOKEN = (process.env.WHATSAPP_ACCESS_TOKEN || '').trim();
const WABA = (process.env.WHATSAPP_WABA_ID || '').trim();
const WANTED = (process.env.WHATSAPP_DEFECT_TEMPLATE || 'defective_piece_notification').trim();
const CONFIGURED_LANG = (process.env.WHATSAPP_TEMPLATE_LANG || 'en').trim();

(async () => {
  if (!TOKEN) {
    console.error('WHATSAPP_ACCESS_TOKEN is not set in backend/.env');
    process.exit(1);
  }
  if (!WABA) {
    console.error('WHATSAPP_WABA_ID is not set in backend/.env.');
    console.error('Find it in Meta for Developers -> your App -> WhatsApp -> API Setup,');
    console.error('labelled "WhatsApp Business Account ID".');
    process.exit(1);
  }

  const response = await fetch(
    `https://graph.facebook.com/${VERSION}/${WABA}/message_templates` +
      `?fields=name,language,status,category&limit=200`,
    { headers: { Authorization: `Bearer ${TOKEN}` } }
  );
  const body = await response.json().catch(() => null);

  if (!response.ok || body?.error) {
    console.error(`HTTP ${response.status}:`, body?.error?.message || 'request failed');
    process.exit(1);
  }

  const rows = (body.data || []).map((t) => ({
    name: t.name,
    language: t.language,
    status: t.status,
    category: t.category,
  }));

  if (!rows.length) {
    console.log('This WhatsApp Business Account has no templates.');
    return;
  }

  console.table(rows);

  const matches = rows.filter((t) => t.name === WANTED);
  if (!matches.length) {
    console.log(`\nNo template named exactly "${WANTED}" on this account.`);
    console.log('Check for a different name above, or a different Business Account.');
    return;
  }

  console.log(`\n"${WANTED}" exists in: ${matches.map((m) => `${m.language} (${m.status})`).join(', ')}`);

  const usable = matches.find((m) => m.status === 'APPROVED');
  if (!usable) {
    console.log('None of them are APPROVED yet — an unapproved template cannot be sent.');
    return;
  }
  if (usable.language !== CONFIGURED_LANG) {
    console.log(
      `\nWHATSAPP_TEMPLATE_LANG is "${CONFIGURED_LANG}" but the approved template is "${usable.language}".`
    );
    console.log(`Set this in backend/.env and restart:\n  WHATSAPP_TEMPLATE_LANG=${usable.language}`);
  } else {
    console.log(`\nWHATSAPP_TEMPLATE_LANG=${CONFIGURED_LANG} matches the approved template.`);
  }
})().catch((error) => {
  console.error('FAILED:', error.message);
  process.exit(1);
});
