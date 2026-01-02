'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Button, IconButton } from '@/components/ui';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { MobileNav } from './MobileNav';

interface HeaderProps {
  onNewRule?: () => void;
}

export function Header({ onNewRule }: HeaderProps) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navigation = [
    { name: 'Dashboard', href: '/dashboard' },
    { name: 'Settings', href: '/dashboard/settings' },
  ];

  const isActive = (href: string) => {
    if (href === '/dashboard') {
      return pathname === '/dashboard';
    }
    return pathname.startsWith(href);
  };

  return (
    <>
      <header className="sticky top-0 z-40 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-md border-b border-neutral-200 dark:border-neutral-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            {/* Logo & Nav */}
            <div className="flex items-center gap-8">
              <Link
                href="/"
                className="flex items-center gap-2 text-xl font-bold text-primary-600 dark:text-primary-400"
              >
                <svg
                  className="w-8 h-8"
                  viewBox="0 0 32 32"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <rect
                    width="32"
                    height="32"
                    rx="8"
                    className="fill-primary-600 dark:fill-primary-500"
                  />
                  <path
                    d="M16 6L8 10V16C8 20.4 11.2 24.5 16 26C20.8 24.5 24 20.4 24 16V10L16 6Z"
                    className="fill-white"
                  />
                  <path
                    d="M16 8L10 11V16C10 19.3 12.4 22.4 16 23.7C19.6 22.4 22 19.3 22 16V11L16 8Z"
                    className="fill-primary-600 dark:fill-primary-500"
                  />
                  <circle cx="16" cy="15" r="3" className="fill-white" />
                </svg>
                <span>Sentinel</span>
                {/* Version Badge */}
                <span
                  className="ml-1 px-1.5 py-0.5 text-[10px] font-mono font-normal bg-neutral-100 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400 rounded"
                  title={`Build: ${process.env.NEXT_PUBLIC_BUILD_TIME || 'unknown'}`}
                >
                  v{process.env.NEXT_PUBLIC_VERSION || 'dev'}
                </span>
              </Link>

              {/* Desktop Navigation */}
              <nav className="hidden md:flex items-center gap-1">
                {navigation.map((item) => (
                  <Link
                    key={item.name}
                    href={item.href}
                    className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                      isActive(item.href)
                        ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/50 dark:text-primary-300'
                        : 'text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:text-neutral-100 dark:hover:bg-neutral-800'
                    }`}
                  >
                    {item.name}
                  </Link>
                ))}
              </nav>
            </div>

            {/* Right side actions */}
            <div className="flex items-center gap-3">
              {/* New Rule Button */}
              {onNewRule && (
                <Button
                  onClick={onNewRule}
                  size="sm"
                  leftIcon={
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 4v16m8-8H4"
                      />
                    </svg>
                  }
                  className="hidden sm:inline-flex"
                >
                  New Rule
                </Button>
              )}

              {/* Theme Toggle */}
              <ThemeToggle size="sm" />

              {/* Notifications */}
              <IconButton
                aria-label="Notifications"
                size="sm"
                variant="ghost"
                className="hidden sm:flex"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
                  />
                </svg>
              </IconButton>

              {/* User menu (Desktop) */}
              {user && (
                <div className="hidden md:flex items-center gap-3 pl-3 border-l border-neutral-200 dark:border-neutral-700">
                  <span className="text-sm text-neutral-600 dark:text-neutral-400">
                    {user.email}
                  </span>
                  <IconButton
                    aria-label="Logout"
                    size="sm"
                    variant="ghost"
                    onClick={logout}
                  >
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                      />
                    </svg>
                  </IconButton>
                </div>
              )}

              {/* Mobile menu button */}
              <IconButton
                aria-label="Open menu"
                size="sm"
                variant="ghost"
                className="md:hidden"
                onClick={() => setMobileMenuOpen(true)}
              >
                <svg
                  className="w-6 h-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 6h16M4 12h16M4 18h16"
                  />
                </svg>
              </IconButton>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Navigation */}
      <MobileNav
        isOpen={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        navigation={navigation}
        user={user}
        onLogout={logout}
        onNewRule={onNewRule}
      />
    </>
  );
}

export type { HeaderProps };
