/**
 * `/p/:token`: the page behind the QR on a guest's box label.
 *
 * Whoever scans the box lands here: our agent, a hub hand, the guest, or a
 * stranger who found it. Everyone sees where the parcel is and where it is
 * going, never who it belongs to. Any signed-in agent or ops user sees the
 * whole order; ops, and the agent it is assigned to, also get a button into
 * their own app. Nothing here gates anything: it only shows.
 *
 * Stands outside every surface (see `isParcelTagPath`): no customer nav, no
 * BIA, no redirect for any role. Built from the same pieces as the customer's
 * order screen so the two read as one product.
 */

import { useState } from 'react';
import { Link, useRoute } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, ArrowRight } from 'lucide-react';
import { format, isValid, parseISO } from 'date-fns';
import {
  Group,
  IdCell,
  NAVY,
  ProgressBar,
  Row,
  progressFor,
} from '@/components/order/OrderParts';
import type { ParcelTagView } from '@shared/parcelTag';

function niceDate(value: string): string {
  const d = parseISO(value);
  return isValid(d) ? format(d, 'dd MMM yyyy') : '';
}

function niceDateTime(value: string): string {
  const d = parseISO(value);
  return isValid(d) ? format(d, 'dd MMM yyyy, h:mm a') : value;
}

class TagError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

function Shell({ children }: { children: React.ReactNode }) {
  // Reached from a scan inside the agent or ops app, or straight from a phone
  // camera. Only the first has somewhere to go back to.
  const canGoBack = typeof window !== 'undefined' && window.history.length > 1;
  return (
    <div className="min-h-[100dvh] bg-background" data-testid="screen-parcel-tag">
      <header className="border-b border-[#E2E8F0] bg-white safe-top">
        <div className="max-w-2xl mx-auto px-4 md:px-6 h-14 flex items-center justify-between">
          {canGoBack ? (
            <button
              type="button"
              onClick={() => window.history.back()}
              className="-ml-2 inline-flex items-center gap-1.5 h-11 px-2 rounded-lg text-sm font-medium text-foreground hover:bg-muted transition-colors"
              data-testid="button-back"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </button>
          ) : (
            <span className="text-sm font-bold tracking-[0.08em] uppercase" style={{ color: NAVY }}>
              Bombino Express
            </span>
          )}
          <span className="text-xs text-muted-foreground">Parcel details</span>
        </div>
      </header>
      <main className="max-w-2xl mx-auto px-4 md:px-6 pt-6 pb-16">{children}</main>
    </div>
  );
}

export default function ParcelTag() {
  const [, params] = useRoute('/p/:token');
  const token = params?.token ?? '';
  const [copied, setCopied] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery<ParcelTagView>({
    queryKey: ['/api/p', token],
    queryFn: async () => {
      const res = await fetch(`/api/p/${encodeURIComponent(token)}`, { credentials: 'include' });
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) {
        throw new TagError(body.message ?? 'This label could not be read.', res.status);
      }
      return body as ParcelTagView;
    },
    enabled: !!token,
    retry: false,
    staleTime: 0,
  });

  const copy = (value: string) => {
    void navigator.clipboard.writeText(value);
    setCopied(value);
    setTimeout(() => setCopied((c) => (c === value ? null : c)), 2000);
  };

  if (isLoading) {
    return (
      <Shell>
        <div className="animate-pulse" aria-busy="true">
          <div className="h-7 w-56 bg-muted rounded" />
          <div className="h-4 w-40 bg-muted rounded mt-3" />
          <div className="h-16 w-full bg-white border border-[#E2E8F0] rounded-lg mt-5" />
          <div className="h-1 w-full bg-muted rounded-full mt-6" />
        </div>
      </Shell>
    );
  }

  if (error || !data) {
    const tooMany = error instanceof TagError && error.status === 429;
    return (
      <Shell>
        <section className="py-12 text-center">
          <AlertTriangle className="w-6 h-6 text-red-600 mx-auto" aria-hidden />
          <h1 className="text-lg font-semibold mt-3">
            {tooMany ? 'Too many lookups' : 'This label is not recognised'}
          </h1>
          <p className="text-sm text-muted-foreground mt-2 max-w-xs mx-auto leading-relaxed">
            {tooMany
              ? 'Please wait a while and scan again.'
              : 'The code may be damaged or mistyped. If you are holding this parcel, contact Bombino Express with the order number printed on the label.'}
          </p>
        </section>
      </Shell>
    );
  }

  const isCancelled = data.status === 'cancelled';
  const progress = progressFor(data.status, data.isPickup, false);
  const staff = data.staff;
  const events = [...data.events].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  return (
    <Shell>
      <h1
        className="text-[26px] md:text-[30px] font-bold tracking-tight leading-tight"
        style={{ color: isCancelled ? undefined : NAVY }}
        data-testid="text-parcel-status"
      >
        {data.statusLabel}
      </h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        {data.destination && (
          <>
            To <span className="text-foreground/85">{data.destination}</span>
            <span className="mx-1.5">·</span>
          </>
        )}
        Booked {niceDate(data.bookedAt)}
      </p>

      <div className="mt-4 grid grid-cols-2 rounded-lg border border-[#E2E8F0] bg-white divide-x divide-[#E2E8F0] overflow-hidden">
        <IdCell
          label="Order number"
          value={data.orderNo}
          copied={copied === data.orderNo}
          onCopy={copy}
          valueTestId="text-order-no"
          testId="button-copy-order-no"
        />
        {data.awbNo ? (
          <IdCell
            label="Airway bill (AWB)"
            value={data.awbNo}
            mono
            copied={copied === data.awbNo}
            onCopy={copy}
            valueTestId="text-awb-no"
            testId="button-copy-awb"
          />
        ) : (
          <div className="px-4 py-3 min-w-0">
            <p className="text-[11px] font-semibold tracking-[0.09em] uppercase text-muted-foreground">
              Airway bill (AWB)
            </p>
            <p className="mt-1 text-sm text-muted-foreground">Issued at our hub</p>
          </div>
        )}
      </div>

      {/* Staff: straight into the right app for this order. */}
      {staff?.role === 'ops' && (
        <Link
          href={`/ops/orders/${staff.orderId}`}
          className="mt-3 flex items-center justify-center gap-1.5 h-11 rounded-lg text-sm font-semibold text-white transition-colors hover:bg-[#2F4468]"
          style={{ backgroundColor: NAVY }}
          data-testid="link-open-ops"
        >
          Open in ops console
          <ArrowRight className="w-4 h-4" aria-hidden />
        </Link>
      )}
      {staff?.role === 'agent' && staff.assignedToMe && (
        <Link
          href={`/agent/pickup/${staff.orderId}`}
          className="mt-3 flex items-center justify-center gap-1.5 h-14 rounded-lg text-base font-semibold text-white"
          style={{ backgroundColor: NAVY }}
          data-testid="link-open-pickup"
        >
          Open pickup
          <ArrowRight className="w-5 h-5" aria-hidden />
        </Link>
      )}

      <div className="mt-5">
        {isCancelled ? (
          <p className="text-sm text-red-800">This order was cancelled.</p>
        ) : (
          <ProgressBar steps={progress.steps} current={progress.current} />
        )}
      </div>

      <section className="mt-8 pt-6 border-t border-[#E2E8F0]">
        <h2 className="text-base font-semibold text-foreground mb-4">Parcel</h2>
        <div className="grid gap-x-10 gap-y-7 md:grid-cols-2">
          <Group title="Shipment">
            <Row label="Parcel ID" value={data.parcelId} />
            <Row label="Destination" value={data.destination} />
            <Row label="Pieces" value={data.pieces} />
            <Row
              label="Weight"
              value={data.bookedWeightKg != null ? `${data.bookedWeightKg} kg (booked)` : null}
            />
            <Row label="Handover" value={data.isPickup ? 'Agent pickup' : 'Drop-off at a counter'} />
            {staff && <Row label="Contents" value={staff.contents} />}
          </Group>

          {events.length > 0 && (
            <Group title="Updates">
              {events.map((ev, i) => (
                <Row key={`${ev.at}-${i}`} label={niceDateTime(ev.at)} value={ev.label} />
              ))}
            </Group>
          )}

          {staff && (
            <>
              <Group title="Sender">
                <Row label="Name" value={staff.sender.name} />
                <Row label="Company" value={staff.sender.company} />
                <Row label="Phone" value={staff.sender.phone} />
                <Row label="Address" value={staff.sender.address} />
              </Group>
              <Group title="Recipient">
                <Row label="Name" value={staff.recipient.name} />
                <Row label="Company" value={staff.recipient.company} />
                <Row label="Phone" value={staff.recipient.phone} />
                <Row label="Address" value={staff.recipient.address} />
              </Group>
            </>
          )}
        </div>
      </section>

      <p className="mt-10 text-[13px] text-muted-foreground leading-relaxed">
        {staff
          ? 'You are seeing contact details because you are signed in as Bombino staff.'
          : 'Found this parcel? Contact Bombino Express and quote the order number above.'}
      </p>
    </Shell>
  );
}
