'use strict';

/** Mock WHMCS API responses so the portal runs without live credentials. */
function ok(extra = {}) {
  return { result: 'success', ...extra };
}

const table = (prefix, suffix, monthly, annually, triennially, setup) => ({ prefix, suffix, msetupfee: String(setup), qsetupfee: '0.00', ssetupfee: '0.00', asetupfee: '0.00', bsetupfee: '0.00', tsetupfee: '0.00', monthly, quarterly: '-1.00', semiannually: '-1.00', annually, biennially: '-1.00', triennially });
const usd = (v) => (Number(v) < 0 ? '-1.00' : (Number(v) * 0.00813).toFixed(2));
const BDT = (monthly, annually, triennially, setup = 0) => ({
  BDT: table('৳', 'BDT', monthly, annually, triennially, setup),
  USD: table('$', 'USD', usd(monthly), usd(annually), usd(triennially), usd(setup)),
});
const STORE = 'https://portal.snbdhost.com/store';
const products = [
  { pid: 42, gid: 1, type: 'hostingaccount', module: 'cpanel', paytype: 'recurring', name: 'USA-01 Starter', slug: 'starter', product_url: `${STORE}/usa-shared-hosting/starter`,
    description: '<strong>1 GB NVMe SSD Storage</strong><br />\r\n<strong>50 GB Bandwidth</strong> (Hard Limit)<br />\r\n<strong>512 MB CloudLinux RAM</strong><br />\r\n<strong>LiteSpeed</strong> + LSCache Enabled<br />\r\n<strong>Free SSL</strong> (Let’s Encrypt)',
    pricing: BDT('97.00', '397.00', '1197.00') },
  { pid: 43, gid: 1, type: 'hostingaccount', module: 'cpanel', paytype: 'recurring', name: 'USA-02 Basic', slug: 'basic', product_url: `${STORE}/usa-shared-hosting/basic`,
    description: '<strong>5 GB NVMe SSD Storage</strong><br />\r\n<strong>100 GB Bandwidth</strong> (Hard Limit)<br />\r\n<strong>1 GB CloudLinux RAM</strong><br />\r\n<strong>Addon Domains</strong> 2 (Up to 3 Websites)<br />\r\n<strong>Free SSL</strong> (Let’s Encrypt)',
    pricing: BDT('187.00', '1497.00', '4197.00') },
  { pid: 27, gid: 11, type: 'other', module: 'snbd_n8n', paytype: 'recurring', name: 'n8n 1G', slug: 'n8n-1g', product_url: `${STORE}/n8n/n8n-1g`,
    description: '<strong>Instant Deploy n8n Hosting</strong><br /> 1 Core CPU<br /> 1 GB RAM<br /> 10 GB NVMe Storage<br /> Database SQLite <br />n8n Standard Mode<br /> Daily (1x) Backup Included<br />\n <em>Ideal for personal use and simple API automations.</em>',
    pricing: BDT('200.00', '2397.00', '7197.00') },
  { pid: 32, gid: 11, type: 'other', module: 'snbd_n8n', paytype: 'recurring', name: 'n8n 6G', slug: 'n8n-6g', product_url: `${STORE}/n8n/n8n-6g`,
    description: '<strong>Instant Deploy n8n Hosting</strong><br /> 3 Core CPU<br /> 6 GB RAM<br /> 10 Worker<br /> 60 GB NVMe Storage<br /> Database PostgreSQL<br /> n8n Queue Mode<br />\n<em>Optimized for high-volume concurrent tasks using Queue Mode.</em>',
    pricing: BDT('1200.00', '14397.00', '43197.00') },
  { pid: 17, gid: 6, type: 'server', module: 'puqProxmoxKVM', paytype: 'recurring', name: 'BDIX VPS 01', slug: 'bdix-vps-01', product_url: `${STORE}/bdix-vps/bdix-vps-01`,
    description: '1 vCPU<br />\n2 GB <br />\n20 GB NVMe (Pro)<br />\nUnmetered BDIX<br />\n500 GB  International<br />\nFull Root Access (SSH)',
    pricing: BDT('647.00', '7797.00', '23397.00') },
  { pid: 19, gid: 6, type: 'server', module: 'puqProxmoxKVM', paytype: 'recurring', name: 'BDIX VPS 03', slug: 'bdix-vps-03', product_url: `${STORE}/bdix-vps/bdix-vps-03`,
    description: '3 vCPU<br />\n6 GB<br />\n60 GB NVMe (Pro)<br />\nUnmetered BDIX<br />\n1500 GB International<br />\nFull Root Access (SSH)',
    pricing: BDT('2197.00', '26397.00', '79197.00', '200.00') },
  { pid: 90, gid: 18, type: 'server', module: 'ArkHostHetznerVPS', paytype: 'recurring', name: 'USA VPS 2G', slug: 'usa-vps-2g', product_url: `${STORE}/usa-vps/usa-vps-2g`,
    description: '<strong>Instant Deploy USA VPS Hosting</strong><br />\n2 Core AMD EPYC™ CPU<br />\n2GB Dedicated RAM<br />\n40GB NVMe Storage<br />\n1 Dedicated IPv4 Address<br />\n<em>Ideal for lightweight automation and US-based proxy needs.</em>',
    pricing: BDT('3657.00', '43907.00', '131717.00') },
];

const handlers = {
  async ValidateLogin(params) {
    if (params.email === 'demo@example.com' && params.password2 === 'demo1234') {
      return ok({ userid: 1, firstname: 'Demo', lastname: 'User', email: 'demo@example.com' });
    }
    return { result: 'error', message: 'Email or password is incorrect' };
  },
  async GetClientsDetails() {
    return ok({
      client: {
        id: 1, firstname: 'Demo', lastname: 'User', fullname: 'Demo User',
        email: 'demo@example.com', status: 'Active', currency: 1, currency_code: 'BDT',
        credit: '25.00',
      },
      stats: { numdueinvoices: 1, dueinvoicesbalance: '14.99', numoverdueservices: 0, numactiveservices: 2, numactivedomains: 1, numactivetickets: 1 },
    });
  },
  async GetClientsProducts() {
    return ok({
      totalresults: 9,
      products: { product: [
        { id: 101, clientid: 1, pid: 42, groupname: 'USA Shared Hosting', recurringamount: '12.99', paymentmethodname: 'bKash Merchant', regdate: '2026-01-01', serverhostname: 'usa1.snbdhost.com', name: 'Business Hosting', domain: 'demo.example.com', status: 'Active', billingcycle: 'Monthly', amount: '12.99', nextduedate: '2026-12-01', username: 'demouser' },
        { id: 102, clientid: 1, pid: 3, name: 'Managed Backup', domain: '', status: 'Active', billingcycle: 'Monthly', amount: '5.00', nextduedate: '2026-12-01', username: '' },
        { id: 601, clientid: 1, pid: 27, groupname: 'n8n', name: 'n8n 1G', domain: 'flows.demo.example.com', status: 'Active', billingcycle: 'Monthly', recurringamount: '200.00', amount: '200.00', paymentmethodname: 'bKash Merchant', regdate: '2026-06-12', nextduedate: '2026-12-12', username: '' },
        { id: 602, clientid: 1, pid: 71, groupname: 'OpenClaw Hosting', name: 'OpenClaw Starter', domain: 'claw.demo.example.com', status: 'Suspended', billingcycle: 'Monthly', recurringamount: '450.00', amount: '450.00', paymentmethodname: 'bKash Merchant', regdate: '2026-08-02', nextduedate: '2026-11-02', username: '' },
        { id: 603, clientid: 1, pid: 81, groupname: 'Managed AI Hosting', name: 'Hermes Agent Pro', domain: 'agent.demo.example.com', status: 'Active', billingcycle: 'Monthly', recurringamount: '1500.00', amount: '1500.00', paymentmethodname: 'bKash Merchant', regdate: '2026-09-20', nextduedate: '2026-12-20', username: 'hermes' },
        { id: 604, clientid: 1, pid: 90, groupname: 'USA VPS', name: 'USA VPS 2G', domain: 'vps1.demo.example.com', status: 'Active', billingcycle: 'Monthly', recurringamount: '3657.00', amount: '3657.00', paymentmethodname: 'Stripe', regdate: '2026-05-04', nextduedate: '2026-12-04', username: 'root', dedicatedip: '5.161.42.17' },
        { id: 605, clientid: 1, pid: 17, groupname: 'BDIX VPS', name: 'BDIX VPS 01', domain: 'bdix1.demo.example.com', status: 'Active', billingcycle: 'Monthly', recurringamount: '647.00', amount: '647.00', paymentmethodname: 'bKash Merchant', regdate: '2026-03-15', nextduedate: '2026-12-15', username: 'root', dedicatedip: '103.112.52.40' },
        { id: 606, clientid: 1, pid: 95, groupname: 'Panel VPS', name: 'Panel VPS 1', domain: 'panel.demo.example.com', status: 'Active', billingcycle: 'Monthly', recurringamount: '990.00', amount: '990.00', paymentmethodname: 'bKash Merchant', regdate: '2026-07-01', nextduedate: '2026-12-01', username: 'admin', dedicatedip: '103.112.52.77' },
        { id: 607, clientid: 1, pid: 120, groupname: 'Premium DNS', name: 'Premium DNS', domain: 'demo.example.com', status: 'Active', billingcycle: 'Annually', recurringamount: '1500.00', amount: '1500.00', paymentmethodname: 'bKash Merchant', regdate: '2026-01-10', nextduedate: '2027-01-10', username: '' },
      ] },
    });
  },
  async GetClientsDomains() {
    return ok({
      totalresults: 1,
      domains: { domain: [
        { id: 201, userid: 1, domainname: 'demo.example.com', registrar: 'enom', status: 'Active', expirydate: '2027-03-15', nextduedate: '2027-03-15', donotrenew: '0' },
      ] },
    });
  },
  async GetInvoices() {
    return ok({
      totalresults: 2,
      invoices: { invoice: [
        { id: 301, invoicenum: '1001', userid: 1, date: '2026-11-01', duedate: '2026-11-08', total: '14.99', balance: '14.99', status: 'Unpaid', paymentmethod: 'stripe' },
        { id: 302, invoicenum: '998', userid: 1, date: '2026-10-01', duedate: '2026-10-08', total: '12.99', balance: '0.00', status: 'Paid', paymentmethod: 'stripe' },
      ] },
    });
  },
  async GetInvoice(params) {
    return ok({
      invoiceid: params.invoiceid || 301, invoicenum: '1001', userid: String(params.invoiceid) === '999' ? 2 : 1, currencycode: 'BDT', currencyprefix: '৳', paymentmethod: 'stripe', credit: '0.00',
      date: '2026-11-01', duedate: '2026-11-08', status: 'Unpaid',
      subtotal: '14.99', tax: '0.00', total: '14.99', balance: '14.99',
      items: { item: [{ description: 'Business Hosting - demo.example.com (Nov)', amount: '12.99' }, { description: 'Managed Backup (Nov)', amount: '2.00' }] },
    });
  },
  async GetSupportDepartments() {
    return ok({ departments: { department: [{ id: 1, name: 'Support' }, { id: 2, name: 'Billing' }] } });
  },
  async GetSupportTickets() {
    return ok({ totalresults: 1, tickets: { ticket: [{ id: 401, tid: 'ABC-123', deptid: 1, subject: 'Welcome — how to use the portal', status: 'Open', priority: 'Medium', lastreply: '2026-11-09 10:00:00' }] } });
  },
  async GetSupportTicket() {
    return ok({ ticketid: 401, userid: 1, tid: 'ABC-123', subject: 'Welcome — how to use the portal', status: 'Open', replies: { reply: [{ admin: 'Jane (Staff)', message: 'Hi! Reply here to test ticket threads.', date: '2026-11-09 10:00:00' }] } });
  },
  async OpenTicket(params) {
    return ok({ id: 402, tid: 'XYZ-999', subject: params.subject || 'New ticket' });
  },
  async AddTicketReply() {
    return ok({});
  },
  async GetProducts() {
    return ok({ totalresults: products.length, products: { product: products } });
  },
  async AddOrder(params) {
    const domain = (params && (params.domain || params['domain[0]'])) || '';
    if (params && params['pid[0]']) {
      const p = products.find((x) => String(x.pid) === String(params['pid[0]']));
      if (!p) return { result: 'error', message: 'Invalid Product ID' };
      return ok({ orderid: 505, invoiceid: 309, serviceids: '103', domainids: params['domaintype[0]'] ? '202' : '' });
    }
    if (domain) return ok({ orderid: 502, invoiceid: 304, total: '12.99', domain });
    return ok({ orderid: 501, invoiceid: 303, total: '12.99' });
  },
  async GetTLDPricing() {
    const row = (reg, tr) => ({ register: { 1: reg }, transfer: { 1: tr }, renew: { 1: reg } });
    return ok({ currency: { id: 1, code: 'BDT', prefix: '৳', suffix: 'BDT' }, pricing: { com: row('1428.78', '1532.10'), net: row('1650.00', '1650.00'), xyz: row('250.00', '1200.00'), 'com.bd': row('1500.00', '-1.00') } });
  },
  async DomainWhois(params) {
    const d = String(params.domain || '').toLowerCase();
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d)) return { result: 'error', message: 'Domain not valid' };
    return ok({ status: d.startsWith('taken') ? 'unavailable' : 'available', whois: '' });
  },
  async CheckDomain(params) {
    // Mock availability: taken if sld starts with "taken"
    const sld = String(params.sld || '').toLowerCase();
    if (!sld || !/^[a-z0-9-]{1,63}$/.test(sld)) return { result: 'error', message: 'Invalid domain name' };
    if (sld.startsWith('taken')) return ok({ available: false, sld, tld: params.tld, reason: 'Domain is already registered' });
    return ok({ available: true, sld, tld: params.tld, price: '12.99' });
  },
  async GetPaymentMethods() {
    return ok({ totalresults: 3, paymentmethods: { paymentmethod: [{ module: 'bkashcheckoutUrl', displayname: 'bKash Merchant' }, { module: 'stripe', displayname: 'Stripe | International Gateways for Credit/Debit Card' }, { module: 'paypal_ppcpv', displayname: 'PayPal' }] } });
  },
  async GetKBArticles() {
    return ok({ totalresults: 2, articles: { article: [{ id: 1, title: 'Point nameservers to us', category: 'Getting started' }, { id: 2, title: 'Pay an invoice', category: 'Billing' }] } });
  },
  async GetCurrencies() {
    return ok({ totalresults: 1, currencies: { currency: [{ id: 1, code: 'BDT', prefix: '৳', suffix: 'BDT', format: 2, rate: '1.00000' }, { id: 2, code: 'USD', prefix: '$', suffix: 'USD', format: 1, rate: '0.00813' }] } });
  },
  async GetAnnouncements() {
    return ok({ totalresults: 1, announcements: { announcement: [{ id: 1, title: 'Scheduled maintenance Sunday', date: '2026-11-10', text: 'No downtime expected.' }] } });
  },
  async UpdateClient() {
    return ok({ clientid: 1 });
  },
  async AddClient(params) {
    if (!params.email || !params.password2) return { result: 'error', message: 'Missing fields' };
    return ok({ clientid: 2, firstname: params.firstname || 'New', lastname: params.lastname || 'User' });
  },
  async GetClientsProductsDetails(params) {
    return ok({ product: { id: Number(params.serviceid || 101), name: 'Business Hosting', domain: 'demo.example.com', status: 'Active', billingcycle: 'Monthly', amount: '12.99', nextduedate: '2026-12-01', username: 'demouser', password: 'enc', server: 'snbdpanel-01', ns1: 'ns1.snbdhost.com', ns2: 'ns2.snbdhost.com' } });
  },
  async UpgradeProduct() { return ok({ orderid: 503, invoiceid: 305 }); },
  async AddCancelRequest() { return ok({}); },
  async GetDomainDetails(params) {
    return ok({ domain: { id: Number(params.domainid || 201), domainname: 'demo.example.com', registrar: 'spaceship', status: 'Active', expirydate: '2027-03-15', ns1: 'ns1.snbdhost.com', ns2: 'ns2.snbdhost.com', lockstatus: 'unlocked' } });
  },
  async DomainUpdateNameservers() { return ok({}); },
  async DomainUpdateLockingStatus() { return ok({}); },
  async DomainGetNameservers() { return ok({ ns1: 'ns1.snbdhost.com', ns2: 'ns2.snbdhost.com' }); },
  async DomainGetLockingStatus() { return ok({ lockstatus: 'locked' }); },
  async CreateSsoToken(params) {
    if (!params.client_id) return { result: 'error', message: 'A valid client_id or user_id is required' };
    return ok({ access_token: 'mock', redirect_url: `/invoices?sso=${encodeURIComponent(params.sso_redirect_path || '')}` });
  },
  async UpdateInvoice(params) { return params.invoiceid ? ok({ invoiceid: params.invoiceid }) : { result: 'error', message: 'Invoice ID Not Found' }; },
  async ApplyCredit(params) { return ok({ invoiceid: params.invoiceid, amount: params.amount, invoicepaid: 'false' }); },
  async UpdateTicket(params) { return ok({ ticketid: params.ticketid }); },
  async RenewDomain() { return ok({ orderid: 504, invoiceid: 306 }); },
  async GetQuotes() {
    return ok({ totalresults: 1, quotes: { quote: [{ id: 601, userid: 1, subject: 'Custom VPS bundle', stage: 'Draft', total: '49.99', validuntil: '2026-12-31' }] } });
  },
  async AcceptQuote() { return ok({ invoiceid: 307 }); },
  async CloseTicket() { return ok({}); },
  async GetEmails() {
    return ok({ totalresults: 1, emails: { email: [{ id: 1, subject: 'Invoice Created', date: '2026-11-01' }] } });
  },
  async GetContacts() {
    return ok({ totalresults: 1, contacts: { contact: [{ id: 1, firstname: 'Billing', lastname: 'Contact', email: 'billing@example.com' }] } });
  },
  async UpdatePassword() { return ok({}); },
  async GetPaymentMethodsFull() {
    return ok({ cards: [{ id: 1, lastfour: '4242', type: 'Visa' }] });
  },
  async AddFunds() { return ok({ invoiceid: 308 }); },
  async MassPay() { return ok({}); },
  async GetServers() {
    return ok({ totalresults: 2, servers: { server: [{ id: 1, name: 'snbdpanel-01', status: 'Online', uptime: '99.9%' }, { id: 2, name: 'hetzner-kvm-02', status: 'Online', uptime: '99.8%' }] } });
  },
  async GetNetworkIssues() {
    return ok({ totalresults: 0, issues: {} });
  },
  async GetDownloads() {
    return ok({ totalresults: 1, downloads: { download: [{ id: 1, title: 'Getting started PDF', category: 'Guides' }] } });
  },
  async SendContact() { return ok({}); },
  async GetAffiliates() {
    return ok({ affiliates: { affiliate: [{ id: 1, balance: '10.00', referrals: 3 }] } });
  },
};


// Second demo client (new@example.com / demo1234): no payment history, so the
// account currency can be switched. State is mutable so switches are visible.
const fresh = {
  currency: 1,
  service: { id: 501, clientid: 2, pid: 42, name: 'USA-01 Starter', domain: 'newbrand.com', status: 'Active', billingcycle: 'Monthly', recurringamount: '97.00', firstpaymentamount: '97.00', nextduedate: '2026-12-10', regdate: '2026-11-10' },
  invoice: { id: 401, invoicenum: '2001', userid: 2, date: '2026-11-10', duedate: '2026-11-17', status: 'Unpaid', items: [{ id: 9001, type: 'Hosting', relid: 501, description: 'USA-01 Starter - newbrand.com', amount: '97.00', taxed: '0' }] },
};
const freshCur = () => (fresh.currency === 2 ? { currencycode: 'USD', currencyprefix: '$' } : { currencycode: 'BDT', currencyprefix: '৳' });
const freshTotal = () => fresh.invoice.items.reduce((n, it) => n + Number(it.amount), 0).toFixed(2);
const is2 = (v) => String(v) === '2';
const base = { ...handlers };
Object.assign(handlers, {
  async GetUsers(params) {
    const all = [
      { id: 1, firstname: 'Demo', lastname: 'User', email: 'demo@example.com', clients: [{ id: 1, isOwner: true }] },
      { id: 2, firstname: 'New', lastname: 'Client', email: 'new@example.com', clients: [{ id: 2, isOwner: true }] },
    ];
    const q = String(params.search || '').toLowerCase();
    const users = all.filter((u) => !q || u.email === q);
    return ok({ totalresults: users.length, users });
  },
  async ValidateLogin(params) {
    if (params.email === 'new@example.com' && params.password2 === 'demo1234') return ok({ userid: 2, firstname: 'New', lastname: 'Client', email: 'new@example.com' });
    return base.ValidateLogin(params);
  },
  async GetClientsDetails(params) {
    if (!is2(params.clientid)) return base.GetClientsDetails(params);
    return ok({ client: { id: 2, firstname: 'New', lastname: 'Client', fullname: 'New Client', email: 'new@example.com', currency: fresh.currency, currency_code: fresh.currency === 2 ? 'USD' : 'BDT', credit: '0.00' }, stats: { numdueinvoices: 1, dueinvoicesbalance: freshTotal(), numactiveservices: 1, numactivedomains: 0, numactivetickets: 0 } });
  },
  async GetTransactions(params) { return ok({ totalresults: is2(params.clientid) ? 0 : 1, transactions: {} }); },
  async GetInvoices(params) {
    if (!is2(params.userid)) return base.GetInvoices(params);
    const i = fresh.invoice;
    return ok({ totalresults: 1, invoices: { invoice: [{ id: i.id, invoicenum: i.invoicenum, userid: 2, date: i.date, duedate: i.duedate, total: freshTotal(), balance: freshTotal(), status: i.status, ...freshCur() }] } });
  },
  async GetInvoice(params) {
    if (String(params.invoiceid) !== '401') return base.GetInvoice(params);
    const i = fresh.invoice;
    return ok({ invoiceid: 401, invoicenum: i.invoicenum, userid: 2, date: i.date, duedate: i.duedate, status: i.status, subtotal: freshTotal(), tax: '0.00', credit: '0.00', total: freshTotal(), balance: freshTotal(), paymentmethod: 'bkashcheckoutUrl', ...freshCur(), items: { item: i.items } });
  },
  async GetClientsProducts(params) {
    if (!is2(params.clientid)) return base.GetClientsProducts(params);
    return ok({ totalresults: 1, products: { product: [fresh.service] } });
  },
  async GetClientsDomains(params) {
    if (!is2(params.clientid)) return base.GetClientsDomains(params);
    return ok({ totalresults: 0, domains: {} });
  },
  async GetClientsAddons() { return ok({ totalresults: 0, addons: {} }); },
  async UpdateClientProduct(params) {
    if (String(params.serviceid) === '501') { fresh.service.recurringamount = params.recurringamount; fresh.service.firstpaymentamount = params.firstpaymentamount; }
    console.log('[mock] UpdateClientProduct', params.serviceid, params.recurringamount);
    return ok({ serviceid: params.serviceid });
  },
  async UpdateClientDomain(params) { return ok({ domainid: params.domainid }); },
  async UpdateClientAddon(params) { return ok({ id: params.id }); },
  async UpdateInvoice(params) {
    if (String(params.invoiceid) === '401') {
      for (const it of fresh.invoice.items) if (params[`itemamount[${it.id}]`] != null) it.amount = params[`itemamount[${it.id}]`];
      console.log('[mock] UpdateInvoice 401 items', fresh.invoice.items.map((it) => it.amount).join(','));
    }
    return ok({ invoiceid: params.invoiceid });
  },
  async UpdateClient(params) {
    if (is2(params.clientid) && params.currency) { fresh.currency = Number(params.currency); console.log('[mock] UpdateClient currency ->', params.currency); }
    return ok({ clientid: params.clientid });
  },
});

// Sign-ups become the second demo client (clientid 2) in the currency they chose.
// Store orders get their own unpaid invoice owned by the ordering client.
const SETUP_KEY = { monthly: 'msetupfee', quarterly: 'qsetupfee', semiannually: 'ssetupfee', annually: 'asetupfee', biennially: 'bsetupfee', triennially: 'tsetupfee' };
const placed = new Map();
let nextOrderId = 505;
let nextInvoiceId = 309;
const layered = { ...handlers };
Object.assign(handlers, {
  async AddClient(params) {
    const email = String(params.email || '').toLowerCase();
    if (['demo@example.com', 'new@example.com'].includes(email)) return { result: 'error', message: 'A user already exists with that email address' };
    if (!email || !params.password2) return { result: 'error', message: 'Missing fields' };
    if (Number(params.currency) === 1 || Number(params.currency) === 2) fresh.currency = Number(params.currency);
    return ok({ clientid: 2, owner_id: 2 });
  },
  async AddOrder(params) {
    if (!params || !params['pid[0]']) return layered.AddOrder(params);
    const p = products.find((x) => String(x.pid) === String(params['pid[0]']));
    if (!p) return { result: 'error', message: 'Invalid Product ID' };
    const usd = is2(params.clientid) && fresh.currency === 2;
    const row = p.pricing[usd ? 'USD' : 'BDT'];
    const cycle = params['billingcycle[0]'];
    const items = [{ id: 9100 + nextInvoiceId, type: 'Hosting', description: `${p.name}${params['domain[0]'] || params['hostname[0]'] ? ` - ${params['domain[0]'] || params['hostname[0]']}` : ''} (${cycle})`, amount: Number(row[cycle] || 0).toFixed(2), taxed: '0' }];
    const setup = Number(row[SETUP_KEY[cycle]] || 0);
    if (setup > 0) items.push({ id: 9200 + nextInvoiceId, type: 'Setup', description: `${p.name} setup fee`, amount: setup.toFixed(2), taxed: '0' });
    const invoiceid = nextInvoiceId++;
    const orderid = nextOrderId++;
    placed.set(String(invoiceid), { userid: Number(params.clientid), usd, items, paymentmethod: params.paymentmethod });
    return ok({ orderid, invoiceid, serviceids: '103', domainids: params['domaintype[0]'] ? '202' : '' });
  },
  async GetInvoice(params) {
    const inv = placed.get(String(params.invoiceid));
    if (!inv) return layered.GetInvoice(params);
    const total = inv.items.reduce((n, it) => n + Number(it.amount), 0).toFixed(2);
    return ok({
      invoiceid: Number(params.invoiceid), invoicenum: String(1700 + Number(params.invoiceid)), userid: inv.userid,
      currencycode: inv.usd ? 'USD' : 'BDT', currencyprefix: inv.usd ? '$' : '৳', paymentmethod: inv.paymentmethod, credit: '0.00',
      date: '2026-11-10', duedate: '2026-11-17', status: 'Unpaid', subtotal: total, tax: '0.00', total, balance: total,
      items: { item: inv.items },
    });
  },
});

module.exports = handlers;
