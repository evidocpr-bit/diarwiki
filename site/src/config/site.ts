export const routePaths = {
  home: '/',
  start: '/start/',
  knowledge: '/knowledge/',
  library: '/library/',
  glucoseTool: '/tools/glucose-units/',
  urgent: '/urgent/',
  search: '/search/',
  about: '/about/',
  editorialPolicy: '/editorial-policy/',
  reviewStatus: '/review-status/',
  sources: '/sources/',
  contact: '/contact/',
  medicalDisclaimer: '/legal/medical-disclaimer/',
  privacy: '/legal/privacy/',
  terms: '/legal/terms/',
} as const;

export const siteIdentity = {
  name: 'ДиарВики',
  origin: 'https://diarwiki.ru',
  description: 'Понятная и проверяемая информация о жизни с диабетом.',
  editorEmail: 'info@diarwiki.ru',
  owner: {
    name: 'Пономарев Степан Андреевич',
    shortName: 'Пономарев С. А.',
    status: 'физическое лицо',
    location: 'Российская Федерация, г. Хабаровск',
  },
  evidoc: {
    name: 'Центр доказательной медицины «Эвидок»',
    nameGenitive: 'Центра доказательной медицины «Эвидок»',
    url: 'https://centrdocmed.ru/',
    logo: '/images/evidoc-logo.png',
    endocrinologyUrl: 'https://centrdocmed.ru/services/endokrinologya/priem-endokrinologa/',
    staffUrl: 'https://centrdocmed.ru/staff/',
  },
  curator: {
    name: 'Пономарев Степан Андреевич',
    role: 'создатель и куратор проекта; сотрудничает с «Эвидок» как партнёр',
    experience: 'живёт с диабетом восемь лет',
    technology: 'постоянно использует закрытую петлю с системой непрерывного мониторинга глюкозы (CGM) и помпой Accu-Chek Combo',
  },
  mission: 'Собрать практическую информацию из открытого диабет-сообщества, а затем проверять её вместе с эндокринологами и участниками сообщества, сопоставляя с научными данными.',
} as const;

type RoutePlacement = 'main' | 'footer-info' | 'footer-legal';

export interface SiteRoute {
  key: keyof typeof routePaths;
  href: (typeof routePaths)[keyof typeof routePaths];
  label: string;
  placements: RoutePlacement[];
}

export const siteRoutes: SiteRoute[] = [
  { key: 'home', href: routePaths.home, label: 'Главная', placements: [] },
  { key: 'start', href: routePaths.start, label: 'Начать', placements: ['main'] },
  { key: 'knowledge', href: routePaths.knowledge, label: 'База знаний', placements: ['main'] },
  { key: 'library', href: routePaths.library, label: 'Библиотека', placements: ['main', 'footer-info'] },
  { key: 'urgent', href: routePaths.urgent, label: 'Срочно', placements: ['main'] },
  { key: 'glucoseTool', href: routePaths.glucoseTool, label: 'Инструменты', placements: ['main'] },
  { key: 'about', href: routePaths.about, label: 'О проекте', placements: ['main'] },
  { key: 'editorialPolicy', href: routePaths.editorialPolicy, label: 'Редакционная политика', placements: ['footer-info'] },
  { key: 'reviewStatus', href: routePaths.reviewStatus, label: 'Статусы проверки', placements: ['footer-info'] },
  { key: 'sources', href: routePaths.sources, label: 'Источники', placements: ['footer-info'] },
  { key: 'contact', href: routePaths.contact, label: 'Контакты', placements: ['footer-info'] },
  { key: 'medicalDisclaimer', href: routePaths.medicalDisclaimer, label: 'Медицинский дисклеймер', placements: ['footer-legal'] },
  { key: 'privacy', href: routePaths.privacy, label: 'Политика данных', placements: ['footer-legal'] },
  { key: 'terms', href: routePaths.terms, label: 'Условия использования', placements: ['footer-legal'] },
];

export const mainNavigation = siteRoutes.filter((route) => route.placements.includes('main'));
export const footerInformationNavigation = siteRoutes.filter((route) => route.placements.includes('footer-info'));
export const footerLegalNavigation = siteRoutes.filter((route) => route.placements.includes('footer-legal'));

export const sidebarNavigation = [
  { label: 'Начать', link: routePaths.start },
  {
    label: 'База знаний',
    items: [
      { label: 'Все материалы', link: routePaths.knowledge },
      { label: 'Срочно', link: routePaths.urgent },
      { label: 'Что такое диабет', link: '/knowledge/what-is-diabetes/' },
      { label: 'После диагноза', link: '/knowledge/after-diagnosis/' },
      { label: 'Что показывает датчик', link: '/knowledge/cgm-basics/' },
      { label: 'Как читать отчёт CGM', link: '/knowledge/cgm-report-statistics/' },
      { label: 'Отчёт CGM для врача', link: '/knowledge/cgm-report-for-doctor/' },
      { label: 'Перенос на новый телефон', link: '/knowledge/cgm-new-phone/' },
      { label: 'Если пропали показания', link: '/knowledge/cgm-no-readings/' },
      { label: 'Передача близким и врачу', link: '/knowledge/cgm-sharing/' },
      { label: 'Juggluco и JugglucoNG', link: '/knowledge/juggluco-juggluco-ng/' },
      { label: 'Подготовка к приёму', link: '/knowledge/prepare-for-appointment/' },
      { label: 'Как читать источники', link: '/knowledge/how-to-read-sources/' },
      { label: 'Telegram-каналы и чаты', link: '/knowledge/telegram-channels-diabetes/' },
      { label: 'Словарь', link: '/knowledge/glossary/' },
    ],
  },
  { label: 'Библиотека', link: routePaths.library },
  { label: 'Инструменты', link: routePaths.glucoseTool },
  { label: 'О проекте', link: routePaths.about },
] as const;
