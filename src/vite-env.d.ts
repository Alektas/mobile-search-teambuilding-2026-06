/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

type TelegramWebApp = {
  initData?: string;
  initDataUnsafe?: Record<string, unknown>;
  platform?: string;
  ready?: () => void;
  expand?: () => void;
  disableVerticalSwipes?: () => void;
};

interface Window {
  Telegram?: {
    WebApp?: TelegramWebApp;
  };
}
