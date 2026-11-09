// Fonction Supabase « reparloc » :
//  - GET  ?ics=1&date=AAAA-MM-JJ&slot=8h – 10h&titre=…&lieu=…  → fichier « Ajouter à mon agenda » (.ics)
//  - POST {token, action, …}                                   → lien de réponse du professionnel, sans compte
// Le lien (table rl_pro_links) est créé par le propriétaire et ne vaut que pour un dossier et un professionnel,
// tant que ce professionnel est celui choisi pour le dossier. Le professionnel ne voit que sa part du dossier
// (comme dans l'appli) et n'écrit qu'au propriétaire. Ses messages sont rangés avec pro_id (author = propriétaire, seul compte du fil).
import { createClient } from "jsr:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, apikey, authorization, x-client-info", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const json = (o: unknown, status = 200) => Response.json(o, { status, headers: CORS });

const ST: Record<string, string> = {
  NOUVEAU: "Nouveau signalement", PRECISIONS: "Précisions demandées", A_CHOISIR: "Professionnel à choisir",
  ATTENTE_PRO: "En attente du professionnel", PROPOSITION: "Proposition à valider", RDV_A_ORGANISER: "Rendez-vous à organiser",
  RDV_PROPOSE: "Rendez-vous proposé", RDV_CONFIRME: "Rendez-vous confirmé", TERMINEE: "Intervention terminée",
  SUIVI: "Suivi complémentaire", CLOTURE: "Clôturé", CLASSE: "Classé sans intervention",
};
const CLOSED = ["CLOTURE", "CLASSE"];
const SLOTS = ["8h – 10h", "10h – 12h", "12h – 14h", "14h – 16h", "16h – 18h"];
const fmtEUR = (n: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n);
const fmtDay = (iso: string) => new Date(iso + "T12:00:00Z").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const todayParis = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" }); // AAAA-MM-JJ
const str = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

class Oops extends Error { constructor(public code: string, public status = 400) { super(code); } }

// deno-lint-ignore no-explicit-any
type Any = any;

async function load(token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw new Oops("lien_inconnu", 404);
  const { data: link } = await sb.from("rl_pro_links").select("*").eq("token", token).maybeSingle();
  if (!link) throw new Oops("lien_inconnu", 404);
  const { data: row } = await sb.from("rl_dossiers").select("*").eq("id", link.dossier_id).maybeSingle();
  if (!row || row.pro_id !== link.pro_id) throw new Oops("lien_expire", 410);
  const [pp, L, P] = await Promise.all([
    sb.from("rl_dossier_pp").select("data").eq("dossier_id", row.id).maybeSingle(),
    sb.from("rl_logements").select("*").eq("id", row.logement_id).single(),
    sb.from("rl_pros").select("*").eq("id", link.pro_id).single(),
  ]);
  const main: Any = row.data || {};
  main.history = main.history || []; main.apptHistory = main.apptHistory || [];
  const ppd: Any = Object.assign({ qa: [], history: [], quote: null, quoteHistory: [], declined: [], pastQuotes: [] }, pp.data?.data || {});
  return { link, row, main, pp: ppd, L: L.data, P: P.data };
}
type Ctx = Awaited<ReturnType<typeof load>>;

async function names(ids: (string | null)[]) {
  const list = ids.filter(Boolean) as string[];
  if (!list.length) return {} as Record<string, string>;
  const { data } = await sb.from("rl_profiles").select("user_id,name").in("user_id", list);
  return Object.fromEntries((data || []).map((p: Any) => [p.user_id, p.name]));
}

function nextText(c: Ctx) {
  const d = c.main, q = c.pp.quote, a = d.appointment;
  switch (d.status) {
    case "ATTENTE_PRO":
      if (q && q.status === "modification demandée") return { me: true, text: "Le propriétaire demande une modification : envoyez une proposition modifiée." };
      return { me: true, text: d.accepted ? "Envoyez votre proposition (description et montant)." : "Envoyez votre proposition, ou indiquez que vous ne pouvez pas intervenir." };
    case "PRECISIONS": return { me: false, text: "Le propriétaire répond à une question." };
    case "PROPOSITION": return { me: false, text: "Le propriétaire étudie votre proposition." };
    case "RDV_A_ORGANISER":
      if (a && a.status === "refusé") return { me: true, text: "Le locataire demande une autre date : proposez un autre créneau." };
      if (a && a.status === "à reprogrammer") return { me: true, text: "Rendez-vous à reprogrammer : proposez une nouvelle date." };
      return { me: true, text: "Proposition acceptée : proposez une date de rendez-vous." };
    case "RDV_PROPOSE": return { me: false, text: "Le locataire doit confirmer le rendez-vous." };
    case "RDV_CONFIRME": return { me: true, text: "Intervenez, puis indiquez que l'intervention est terminée." };
    case "TERMINEE": return { me: false, text: "Intervention terminée : le locataire et le propriétaire donnent leur retour." };
    case "SUIVI": return { me: false, text: "Le propriétaire organise une suite." };
    default: return { me: false, text: CLOSED.includes(d.status) ? "Dossier terminé." : "" };
  }
}

async function view(c: Ctx) {
  const d = c.main;
  const [{ data: msgs }, who] = await Promise.all([
    sb.from("rl_messages").select("author,pro_id,text,created_at").eq("dossier_id", c.row.id).eq("ch", "pp").order("created_at"),
    names([c.L.owner_id, c.L.tenant_id]),
  ]);
  const paths = (d.media || []).filter((m: Any) => m.p).map((m: Any) => m.p);
  let media: { url: string; k: string }[] = [];
  if (paths.length) {
    const { data } = await sb.storage.from("rl-media").createSignedUrls(paths, 3600);
    media = (data || []).map((x: Any, i: number) => ({ url: x.signedUrl, k: d.media.filter((m: Any) => m.p)[i].k })).filter((x) => x.url);
  }
  const q = c.pp.quote;
  return {
    title: d.title, num: d.num, category: d.category, description: d.description, availability: d.availability || "",
    urgent: !!d.urgent, status: d.status, statusLabel: ST[d.status] || d.status, accepted: !!d.accepted, closed: CLOSED.includes(d.status),
    createdAt: d.createdAt, updatedAt: d.updatedAt,
    logement: { name: c.L.name, city: c.L.city }, ownerName: who[c.L.owner_id] || "Le propriétaire", tenantName: c.L.tenant_id ? who[c.L.tenant_id] || "" : "",
    proName: c.P.name, trade: c.P.trade,
    quote: q ? { version: q.version, description: q.description, amount: q.amount, status: q.status, ownerComment: q.ownerComment || "" } : null,
    appointment: d.appointment || null, report: d.report || null,
    feedback: d.feedback ? { resolved: !!d.feedback.resolved } : null,
    messages: (msgs || []).map((m: Any) => ({ mine: m.pro_id ? m.pro_id === c.P.id : m.author === c.P.user_id, text: m.text, at: Date.parse(m.created_at) })),
    media, next: nextText(c), slots: SLOTS,
  };
}

async function act(c: Ctx, action: string, b: Any) {
  const d = c.main, pp = c.pp, now = Date.now(), by = "pro:" + c.P.id;
  const targets = (roles: string[]) => roles.map((r) => (r === "owner" ? c.L.owner_id : c.L.tenant_id)).filter(Boolean);
  const notify = async (roles: string[], text: string) => {
    const t = targets(roles);
    if (t.length) await sb.from("rl_notifs").insert(t.map((to) => ({ to_user: to, dossier_id: c.row.id, text: `${d.title} — ${text}`.slice(0, 300) })));
  };
  const hist = (text: string, scope: "main" | "pp") => {
    if (scope === "pp") pp.history.push({ at: now, by, text, vis: "pp" });
    else { d.history.push({ at: now, by, text }); if (d.history.length > 200) d.history = d.history.slice(-200); }
  };
  const savePP = async () => { const r = await sb.from("rl_dossier_pp").upsert({ dossier_id: c.row.id, data: pp }); if (r.error) throw r.error; };
  const saveMain = async (extra: Any = {}) => {
    d.updatedAt = now;
    const r = await sb.from("rl_dossiers").update({ data: d, ...extra }).eq("id", c.row.id);
    if (r.error) throw r.error;
  };
  if (CLOSED.includes(d.status)) throw new Oops("dossier_termine");

  if (action === "message") {
    const text = str(b.text, 1500);
    if (!text) throw new Oops("message_vide");
    const r = await sb.from("rl_messages").insert({ dossier_id: c.row.id, ch: "pp", author: c.L.owner_id, pro_id: c.P.id, text });
    if (r.error) throw r.error;
    await notify(["owner"], "Nouveau message");
    return;
  }
  if (action === "decline") {
    if (d.status !== "ATTENTE_PRO" || d.accepted) throw new Oops("etape");
    const reason = str(b.reason, 500);
    if (reason.length < 5) throw new Oops("motif");
    pp.declined.push({ proId: c.P.id, reason, at: now });
    hist(`${c.P.name} a décliné : « ${reason} »`, "pp");
    d.accepted = false; d.status = "A_CHOISIR";
    await savePP(); await saveMain({ pro_id: null });
    await notify(["owner"], "Le professionnel a décliné");
    return;
  }
  if (action === "quote") {
    if (d.status !== "ATTENTE_PRO") throw new Oops("etape");
    const desc = str(b.desc, 1500);
    const amount = Math.round(parseFloat(String(b.amount || "").replace(/\s/g, "").replace(",", ".")) * 100) / 100;
    if (desc.length < 10) throw new Oops("description");
    if (!(amount > 0) || amount > 100000) throw new Oops("montant");
    if (!d.accepted) { d.accepted = true; hist("Demande acceptée par le professionnel", "main"); }
    if (pp.quote) pp.quoteHistory.push(pp.quote);
    const v = (pp.quote ? pp.quote.version : 0) + 1;
    pp.quote = { version: v, description: desc, amount, needsVisit: !!b.visit, status: "proposée", at: now, replacesAccepted: false };
    d.status = "PROPOSITION";
    hist(`Proposition v${v} envoyée : ${fmtEUR(amount)}`, "pp");
    await savePP(); await saveMain();
    await notify(["owner", "tenant"], `Proposition à valider (v${v})`);
    return;
  }
  if (action === "appt") {
    if (!["RDV_A_ORGANISER", "RDV_PROPOSE", "RDV_CONFIRME"].includes(d.status)) throw new Oops("etape");
    const date = str(b.date, 10), slot = str(b.slot, 20);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date <= todayParis()) throw new Oops("date");
    if (!SLOTS.includes(slot)) throw new Oops("creneau");
    const prev = d.appointment;
    if (prev) d.apptHistory.push(prev);
    d.appointment = { version: (prev ? prev.version : 0) + 1, date, slot, status: "proposé", at: now };
    d.status = "RDV_PROPOSE";
    hist(prev ? `Nouveau rendez-vous proposé : ${fmtDay(date)}, ${slot} (à confirmer à nouveau)` : `Rendez-vous proposé : ${fmtDay(date)}, ${slot}`, "main");
    await saveMain();
    await notify(["tenant", "owner"], "Rendez-vous proposé : à confirmer");
    return;
  }
  if (action === "done") {
    if (d.status !== "RDV_CONFIRME") throw new Oops("etape");
    const text = str(b.report, 1500);
    if (text.length < 10) throw new Oops("compte_rendu");
    d.report = { text, extraVisit: !!b.extra, at: now }; d.feedback = null; d.status = "TERMINEE";
    hist(`Intervention indiquée comme terminée${d.report.extraVisit ? " (passage supplémentaire nécessaire)" : ""}, compte rendu ajouté`, "main");
    await saveMain();
    await notify(["tenant", "owner"], "Intervention terminée : votre retour est attendu");
    return;
  }
  throw new Oops("action_inconnue");
}

/* ---------- Fichier calendrier (.ics) : l'iPhone propose « Ajouter au calendrier » ---------- */
const icsEsc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const fold = (l: string) => { const out: string[] = []; let s = l; const len = (x: string) => new TextEncoder().encode(x).length; while (len(s) > 74) { let n = 74; while (len(s.slice(0, n)) > 74) n--; out.push(s.slice(0, n)); s = " " + s.slice(n); } out.push(s); return out.join("\r\n"); };
function calendrier(q: URLSearchParams) {
  const date = (q.get("date") || "").replace(/\D/g, "").slice(0, 8);
  if (date.length !== 8) return new Response("date manquante", { status: 400, headers: CORS });
  const h = (q.get("slot") || "").match(/(\d{1,2})\s*h.*?(\d{1,2})\s*h/);
  const p = (n: number) => String(n).padStart(2, "0");
  const h1 = h ? Math.min(23, +h[1]) : 9, h2 = h ? Math.min(23, Math.max(+h[2], h1 + 1)) : h1 + 2;
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Repar'Loc//Rendez-vous//FR", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VTIMEZONE", "TZID:Europe/Paris",
    "BEGIN:DAYLIGHT", "TZOFFSETFROM:+0100", "TZOFFSETTO:+0200", "TZNAME:CEST", "DTSTART:19700329T020000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU", "END:DAYLIGHT",
    "BEGIN:STANDARD", "TZOFFSETFROM:+0200", "TZOFFSETTO:+0100", "TZNAME:CET", "DTSTART:19701025T030000", "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU", "END:STANDARD",
    "END:VTIMEZONE",
    "BEGIN:VEVENT", `UID:${(q.get("id") || crypto.randomUUID()).replace(/[^\w-]/g, "").slice(0, 60)}-${date}@reparloc`, `DTSTAMP:${stamp}`,
    `DTSTART;TZID=Europe/Paris:${date}T${p(h1)}0000`, `DTEND;TZID=Europe/Paris:${date}T${p(h2)}0000`,
    `SUMMARY:${icsEsc(str(q.get("titre") || "Rendez-vous réparation", 120))}`];
  if (q.get("lieu")) lines.push(`LOCATION:${icsEsc(str(q.get("lieu"), 120))}`);
  if (q.get("notes")) lines.push(`DESCRIPTION:${icsEsc(str(q.get("notes"), 500))}`);
  lines.push("BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Rendez-vous Répar'Loc", "TRIGGER:-PT1H", "END:VALARM", "END:VEVENT", "END:VCALENDAR");
  return new Response(lines.map(fold).join("\r\n") + "\r\n", { headers: { ...CORS, "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `inline; filename="rendez-vous.ics"` } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const q = new URL(req.url).searchParams;
  if (req.method === "GET" && q.has("ics")) return calendrier(q);
  if (req.method === "GET") return json({ ok: true, service: "reparloc" });
  let b: Any = {};
  try { b = await req.json(); } catch { return json({ erreur: "requete" }, 400); }
  try {
    const c = await load(str(b.token, 64));
    if (b.action && b.action !== "view") {
      await act(c, String(b.action), b);
      return json(await view(await load(c.link.token)));
    }
    return json(await view(c));
  } catch (e) {
    if (e instanceof Oops) return json({ erreur: e.code }, e.status);
    console.log("erreur", String((e as Any)?.message || e));
    return json({ erreur: "serveur" }, 500);
  }
});
