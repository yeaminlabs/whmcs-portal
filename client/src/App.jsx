import { useEffect, useMemo, useRef, useState } from 'react';
import { AppShell } from '@astryxdesign/core/AppShell';
import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Grid } from '@astryxdesign/core/Grid';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { SideNav, SideNavItem, SideNavSection } from '@astryxdesign/core/SideNav';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { TopNav } from '@astryxdesign/core/TopNav';
import { VStack } from '@astryxdesign/core/VStack';

const BASE_PATH = '/app';

function routeFromHash() {
  const value = window.location.hash.replace(/^#\/?/, '').split('?')[0];
  return value || 'dashboard';
}

function go(route) {
  window.location.hash = `/${route}`;
}

function readNumber(value) {
  const number = Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(number) ? number : 0;
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
}

function formatAmount(value, currency) {
  const amount = readNumber(value);
  const code = String(currency || '').toUpperCase();
  if (/^[A-Z]{3}$/.test(code)) {
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: code }).format(amount);
    } catch {
      // WHMCS can return a non-ISO currency label. Fall through to a number.
    }
  }
  return amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function statusVariant(status) {
  const normalized = String(status || '').toLowerCase();
  if (['active', 'paid', 'resolved', 'closed', 'completed'].includes(normalized)) return 'success';
  if (['overdue', 'cancelled', 'terminated', 'failed'].includes(normalized)) return 'error';
  if (['pending', 'suspended', 'unpaid', 'open'].includes(normalized)) return 'warning';
  return 'neutral';
}

function StatusBadge({ status }) {
  return <Badge variant={statusVariant(status)} label={status || 'Unknown'} />;
}

function useHashRoute() {
  const [route, setRoute] = useState(routeFromHash);
  useEffect(() => {
    const onChange = () => setRoute(routeFromHash());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

function useDashboard() {
  const [state, setState] = useState({ status: 'loading', data: null, error: '' });

  async function load(signal) {
    setState({ status: 'loading', data: null, error: '' });
    try {
      const response = await fetch('/api/react/dashboard', {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
        signal,
      });
      const contentType = response.headers.get('content-type') || '';
      if (response.redirected || !contentType.includes('application/json')) {
        setState({ status: 'signed-out', data: null, error: '' });
        return;
      }
      const payload = await response.json();
      if (!response.ok || payload.error) {
        throw new Error(payload.message || 'The dashboard could not be loaded.');
      }
      setState({ status: 'ready', data: payload, error: '' });
    } catch (error) {
      if (error.name === 'AbortError') return;
      setState({ status: 'error', data: null, error: error.message || 'The dashboard could not be loaded.' });
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, []);

  return { ...state, reload: () => load() };
}

function Brand() {
  return (
    <a className="portal-brand" href={`${BASE_PATH}/#/dashboard`} aria-label="SNBD Host dashboard">
      <span className="portal-brand-mark">S</span>
      <span>
        <strong>SNBD HOST</strong>
        <small>Client portal</small>
      </span>
    </a>
  );
}

function PortalNavigation({ route }) {
  return (
    <SideNav
      collapsible={{ defaultIsCollapsed: false, hasButton: true, buttonLabel: 'Collapse navigation' }}
      footer={<Text type="supporting">Live WHMCS workspace</Text>}
    >
      <SideNavSection title="Workspace">
        <SideNavItem label="Dashboard" icon="search" href="#/dashboard" isSelected={route === 'dashboard'} />
        <SideNavItem label="Search performance" icon="funnel" href="/google/tools" />
      </SideNavSection>
      <SideNavSection title="Manage">
        <SideNavItem label="My services" icon="wrench" href="/services" />
        <SideNavItem label="Domains" icon="calendar" href="/domains" />
        <SideNavItem label="Invoices" icon="checkDouble" href="/invoices" />
        <SideNavItem label="Store" icon="arrowUp" href="/store" />
      </SideNavSection>
      <SideNavSection title="Support">
        <SideNavItem label="Tickets" icon="info" href="/tickets" />
        <SideNavItem label="Help center" icon="search" href="/kb" />
        <SideNavItem label="Google tools" icon="externalLink" href="/google/tools" />
      </SideNavSection>
    </SideNav>
  );
}

function PortalTopNav({ onRefresh, refreshing }) {
  return (
    <TopNav
      label="SNBD Host portal navigation"
      heading={<Brand />}
      endContent={
        <HStack gap={2} align="center" wrap="wrap">
          <span className="sync-indicator"><span className="sync-dot" /> Account-scoped data</span>
          <Button label="Refresh" variant="secondary" size="sm" isLoading={refreshing} onClick={onRefresh} />
          <Button label="Legacy portal" variant="ghost" size="sm" onClick={() => window.location.assign('/')} />
        </HStack>
      }
    />
  );
}

function Shell({ route, children, onRefresh, refreshing }) {
  return (
    <AppShell
      height="auto"
      variant="section"
      contentPadding={0}
      topNav={<PortalTopNav onRefresh={onRefresh} refreshing={refreshing} />}
      sideNav={<PortalNavigation route={route} />}
    >
      {children}
    </AppShell>
  );
}

function MetricCard({ label, value, detail, variant = 'neutral' }) {
  return (
    <Card>
      <div className="metric-card">
        <div className="metric-card-heading">
          <Text type="supporting">{label}</Text>
          <Badge variant={variant} label={detail} />
        </div>
        <Heading level={2} type="display-3">{value}</Heading>
      </div>
    </Card>
  );
}

function SectionHeader({ title, description, action }) {
  return (
    <div className="section-header">
      <div>
        <Heading level={2}>{title}</Heading>
        {description ? <Text type="supporting">{description}</Text> : null}
      </div>
      {action}
    </div>
  );
}

function DashboardHeader({ customer, onRefresh, refreshing }) {
  const name = customer?.fullname || [customer?.firstname, customer?.lastname].filter(Boolean).join(' ') || 'there';
  const email = customer?.email || '';
  return (
    <div className="dashboard-header">
      <div>
        <Text type="supporting">SNBD Host / Workspace</Text>
        <Heading level={1} type="display-2">Welcome back, {name.split(' ')[0]}.</Heading>
        <Text type="large">Your account view is loaded from the signed-in WHMCS client.</Text>
        {email ? <Text type="supporting">{email}</Text> : null}
      </div>
      <Button label="Refresh account data" variant="primary" isLoading={refreshing} onClick={onRefresh} />
    </div>
  );
}

function ServicesCard({ services }) {
  return (
    <Card padding={0}>
      <SectionHeader title="Your services" description="Services returned for this WHMCS client." action={<Badge label={`${services.length} shown`} />} />
      {services.length ? (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead><tr><th>Service</th><th>Status</th><th>Renewal</th><th>Amount</th></tr></thead>
            <tbody>
              {services.map((service, index) => {
                const title = service.name || service.productname || service.groupname || 'Service';
                return (
                  <tr key={service.id || service.domain || `${title}-${index}`}>
                    <td><strong>{title}</strong><small>{service.domain || service.username || 'No domain attached'}</small></td>
                    <td><StatusBadge status={service.status} /></td>
                    <td>{formatDate(service.nextduedate)}</td>
                    <td>{formatAmount(service.recurringamount || service.amount, service.currencycode || service.currency)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-card"><EmptyState title="No services yet" description="This account has no service records in WHMCS." /></div>
      )}
    </Card>
  );
}

function InvoicesCard({ invoices, customer }) {
  return (
    <Card padding={0}>
      <SectionHeader title="Recent invoices" description="The latest billing records for this account." action={<Button label="View invoices" size="sm" variant="ghost" onClick={() => window.location.assign('/invoices')} />} />
      {invoices.length ? (
        <div className="invoice-list">
          {invoices.map((invoice, index) => {
            const number = invoice.invoicenum || invoice.id || index + 1;
            return (
              <div className="invoice-row" key={invoice.id || number}>
                <div><strong>#{number}</strong><small>{formatDate(invoice.date)}</small></div>
                <StatusBadge status={invoice.status} />
                <strong>{formatAmount(invoice.total, invoice.currencycode || customer?.currency)}</strong>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="empty-card"><EmptyState title="No invoices yet" description="No billing records were returned for this account." /></div>
      )}
    </Card>
  );
}

function DomainsCard({ domains }) {
  return (
    <Card>
      <SectionHeader title="Domains" description="Domains attached to the signed-in client." />
      {domains.length ? (
        <VStack gap={2}>
          {domains.map((domain, index) => {
            const name = domain.domain || domain.name || domain.domainname || 'Domain';
            return (
              <div className="compact-row" key={domain.id || name || index}>
                <div><strong>{name}</strong><small>Expires {formatDate(domain.expirydate || domain.nextduedate)}</small></div>
                <StatusBadge status={domain.status} />
              </div>
            );
          })}
        </VStack>
      ) : <EmptyState title="No domains yet" description="No domain records were returned for this account." isCompact />}
    </Card>
  );
}

function TicketsCard({ tickets, unavailable }) {
  return (
    <Card>
      <SectionHeader title="Support" description="Recent tickets from the account." />
      {unavailable ? (
        <Banner status="info" title="Support data unavailable" description="The WHMCS support API is not available for this account." />
      ) : tickets.length ? (
        <VStack gap={2}>
          {tickets.map((ticket, index) => (
            <a className="ticket-row" href={`/tickets/${ticket.id || ticket.tid || ''}`} key={ticket.id || ticket.tid || index}>
              <span><strong>{ticket.subject || 'Support ticket'}</strong><small>#{ticket.tid || ticket.id || '—'} · {formatDate(ticket.lastreply || ticket.date)}</small></span>
              <StatusBadge status={ticket.status} />
            </a>
          ))}
        </VStack>
      ) : <EmptyState title="No open tickets" description="There are no support tickets to show for this account." isCompact />}
    </Card>
  );
}

function AccountHealthCard({ services, domains, tickets }) {
  const serviceActive = services.filter((service) => String(service.status).toLowerCase() === 'active').length;
  const domainActive = domains.filter((domain) => String(domain.status).toLowerCase() === 'active').length;
  const ticketClosed = tickets.filter((ticket) => ['closed', 'resolved'].includes(String(ticket.status).toLowerCase())).length;
  const rows = [
    { label: 'Active services', value: serviceActive, max: Math.max(services.length, 1), variant: 'success' },
    { label: 'Active domains', value: domainActive, max: Math.max(domains.length, 1), variant: 'accent' },
    { label: 'Resolved tickets', value: ticketClosed, max: Math.max(tickets.length, 1), variant: 'neutral' },
  ];
  return (
    <Card variant="muted">
      <SectionHeader title="Account health" description="A direct summary of the records returned by WHMCS." />
      <VStack gap={3}>
        {rows.map((row) => (
          <div key={row.label} className="health-row">
            <HStack justify="between" align="center">
              <Text type="label">{row.label}</Text>
              <Text type="supporting" hasTabularNumbers>{row.value} / {row.max}</Text>
            </HStack>
            <ProgressBar label={row.label} value={row.value} max={row.max} variant={row.variant} isLabelHidden />
          </div>
        ))}
      </VStack>
    </Card>
  );
}

function GoogleToolsCard({ tools }) {
  const connected = Array.isArray(tools) ? tools : [];
  return (
    <Card>
      <SectionHeader title="Google tools" description="Connections are kept per WHMCS client on the server." />
      {connected.length ? (
        <HStack gap={2} wrap="wrap">
          {connected.map((tool) => <Badge key={tool} variant="success" label={tool === 'searchconsole' ? 'Search Console connected' : 'Analytics connected'} />)}
        </HStack>
      ) : (
        <VStack gap={3}>
          <Text type="supporting">No Google tools are connected for this client yet.</Text>
          <Button label="Manage Google tools" size="sm" variant="secondary" onClick={() => window.location.assign('/google/tools')} />
        </VStack>
      )}
    </Card>
  );
}

function Dashboard({ data, onRefresh, refreshing }) {
  const customer = data.customer || {};
  const services = Array.isArray(data.services) ? data.services : [];
  const domains = Array.isArray(data.domains) ? data.domains : [];
  const invoices = Array.isArray(data.invoices) ? data.invoices : [];
  const tickets = Array.isArray(data.tickets) ? data.tickets : [];
  const stats = data.stats || {};
  const dueInvoices = invoices.filter((invoice) => ['unpaid', 'overdue'].includes(String(invoice.status).toLowerCase()));
  const dueCount = Number(stats.numdueinvoices ?? dueInvoices.length) || 0;
  const dueBalance = stats.dueinvoicesbalance ?? dueInvoices.reduce((sum, invoice) => sum + readNumber(invoice.total), 0);
  const openTickets = Number(stats.numactivetickets ?? tickets.filter((ticket) => !['closed', 'resolved'].includes(String(ticket.status).toLowerCase())).length) || 0;
  const serviceCount = Number(stats.numactiveservices ?? services.length) || 0;
  const domainCount = Number(stats.numactivedomains ?? domains.length) || 0;

  return (
    <div className="dashboard-page">
      <DashboardHeader customer={customer} onRefresh={onRefresh} refreshing={refreshing} />
      <Grid columns={{ minWidth: 210, repeat: 'fit' }} gap={4}>
        <MetricCard label="Active services" value={serviceCount} detail={`${services.length} returned`} variant="success" />
        <MetricCard label="Active domains" value={domainCount} detail={`${domains.length} returned`} variant="info" />
        <MetricCard label="Balance due" value={formatAmount(dueBalance, customer.currency)} detail={`${dueCount} due`} variant={dueCount ? 'warning' : 'success'} />
        <MetricCard label="Open support" value={openTickets} detail={data.ticketsUnavailable ? 'Unavailable' : 'Account tickets'} variant={data.ticketsUnavailable ? 'neutral' : openTickets ? 'warning' : 'success'} />
      </Grid>
      <div className="dashboard-columns">
        <div className="dashboard-main-column">
          <ServicesCard services={services} />
          <InvoicesCard invoices={invoices} customer={customer} />
        </div>
        <div className="dashboard-side-column">
          <DomainsCard domains={domains} />
          <TicketsCard tickets={tickets} unavailable={data.ticketsUnavailable} />
          <AccountHealthCard services={services} domains={domains} tickets={tickets} />
          <GoogleToolsCard tools={data.googleTools} />
        </div>
      </div>
      <Text type="supporting" as="p" className="data-footnote">Live account payload · Last loaded {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date())}</Text>
    </div>
  );
}

function AuthRequired() {
  return (
    <Card>
      <EmptyState
        title="Sign in to load your workspace"
        description="This dashboard never falls back to demo records. Sign in through the existing WHMCS session, then the account-scoped API will populate this view."
        actions={<HStack gap={2} wrap="wrap"><Button label="Sign in" variant="primary" onClick={() => go('login')} /><Button label="Open legacy login" variant="secondary" onClick={() => window.location.assign('/login?next=/app/%23/dashboard')} /></HStack>}
      />
    </Card>
  );
}

function DashboardPage() {
  const dashboard = useDashboard();
  const refreshing = dashboard.status === 'loading';
  let content;
  if (dashboard.status === 'loading') {
    content = <Card><EmptyState title="Loading your account" description="Checking the signed-in WHMCS session and reading the account payload." isCompact /></Card>;
  } else if (dashboard.status === 'signed-out') {
    content = <AuthRequired />;
  } else if (dashboard.status === 'error') {
    content = <Banner status="error" title="Dashboard unavailable" description={dashboard.error} endContent={<Button label="Try again" onClick={dashboard.reload} />} />;
  } else {
    content = <Dashboard data={dashboard.data} onRefresh={dashboard.reload} refreshing={refreshing} />;
  }
  return <Shell route="dashboard" onRefresh={dashboard.reload} refreshing={refreshing}><div className="portal-content">{content}</div></Shell>;
}

function LoginPage() {
  const googleButton = useRef(null);
  const [googleClientId, setGoogleClientId] = useState('');
  const [googleError, setGoogleError] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/react/config', { credentials: 'same-origin' })
      .then((response) => response.json())
      .then((payload) => { if (!cancelled) setGoogleClientId(payload.googleClientId || ''); })
      .catch(() => { if (!cancelled) setGoogleError('Google sign-in configuration is unavailable.'); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!googleClientId || !googleButton.current) return undefined;
    const render = () => {
      if (!window.google?.accounts?.id || !googleButton.current) return;
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        context: 'signin',
        ux_mode: 'popup',
        auto_select: false,
        callback: async (response) => {
          try {
            const result = await fetch('/auth/google', {
              method: 'POST',
              credentials: 'same-origin',
              headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
              body: JSON.stringify({ id_token: response.credential, next: '/app/#/dashboard' }),
            });
            const payload = await result.json().catch(() => ({}));
            if (!result.ok || !payload.ok) throw new Error(payload.error || 'Google sign-in failed.');
            go('dashboard');
          } catch (error) {
            setGoogleError(error.message);
          }
        },
      });
      googleButton.current.replaceChildren();
      window.google.accounts.id.renderButton(googleButton.current, { theme: 'outline', size: 'large', width: 360, text: 'signin_with' });
    };
    if (window.google?.accounts?.id) {
      render();
      return undefined;
    }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = render;
    script.onerror = () => setGoogleError('Google sign-in could not load in this browser.');
    document.head.appendChild(script);
    return () => { script.remove(); };
  }, [googleClientId]);

  return (
    <div className="login-page">
      <div className="login-art" aria-hidden="true"><span>SNBD</span><small>Reliable hosting, account-scoped by design.</small></div>
      <main className="login-panel">
        <Brand />
        <VStack gap={2}>
          <Heading level={1} type="display-2">Welcome back</Heading>
          <Text type="large">Sign in to view the services, billing, domains, and support records tied to your WHMCS account.</Text>
        </VStack>
        <div className="google-login">
          <div ref={googleButton} />
          {googleError ? <Text type="supporting" color="secondary" as="p">{googleError}</Text> : null}
        </div>
        <div className="login-divider"><span>or use your WHMCS login</span></div>
        <form method="post" action="/login" className="login-form">
          <input type="hidden" name="next" value="/app/#/dashboard" />
          <TextInput label="Email" type="email" value={email} onChange={setEmail} htmlName="email" autoComplete="email" isRequired />
          <TextInput label="Password" type="password" value={password} onChange={setPassword} htmlName="password" autoComplete="current-password" isRequired />
          <Button label="Sign in" variant="primary" type="submit" width="100%" />
        </form>
        <Text type="supporting" as="p">Your WHMCS password and Google credential are handled by the existing server routes. They are never placed in the React bundle.</Text>
        <a className="legacy-link" href="/login">Need the classic login page?</a>
      </main>
    </div>
  );
}

function PlaceholderPage({ route }) {
  const labels = { services: 'My services', domains: 'Domains', invoices: 'Invoices', tickets: 'Support tickets' };
  const label = labels[route] || 'This workspace';
  return (
    <Shell route={route} onRefresh={() => {}} refreshing={false}>
      <div className="portal-content placeholder-page">
        <Card>
          <EmptyState title={`${label} stays on the existing portal for now`} description="The Astryx dashboard shell is live and consuming account data. This route keeps the established WHMCS page until its own read-only API slice is migrated." actions={<Button label="Back to dashboard" variant="primary" onClick={() => go('dashboard')} />} />
        </Card>
      </div>
    </Shell>
  );
}

export default function App() {
  const route = useHashRoute();
  if (route === 'login') return <LoginPage />;
  if (route === 'dashboard') return <DashboardPage />;
  return <PlaceholderPage route={route} />;
}
