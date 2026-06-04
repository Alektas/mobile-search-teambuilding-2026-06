# Расписание командировки

Мобильное одностраничное PWA-приложение с расписанием по дням. Стек: Vite, React, TypeScript, Tailwind CSS.

## Запуск

```bash
npm install
npm run dev
```

Сборка:

```bash
npm run build
```

Локальный просмотр production-сборки:

```bash
npm run preview
```

## Данные

Расписание лежит в `src/data/schedule.json`.

Важные поля:

- `updatedAt` показывает дату обновления в UI.
- `timezone` должен оставаться `Europe/Moscow`.
- `days[].events[]` содержит карточки событий.
- `visibility.full` и `visibility.short` управляют режимами отображения.
- `choiceGroupId` помечает параллельные альтернативы.

Поддерживаемые типы:

```ts
type EventType =
  | "conference"
  | "talk"
  | "hackathon"
  | "brainstorm"
  | "demo"
  | "workshop"
  | "activity"
  | "meal"
  | "transport"
  | "break"
  | "free_time"
  | "other";
```

## Пароль

Пароль задан в `src/App.tsx`.

Это только лёгкий барьер на статическом сайте. Расписание и пароль остаются доступны в собранных файлах.

## GitHub Pages

В проекте есть workflow `.github/workflows/deploy.yml`. Он собирает приложение и публикует `dist` через GitHub Pages при push в `master` или `main`.

В настройках репозитория нужно выбрать Pages source: `GitHub Actions`.

`vite.config.ts` автоматически выставляет `base` из `GITHUB_REPOSITORY` в GitHub Actions, поэтому проектные Pages вида `https://owner.github.io/repo/` работают без ручной правки.

## Offline/PWA

PWA настроен через `vite-plugin-pwa`.

После первой загрузки кешируются app shell и JSON-asset расписания. При обновлении расписания пользователь получит новую версию после обновления страницы, когда браузер подтянет свежий service worker.

