'use client';

import React from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Shield, Lock, FileCheck, Globe } from 'lucide-react';
import { type Locale, locales, localeConfig, getLocalizedPath } from '@/lib/i18n/config';
import { saveLanguagePreference } from './LanguageSelector';

export interface FooterProps {
  locale: Locale;
}

export const Footer: React.FC<FooterProps> = ({ locale }) => {
  const t = useTranslations('common');
  const router = useRouter();
  const pathname = usePathname();

  const handleLanguageChange = (newLocale: Locale) => {
    saveLanguagePreference(newLocale);
    const newPath = getLocalizedPath(pathname, newLocale);
    router.push(newPath);
  };

  return (
    <footer
      className="w-full border-t border-[var(--color-border)] bg-[var(--color-background)] pt-16 pb-8"
      role="contentinfo"
    >
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-12 mb-12">
          {/* Brand Column */}
          <div className="flex flex-col gap-6">
            <Link
              href={`/${locale}`}
              className="group flex items-center gap-2.5 text-xl font-bold text-[var(--color-foreground)]"
              aria-label={`${t('brand')} - ${t('navigation.home')}`}
            >
              <div className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--color-primary)] text-white shadow-md transition-transform group-hover:scale-105">
                <svg
                  className="h-5 w-5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
              </div>
              <span data-testid="footer-brand-name">{t('brand')}</span>
            </Link>
            <p className="text-sm text-[var(--color-muted-foreground)] leading-relaxed max-w-xs">
              {t('tagline') || 'Professional, secure, and free PDF tools for everyone. No installation required.'}
            </p>
            <Link
              href={`/${locale}/faq`}
              className="text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-primary)] transition-colors flex items-center gap-2 group w-fit"
            >
              <span className="w-1 h-1 rounded-full bg-[var(--color-muted-foreground)] group-hover:bg-[var(--color-primary)] transition-colors" />
              {t('navigation.faq')}
            </Link>
          </div>

          {/* Security Features */}
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-[var(--color-foreground)] mb-6">
              {t('footer.security')}
            </h3>
            <ul className="flex flex-col gap-4">
              <li className="flex items-start gap-3">
                <div className="mt-0.5 p-1 rounded bg-[color-mix(in_srgb,var(--color-success)_10%,transparent)] text-[var(--color-success)]">
                  <Lock className="h-3 w-3" />
                </div>
                <div>
                  <span className="block text-sm font-medium text-[var(--color-foreground)]">{t('footer.clientSideProcessing')}</span>
                  <span className="text-xs text-[var(--color-muted-foreground)]">{t('footer.filesNeverLeave')}</span>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <div className="mt-0.5 p-1 rounded bg-[color-mix(in_srgb,var(--color-primary)_10%,transparent)] text-[var(--color-primary)]">
                  <FileCheck className="h-3 w-3" />
                </div>
                <div>
                  <span className="block text-sm font-medium text-[var(--color-foreground)]">{t('footer.noFileUploads')}</span>
                  <span className="text-xs text-[var(--color-muted-foreground)]">{t('footer.privateSecure')}</span>
                </div>
              </li>
            </ul>
          </div>

          {/* Privacy Badge Block */}
          <div className="flex flex-col justify-start">
            <h3 className="text-sm font-bold uppercase tracking-wider text-[var(--color-foreground)] mb-6">
              {t('footer.compliance')}
            </h3>
            <div
              className="flex items-center gap-3 p-4 bg-[var(--color-card)] border border-[var(--color-border)] rounded-xl shadow-sm"
            >
              <div className="h-10 w-10 rounded-full bg-[color-mix(in_srgb,var(--color-success)_10%,transparent)] flex items-center justify-center flex-shrink-0">
                <Shield className="h-5 w-5 text-[var(--color-success)]" aria-hidden="true" />
              </div>
              <div>
                <div className="text-sm font-bold text-[var(--color-foreground)]">{t('footer.gdprCompliant')}</div>
                <div className="text-xs text-[var(--color-muted-foreground)]">{t('footer.privacyBadge')}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Language Switcher */}
        <div className="py-6 border-t border-[var(--color-border)]">
          <div className="flex items-center gap-3 mb-4">
            <Globe className="h-4 w-4 text-[var(--color-muted-foreground)]" />
            <span className="text-sm font-medium text-[var(--color-foreground)]">
              {t('buttons.selectLanguage')}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {locales.map((loc) => {
              const config = localeConfig[loc];
              const isActive = loc === locale;
              return (
                <button
                  key={loc}
                  onClick={() => handleLanguageChange(loc)}
                  className={`
                    px-3 py-1.5 text-sm rounded-full transition-all
                    ${isActive
                      ? 'bg-[var(--color-primary)] text-white font-medium'
                      : 'bg-[var(--color-muted)] text-[var(--color-muted-foreground)] hover:bg-[color-mix(in_srgb,var(--color-primary)_10%,transparent)] hover:text-[var(--color-primary)]'
                    }
                  `}
                  aria-current={isActive ? 'true' : undefined}
                >
                  {config.nativeName}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;

