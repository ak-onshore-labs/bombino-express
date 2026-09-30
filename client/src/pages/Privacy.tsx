import { useLocation } from 'wouter';
import { ArrowLeft } from 'lucide-react';

export default function Privacy() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-[100dvh] bg-background safe-top safe-bottom">
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur-sm border-b border-border px-4 py-3 flex items-center gap-3">
        <button
          onClick={() => setLocation('/login')}
          className="p-1 rounded-lg hover:bg-gray-100 transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="font-semibold text-lg">Privacy Policy</h1>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-6 text-sm text-gray-700 leading-relaxed">
        <p className="text-xs text-gray-400">Last updated: April 2026</p>

        <section>
          <h2 className="font-semibold text-base text-gray-900 mb-2">1. Introduction</h2>
          <p>
            Bombino Express ("we", "our", or "us") is committed to protecting your privacy. This Privacy
            Policy explains how we collect, use, and safeguard your information when you use the Bombino
            Express mobile application and related services.
          </p>
        </section>

        <section>
          <h2 className="font-semibold text-base text-gray-900 mb-2">2. Information We Collect</h2>
          <p className="mb-2">We collect the following information:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Full name, email address, and phone number</li>
            <li>Aadhaar number and identity documents (for KYC compliance)</li>
            <li>Sender and recipient addresses for shipments</li>
            <li>Shipment details and tracking information</li>
            <li>Device information and usage data</li>
            <li>Communications with our AI support assistant (BIA)</li>
          </ul>
        </section>

        <section>
          <h2 className="font-semibold text-base text-gray-900 mb-2">3. How We Use Your Information</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>To process and track your shipments</li>
            <li>To verify your identity as required by customs regulations</li>
            <li>To provide customer support through our AI assistant</li>
            <li>To send shipment status notifications</li>
            <li>To improve our services and user experience</li>
            <li>To comply with legal and regulatory requirements</li>
          </ul>
        </section>

        <section>
          <h2 className="font-semibold text-base text-gray-900 mb-2">4. Data Sharing</h2>
          <p className="mb-2">We share your data only as necessary to provide our services:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <strong>ITD Courier Services</strong> — shipment and recipient details for delivery processing
            </li>
            <li>
              <strong>OpenAI</strong> — anonymised chat messages to power our AI support assistant (BIA)
            </li>
            <li>
              <strong>Supabase</strong> — secure cloud database storage for your account data
            </li>
          </ul>
          <p className="mt-2">We do not sell your personal information to third parties.</p>
        </section>

        <section>
          <h2 className="font-semibold text-base text-gray-900 mb-2">5. Data Security</h2>
          <p>
            We implement industry-standard security measures including AES-256 encryption for sensitive
            credentials, secure HTTPS connections, and access controls to protect your personal information.
          </p>
        </section>

        <section>
          <h2 className="font-semibold text-base text-gray-900 mb-2">6. Data Retention</h2>
          <p>
            We retain your personal data for as long as your account is active or as needed to provide
            services. You may request deletion of your account and associated data by contacting us.
          </p>
        </section>

        <section>
          <h2 className="font-semibold text-base text-gray-900 mb-2">7. Your Rights</h2>
          <p className="mb-2">You have the right to:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Access your personal data</li>
            <li>Correct inaccurate information</li>
            <li>Request deletion of your data</li>
            <li>Withdraw consent at any time</li>
            <li>Lodge a complaint with a data protection authority</li>
          </ul>
        </section>

        <section>
          <h2 className="font-semibold text-base text-gray-900 mb-2">8. Children's Privacy</h2>
          <p>
            Our services are not directed to children under 13. We do not knowingly collect personal
            information from children under 13.
          </p>
        </section>

        <section>
          <h2 className="font-semibold text-base text-gray-900 mb-2">9. Contact Us</h2>
          <p>For privacy-related questions or requests, please contact us at:</p>
          <p className="mt-2 font-medium text-gray-900">
            Bombino Express
            <br />
            Email: bombino@bombinoexp.com
            <br />
            Website: www.bombinoexp.com
          </p>
        </section>

        <section>
          <h2 className="font-semibold text-base text-gray-900 mb-2">10. Changes to This Policy</h2>
          <p>
            We may update this Privacy Policy periodically. We will notify you of significant changes through
            the app or by email.
          </p>
        </section>

        <p className="text-xs text-gray-400 pt-4 border-t border-gray-100">
          © 2026 Bombino Express. All rights reserved.
        </p>
      </div>
    </div>
  );
}
