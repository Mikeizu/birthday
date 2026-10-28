import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowDownToLine, ArrowRight, ArrowUpRight, Bell, CalendarDays, Cake, Check, CheckCircle2, ChevronLeft, ChevronRight, CircleHelp, Clock3, Ellipsis, Gift, Heart, LayoutDashboard, Leaf, LoaderCircle, LogOut, Mail, MessageCircle, Pencil, Plus, Search, Settings2, ShieldCheck, Sparkles, Trash2, Users, X } from 'lucide-react';
import { MONTHS, birthdayLabel, createCalendar, daysUntil, initials, observedDate, sortUpcoming } from './lib/birthdays.js';

type Birthday = { id: string; name: string; title: string; month: number; day: number; createdAt?: string; whatsappPhone?: string; whatsappOptIn?: boolean; hasWhatsapp?: boolean };
type Page = 'overview' | 'birthdays' | 'calendar' | 'reminders';
type Auth = { authenticated: boolean; setupRequired: boolean };
type WhatsAppStatus = { configured: boolean; celebrantConfigured?: boolean; adminConfigured?: boolean; missing: string[]; invalid?: string[]; sendTime: string; timeZone: string; templateName: string; greetingTemplateName?: string; language?: string };
const NAV = [{ id: 'overview', label: 'Overview', icon: LayoutDashboard }, { id: 'birthdays', label: 'Birthday directory', icon: Users }, { id: 'calendar', label: 'Calendar', icon: CalendarDays }, { id: 'reminders', label: 'Reminders', icon: Bell }] as const;
const COLORS = ['sage', 'peach', 'lavender', 'gold', 'rose', 'blue'];

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...options?.headers } });
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Something went wrong. Please try again.');
  return body as T;
}

function foundationToday(timeZone = 'Africa/Lagos') {
  try { new Intl.DateTimeFormat('en', { timeZone }).format(); } catch { timeZone = 'Africa/Lagos'; }
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(new Date());
  const get = (name: string) => Number(parts.find(p => p.type === name)?.value);
  return new Date(get('year'), get('month') - 1, get('day'));
}

function getDemoBirthdays(now: Date): Birthday[] {
  const base = [
    ['Amara Okafor', 'Programme Director', 4], ['Daniel Adeyemi', 'Community Volunteer', 9], ['Grace Mensah', 'Board Member', 14], ['Ibrahim Bello', 'Outreach Coordinator', 18], ['Nkechi Eze', 'Foundation Member', 23], ['Sarah Johnson', 'Partnerships Lead', 28],
  ];
  return base.map(([name, title, day], i) => ({ id: `sample-${i}`, name: String(name), title: String(title), month: now.getMonth() + 1, day: Number(day) }));
}

function Avatar({ person, index = 0, large = false }: { person: Birthday; index?: number; large?: boolean }) {
  return <span className={`avatar ${COLORS[index % COLORS.length]} ${large ? 'large' : ''}`} aria-hidden="true">{initials(person.name)}</span>;
}

function Modal({ title, subtitle, children, onClose }: { title: string; subtitle?: string; children: ReactNode; onClose: () => void }) {
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const focusable = () => Array.from(dialog.current?.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex="0"]') || []).filter(e => !e.hasAttribute('disabled'));
    (dialog.current?.querySelector<HTMLElement>('input') || focusable()[0])?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab') {
        const elements = focusable();
        if (event.shiftKey && document.activeElement === elements[0]) { event.preventDefault(); elements.at(-1)?.focus(); }
        if (!event.shiftKey && document.activeElement === elements.at(-1)) { event.preventDefault(); elements[0]?.focus(); }
      }
    };
    document.addEventListener('keydown', handleKey);
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', handleKey); document.body.style.overflow = oldOverflow; previous?.focus(); };
  }, [onClose]);
  return <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" ref={dialog}>
      <button className="icon-button close-modal" aria-label="Close dialog" onClick={onClose}><X size={20} /></button>
      <div className="modal-symbol"><Heart size={24} /></div><h2 id="modal-title">{title}</h2>{subtitle && <p className="muted modal-subtitle">{subtitle}</p>}{children}
    </div>
  </div>;
}

function CelebrationArt() {
  return <svg className="celebration-art" viewBox="0 0 350 210" fill="none" aria-hidden="true">
    <ellipse cx="195" cy="184" rx="112" ry="13" fill="#CEDBCD" />
    <path d="M80 176c-25-28-44-49-32-82 30 4 50 32 32 82Z" fill="#88A08A" /><path d="m80 176-23-65" stroke="#587C61" strokeWidth="2" />
    <path d="M93 177c-6-35-1-58 24-73 22 24 12 55-24 73Z" fill="#ACBE9A" /><path d="m94 175 18-56" stroke="#71916B" strokeWidth="2" />
    <path d="M275 175c27-24 37-51 27-72-27 9-38 38-27 72Z" fill="#8BA58E" /><path d="m275 176 20-59" stroke="#587C61" strokeWidth="2" />
    <rect x="128" y="116" width="132" height="63" rx="8" fill="#F8E3D0" /><path d="M128 126c0-15 13-18 23-11s12 13 24 5 18-9 29 0 15 8 25 0 23-14 31 5v12c-8-8-17-8-26 0s-18 6-27-1-17-7-28 1-18 4-28-2-16-2-23 2Z" fill="#FFF9EE" />
    <path d="M141 175h105" stroke="#D9BCA1" strokeWidth="2" /><rect x="174" y="87" width="9" height="29" rx="3" fill="#C88E79" /><path d="M178 87c-11-5-6-15 1-20 6 10 7 16-1 20Z" fill="#E4AE5C" />
    <rect x="207" y="87" width="9" height="29" rx="3" fill="#8BA58E" /><path d="M211 87c-10-5-6-15 1-20 6 10 7 16-1 20Z" fill="#E4AE5C" />
    <path d="m114 45 7 9m-8-8-2 11m1-11-10 4m152 15 8-9m-8 9 12 1m-12-1 2 11" stroke="#C29675" strokeWidth="3" strokeLinecap="round" />
    <path d="m153 38 4-13m78 16 9-5M306 76l7-2M58 62l9 4" stroke="#779679" strokeWidth="4" strokeLinecap="round" />
    <circle cx="284" cy="36" r="4" fill="#E4BD83" /><circle cx="91" cy="83" r="3" fill="#BF877B" /><circle cx="227" cy="20" r="3" fill="#BF877B" />
    <path d="m170 43 4 5-4 5-4-5Z" fill="#E3B778" /><path d="m291 141 4 5-4 5-4-5Z" fill="#D6AA72" />
  </svg>;
}

export default function App() {
  const [page, setPage] = useState<Page>('overview');
  const [birthdays, setBirthdays] = useState<Birthday[]>([]);
  const [auth, setAuth] = useState<Auth>({ authenticated: false, setupRequired: false });
  const [whatsapp, setWhatsapp] = useState<WhatsAppStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [today, setToday] = useState(foundationToday);
  const [month, setMonth] = useState(today.getMonth());
  const [calendarYear, setCalendarYear] = useState(today.getFullYear());
  const [query, setQuery] = useState('');
  const [monthFilter, setMonthFilter] = useState('all');
  const [sort, setSort] = useState('upcoming');
  const [demo, setDemo] = useState(false);
  const [modal, setModal] = useState<'login' | 'add' | 'edit' | 'delete' | 'help' | null>(null);
  const [selected, setSelected] = useState<Birthday | null>(null);
  const [continueToAdd, setContinueToAdd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [toast, setToast] = useState('');
  const [mobileNav, setMobileNav] = useState(false);
  const [browserAlerts, setBrowserAlerts] = useState(() => { try { return localStorage.getItem('impact23-alerts') === 'true'; } catch { return false; } });
  const closeModal = useRef(() => {});
  closeModal.current = () => { if (!busy) { setModal(null); setFormError(''); } };
  const stableClose = useRef(() => closeModal.current()).current;

  async function load() {
    setLoading(true); setError('');
    try {
      const [session, records, reminders] = await Promise.all([api<Auth>('/auth/status'), api<{birthdays: Birthday[]}>('/birthdays'), api<{whatsapp: WhatsAppStatus}>('/reminders/status')]);
      setAuth(session); setBirthdays(records.birthdays); setWhatsapp(reminders.whatsapp); setToday(foundationToday(reminders.whatsapp.timeZone));
    } catch (err) { setError((err as Error).message); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  useEffect(() => { if (toast) { const timer = setTimeout(() => setToast(''), 4500); return () => clearTimeout(timer); } }, [toast]);
  useEffect(() => { const timer = setInterval(() => setToday(foundationToday(whatsapp?.timeZone)), 60_000); return () => clearInterval(timer); }, [whatsapp?.timeZone]);
  useEffect(() => {
    if (!browserAlerts || demo || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    const due = birthdays.filter(b => daysUntil(b, today) === 0);
    if (!due.length) return;
    const key = `impact23-notified-${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;
    try { if (localStorage.getItem(key)) return; new Notification('A little celebration is due 🎂', { body: `Today: ${due.map(b => b.name).join(', ')}. Happy birthday from Impact23!`, icon: '/favicon.svg' }); localStorage.setItem(key, 'true'); } catch { /* Browser permission may change between checks. */ }
  }, [browserAlerts, birthdays, demo, today]);

  const people = demo ? getDemoBirthdays(today) : birthdays;
  const upcoming = sortUpcoming(people, today) as Birthday[];
  const todayBirthdays = people.filter(b => daysUntil(b, today) === 0);
  const thisMonth = people.filter(b => b.month === today.getMonth() + 1);
  const nextSeven = people.filter(b => daysUntil(b, today) <= 7);
  const monthPeople = people.filter(b => b.month === month + 1 && (!query || `${b.name} ${b.title}`.toLowerCase().includes(query.toLowerCase()))).sort((a, b) => a.day - b.day || a.name.localeCompare(b.name));
  const filtered = people.filter(b => (monthFilter === 'all' || b.month === Number(monthFilter)) && `${b.name} ${b.title}`.toLowerCase().includes(query.toLowerCase()));
  const directory = (sort === 'name' ? [...filtered].sort((a, b) => a.name.localeCompare(b.name)) : sortUpcoming(filtered, today)) as Birthday[];

  function navigate(next: Page) { setPage(next); setQuery(''); setMobileNav(false); }
  function openAdd() { setSelected(null); setFormError(''); if (!auth.authenticated) { setContinueToAdd(true); setModal('login'); } else setModal('add'); }
  function moveMonth(direction: number) { const next = new Date(calendarYear, month + direction, 1); setMonth(next.getMonth()); setCalendarYear(next.getFullYear()); }
  function exportCalendar() {
    if (!people.length) { setToast('Add a birthday to create your calendar.'); return; }
    const url = URL.createObjectURL(new Blob([createCalendar(people)], { type: 'text/calendar;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = demo ? 'impact23-sample-birthdays.ics' : 'impact23-birthdays.ics'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    setToast('Calendar downloaded. Import it into Google, Apple, or Outlook Calendar.');
  }
  async function handleAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setFormError(''); setBusy(true);
    const data = new FormData(event.currentTarget);
    if (auth.setupRequired && data.get('password') !== data.get('confirm')) { setFormError('Your passwords do not match.'); setBusy(false); return; }
    try {
      const session = await api<Auth>(auth.setupRequired ? '/auth/setup' : '/auth/login', { method: 'POST', body: JSON.stringify({ password: data.get('password') }) });
      setAuth(session);
      const records = await api<{birthdays: Birthday[]}>('/birthdays'); setBirthdays(records.birthdays);
      setModal(continueToAdd ? 'add' : null); setContinueToAdd(false); setToast('You’re signed in as admin.');
    } catch (err) { setFormError((err as Error).message); }
    finally { setBusy(false); }
  }
  async function saveBirthday(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setFormError(''); setBusy(true);
    const data = new FormData(event.currentTarget);
    const payload = { name: String(data.get('name')).trim(), title: String(data.get('title')).trim(), month: Number(data.get('month')), day: Number(data.get('day')), whatsappPhone: String(data.get('phone')).trim(), whatsappOptIn: data.get('consent') === 'on' };
    try {
      const result = await api<{birthday: Birthday}>(modal === 'edit' ? `/birthdays/${selected!.id}` : '/birthdays', { method: modal === 'edit' ? 'PUT' : 'POST', body: JSON.stringify(payload) });
      setBirthdays(old => modal === 'edit' ? old.map(b => b.id === selected!.id ? result.birthday : b) : [...old, result.birthday]);
      setDemo(false); setModal(null); setToast(modal === 'edit' ? 'Birthday updated. Another celebration to look forward to.' : `${result.birthday.name}’s birthday is on the calendar.`);
    } catch (err) { setFormError((err as Error).message); }
    finally { setBusy(false); }
  }
  async function deleteBirthday() {
    if (!selected) return; setBusy(true); setFormError('');
    try { await api(`/birthdays/${selected.id}`, {method:'DELETE'}); setBirthdays(old => old.filter(b => b.id !== selected.id)); setModal(null); setToast('Birthday removed from the directory.'); }
    catch (err) { setFormError((err as Error).message); }
    finally { setBusy(false); }
  }
  async function logout() {
    try { await api('/auth/logout', { method: 'POST' }); setAuth(old => ({ ...old, authenticated: false })); const records = await api<{birthdays: Birthday[]}>('/birthdays'); setBirthdays(records.birthdays); setToast('You’ve signed out.'); }
    catch (err) { setToast((err as Error).message); }
  }
  async function toggleBrowserAlerts() {
    if (browserAlerts) { setBrowserAlerts(false); try { localStorage.setItem('impact23-alerts','false'); } catch {} return; }
    if (typeof Notification === 'undefined') { setToast('This browser does not support notifications. Try calendar reminders instead.'); return; }
    const permission = await Notification.requestPermission();
    if (permission === 'granted') { setBrowserAlerts(true); try { localStorage.setItem('impact23-alerts','true'); } catch {} setToast('Browser alerts enabled while this app is open.'); }
    else setToast('Notifications weren’t enabled. You can change this in your browser’s site settings.');
  }
  function editBirthday(person: Birthday) { setSelected(person); setFormError(''); setModal('edit'); }

  const recordRow = (person: Birthday, index: number, showMonth = false) => <div className="person-row" key={person.id}>
    <Avatar person={person} index={index} /><div className="person-info"><strong>{person.name}</strong><span>{person.title || 'Foundation member'}</span></div>
    <div className="person-date"><span>{showMonth ? birthdayLabel(person) : String(person.day).padStart(2, '0')}</span>{daysUntil(person, today) === 0 ? <span className="pill today-pill">Today 🎉</span> : <small>{daysUntil(person, today) === 1 ? 'Tomorrow' : `in ${daysUntil(person, today)} days`}</small>}</div>
    {auth.authenticated && !demo && <div className="row-actions"><button className="icon-button" aria-label={`Edit ${person.name}`} onClick={() => editBirthday(person)}><Pencil size={16}/></button><button className="icon-button danger-icon" aria-label={`Delete ${person.name}`} onClick={() => {setSelected(person);setModal('delete');setFormError('');}}><Trash2 size={16}/></button></div>}
  </div>;

  return <div className="app-shell">
    {mobileNav && <button className="nav-scrim" aria-label="Close menu" onClick={() => setMobileNav(false)} />}
    <aside className={`sidebar ${mobileNav ? 'open' : ''}`}>
      <a className="brand" href="#" onClick={e => {e.preventDefault();navigate('overview');}} aria-label="Impact23 home"><span className="brand-mark"><Heart size={22} fill="currentColor"/><Sparkles size={12}/></span><div><strong>impact<span>23</span></strong><small>INTERNATIONAL SUPPORT FOUNDATION</small></div></a>
      <div className="workspace-label">OUR COMMUNITY</div>
      <nav aria-label="Main navigation">{NAV.map(item => <button key={item.id} className={`nav-item ${page === item.id ? 'active' : ''}`} onClick={() => navigate(item.id)} aria-current={page === item.id ? 'page' : undefined}><item.icon size={19}/><span>{item.label}</span>{item.id === 'reminders' && todayBirthdays.length > 0 && <span className="nav-count">{todayBirthdays.length}</span>}</button>)}</nav>
      <div className="sidebar-note"><span className="note-art"><Heart size={24}/><span>✦</span></span><strong>A little remembrance.<br/>A lasting impact.</strong><p>Making everyone in our<br/>community feel celebrated.</p><span className="handwritten">That’s the Impact23 way.</span></div>
      <button className="help-button" onClick={() => setModal('help')}><CircleHelp size={18}/> A little help</button>
      <div className="sidebar-bottom"><span className="foundation-dot"/><span>Made for our people</span><Heart size={12}/></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="topbar-breadcrumb"><button className="mobile-menu icon-button" aria-label="Open navigation" onClick={() => setMobileNav(true)}><Ellipsis size={23}/></button><span>Our community</span><ChevronRight size={13}/><strong>{NAV.find(n => n.id === page)?.label}</strong></div><div className="topbar-actions"><span className="today-date">{today.toLocaleDateString('en-GB', {day:'numeric', month:'short',year:'numeric'})}</span><button className="notification-button icon-button" aria-label="View reminders" onClick={() => navigate('reminders')}><Bell size={19}/>{todayBirthdays.length > 0 && <i/>}</button><span className="top-divider"/>{auth.authenticated ? <><div className="admin-chip"><span className="admin-avatar">A</span><div><strong>Foundation admin</strong><small>Administrator</small></div></div><button className="icon-button" aria-label="Sign out" title="Sign out" onClick={() => void logout()}><LogOut size={17}/></button></> : <button className="admin-login" onClick={() => {setContinueToAdd(false);setFormError('');setModal('login');}}><ShieldCheck size={17}/><span>Admin sign in</span></button>}</div></header>
      <main>
        {error && <div className="error-banner" role="alert"><span>We couldn’t load your birthdays. {error}</span><button onClick={() => void load()}>Try again</button></div>}
        {demo && <div className="demo-banner"><Sparkles size={17}/><span>You’re exploring sample birthdays. Your foundation’s records haven’t changed.</span><button onClick={() => setDemo(false)}>Exit sample view <X size={14}/></button></div>}
        <div className="page-heading"><div><div className="eyebrow">IMPACT23 BIRTHDAY BOOK</div><h1>{page === 'overview' ? 'A little joy. For every birthday.' : page === 'birthdays' ? 'The people behind our impact.' : page === 'calendar' ? 'A year of reasons to celebrate.' : 'Good wishes, right on time.'}</h1><p>{page === 'overview' ? 'Remember the dates. Celebrate the people. Make everyone feel special.' : page === 'birthdays' ? 'Every name belongs. Keep your community’s special days in one place.' : page === 'calendar' ? 'A little planning makes every birthday a little more meaningful.' : 'Thoughtful reminders, so a special day never slips by.'}</p></div><button className="button primary" onClick={openAdd} disabled={loading || !!error}><Plus size={18}/>Add birthday</button></div>

        {loading ? <div className="loading-state" role="status"><LoaderCircle className="spin" size={28}/><span>Gathering your community…</span></div> : <>
          {page === 'overview' && <>
            <section className="welcome-card"><div className="welcome-copy"><span className="tiny-label"><span/> PEOPLE FIRST. ALWAYS.</span><h2>Because every person<br/>deserves to be <em>celebrated.</em></h2><p>Your community’s birthdays, thoughtfully kept together.<br className="desktop-break"/> A small reminder that we’re better, together.</p><button className="text-button" onClick={() => navigate('calendar')}>Let’s see who’s celebrating <ArrowRight size={16}/></button></div><CelebrationArt/><div className="hero-stamp"><Heart size={12} fill="currentColor"/> WITH LOVE, IMPACT23</div></section>
            <div className="stats-grid"><div className="stat-card"><span className="stat-icon sage"><Users size={21}/></span><div><span className="stat-label">Our birthday family</span><strong>{people.length}<small>people to celebrate</small></strong></div><span className="stat-decoration"><ArrowUpRight size={17}/></span></div><div className="stat-card"><span className="stat-icon peach"><Cake size={21}/></span><div><span className="stat-label">Birthdays this month</span><strong>{thisMonth.length}<small>in {MONTHS[today.getMonth()]}</small></strong></div><span className="stat-month">{MONTHS[today.getMonth()].slice(0,3).toUpperCase()}</span></div><div className="stat-card"><span className="stat-icon lavender"><Gift size={21}/></span><div><span className="stat-label">Coming up soon</span><strong>{nextSeven.length}<small>in the next 7 days</small></strong></div><span className="stat-decoration"><Sparkles size={18}/></span></div></div>
            <div className="dashboard-columns"><section className="panel birthdays-panel"><div className="panel-heading"><div className="section-title"><CalendarDays size={19}/><h2>This month’s celebrations</h2></div><div className="month-controls"><button className="icon-button" aria-label="Previous month" onClick={() => moveMonth(-1)}><ChevronLeft size={17}/></button><span>{MONTHS[month]} <small>{calendarYear}</small></span><button className="icon-button" aria-label="Next month" onClick={() => moveMonth(1)}><ChevronRight size={17}/></button></div></div><div className="list-caption"><span>A SPECIAL DAY FOR</span><span>DATE</span></div>{monthPeople.length ? <div>{monthPeople.map((person, i) => recordRow(person, i))}</div> : <div className="empty-state"><span className="empty-icon"><Cake size={30}/></span><h3>{people.length ? `A little quiet in ${MONTHS[month]}` : 'Your birthday book starts here'}</h3><p>{people.length ? 'No birthdays recorded for this month. Add someone to make it special.' : 'Add the people who make Impact23 special. We’ll take care of remembering their day.'}</p><button className="button secondary" onClick={openAdd}><Plus size={16}/>Add a birthday</button>{!people.length && <button className="text-button subtle" onClick={() => {setDemo(true);setMonth(today.getMonth());}}>Or explore a sample birthday book <ArrowRight size={14}/></button>}</div>}<button className="panel-footer" onClick={() => navigate('birthdays')}>View the birthday directory <ArrowRight size={15}/></button></section>
            <aside className="dashboard-side"><section className="up-next-card"><div className="section-title"><Sparkles size={18}/><h2>Next up, a little celebration</h2></div>{upcoming[0] ? <><div className="upcoming-person"><Avatar person={upcoming[0]} large index={2}/><h3>{upcoming[0].name}</h3><p>{upcoming[0].title || 'Foundation member'}</p><span className="next-date"><Cake size={15}/>{birthdayLabel(upcoming[0])}<i/>{daysUntil(upcoming[0], today) === 0 ? 'Today!' : daysUntil(upcoming[0], today) === 1 ? 'Tomorrow' : `${daysUntil(upcoming[0], today)} days to go`}</span></div><button className="button white full" onClick={() => {navigate('birthdays');setQuery(upcoming[0].name);}}>View birthday <ArrowRight size={15}/></button></> : <div className="up-next-empty"><Gift size={34}/><h3>Something to look forward to</h3><p>Your next birthday celebration will appear right here.</p></div>}</section><section className="whatsapp-mini"><span className="whatsapp-symbol"><MessageCircle size={21}/></span><div><strong>A thoughtful nudge</strong><p>Let WhatsApp do the remembering.</p><button className="text-button" onClick={() => navigate('reminders')}>Set up reminders <ArrowRight size={14}/></button></div></section></aside></div>
            <section className="year-panel"><div><h2>A whole year of belonging</h2><p>Every month has a little something to celebrate.</p></div><div className="month-strip">{MONTHS.map((label, index) => <button key={label} className={index === month ? 'selected' : ''} onClick={() => {setMonth(index);navigate('calendar');}} aria-label={`View ${label}: ${people.filter(b=>b.month===index+1).length} birthdays`}><span>{label.slice(0,3)}</span><strong>{people.filter(b=>b.month===index+1).length}</strong><i className={people.some(b=>b.month===index+1) ? 'has-birthdays' : ''}/></button>)}</div></section>
          </>}

          {page === 'birthdays' && <section className="panel directory-panel"><div className="directory-toolbar"><div><h2>Our birthday family <span className="count-badge">{people.length}</span></h2><p>Good people. Special days. All together.</p></div><button className="button secondary" onClick={exportCalendar} disabled={!people.length}><ArrowDownToLine size={16}/>Export calendar</button></div><div className="filter-bar"><label className="search-field"><Search size={17}/><input type="search" aria-label="Search names or titles" placeholder="Find a name or title…" value={query} onChange={e => setQuery(e.target.value)}/></label><select aria-label="Filter by month" value={monthFilter} onChange={e=>setMonthFilter(e.target.value)}><option value="all">All months</option>{MONTHS.map((m,i)=><option value={i+1} key={m}>{m}</option>)}</select><select aria-label="Sort birthdays" value={sort} onChange={e=>setSort(e.target.value)}><option value="upcoming">Next birthday first</option><option value="name">Name A–Z</option></select></div><div className="directory-caption"><span>NAME & TITLE</span><span>BIRTHDAY</span></div>{directory.length ? directory.map((person,i)=>recordRow(person,i,true)) : <div className="empty-state"><span className="empty-icon"><Users size={30}/></span><h3>{query || monthFilter !== 'all' ? 'No birthdays found' : 'Make room for your people'}</h3><p>{query || monthFilter !== 'all' ? 'Try another name or choose a different month.' : 'Start with a name and a special day. No birth year needed.'}</p>{query || monthFilter !== 'all' ? <button className="button secondary" onClick={()=>{setQuery('');setMonthFilter('all');}}>Clear filters</button> : <button className="button primary" onClick={openAdd}><Plus size={16}/>Add the first birthday</button>}</div>}<div className="directory-footer">{directory.length} {directory.length === 1 ? 'person' : 'people'}{demo ? ' · Sample records' : ' · Birthdays repeat every year'}<span><ShieldCheck size={13}/> Contact details are visible only to admins</span></div></section>}

          {page === 'calendar' && <section className="panel calendar-panel"><div className="calendar-toolbar"><div><h2>{MONTHS[month]} <span className="muted">{calendarYear}</span></h2><p>{monthPeople.length} {monthPeople.length === 1 ? 'reason' : 'reasons'} to make someone’s day.</p></div><div className="calendar-toolbar-actions"><button className="button secondary compact" onClick={()=>{setMonth(today.getMonth());setCalendarYear(today.getFullYear());}}>Today</button><button className="icon-button" aria-label="Previous calendar month" onClick={()=>moveMonth(-1)}><ChevronLeft size={20}/></button><button className="icon-button" aria-label="Next calendar month" onClick={()=>moveMonth(1)}><ChevronRight size={20}/></button></div></div><div className="calendar-grid">{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d=><div className="weekday" key={d}>{d}</div>)}{Array.from({length:new Date(calendarYear,month,1).getDay()},(_,i)=><div className="calendar-cell blank" key={`blank-${i}`}/>)}{Array.from({length:new Date(calendarYear,month+1,0).getDate()},(_,i)=>{const day=i+1;const matches=people.filter(b=>{const observed=observedDate(b,calendarYear);return observed.getMonth()===month&&observed.getDate()===day;});const isToday=day===today.getDate()&&month===today.getMonth()&&calendarYear===today.getFullYear();return <div className={`calendar-cell ${isToday?'is-today':''} ${matches.length?'has-birthday':''}`} key={day}><span className="day-number">{day}</span>{matches.slice(0,3).map((person,index)=><button className={`calendar-event ${COLORS[index%COLORS.length]}`} key={person.id} title={`${person.name} · ${person.title}${person.month===2&&person.day===29&&day===28?' · February 29 observed on February 28':''}`} onClick={()=>{navigate('birthdays');setQuery(person.name);}}><Cake size={12}/><span>{person.name}</span></button>)}{matches.length>3&&<button className="more-events" onClick={()=>{navigate('birthdays');setMonthFilter(String(month+1));}}>+{matches.length-3} more</button>}</div>;})}</div><div className="calendar-legend"><span><i/>Today</span><span><Cake size={14}/>Community birthday</span><button className="text-button" onClick={exportCalendar}><ArrowDownToLine size={14}/>Add birthdays to your calendar</button></div></section>}

          {page === 'reminders' && <><div className="reminders-layout"><section className="panel reminder-main"><div className="reminder-section-heading"><span className="stat-icon sage"><MessageCircle size={25}/></span><div><h2>Thoughtfulness, delivered.</h2><p>Birthday reminders & greetings on WhatsApp</p></div><span className={`pill ${whatsapp?.configured ? 'connected-pill' : 'pending-pill'}`}>{whatsapp?.configured ? 'Configured' : 'Setup needed'}</span></div><p className="reminder-intro">A morning nudge for your admin. A warm birthday wish for your people. One less thing to remember, one more reason to smile.</p><div className="delivery-row"><span className="delivery-icon"><ShieldCheck size={20}/></span><div><strong>For the foundation admin</strong><p>A daily summary of everyone celebrating today.</p></div><span className={`status-dot ${whatsapp?.adminConfigured?'on':''}`}/></div><div className="delivery-row"><span className="delivery-icon peach"><Gift size={20}/></span><div><strong>For the birthday celebrant</strong><p>A personal greeting for members who have opted in.</p></div><span className={`status-dot ${whatsapp?.celebrantConfigured?'on':''}`}/></div><div className="schedule"><Clock3 size={17}/><span>Every birthday at <strong>{whatsapp?.sendTime || '08:00'}</strong> · {whatsapp?.timeZone || 'Africa/Lagos'}</span></div>{!whatsapp?.configured && <div className="setup-note"><Settings2 size={20}/><div><strong>Connect your WhatsApp Business account</strong><p>Your server needs a Meta access token, WhatsApp phone number ID, admin recipient, and two approved message templates. Add these securely to your hosting environment; never share tokens here.</p><details><summary>View connection requirements</summary><ul>{(whatsapp && (whatsapp.missing.length || whatsapp.invalid?.length) ? [...whatsapp.missing, ...(whatsapp.invalid || []).map(name => `Check ${name}`)] : ['WHATSAPP_ACCESS_TOKEN','WHATSAPP_PHONE_NUMBER_ID','WHATSAPP_RECIPIENT_PHONE']).map(name=><li key={name}><code>{name}</code></li>)}</ul><p>Templates: <code>{whatsapp?.templateName || 'impact23_birthday_reminder'}</code> (date, birthday names) and <code>{whatsapp?.greetingTemplateName || 'impact23_birthday_greeting'}</code> (name, title). See the repository README for configuration and approved template wording.</p></details></div></div>}<div className="privacy-note"><ShieldCheck size={15}/><span>Celebrants only receive messages after their admin records permission. WhatsApp delivery requires an online server and approved Meta templates.</span></div></section><aside className="reminder-side"><section className="panel reminder-option"><span className="stat-icon lavender"><CalendarDays size={23}/></span><h2>Your calendar, too.</h2><p>Download all birthdays as yearly events, with a reminder the day before.</p><button className="button secondary full" onClick={exportCalendar} disabled={!people.length}><ArrowDownToLine size={16}/>Download birthday calendar</button><small>Works with Google, Apple & Outlook Calendar. Import again when your directory changes. February 29 is observed on February 28 in non-leap years.</small></section><section className="panel reminder-option"><div className="option-title"><span className="stat-icon peach"><Bell size={22}/></span><button className={`toggle ${browserAlerts?'enabled':''}`} role="switch" aria-checked={browserAlerts} aria-label="Browser birthday alerts" onClick={()=>void toggleBrowserAlerts()}><span/></button></div><h2>A gentle browser nudge.</h2><p>Get a notification for today’s birthdays while this app is open.</p><span className="browser-label">{browserAlerts?'Alerts enabled on this device':'Alerts are off on this device'}</span></section></aside></div><section className="panel due-panel"><div className="panel-heading"><div className="section-title"><Bell size={18}/><h2>Coming up in the next 7 days</h2></div><span className="count-badge">{nextSeven.length}</span></div>{nextSeven.length ? (sortUpcoming(nextSeven,today) as Birthday[]).map((b,i)=>recordRow(b,i,true)) : <div className="quiet-empty"><Leaf size={23}/><span>No birthdays in the next seven days. A little time to plan the next celebration.</span></div>}</section></>}
          <footer className="page-footer"><span>Impact23 International Support Foundation</span><span>Every person matters. Every birthday, too. <Heart size={12}/></span></footer>
        </>}
      </main>
    </div>

    {modal === 'login' && <Modal title={auth.setupRequired ? 'A home for your birthday book.' : 'Welcome back, admin.'} subtitle={auth.setupRequired ? 'Create the foundation’s admin password to start adding your people.' : 'Sign in to add birthdays and keep your community’s details up to date.'} onClose={stableClose}><form onSubmit={e=>void handleAuth(e)}><label className="form-label">{auth.setupRequired?'Create password':'Admin password'}<input name="password" type="password" required minLength={auth.setupRequired?12:1} autoComplete={auth.setupRequired?'new-password':'current-password'} placeholder={auth.setupRequired?'At least 12 characters':'Enter your admin password'}/></label>{auth.setupRequired&&<label className="form-label">Confirm password<input name="confirm" type="password" required minLength={12} autoComplete="new-password" placeholder="Once more, just to be sure"/></label>}{formError&&<p className="form-error" role="alert">{formError}</p>}<button className="button primary full" disabled={busy}>{busy?<LoaderCircle className="spin" size={18}/>:<ShieldCheck size={17}/>} {auth.setupRequired?'Create admin account':'Sign in'}</button><p className="form-footnote"><ShieldCheck size={13}/>Your password is securely hashed. Member contact details stay private.</p></form></Modal>}
    {(modal === 'add' || modal === 'edit') && <Modal title={modal==='edit'?'Keep the little details right.':'Someone special to celebrate.'} subtitle="Add their name and birthday. We’ll remember the date, year after year." onClose={stableClose}><form onSubmit={e=>void saveBirthday(e)} key={selected?.id || 'new'}><label className="form-label">Full name <span>*</span><input name="name" required maxLength={100} defaultValue={selected?.name || ''} placeholder="e.g. Amara Okafor" autoComplete="name"/></label><label className="form-label">Title / role <span className="optional">Optional</span><input name="title" maxLength={100} defaultValue={selected?.title || ''} placeholder="e.g. Volunteer, Board Member, Dr."/></label><div className="form-date-row"><label className="form-label">Birth month <span>*</span><select name="month" defaultValue={selected?.month || ''} required><option value="" disabled>Select month</option>{MONTHS.map((m,i)=><option value={i+1} key={m}>{String(i+1).padStart(2,'0')} — {m}</option>)}</select></label><label className="form-label">Day <span>*</span><input name="day" type="number" min={1} max={31} required placeholder="DD" defaultValue={selected?.day || ''}/></label></div><p className="field-note"><CalendarDays size={13}/>Month and day only (MM/DD). No birth year needed.</p><details className="whatsapp-fields" open={!!selected?.whatsappPhone}><summary><MessageCircle size={16}/>WhatsApp birthday greeting <span className="optional">Optional</span></summary><label className="form-label">WhatsApp number<input name="phone" type="tel" defaultValue={selected?.whatsappPhone || ''} placeholder="e.g. +2348012345678" pattern="\+[1-9][0-9]{7,14}" autoComplete="tel"/><span className="input-hint">Include the country code, with no spaces.</span></label><label className="checkbox-label"><input type="checkbox" name="consent" defaultChecked={selected?.whatsappOptIn || false}/><span>This person has agreed to receive birthday greetings from Impact23 on WhatsApp.</span></label></details>{formError&&<p className="form-error" role="alert">{formError}</p>}<div className="form-actions"><button type="button" className="button secondary" onClick={stableClose} disabled={busy}>Cancel</button><button className="button primary" disabled={busy}>{busy?<LoaderCircle className="spin" size={17}/>:<Check size={17}/>} {modal==='edit'?'Save changes':'Save birthday'}</button></div><p className="form-footnote">February 29 reminders are observed on February 28 in non-leap years.</p></form></Modal>}
    {modal==='delete'&&selected&&<Modal title="Remove this birthday?" subtitle={`${selected.name} will be removed from the directory and future WhatsApp reminders. Existing calendar imports must be updated separately.`} onClose={stableClose}>{formError&&<p className="form-error" role="alert">{formError}</p>}<div className="form-actions"><button className="button secondary" disabled={busy} onClick={stableClose}>Keep birthday</button><button className="button danger" disabled={busy} onClick={()=>void deleteBirthday()}>{busy?<LoaderCircle className="spin" size={17}/>:<Trash2 size={17}/>}Remove birthday</button></div></Modal>}
    {modal==='help'&&<Modal title="A little help, a lot of heart." subtitle="Your foundation’s birthday book, made simple." onClose={stableClose}><div className="help-list"><div><span>01</span><p><strong>Add your people.</strong> Sign in as admin, then add a name, title, and birthday in MM/DD format. The first admin sets a password on this local app.</p></div><div><span>02</span><p><strong>Find their special day.</strong> Browse the calendar or search the directory by name, role, and month.</p></div><div><span>03</span><p><strong>Send a little joy.</strong> Connect WhatsApp Business for automatic admin reminders and opted-in celebrant greetings. You can also import the birthday calendar into your calendar app.</p></div></div><p className="field-note">Dates and automatic reminders use {whatsapp?.timeZone || 'Africa/Lagos'} time. Your records are stored on this server; back up its .data folder and keep it on persistent storage.</p><button className="button primary full" onClick={stableClose}>Got it <Heart size={16}/></button></Modal>}
    {toast&&<div className="toast" role="status"><CheckCircle2 size={19}/><span>{toast}</span><button className="icon-button" aria-label="Dismiss notification" onClick={()=>setToast('')}><X size={15}/></button></div>}
  </div>;
}
