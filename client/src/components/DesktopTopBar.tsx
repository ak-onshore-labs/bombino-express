import { useLocation } from 'wouter';

type PageMeta = { title: string; subtitle: string };

function getPageMeta(path: string): PageMeta | null {
  const map: Record<string, PageMeta> = {
    '/home': { title: 'Dashboard', subtitle: 'Welcome back' },
    '/rates': { title: 'Get Rates', subtitle: 'Calculate shipping costs' },
    '/create': { title: 'Create Shipment', subtitle: 'India → International' },
    '/orders': { title: 'My Orders', subtitle: 'Track and manage shipments' },
    '/track': { title: 'Track Shipment', subtitle: 'Real-time shipment status' },
    '/profile': { title: 'My Profile', subtitle: 'Account settings' },
    '/notifications': { title: 'Notifications', subtitle: '' },
    '/rewards': { title: 'Rewards', subtitle: 'Your points and special rewards' },
  };
  if (path === '/help') return null;
  return map[path] ?? null;
}

export function DesktopTopBar() {
  const [location] = useLocation();
  const meta = getPageMeta(location);

  if (meta === null) {
    return null;
  }

  return (
    <div className="hidden md:flex items-center justify-between h-14 bg-white/98 backdrop-blur-sm border-b border-[#E2E8F0] px-8 sticky top-0 z-10 shrink-0 shadow-[0_1px_8px_oklch(17%_0.048_248_/_0.07)]">
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="text-sm font-semibold text-[lab(34.0831_-9.57756_-27.7093)] truncate tracking-tight">
          {meta.title}
        </span>
        {meta.subtitle ? (
          <>
            <span className="text-[#E2E8F0] font-light select-none">/</span>
            <span className="text-xs text-[#64748B] truncate">{meta.subtitle}</span>
          </>
        ) : null}
      </div>
      {location === '/rates' ? (
        <span className="text-xs text-[#64748B] shrink-0 font-medium">Prices include GST</span>
      ) : null}
    </div>
  );
}

