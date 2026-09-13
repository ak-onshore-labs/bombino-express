import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import {
  Search,
  ArrowRight,
  ChevronRight,
  BadgeDollarSign,
  Send,
  Phone,
  Bell,
  ShieldCheck,
  AlertTriangle,
  PackageOpen,
} from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { useKycOnFile } from '@/hooks/useKycOnFile';
import { StatusBadge } from '@/components/StatusBadge';
import whatsAppLogo from '@/assets/WhatsApp.svg.png';
import { type DisplayRow } from '@/lib/shipmentRows';
import { useNotifications, useOrderHistory } from '@/hooks/useCustomerOrders';
import { useSupportContacts } from '@/hooks/useSupportContacts';

/** The subset of a notification this page renders. */
interface HomeNotificationRow {
  id: string;
  title: string | null;
  body: string | null;
  type: string | null;
  created_at: string;
}

// ─── Popular routes (static seed; ready to swap for an /api/popular-routes endpoint) ───
const POPULAR_ROUTES = [
  { from: '🇮🇳', to: '🇺🇸', label: 'Mumbai → New York',  price: '₹1,240', eta: '3–5 days', service: 'Express' },
  { from: '🇮🇳', to: '🇬🇧', label: 'Mumbai → London',    price: '₹980',   eta: '2–4 days', service: 'Express' },
  { from: '🇮🇳', to: '🇦🇪', label: 'Mumbai → Dubai',     price: '₹540',   eta: '1–3 days', service: 'Express' },
  { from: '🇮🇳', to: '🇨🇦', label: 'Mumbai → Toronto',   price: '₹1,420', eta: '4–6 days', service: 'Express' },
];

// ─── Greeting (logged in / out) ───
function Greeting({ firstName }: { firstName?: string | null }) {
  return (
    <div className="flex items-end justify-between gap-6 mb-4">
      <div>
        <h1 className="text-[26px] font-bold tracking-[-0.02em] leading-tight text-foreground">
          {firstName ? <>Welcome back, <span>{firstName}</span></> : 'Welcome'}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Track an order, get a quote, or create a new shipment.
        </p>
      </div>
      <Link
        href="/create"
        className="h-9 px-3 inline-flex items-center gap-2 text-xs font-semibold rounded-lg bg-[lab(34.0831_-9.57756_-27.7093)] text-white hover:bg-[#2F4468] transition-colors"
      >
        <ArrowRight className="w-3.5 h-3.5" />
        New shipment
      </Link>
    </div>
  );
}

// ─── Track bar (single-row composite) ───
function TrackBar({
  value,
  onChange,
  onTrack,
  recent,
}: {
  value: string;
  onChange: (v: string) => void;
  onTrack: (awb?: string) => void;
  recent: string[];
}) {
  return (
    <div className="rounded-2xl bg-white border border-[#E2E8F0] shadow-[0_1px_2px_lab(34.0831_-9.57756_-27.7093_/_0.04),0_2px_12px_lab(34.0831_-9.57756_-27.7093_/_0.05)] p-1.5 flex items-center gap-2">
      <div className="flex items-center gap-2 px-3 text-[11px] font-semibold tracking-[0.12em] text-[#F2A123] uppercase border-r border-[#E2E8F0] pr-4 ml-2">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full rounded-full bg-[#F2A123] opacity-60 animate-ping" />
          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#F2A123]" />
        </span>
        Track
      </div>
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onTrack()}
          placeholder="Enter AWB number — e.g. BMB123456789"
          className="w-full h-11 pl-10 pr-3 text-sm bg-transparent border-0 outline-none placeholder:text-muted-foreground/70 font-medium tabular-nums tracking-tight"
          data-testid="input-tracking"
        />
      </div>
      {recent.length > 0 && (
        <div className="hidden lg:flex items-center gap-1.5 pr-2 border-r border-[#E2E8F0] pl-2">
          <span className="text-[11px] text-muted-foreground mr-1">Recent:</span>
          {recent.slice(0, 2).map((awb) => (
            <button
              key={awb}
              onClick={() => onTrack(awb)}
              className="px-2.5 h-7 rounded-md bg-[#F3F4F6] hover:bg-[#E2E8F0] text-[11px] font-semibold tabular-nums text-foreground/80 transition-colors"
              data-testid={`recent-awb-${awb}`}
            >
              {awb}
            </button>
          ))}
        </div>
      )}
      <button
        onClick={() => onTrack()}
        className="h-11 px-6 inline-flex items-center gap-2 text-sm font-semibold rounded-xl bg-[lab(34.0831_-9.57756_-27.7093)] text-white hover:bg-[#2F4468] transition-colors"
        data-testid="button-track"
      >
        Track
        <ArrowRight className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ─── Get Rates / Ship Now action cards ───
function ActionCards() {
  return (
    <section className="grid grid-cols-2 gap-5">
      {/* Get Rates */}
      <Link
        href="/rates"
        className="group relative rounded-2xl bg-white border border-[#E2E8F0] shadow-[0_1px_2px_lab(34.0831_-9.57756_-27.7093_/_0.04),0_2px_12px_lab(34.0831_-9.57756_-27.7093_/_0.05)] hover:shadow-[0_6px_24px_lab(34.0831_-9.57756_-27.7093_/_0.10),0_2px_6px_lab(34.0831_-9.57756_-27.7093_/_0.05)] transition-all overflow-hidden"
        data-testid="card-get-rates"
      >
        <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-[#FFF6E5] to-transparent pointer-events-none" />
        <div className="relative p-6">
          <div className="flex items-start justify-between mb-5">
            <div className="w-12 h-12 rounded-2xl bg-[#F2A123]/15 flex items-center justify-center">
              <BadgeDollarSign className="w-[22px] h-[22px] text-[#F2A123]" />
            </div>
            <span className="text-[10px] font-bold tracking-[0.14em] uppercase text-[#F2A123] bg-[#FFF6E5] px-2.5 py-1 rounded-full">
              Most used
            </span>
          </div>
          <h3 className="text-lg font-bold tracking-tight leading-tight text-foreground">Get Rates</h3>
          <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
            Compare express, economy &amp; freight pricing across 150+ countries.
          </p>

          <div className="mt-5 flex flex-wrap gap-1.5">
            {['IN → US', 'IN → UK', 'IN → AE', 'IN → CA'].map((r) => (
              <span
                key={r}
                className="text-[11px] font-semibold px-2.5 py-1.5 rounded-md bg-[#F3F4F6] text-foreground/70 group-hover:bg-[#FFF6E5] group-hover:text-foreground transition-colors"
              >
                {r}
              </span>
            ))}
            <span className="text-[11px] font-semibold px-2.5 py-1.5 rounded-md bg-[#F3F4F6] text-muted-foreground">
              + custom route
            </span>
          </div>

          <div className="mt-6 pt-5 border-t border-[#E2E8F0] flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div>
                <p className="text-[10px] font-semibold tracking-[0.12em] uppercase text-muted-foreground/80">
                  Cheapest 0.5 kg
                </p>
                <p className="text-sm font-bold tabular-nums mt-0.5">
                  ₹1,240 <span className="text-muted-foreground font-medium">→ US</span>
                </p>
              </div>
              <div className="h-8 w-px bg-[#E2E8F0]" />
              <div>
                <p className="text-[10px] font-semibold tracking-[0.12em] uppercase text-muted-foreground/80">ETA</p>
                <p className="text-sm font-bold tabular-nums mt-0.5">3–5 days</p>
              </div>
            </div>
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-foreground group-hover:text-[#F2A123] transition-colors">
              Calculate
              <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
            </span>
          </div>
        </div>
      </Link>

      {/* Ship Now */}
      <Link
        href="/create"
        className="group relative rounded-2xl bg-gradient-to-br from-[lab(34.0831_-9.57756_-27.7093)] to-[#0c1a25] text-white shadow-[0_1px_2px_lab(34.0831_-9.57756_-27.7093_/_0.04),0_2px_12px_lab(34.0831_-9.57756_-27.7093_/_0.05)] hover:shadow-[0_6px_24px_lab(34.0831_-9.57756_-27.7093_/_0.18)] transition-all overflow-hidden"
        data-testid="card-ship-now"
      >
        <div
          className="absolute inset-0 opacity-[0.15] pointer-events-none"
          style={{
            backgroundImage: 'radial-gradient(rgba(255,255,255,0.18) 1px, transparent 1px)',
            backgroundSize: '14px 14px',
          }}
        />
        <div className="relative p-6">
          <div className="flex items-start justify-between mb-5">
            <div className="w-12 h-12 rounded-2xl bg-[#F2A123] flex items-center justify-center">
              <Send className="w-[22px] h-[22px] text-[lab(34.0831_-9.57756_-27.7093)]" />
            </div>
            <span className="text-[10px] font-bold tracking-[0.14em] uppercase text-white/70 bg-gradient-to-r from-white/[0.12] to-white/[0.06] border border-white/15 px-2.5 py-1 rounded-full">
              3-step flow
            </span>
          </div>
          <h3 className="text-lg font-bold tracking-tight leading-tight">Ship Now</h3>
          <p className="text-sm text-white/55 mt-1 leading-relaxed">
            Pickup at your door. Door-to-door tracking. Customs handled for you.
          </p>

          <div className="mt-5 flex items-center gap-2">
            {[
              { n: 1, label: 'Address', on: true },
              { n: 2, label: 'Package', on: false },
              { n: 3, label: 'Pay', on: false },
            ].map((s, i) => (
              <div key={s.n} className="flex items-center gap-2 flex-1 last:flex-initial">
                <div
                  className={
                    s.on
                      ? 'w-5 h-5 rounded-full bg-[#F2A123] text-[lab(34.0831_-9.57756_-27.7093)] text-[10px] font-bold flex items-center justify-center'
                      : 'w-5 h-5 rounded-full bg-white/12 text-white/60 text-[10px] font-bold flex items-center justify-center'
                  }
                >
                  {s.n}
                </div>
                <span className={s.on ? 'text-xs font-medium text-white/80' : 'text-xs font-medium text-white/55'}>
                  {s.label}
                </span>
                {i < 2 && <div className="flex-1 h-px bg-white/15" />}
              </div>
            ))}
          </div>

          <div className="mt-6 pt-5 border-t border-white/10 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div>
                <p className="text-[10px] font-semibold tracking-[0.12em] uppercase text-white/45">Avg pickup</p>
                <p className="text-sm font-bold tabular-nums mt-0.5">&lt; 2 hrs</p>
              </div>
              <div className="h-8 w-px bg-white/10" />
              <div>
                <p className="text-[10px] font-semibold tracking-[0.12em] uppercase text-white/45">Coverage</p>
                <p className="text-sm font-bold mt-0.5">150+ countries</p>
              </div>
            </div>
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#F2A123]">
              Create shipment
              <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
            </span>
          </div>
        </div>
      </Link>
    </section>
  );
}

// ─── Popular routes ───
function PopularRoutes() {
  return (
    <section className="rounded-2xl bg-white border border-[#E2E8F0] shadow-[0_1px_2px_lab(34.0831_-9.57756_-27.7093_/_0.04),0_2px_12px_lab(34.0831_-9.57756_-27.7093_/_0.05)] overflow-hidden">
      <div className="px-6 py-4 flex items-center justify-between border-b border-[#E2E8F0]">
        <div>
          <h3 className="text-sm font-bold tracking-tight text-foreground">Popular routes this week</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Most-quoted destinations from India.</p>
        </div>
        <Link
          href="/rates"
          className="text-xs font-semibold text-[#F2A123] inline-flex items-center gap-1 hover:underline"
        >
          View all rates <ChevronRight className="w-3 h-3" />
        </Link>
      </div>
      <div className="grid grid-cols-4 divide-x divide-[#E2E8F0]">
        {POPULAR_ROUTES.map((r) => (
          <Link
            key={r.label}
            href="/rates"
            className="group p-5 hover:bg-[#F8F9FA] transition-colors"
            data-testid={`popular-route-${r.label}`}
          >
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[22px] leading-none">{r.from}</span>
              <svg width="22" height="10" viewBox="0 0 22 10" className="text-[#F2A123]">
                <line x1="2" y1="5" x2="18" y2="5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 6" />
                <path d="M16 1l4 4-4 4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="text-[22px] leading-none">{r.to}</span>
            </div>
            <p className="text-[13px] font-semibold tracking-tight text-foreground">{r.label}</p>
            <div className="flex items-baseline gap-2 mt-2">
              <span className="text-base font-bold tabular-nums">{r.price}</span>
              <span className="text-[11px] text-muted-foreground">from 0.5 kg</span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">{r.service} · {r.eta}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}

// ─── Why Bombino (dark stats band) ───
function StatsBand() {
  return (
    <section className="rounded-2xl bg-gradient-to-br from-[lab(34.0831_-9.57756_-27.7093)] to-[#0c1a25] text-white overflow-hidden relative">
      <div
        className="absolute inset-0 opacity-[0.12] pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(rgba(255,255,255,0.18) 1px, transparent 1px)',
          backgroundSize: '18px 18px',
        }}
      />
      <div
        className="absolute -bottom-20 -left-20 w-72 h-72 rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(242,161,35,0.18) 0%, transparent 65%)' }}
      />
      <div className="relative px-7 py-7 flex items-center gap-8">
        <div className="flex-shrink-0 max-w-[200px]">
          <p className="text-[10px] font-bold tracking-[0.18em] uppercase text-[#F2A123]/90">Bombino at a glance</p>
          <h3 className="text-xl font-bold tracking-tight mt-2 leading-tight">
            Operating worldwide since <span className="tabular-nums">1995</span>.
          </h3>
        </div>
        <div className="h-16 w-px bg-white/10" />
        <div className="flex-1 grid grid-cols-3 gap-6">
          <div>
            <p className="text-[28px] font-extrabold leading-none tracking-tight tabular-nums">30+</p>
            <p className="text-sm font-semibold text-white/85 mt-1">Years</p>
            <p className="text-xs text-white/45 mt-1">of global logistics excellence</p>
          </div>
          <div>
            <p className="text-[28px] font-extrabold leading-none tracking-tight tabular-nums">140+</p>
            <p className="text-sm font-semibold text-white/85 mt-1">Kilograms / hour</p>
            <p className="text-xs text-white/45 mt-1">shipped around the world</p>
          </div>
          <div>
            <p className="text-[28px] font-extrabold leading-none tracking-tight tabular-nums">250K+</p>
            <p className="text-sm font-semibold text-white/85 mt-1">Happy clients</p>
            <p className="text-xs text-white/45 mt-1">sending &amp; receiving worldwide</p>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Support widget (right rail) ───
function SupportWidget() {
  const { waHref, telHref, officeLabel, whatsappLabel } = useSupportContacts();
  return (
    <section className="rounded-2xl bg-white border border-[#E2E8F0] shadow-[0_1px_2px_lab(34.0831_-9.57756_-27.7093_/_0.04),0_2px_12px_lab(34.0831_-9.57756_-27.7093_/_0.05)] overflow-hidden">
      <div className="px-5 pt-5 pb-3 flex items-center justify-between">
        <h3 className="text-sm font-bold tracking-tight text-foreground">Need to talk to us?</h3>
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          Online now
        </span>
      </div>
      <div className="px-5 pb-5 space-y-2">
        <a
          href={waHref}
          target="_blank"
          rel="noopener noreferrer"
          className="group flex items-center gap-3 p-3 rounded-xl border border-[#E2E8F0] hover:border-emerald-200 hover:bg-emerald-50/50 transition-colors"
          data-testid="button-whatsapp-desktop"
        >
          <div className="w-9 h-9 rounded-xl bg-emerald-50 flex items-center justify-center flex-shrink-0">
            <img src={whatsAppLogo} alt="WhatsApp" className="w-5 h-5 object-contain" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold leading-tight text-foreground">WhatsApp</p>
            <p className="text-[11px] text-muted-foreground mt-0.5 tabular-nums">{whatsappLabel}</p>
          </div>
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground group-hover:text-emerald-600 transition-colors" />
        </a>
        <a
          href={telHref}
          className="group flex items-center gap-3 p-3 rounded-xl border border-[#E2E8F0] hover:border-[lab(34.0831_-9.57756_-27.7093)]/30 hover:bg-[#F8F9FA] transition-colors"
          data-testid="button-call-desktop"
        >
          <div className="w-9 h-9 rounded-xl bg-[#F3F4F6] flex items-center justify-center flex-shrink-0">
            <Phone className="w-4 h-4 text-[lab(34.0831_-9.57756_-27.7093)]" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold leading-tight text-foreground">Call us</p>
            <p className="text-[11px] text-muted-foreground mt-0.5 tabular-nums">{officeLabel}</p>
          </div>
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
        </a>
        <div className="pt-3 mt-2 border-t border-[#E2E8F0] flex items-center justify-between text-[11px]">
          <span className="text-muted-foreground">Mon–Sat, 9:00 AM – 7:00 PM IST</span>
          <Link href="/help" className="text-[#F2A123] font-semibold hover:underline">
            Help &amp; FAQ →
          </Link>
        </div>
      </div>
    </section>
  );
}

function KycHomeTip() {
  const { data: kycOnFile } = useKycOnFile();

  if (kycOnFile) {
    return (
      <section className="rounded-2xl bg-white border border-green-200 bg-green-50/30 shadow-sm p-4">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-green-100 text-green-700 flex items-center justify-center flex-shrink-0">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-foreground">KYC complete</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {kycOnFile.document_type} ••{kycOnFile.last_four}
            </p>
            <Link
              href="/profile#kyc"
              className="text-[11px] font-semibold text-[#F2A123] hover:underline mt-1 inline-block"
              data-testid="tip-kyc-manage"
            >
              Manage document →
            </Link>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-2xl bg-white border border-[#E2E8F0] shadow-sm p-4">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-[#FFF6E5] text-[#F2A123] flex items-center justify-center flex-shrink-0">
          <ShieldCheck className="w-4 h-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-foreground">Complete your KYC</p>
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
            Upload your identity document once — reused on every shipment.
          </p>
          <Link
            href="/profile#kyc"
            className="text-[11px] font-semibold text-[#F2A123] hover:underline mt-1 inline-block"
            data-testid="tip-kyc-upload"
          >
            Upload in profile →
          </Link>
        </div>
      </div>
    </section>
  );
}

// ─── Tips widget (right rail, guest / pre-KYC users) ───
function TipsWidget() {
  return (
    <section className="rounded-2xl bg-white border border-[#E2E8F0] shadow-[0_1px_2px_lab(34.0831_-9.57756_-27.7093_/_0.04),0_2px_12px_lab(34.0831_-9.57756_-27.7093_/_0.05)] overflow-hidden">
      <div className="px-5 pt-5 pb-3 flex items-center justify-between">
        <h3 className="text-sm font-bold tracking-tight text-foreground">Before you ship</h3>
        <span className="text-[10px] font-bold tracking-[0.14em] uppercase text-muted-foreground">3 steps</span>
      </div>
      <ul className="px-5 pb-5 space-y-3">
        <li className="flex items-start gap-3">
          <div className="w-7 h-7 rounded-lg bg-[#FFF6E5] text-[#F2A123] flex items-center justify-center flex-shrink-0">
            <ShieldCheck className="w-3.5 h-3.5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold leading-snug text-foreground">Complete your KYC</p>
            <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
              Sign in and upload your identity document once for all shipments.
            </p>
            <Link
              href="/login?redirect=/profile%23kyc"
              className="text-[11px] font-semibold text-[#F2A123] hover:underline mt-1 inline-block"
              data-testid="tip-kyc"
            >
              Sign in to upload →
            </Link>
          </div>
        </li>
        <li className="flex items-start gap-3 pt-3 border-t border-[#E2E8F0]">
          <div className="w-7 h-7 rounded-lg bg-[#F3F4F6] text-foreground/70 flex items-center justify-center flex-shrink-0">
            <AlertTriangle className="w-3.5 h-3.5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold leading-snug text-foreground">Check prohibited items</p>
            <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
              Lithium batteries, perfumes &amp; certain foods vary by country.
            </p>
            <Link
              href="/help"
              className="text-[11px] font-semibold text-[#F2A123] hover:underline mt-1 inline-block"
              data-testid="tip-prohibited"
            >
              See the list →
            </Link>
          </div>
        </li>
        <li className="flex items-start gap-3 pt-3 border-t border-[#E2E8F0]">
          <div className="w-7 h-7 rounded-lg bg-[#F3F4F6] text-foreground/70 flex items-center justify-center flex-shrink-0">
            <PackageOpen className="w-3.5 h-3.5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold leading-snug text-foreground">Pack like a pro</p>
            <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
              Double-box fragile items, seal all edges with H-tape.
            </p>
            <Link
              href="/help"
              className="text-[11px] font-semibold text-[#F2A123] hover:underline mt-1 inline-block"
              data-testid="tip-packing"
            >
              Packing guide →
            </Link>
          </div>
        </li>
      </ul>
    </section>
  );
}

// ─── Recent updates (right rail, logged-in users) ───
function RecentUpdates({
  notifications,
  loading,
}: {
  notifications: HomeNotificationRow[];
  loading: boolean;
}) {
  return (
    <section className="rounded-2xl bg-white border border-[#E2E8F0] shadow-[0_1px_2px_lab(34.0831_-9.57756_-27.7093_/_0.04),0_2px_12px_lab(34.0831_-9.57756_-27.7093_/_0.05)] overflow-hidden">
      <div className="px-5 pt-5 pb-3 flex items-center justify-between">
        <h3 className="text-sm font-bold tracking-tight text-foreground">Recent updates</h3>
        <Link
          href="/notifications"
          className="text-xs font-semibold text-[#F2A123] inline-flex items-center gap-1 hover:underline"
        >
          View all <ChevronRight className="w-3 h-3" />
        </Link>
      </div>
      <ul className="px-5 pb-5 space-y-3">
        {loading && (
          <>
            <li className="flex items-start gap-3 animate-pulse">
              <div className="w-7 h-7 rounded-lg bg-[#F3F4F6] flex-shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-2/3 bg-[#F3F4F6] rounded" />
                <div className="h-2.5 w-1/2 bg-[#F3F4F6] rounded" />
              </div>
            </li>
            <li className="flex items-start gap-3 animate-pulse">
              <div className="w-7 h-7 rounded-lg bg-[#F3F4F6] flex-shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-2/3 bg-[#F3F4F6] rounded" />
                <div className="h-2.5 w-1/2 bg-[#F3F4F6] rounded" />
              </div>
            </li>
          </>
        )}
        {!loading && notifications.length === 0 && (
          <li className="text-xs text-muted-foreground py-4 text-center">No recent updates.</li>
        )}
        {!loading &&
          notifications.slice(0, 4).map((n) => (
            <li key={n.id} className="flex items-start gap-3 text-xs" data-testid={`notification-${n.id}`}>
              <div className="w-7 h-7 rounded-lg bg-[#FFF6E5] text-[#F2A123] flex items-center justify-center flex-shrink-0">
                <Bell className="w-3.5 h-3.5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold leading-tight text-foreground line-clamp-1">
                  {n.title ?? '—'}
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{n.body ?? ''}</p>
              </div>
            </li>
          ))}
      </ul>
    </section>
  );
}

// ─── My Shipments table (logged-in main column) ───
function MyShipmentsTable({
  rows,
  loading,
}: {
  rows: DisplayRow[];
  loading: boolean;
}) {
  return (
    <section className="rounded-2xl bg-white border border-[#E2E8F0] shadow-[0_1px_2px_lab(34.0831_-9.57756_-27.7093_/_0.04),0_2px_12px_lab(34.0831_-9.57756_-27.7093_/_0.05)] overflow-hidden">
      <div className="px-6 py-4 flex items-center justify-between border-b border-[#E2E8F0]">
        <div>
          <h3 className="text-sm font-bold tracking-tight text-foreground">My shipments</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Your most recent orders.</p>
        </div>
        <Link
          href="/orders"
          className="text-xs font-semibold text-[#F2A123] inline-flex items-center gap-1 hover:underline"
        >
          View all <ChevronRight className="w-3 h-3" />
        </Link>
      </div>
      <div className="grid grid-cols-[2fr_1.5fr_auto_auto] gap-4 px-6 py-2.5 text-[10px] font-bold tracking-[0.12em] uppercase text-muted-foreground border-b border-[#E2E8F0] bg-[#F8F9FA]">
        <span>AWB / Order number</span>
        <span>Destination</span>
        <span className="text-right">Amount</span>
        <span>Status</span>
      </div>
      <div className="divide-y divide-[#E2E8F0]">
        {loading && (
          <>
            <div className="grid grid-cols-[2fr_1.5fr_auto_auto] gap-4 px-6 py-3.5 animate-pulse items-center">
              <div className="h-3.5 w-32 bg-[#F3F4F6] rounded" />
              <div className="h-3 w-24 bg-[#F3F4F6] rounded" />
              <div className="h-3 w-16 bg-[#F3F4F6] rounded justify-self-end" />
              <div className="h-5 w-16 bg-[#F3F4F6] rounded-full" />
            </div>
            <div className="grid grid-cols-[2fr_1.5fr_auto_auto] gap-4 px-6 py-3.5 animate-pulse items-center">
              <div className="h-3.5 w-32 bg-[#F3F4F6] rounded" />
              <div className="h-3 w-24 bg-[#F3F4F6] rounded" />
              <div className="h-3 w-16 bg-[#F3F4F6] rounded justify-self-end" />
              <div className="h-5 w-16 bg-[#F3F4F6] rounded-full" />
            </div>
          </>
        )}
        {!loading && rows.length === 0 && (
          <div className="px-6 py-10 text-center text-sm text-muted-foreground">
            No shipments yet. <Link href="/create" className="text-[#F2A123] font-semibold hover:underline">Create your first →</Link>
          </div>
        )}
        {!loading &&
          rows.slice(0, 4).map((row) => {
            const dest = [row.city, row.country].filter(Boolean).join(', ') || '—';
            const rowClassName =
              'grid grid-cols-[2fr_1.5fr_auto_auto] gap-4 px-6 py-3.5 items-center hover:bg-[#F8F9FA] transition-colors';
            const content = (
              <>
                <span className="text-sm font-semibold tabular-nums tracking-[0.02em] text-foreground">
                  {row.isOrder && (
                    <span className="mr-1.5 text-[9px] font-bold uppercase tracking-[0.08em] text-muted-foreground bg-muted px-1.5 py-0.5 rounded align-middle">
                      Order
                    </span>
                  )}
                  {row.displayId}
                </span>
                <span className="text-sm text-muted-foreground truncate">{dest}</span>
                <span className="text-sm font-medium tabular-nums text-right">{row.amountStr ?? '—'}</span>
                <StatusBadge status={row.statusLabel} tone={row.statusTone} className="shrink-0" />
              </>
            );
            return (
              <Link
                key={row.key}
                href={`${row.isOrder ? '/order' : '/shipment'}/${encodeURIComponent(row.displayId)}`}
                className={rowClassName}
                data-testid={`shipment-row-${row.displayId}`}
              >
                {content}
              </Link>
            );
          })}
      </div>
    </section>
  );
}

// ─── Desktop page ───
export default function HomeDesktop() {
  const [, setLocation] = useLocation();
  const { isLoggedIn, user } = useAppStore();

  const [trackingNumber, setTrackingNumber] = useState('');

  // Same two hooks the mobile home uses, so both share one cache and one
  // polling schedule rather than each running their own timers.
  const { data: historyData, isLoading: historyLoading } = useOrderHistory(isLoggedIn);
  const { data: notificationsData } = useNotifications(isLoggedIn);

  const shipmentRows: DisplayRow[] = historyData ?? [];
  const apiNotifications = notificationsData ?? [];
  const shipmentsLoading = isLoggedIn && historyLoading;

  const handleTrack = (awb?: string) => {
    const value = (awb ?? trackingNumber).trim();
    if (value) setLocation(`/shipment/${encodeURIComponent(value)}`);
  };

  const firstName = isLoggedIn ? (user?.fullName?.split(' ')[0] || user?.email) : undefined;
  const recentAwbs = shipmentRows.filter((r) => !r.isOrder).slice(0, 2).map((r) => r.displayId);

  return (
    <div className="space-y-6" data-testid="screen-home-desktop">
      <section>
        <Greeting firstName={firstName} />
        <TrackBar
          value={trackingNumber}
          onChange={setTrackingNumber}
          onTrack={handleTrack}
          recent={recentAwbs}
        />
      </section>

      <div className="grid grid-cols-12 gap-6 pb-10">
        {/* LEFT — main column */}
        <div className="col-span-12 lg:col-span-8 space-y-6">
          <ActionCards />

          {isLoggedIn && (
            <MyShipmentsTable rows={shipmentRows} loading={shipmentsLoading} />
          )}

          <PopularRoutes />

          <StatsBand />
        </div>

        {/* RIGHT — sidebar */}
        <aside className="col-span-12 lg:col-span-4 space-y-5">
          <SupportWidget />
          {isLoggedIn ? (
            <>
              <KycHomeTip />
              <RecentUpdates notifications={apiNotifications} loading={shipmentsLoading} />
            </>
          ) : (
            <TipsWidget />
          )}
        </aside>
      </div>
    </div>
  );
}

