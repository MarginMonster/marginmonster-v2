/* Copy for the signup and login screens, in the same five languages the
 * landing page sells in.
 *
 * Without this, the funnel broke exactly where it costs the most: a visitor
 * read the whole pitch in Spanish, clicked "Empieza gratis", and hit an
 * English form asking for a password. Four of the five supported languages
 * hit that wall at the moment of conversion.
 *
 * The landing stores the visitor's choice in localStorage under "emLang";
 * both screens read it, and signup already posts it as a hidden field, so
 * the server can answer errors in the same language it was asked in.
 */

export type AuthLang = "en" | "es" | "fr" | "de" | "zh";

export type AuthCopy = {
  signupTitle: string;
  signupH1: string;
  signupSub: string;
  nameLabel: string;
  namePlaceholder: string;
  emailLabel: string;
  emailPlaceholder: string;
  passwordLabel: string;
  passwordPlaceholder: string;
  createBtn: string;
  creating: string;
  consentPre: string;
  consentTerms: string;
  consentMid: string;
  consentPrivacy: string;
  haveOne: string;
  logInLink: string;

  loginTitle: string;
  loginH1: string;
  loginBtn: string;
  loggingIn: string;
  forgot: string;
  newHere: string;
  createLink: string;

  /* Server-side. The action receives the posted language, so a Spanish
     signup fails in Spanish. */
  errEmail: string;
  errPassword: string;
  errRate: string;
  errGeneric: string;
  errBadLogin: string;
};

const EN: AuthCopy = {
  signupTitle: "Start free · EasyMode",
  signupH1: "Create your account",
  signupSub: "7-day free trial on every plan. No Shopify store required.",
  nameLabel: "Your name (or brand)",
  namePlaceholder: "Sunny Supply Co.",
  emailLabel: "Email",
  emailPlaceholder: "you@brand.com",
  passwordLabel: "Password",
  passwordPlaceholder: "8+ characters",
  createBtn: "Create account →",
  creating: "Creating…",
  consentPre: "By creating an account you agree to our ",
  consentTerms: "Terms",
  consentMid: " and ",
  consentPrivacy: "Privacy Policy",
  haveOne: "Already have one? ",
  logInLink: "Log in",
  loginTitle: "Log in · EasyMode",
  loginH1: "Log in",
  loginBtn: "Log in →",
  loggingIn: "Logging in…",
  forgot: "Forgot your password?",
  newHere: "New here? ",
  createLink: "Create an account",
  errEmail: "Enter a valid email address.",
  errPassword: "Password needs at least 8 characters.",
  errRate: "Too many accounts created from here recently. Try again a little later.",
  errGeneric: "Couldn't create the account just now — try again in a moment.",
  errBadLogin: "Email or password didn't match.",
};

const ES: AuthCopy = {
  signupTitle: "Empieza gratis · EasyMode",
  signupH1: "Crea tu cuenta",
  signupSub: "7 días de prueba gratis en todos los planes. No necesitas una tienda Shopify.",
  nameLabel: "Tu nombre (o marca)",
  namePlaceholder: "Sunny Supply Co.",
  emailLabel: "Correo electrónico",
  emailPlaceholder: "tu@marca.com",
  passwordLabel: "Contraseña",
  passwordPlaceholder: "8+ caracteres",
  createBtn: "Crear cuenta →",
  creating: "Creando…",
  consentPre: "Al crear una cuenta aceptas nuestros ",
  consentTerms: "Términos",
  consentMid: " y la ",
  consentPrivacy: "Política de Privacidad",
  haveOne: "¿Ya tienes una? ",
  logInLink: "Inicia sesión",
  loginTitle: "Inicia sesión · EasyMode",
  loginH1: "Inicia sesión",
  loginBtn: "Entrar →",
  loggingIn: "Entrando…",
  forgot: "¿Olvidaste tu contraseña?",
  newHere: "¿Eres nuevo? ",
  createLink: "Crea una cuenta",
  errEmail: "Introduce un correo electrónico válido.",
  errPassword: "La contraseña necesita al menos 8 caracteres.",
  errRate: "Se han creado demasiadas cuentas desde aquí. Inténtalo un poco más tarde.",
  errGeneric: "No pudimos crear la cuenta ahora mismo — inténtalo en un momento.",
  errBadLogin: "El correo o la contraseña no coinciden.",
};

const FR: AuthCopy = {
  signupTitle: "Essai gratuit · EasyMode",
  signupH1: "Créez votre compte",
  signupSub: "7 jours d'essai gratuit sur tous les plans. Aucune boutique Shopify requise.",
  nameLabel: "Votre nom (ou marque)",
  namePlaceholder: "Sunny Supply Co.",
  emailLabel: "E-mail",
  emailPlaceholder: "vous@marque.com",
  passwordLabel: "Mot de passe",
  passwordPlaceholder: "8+ caractères",
  createBtn: "Créer le compte →",
  creating: "Création…",
  consentPre: "En créant un compte, vous acceptez nos ",
  consentTerms: "Conditions",
  consentMid: " et notre ",
  consentPrivacy: "Politique de confidentialité",
  haveOne: "Vous en avez déjà un ? ",
  logInLink: "Connectez-vous",
  loginTitle: "Connexion · EasyMode",
  loginH1: "Connexion",
  loginBtn: "Se connecter →",
  loggingIn: "Connexion…",
  forgot: "Mot de passe oublié ?",
  newHere: "Nouveau ici ? ",
  createLink: "Créer un compte",
  errEmail: "Saisissez une adresse e-mail valide.",
  errPassword: "Le mot de passe doit faire au moins 8 caractères.",
  errRate: "Trop de comptes créés depuis cet endroit récemment. Réessayez un peu plus tard.",
  errGeneric: "Impossible de créer le compte pour le moment — réessayez dans un instant.",
  errBadLogin: "L'e-mail ou le mot de passe ne correspond pas.",
};

const DE: AuthCopy = {
  signupTitle: "Gratis starten · EasyMode",
  signupH1: "Konto erstellen",
  signupSub: "7 Tage kostenlos testen, in jedem Plan. Kein Shopify-Shop nötig.",
  nameLabel: "Dein Name (oder deine Marke)",
  namePlaceholder: "Sunny Supply Co.",
  emailLabel: "E-Mail",
  emailPlaceholder: "du@marke.de",
  passwordLabel: "Passwort",
  passwordPlaceholder: "8+ Zeichen",
  createBtn: "Konto erstellen →",
  creating: "Wird erstellt…",
  consentPre: "Mit dem Erstellen eines Kontos akzeptierst du unsere ",
  consentTerms: "AGB",
  consentMid: " und die ",
  consentPrivacy: "Datenschutzerklärung",
  haveOne: "Schon eines? ",
  logInLink: "Anmelden",
  loginTitle: "Anmelden · EasyMode",
  loginH1: "Anmelden",
  loginBtn: "Anmelden →",
  loggingIn: "Anmeldung…",
  forgot: "Passwort vergessen?",
  newHere: "Neu hier? ",
  createLink: "Konto erstellen",
  errEmail: "Gib eine gültige E-Mail-Adresse ein.",
  errPassword: "Das Passwort braucht mindestens 8 Zeichen.",
  errRate: "Von hier wurden zuletzt zu viele Konten erstellt. Versuch es etwas später noch einmal.",
  errGeneric: "Das Konto ließ sich gerade nicht erstellen — versuch es gleich noch einmal.",
  errBadLogin: "E-Mail oder Passwort stimmen nicht.",
};

const ZH: AuthCopy = {
  signupTitle: "免费开始 · EasyMode",
  signupH1: "创建账户",
  signupSub: "所有套餐均含 7 天免费试用。无需 Shopify 店铺。",
  nameLabel: "你的名字（或品牌）",
  namePlaceholder: "Sunny Supply Co.",
  emailLabel: "邮箱",
  emailPlaceholder: "you@brand.com",
  passwordLabel: "密码",
  passwordPlaceholder: "至少 8 个字符",
  createBtn: "创建账户 →",
  creating: "创建中…",
  consentPre: "创建账户即表示你同意我们的",
  consentTerms: "服务条款",
  consentMid: "和",
  consentPrivacy: "隐私政策",
  haveOne: "已经有账户了？",
  logInLink: "登录",
  loginTitle: "登录 · EasyMode",
  loginH1: "登录",
  loginBtn: "登录 →",
  loggingIn: "登录中…",
  forgot: "忘记密码？",
  newHere: "第一次来？",
  createLink: "创建账户",
  errEmail: "请输入有效的邮箱地址。",
  errPassword: "密码至少需要 8 个字符。",
  errRate: "此处近期创建的账户过多，请稍后再试。",
  errGeneric: "暂时无法创建账户 — 请稍后再试。",
  errBadLogin: "邮箱或密码不正确。",
};

export const AUTH_I18N: Record<AuthLang, AuthCopy> = { en: EN, es: ES, fr: FR, de: DE, zh: ZH };

/** Narrow anything (localStorage value, posted field, Accept-Language) to a
 *  language we actually have copy for. Never throws; falls back to English. */
export function authLang(raw: unknown): AuthLang {
  const s = String(raw ?? "").slice(0, 2).toLowerCase();
  return s === "es" || s === "fr" || s === "de" || s === "zh" ? s : "en";
}

/** Copy for a language, always defined. */
export function authCopy(raw: unknown): AuthCopy {
  return AUTH_I18N[authLang(raw)];
}
