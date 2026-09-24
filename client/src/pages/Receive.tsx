import { useState } from 'react';
import { ScanSearch, ArrowRight, PackageSearch, Package } from 'lucide-react';
import { useLocation, Link } from 'wouter';
import { Header } from '@/components/Header';
import { BottomNav } from '@/components/BottomNav';
import { SideMenu } from '@/components/SideMenu';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAppStore } from '@/lib/store';
import { useOrderHistory } from '@/hooks/useCustomerOrders';

export default function Receive() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [trackingNumber, setTrackingNumber] = useState('');
  const [error, setError] = useState('');
  const [, setLocation] = useLocation();
  const isLoggedIn = useAppStore((s) => s.isLoggedIn);

  // The same merged list Home and Orders read, so this screen shares their
  // cache instead of keeping a copy. "Incoming" is anything still moving.
  const { data: rows, isLoading } = useOrderHistory(isLoggedIn);
  const incomingShipments = (rows ?? []).filter((row) => row.isLive);

  const handleTrack = () => {
    const awb = trackingNumber.trim();
    if (!awb) {
      setError('Please enter a tracking number');
      return;
    }
    setLocation(`/shipment/${awb}`);
  };

  return (
    <div className="min-h-screen bg-background pb-20" data-testid="screen-receive">
      <Header onMenuClick={() => setMenuOpen(true)} />
      <SideMenu isOpen={menuOpen} onClose={() => setMenuOpen(false)} />

      <main className="px-4 py-5 max-w-md mx-auto md:max-w-5xl md:px-6 md:py-6">
        <div className="mb-5 md:mb-6">
          <h1 className="text-lg font-semibold text-foreground mb-1 md:text-2xl md:font-bold md:text-[lab(34.0831_-9.57756_-27.7093)]">Track & Receive</h1>
          <p className="text-sm text-muted-foreground">Track your incoming shipments</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 md:gap-8 md:items-start">
          {/* Left — Track by AWB */}
          <div className="bg-white rounded-2xl border border-[#E2E8F0] p-5 mb-5 md:mb-0 shadow-[0_2px_12px_oklch(17%_0.048_248_/_0.06),_0_1px_3px_oklch(17%_0.048_248_/_0.04)]">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-11 h-11 rounded-xl bg-[lab(34.0831_-9.57756_-27.7093)]/8 flex items-center justify-center">
                <ScanSearch className="w-5 h-5 text-[lab(34.0831_-9.57756_-27.7093)]" />
              </div>
              <div>
                <h2 className="font-semibold text-[lab(34.0831_-9.57756_-27.7093)]">Track by AWB</h2>
                <p className="text-xs text-muted-foreground">Enter your tracking number</p>
              </div>
            </div>
            <div className="flex gap-2 mb-2">
              <Input
                value={trackingNumber}
                onChange={(e) => {
                  setTrackingNumber(e.target.value);
                  setError('');
                }}
                placeholder="Enter AWB number"
                className="h-12 text-sm bg-[#F3F4F6] border-0 rounded-xl"
                onKeyDown={(e) => e.key === 'Enter' && handleTrack()}
                data-testid="input-track-awb"
              />
              <Button
                onClick={handleTrack}
                className="h-12 w-12 bg-[#F2A123] hover:bg-[#F2A123]/90 rounded-xl shadow-[0_4px_20px_oklch(17%_0.048_248_/_0.10)] shrink-0"
                data-testid="button-track-submit"
              >
                <ArrowRight className="w-5 h-5 text-[lab(34.0831_-9.57756_-27.7093)]" />
              </Button>
            </div>
            {error && (
              <div className="text-xs text-red-500 mb-2">{error}</div>
            )}
          </div>

          {/* Right — Incoming Shipments */}
          <div>
            {isLoggedIn ? (
              isLoading && incomingShipments.length === 0 ? (
                <div
                  className="h-40 rounded-2xl border border-[#E2E8F0] bg-white animate-pulse motion-reduce:animate-none"
                  aria-busy="true"
                  data-testid="receive-incoming-loading"
                />
              ) : incomingShipments.length > 0 ? (
                <div>
                  <h2 className="font-semibold text-[lab(34.0831_-9.57756_-27.7093)] text-sm mb-3 md:text-base">Incoming Shipments</h2>
                  <div className="space-y-2">
                    {incomingShipments.map((shipment) => (
                      <Link
                        key={shipment.key}
                        href={shipment.awb ? `/shipment/${shipment.awb}` : `/orders/${shipment.displayId}`}
                        className="block bg-white rounded-xl border border-[#E2E8F0] p-4 shadow-[0_2px_12px_oklch(17%_0.048_248_/_0.06),_0_1px_3px_oklch(17%_0.048_248_/_0.04)] hover:shadow-[0_4px_20px_oklch(17%_0.048_248_/_0.10)] transition-all"
                        data-testid={`incoming-shipment-${shipment.displayId}`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-semibold text-sm text-[lab(34.0831_-9.57756_-27.7093)]">{shipment.displayId}</span>
                          <StatusBadge status={shipment.statusLabel} tone={shipment.statusTone} />
                        </div>
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>{shipment.recipient} → {shipment.city}</span>
                          <span>{shipment.service}</span>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="bg-white rounded-2xl border border-[#E2E8F0] p-8 text-center shadow-[0_2px_12px_oklch(17%_0.048_248_/_0.06),_0_1px_3px_oklch(17%_0.048_248_/_0.04)]">
                  <div className="w-14 h-14 bg-[lab(34.0831_-9.57756_-27.7093)]/8 rounded-full flex items-center justify-center mx-auto mb-3">
                    <PackageSearch className="w-7 h-7 text-[lab(34.0831_-9.57756_-27.7093)]" />
                  </div>
                  <p className="font-semibold text-[lab(34.0831_-9.57756_-27.7093)] text-sm mb-1">No incoming shipments</p>
                  <p className="text-xs text-muted-foreground">
                    Track any shipment using the AWB number
                  </p>
                </div>
              )
            ) : (
              <div className="bg-white rounded-2xl border border-[#E2E8F0] p-8 text-center shadow-[0_2px_12px_oklch(17%_0.048_248_/_0.06),_0_1px_3px_oklch(17%_0.048_248_/_0.04)]">
                <div className="w-14 h-14 bg-[lab(34.0831_-9.57756_-27.7093)]/8 rounded-full flex items-center justify-center mx-auto mb-3">
                  <Package className="w-7 h-7 text-[lab(34.0831_-9.57756_-27.7093)]" />
                </div>
                <p className="font-semibold text-[lab(34.0831_-9.57756_-27.7093)] text-sm mb-1">Track any shipment</p>
                <p className="text-xs text-muted-foreground mb-4">
                  Enter an AWB number to track your package
                </p>
                <p className="text-xs text-muted-foreground">
                  <Link href="/login" className="text-[#F2A123] font-semibold hover:underline">
                    Sign in
                  </Link>
                  {' '}to view your incoming shipments
                </p>
              </div>
            )}
          </div>
        </div>
      </main>

      <BottomNav />
    </div>
  );
}
