/* UI translations — the KEY is the English source string, the value is its
 * translation in that language. Any key missing here falls back to English
 * automatically (see tr() in ui-i18n.ts), so this file can grow one surface at
 * a time without ever breaking a page.
 *
 * Placeholders are written as {name} and are preserved verbatim across every
 * language — tr() substitutes them after lookup. Keep brand and product names
 * (EasyMode, Studio tier names, etc.) untranslated.
 *
 * These are machine-assisted translations authored for the app; they read
 * naturally but a native speaker should still review before a hard launch in
 * that market. Extended as strings are wrapped across the app. */

import type { UiLang } from "./ui-i18n";

const es: Record<string, string> = {
  // App shell — nav
  "Dashboard": "Panel",
  "Studio": "Estudio",
  "Channels": "Canales",
  "Campaigns": "Campañas",
  "Archive": "Archivo",
  "Gallery": "Galería",
  "Auto-posting": "Autopublicación",
  "Share": "Compartir",
  // App shell — mode + account
  "Marketing": "Marketing",
  "Creator": "Creador",
  "Log out": "Cerrar sesión",
  "Log in": "Iniciar sesión",
  "Sell your products — ads, campaigns, the works": "Vende tus productos — anuncios, campañas, todo",
  "Create for yourself — images, videos & music, no store needed": "Crea para ti — imágenes, vídeos y música, sin tienda",
  "Creation mode": "Modo de creación",
  // App shell — language toggle
  "Display language — translates the app": "Idioma de la interfaz — traduce la app",
  // App shell — HUD
  "No plan": "Sin plan",
  "Manage your plan": "Gestiona tu plan",
  "Your store's level — every level pays out free tokens": "El nivel de tu tienda — cada nivel regala tokens gratis",
  "Player status": "Estado del jugador",
  "Expand player status": "Mostrar el estado del jugador",
  "Collapse player status": "Ocultar el estado del jugador",
  "Collapse": "Ocultar",
};

const fr: Record<string, string> = {
  "Dashboard": "Tableau de bord",
  "Studio": "Studio",
  "Channels": "Chaînes",
  "Campaigns": "Campagnes",
  "Archive": "Archives",
  "Gallery": "Galerie",
  "Auto-posting": "Publication auto",
  "Share": "Partager",
  "Marketing": "Marketing",
  "Creator": "Créateur",
  "Log out": "Déconnexion",
  "Log in": "Connexion",
  "Sell your products — ads, campaigns, the works": "Vendez vos produits — publicités, campagnes, tout",
  "Create for yourself — images, videos & music, no store needed": "Créez pour vous — images, vidéos et musique, sans boutique",
  "Creation mode": "Mode de création",
  "Display language — translates the app": "Langue d'affichage — traduit l'application",
  "No plan": "Aucun forfait",
  "Manage your plan": "Gérer votre forfait",
  "Your store's level — every level pays out free tokens": "Le niveau de votre boutique — chaque niveau offre des jetons gratuits",
  "Player status": "Statut du joueur",
  "Expand player status": "Afficher le statut du joueur",
  "Collapse player status": "Masquer le statut du joueur",
  "Collapse": "Réduire",
};

const de: Record<string, string> = {
  "Dashboard": "Übersicht",
  "Studio": "Studio",
  "Channels": "Kanäle",
  "Campaigns": "Kampagnen",
  "Archive": "Archiv",
  "Gallery": "Galerie",
  "Auto-posting": "Auto-Posting",
  "Share": "Teilen",
  "Marketing": "Marketing",
  "Creator": "Creator",
  "Log out": "Abmelden",
  "Log in": "Anmelden",
  "Sell your products — ads, campaigns, the works": "Verkaufe deine Produkte — Anzeigen, Kampagnen, alles",
  "Create for yourself — images, videos & music, no store needed": "Erschaffe für dich — Bilder, Videos & Musik, kein Shop nötig",
  "Creation mode": "Erstellungsmodus",
  "Display language — translates the app": "Anzeigesprache — übersetzt die App",
  "No plan": "Kein Plan",
  "Manage your plan": "Plan verwalten",
  "Your store's level — every level pays out free tokens": "Das Level deines Shops — jedes Level schenkt Gratis-Tokens",
  "Player status": "Spielerstatus",
  "Expand player status": "Spielerstatus einblenden",
  "Collapse player status": "Spielerstatus ausblenden",
  "Collapse": "Einklappen",
};

const zh: Record<string, string> = {
  "Dashboard": "仪表板",
  "Studio": "工作室",
  "Channels": "频道",
  "Campaigns": "广告系列",
  "Archive": "存档",
  "Gallery": "作品库",
  "Auto-posting": "自动发布",
  "Share": "分享",
  "Marketing": "营销",
  "Creator": "创作",
  "Log out": "退出登录",
  "Log in": "登录",
  "Sell your products — ads, campaigns, the works": "销售你的产品 — 广告、广告系列，一应俱全",
  "Create for yourself — images, videos & music, no store needed": "为自己创作 — 图片、视频和音乐，无需店铺",
  "Creation mode": "创作模式",
  "Display language — translates the app": "显示语言 — 翻译整个应用",
  "No plan": "无套餐",
  "Manage your plan": "管理你的套餐",
  "Your store's level — every level pays out free tokens": "你的店铺等级 — 每升一级赠送免费代币",
  "Player status": "玩家状态",
  "Expand player status": "展开玩家状态",
  "Collapse player status": "收起玩家状态",
  "Collapse": "收起",
};

export const UI_DICT: Partial<Record<UiLang, Record<string, string>>> = { es, fr, de, zh };
