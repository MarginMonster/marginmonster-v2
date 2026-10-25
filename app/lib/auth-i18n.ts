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

export type AuthLang = "en" | "es" | "fr" | "de" | "zh" | "ur";

export type AuthCopy = {
  signupTitle: string;
  signupH1: string;
  signupSub: string;
  nameLabel: string;
  nameOptional: string;
  namePlaceholder: string;
  emailLabel: string;
  emailPlaceholder: string;
  passwordLabel: string;
  passwordPlaceholder: string;
  showPw: string;
  hidePw: string;
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
  loginSub: string;
  loginBtn: string;
  loggingIn: string;
  forgot: string;
  newHere: string;
  createLink: string;

  /* Forgot-password screen. */
  forgotTitle: string;
  forgotH1: string;
  forgotSub: string;
  forgotBtn: string;
  forgotSending: string;
  forgotSentH1: string;
  forgotNeutral: string;
  forgotResend: string;
  forgotOff: string;
  forgotRate: string;
  backToLogin: string;

  /* Choose-a-new-password screen. */
  resetTitle: string;
  resetH1: string;
  resetPwLabel: string;
  resetBtn: string;
  resetSaving: string;
  resetDead: string;
  resetExpiredH1: string;
  resetNewLink: string;
  resetShortPw: string;
  resetRate: string;
  resetChangedH1: string;
  resetOrphan: string;

  /* Server-side. The action receives the posted language, so a Spanish
     signup fails in Spanish. */
  errEmail: string;
  errPassword: string;
  errRate: string;
  errGeneric: string;
  errBadLogin: string;
  /* Login-specific throttle. {n} is replaced with the minute count. */
  errLoginRate: string;
};

const EN: AuthCopy = {
  signupTitle: "Start free · EasyMode",
  signupH1: "Create your account",
  signupSub: "7-day free trial on every plan. No Shopify store required.",
  nameLabel: "Your name (or brand)",
  nameOptional: "optional",
  namePlaceholder: "Sunny Supply Co.",
  emailLabel: "Email",
  emailPlaceholder: "you@brand.com",
  passwordLabel: "Password",
  passwordPlaceholder: "8+ characters",
  showPw: "Show password",
  hidePw: "Hide password",
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
  loginSub: "Welcome back. Pick up right where you left off.",
  loginBtn: "Log in →",
  loggingIn: "Logging in…",
  forgot: "Forgot your password?",
  newHere: "New here? ",
  createLink: "Create an account",
  forgotTitle: "Reset your password · EasyMode",
  forgotH1: "Reset your password",
  forgotSub: "We'll email you a link to choose a new one.",
  forgotBtn: "Send the link →",
  forgotSending: "Sending…",
  forgotSentH1: "Check your email",
  forgotNeutral: "If an account exists for that address, a reset link is on its way. It expires in 60 minutes. Nothing within 10 minutes? Email {contact} from the address on your account.",
  forgotResend: "Resend link",
  forgotOff: "Password reset by email isn't switched on yet. Email {contact} from the address on your account and we'll restore access by hand.",
  forgotRate: "Too many reset requests from here. Try again a little later.",
  backToLogin: "Back to log in",
  resetTitle: "Choose a new password · EasyMode",
  resetH1: "Choose a new password",
  resetPwLabel: "New password",
  resetBtn: "Save and log in →",
  resetSaving: "Saving…",
  resetDead: "This link is no longer valid — it may have expired, or already been used.",
  resetExpiredH1: "This link no longer works",
  resetNewLink: "Send me a new one",
  resetShortPw: "Password needs at least 8 characters.",
  resetRate: "Too many attempts. Try again in a few minutes.",
  resetChangedH1: "Password changed",
  resetOrphan: "Your new password is saved, but this account isn't linked to a workspace yet, so there's nothing to sign in to. Email {contact} and we'll connect it.",
  errEmail: "Enter a valid email address.",
  errPassword: "Password needs at least 8 characters.",
  errRate: "Too many accounts created from here recently. Try again a little later.",
  errGeneric: "Couldn't create the account just now — try again in a moment.",
  errBadLogin: "Email or password didn't match.",
  errLoginRate: "Too many attempts. Try again in {n} minute{s}.",
};

const ES: AuthCopy = {
  signupTitle: "Empieza gratis · EasyMode",
  signupH1: "Crea tu cuenta",
  signupSub: "7 días de prueba gratis en todos los planes. No necesitas una tienda Shopify.",
  nameLabel: "Tu nombre (o marca)",
  nameOptional: "opcional",
  namePlaceholder: "Sunny Supply Co.",
  emailLabel: "Correo electrónico",
  emailPlaceholder: "tu@marca.com",
  passwordLabel: "Contraseña",
  passwordPlaceholder: "8+ caracteres",
  showPw: "Mostrar contraseña",
  hidePw: "Ocultar contraseña",
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
  loginSub: "Bienvenido de nuevo. Continúa justo donde lo dejaste.",
  loginBtn: "Entrar →",
  loggingIn: "Entrando…",
  forgot: "¿Olvidaste tu contraseña?",
  newHere: "¿Eres nuevo? ",
  createLink: "Crea una cuenta",
  forgotTitle: "Restablece tu contraseña · EasyMode",
  forgotH1: "Restablece tu contraseña",
  forgotSub: "Te enviaremos un enlace por correo para elegir una nueva.",
  forgotBtn: "Enviar el enlace →",
  forgotSending: "Enviando…",
  forgotSentH1: "Revisa tu correo",
  forgotNeutral: "Si existe una cuenta para esa dirección, un enlace de restablecimiento está en camino. Caduca en 60 minutos. ¿Nada en 10 minutos? Escribe a {contact} desde la dirección de tu cuenta.",
  forgotResend: "Reenviar enlace",
  forgotOff: "El restablecimiento de contraseña por correo aún no está activado. Escribe a {contact} desde la dirección de tu cuenta y restauraremos el acceso a mano.",
  forgotRate: "Demasiadas solicitudes de restablecimiento desde aquí. Inténtalo un poco más tarde.",
  backToLogin: "Volver a iniciar sesión",
  resetTitle: "Elige una nueva contraseña · EasyMode",
  resetH1: "Elige una nueva contraseña",
  resetPwLabel: "Nueva contraseña",
  resetBtn: "Guardar e iniciar sesión →",
  resetSaving: "Guardando…",
  resetDead: "Este enlace ya no es válido — puede que haya caducado o que ya se haya usado.",
  resetExpiredH1: "Este enlace ya no funciona",
  resetNewLink: "Envíame uno nuevo",
  resetShortPw: "La contraseña necesita al menos 8 caracteres.",
  resetRate: "Demasiados intentos. Inténtalo de nuevo en unos minutos.",
  resetChangedH1: "Contraseña cambiada",
  resetOrphan: "Tu nueva contraseña se guardó, pero esta cuenta aún no está vinculada a un espacio de trabajo, así que no hay dónde iniciar sesión. Escribe a {contact} y la conectaremos.",
  errEmail: "Introduce un correo electrónico válido.",
  errPassword: "La contraseña necesita al menos 8 caracteres.",
  errRate: "Se han creado demasiadas cuentas desde aquí. Inténtalo un poco más tarde.",
  errGeneric: "No pudimos crear la cuenta ahora mismo — inténtalo en un momento.",
  errBadLogin: "El correo o la contraseña no coinciden.",
  errLoginRate: "Demasiados intentos. Inténtalo de nuevo en {n} minuto{s}.",
};

const FR: AuthCopy = {
  signupTitle: "Essai gratuit · EasyMode",
  signupH1: "Créez votre compte",
  signupSub: "7 jours d'essai gratuit sur tous les plans. Aucune boutique Shopify requise.",
  nameLabel: "Votre nom (ou marque)",
  nameOptional: "facultatif",
  namePlaceholder: "Sunny Supply Co.",
  emailLabel: "E-mail",
  emailPlaceholder: "vous@marque.com",
  passwordLabel: "Mot de passe",
  passwordPlaceholder: "8+ caractères",
  showPw: "Afficher le mot de passe",
  hidePw: "Masquer le mot de passe",
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
  loginSub: "Bon retour. Reprenez là où vous vous étiez arrêté.",
  loginBtn: "Se connecter →",
  loggingIn: "Connexion…",
  forgot: "Mot de passe oublié ?",
  newHere: "Nouveau ici ? ",
  createLink: "Créer un compte",
  forgotTitle: "Réinitialiser votre mot de passe · EasyMode",
  forgotH1: "Réinitialiser votre mot de passe",
  forgotSub: "Nous vous enverrons un lien par e-mail pour en choisir un nouveau.",
  forgotBtn: "Envoyer le lien →",
  forgotSending: "Envoi…",
  forgotSentH1: "Vérifiez vos e-mails",
  forgotNeutral: "Si un compte existe pour cette adresse, un lien de réinitialisation est en route. Il expire dans 60 minutes. Rien dans les 10 minutes ? Écrivez à {contact} depuis l'adresse de votre compte.",
  forgotResend: "Renvoyer le lien",
  forgotOff: "La réinitialisation du mot de passe par e-mail n'est pas encore activée. Écrivez à {contact} depuis l'adresse de votre compte et nous rétablirons l'accès manuellement.",
  forgotRate: "Trop de demandes de réinitialisation depuis cet endroit. Réessayez un peu plus tard.",
  backToLogin: "Retour à la connexion",
  resetTitle: "Choisir un nouveau mot de passe · EasyMode",
  resetH1: "Choisir un nouveau mot de passe",
  resetPwLabel: "Nouveau mot de passe",
  resetBtn: "Enregistrer et se connecter →",
  resetSaving: "Enregistrement…",
  resetDead: "Ce lien n'est plus valide — il a peut-être expiré ou a déjà été utilisé.",
  resetExpiredH1: "Ce lien ne fonctionne plus",
  resetNewLink: "Envoyez-m'en un nouveau",
  resetShortPw: "Le mot de passe doit faire au moins 8 caractères.",
  resetRate: "Trop de tentatives. Réessayez dans quelques minutes.",
  resetChangedH1: "Mot de passe modifié",
  resetOrphan: "Votre nouveau mot de passe est enregistré, mais ce compte n'est pas encore lié à un espace de travail, il n'y a donc nulle part où se connecter. Écrivez à {contact} et nous le relierons.",
  errEmail: "Saisissez une adresse e-mail valide.",
  errPassword: "Le mot de passe doit faire au moins 8 caractères.",
  errRate: "Trop de comptes créés depuis cet endroit récemment. Réessayez un peu plus tard.",
  errGeneric: "Impossible de créer le compte pour le moment — réessayez dans un instant.",
  errBadLogin: "L'e-mail ou le mot de passe ne correspond pas.",
  errLoginRate: "Trop de tentatives. Réessayez dans {n} minute{s}.",
};

const DE: AuthCopy = {
  signupTitle: "Gratis starten · EasyMode",
  signupH1: "Konto erstellen",
  signupSub: "7 Tage kostenlos testen, in jedem Plan. Kein Shopify-Shop nötig.",
  nameLabel: "Dein Name (oder deine Marke)",
  nameOptional: "optional",
  namePlaceholder: "Sunny Supply Co.",
  emailLabel: "E-Mail",
  emailPlaceholder: "du@marke.de",
  passwordLabel: "Passwort",
  passwordPlaceholder: "8+ Zeichen",
  showPw: "Passwort anzeigen",
  hidePw: "Passwort verbergen",
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
  loginSub: "Willkommen zurück. Mach genau dort weiter, wo du aufgehört hast.",
  loginBtn: "Anmelden →",
  loggingIn: "Anmeldung…",
  forgot: "Passwort vergessen?",
  newHere: "Neu hier? ",
  createLink: "Konto erstellen",
  forgotTitle: "Passwort zurücksetzen · EasyMode",
  forgotH1: "Passwort zurücksetzen",
  forgotSub: "Wir schicken dir per E-Mail einen Link, um ein neues zu wählen.",
  forgotBtn: "Link senden →",
  forgotSending: "Wird gesendet…",
  forgotSentH1: "Sieh in deinem Postfach nach",
  forgotNeutral: "Falls für diese Adresse ein Konto existiert, ist ein Link zum Zurücksetzen unterwegs. Er läuft in 60 Minuten ab. Nichts innerhalb von 10 Minuten? Schreib an {contact} von der Adresse deines Kontos.",
  forgotResend: "Link erneut senden",
  forgotOff: "Das Zurücksetzen des Passworts per E-Mail ist noch nicht aktiviert. Schreib an {contact} von der Adresse deines Kontos, und wir stellen den Zugang von Hand wieder her.",
  forgotRate: "Zu viele Zurücksetz-Anfragen von hier. Versuch es etwas später noch einmal.",
  backToLogin: "Zurück zur Anmeldung",
  resetTitle: "Neues Passwort wählen · EasyMode",
  resetH1: "Neues Passwort wählen",
  resetPwLabel: "Neues Passwort",
  resetBtn: "Speichern und anmelden →",
  resetSaving: "Wird gespeichert…",
  resetDead: "Dieser Link ist nicht mehr gültig — er ist möglicherweise abgelaufen oder wurde bereits verwendet.",
  resetExpiredH1: "Dieser Link funktioniert nicht mehr",
  resetNewLink: "Schick mir einen neuen",
  resetShortPw: "Das Passwort braucht mindestens 8 Zeichen.",
  resetRate: "Zu viele Versuche. Versuch es in ein paar Minuten noch einmal.",
  resetChangedH1: "Passwort geändert",
  resetOrphan: "Dein neues Passwort ist gespeichert, aber dieses Konto ist noch mit keinem Arbeitsbereich verbunden, daher gibt es nichts zum Anmelden. Schreib an {contact}, und wir verbinden es.",
  errEmail: "Gib eine gültige E-Mail-Adresse ein.",
  errPassword: "Das Passwort braucht mindestens 8 Zeichen.",
  errRate: "Von hier wurden zuletzt zu viele Konten erstellt. Versuch es etwas später noch einmal.",
  errGeneric: "Das Konto ließ sich gerade nicht erstellen — versuch es gleich noch einmal.",
  errBadLogin: "E-Mail oder Passwort stimmen nicht.",
  errLoginRate: "Zu viele Versuche. Versuch es in {n} Minute{s} noch einmal.",
};

const ZH: AuthCopy = {
  signupTitle: "免费开始 · EasyMode",
  signupH1: "创建账户",
  signupSub: "所有套餐均含 7 天免费试用。无需 Shopify 店铺。",
  nameLabel: "你的名字（或品牌）",
  nameOptional: "选填",
  namePlaceholder: "Sunny Supply Co.",
  emailLabel: "邮箱",
  emailPlaceholder: "you@brand.com",
  passwordLabel: "密码",
  passwordPlaceholder: "至少 8 个字符",
  showPw: "显示密码",
  hidePw: "隐藏密码",
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
  loginSub: "欢迎回来，继续上次的进度吧。",
  loginBtn: "登录 →",
  loggingIn: "登录中…",
  forgot: "忘记密码？",
  newHere: "第一次来？",
  createLink: "创建账户",
  forgotTitle: "重置密码 · EasyMode",
  forgotH1: "重置密码",
  forgotSub: "我们会给你发送一封邮件，让你设置新密码。",
  forgotBtn: "发送链接 →",
  forgotSending: "发送中…",
  forgotSentH1: "请查收邮件",
  forgotNeutral: "如果该地址存在账户，重置链接正在发送途中。链接将在 60 分钟后失效。10 分钟内仍未收到？请用账户所用的邮箱写信给 {contact}。",
  forgotResend: "重新发送链接",
  forgotOff: "通过邮件重置密码功能尚未开启。请用账户所用的邮箱写信给 {contact}，我们会手动为你恢复访问。",
  forgotRate: "来自此处的重置请求过多，请稍后再试。",
  backToLogin: "返回登录",
  resetTitle: "设置新密码 · EasyMode",
  resetH1: "设置新密码",
  resetPwLabel: "新密码",
  resetBtn: "保存并登录 →",
  resetSaving: "保存中…",
  resetDead: "此链接已失效 — 可能已过期，或已被使用。",
  resetExpiredH1: "此链接已失效",
  resetNewLink: "给我发送一个新链接",
  resetShortPw: "密码至少需要 8 个字符。",
  resetRate: "尝试次数过多，请过几分钟再试。",
  resetChangedH1: "密码已更改",
  resetOrphan: "你的新密码已保存，但此账户尚未关联到任何工作区，因此暂时无法登录。请写信给 {contact}，我们会为你关联。",
  errEmail: "请输入有效的邮箱地址。",
  errPassword: "密码至少需要 8 个字符。",
  errRate: "此处近期创建的账户过多，请稍后再试。",
  errGeneric: "暂时无法创建账户 — 请稍后再试。",
  errBadLogin: "邮箱或密码不正确。",
  errLoginRate: "尝试次数过多，请过 {n} 分钟后再试。",
};

const UR: AuthCopy = {
  "signupTitle": "مفت شروع کریں · EasyMode",
  "signupH1": "اپنا اکاؤنٹ بنائیں",
  "signupSub": "ہر پلان پر 7 دن کا مفت ٹرائل۔ Shopify اسٹور کی ضرورت نہیں۔",
  "nameLabel": "آپ کا نام (یا برانڈ)",
  "nameOptional": "اختیاری",
  "namePlaceholder": "Sunny Supply Co.",
  "emailLabel": "ای میل",
  "emailPlaceholder": "you@brand.com",
  "passwordLabel": "پاس ورڈ",
  "passwordPlaceholder": "8+ حروف",
  "showPw": "پاس ورڈ دکھائیں",
  "hidePw": "پاس ورڈ چھپائیں",
  "createBtn": "اکاؤنٹ بنائیں →",
  "creating": "بنایا جا رہا ہے…",
  "consentPre": "اکاؤنٹ بنا کر آپ ہماری ",
  "consentTerms": "شرائط",
  "consentMid": " اور ",
  "consentPrivacy": "پرائیویسی پالیسی",
  "haveOne": "پہلے سے اکاؤنٹ ہے؟ ",
  "logInLink": "لاگ اِن کریں",
  "loginTitle": "لاگ اِن · EasyMode",
  "loginH1": "لاگ اِن کریں",
  "loginSub": "دوبارہ خوش آمدید۔ وہیں سے جاری رکھیں جہاں آپ نے چھوڑا تھا۔",
  "loginBtn": "لاگ اِن کریں →",
  "loggingIn": "لاگ اِن ہو رہا ہے…",
  "forgot": "پاس ورڈ بھول گئے؟",
  "newHere": "یہاں نئے ہیں؟ ",
  "createLink": "اکاؤنٹ بنائیں",
  "forgotTitle": "اپنا پاس ورڈ ری سیٹ کریں · EasyMode",
  "forgotH1": "اپنا پاس ورڈ ری سیٹ کریں",
  "forgotSub": "ہم آپ کو نیا پاس ورڈ منتخب کرنے کے لیے ای میل پر ایک لنک بھیجیں گے۔",
  "forgotBtn": "لنک بھیجیں →",
  "forgotSending": "بھیجا جا رہا ہے…",
  "forgotSentH1": "اپنی ای میل دیکھیں",
  "forgotNeutral": "اگر اس ایڈریس کے لیے کوئی اکاؤنٹ موجود ہے، تو ری سیٹ لنک بھیجا جا رہا ہے۔ یہ 60 منٹ میں ختم ہو جائے گا۔ 10 منٹ میں کچھ نہیں آیا؟ اپنے اکاؤنٹ والے ایڈریس سے {contact} پر ای میل کریں۔",
  "forgotResend": "لنک دوبارہ بھیجیں",
  "forgotOff": "ای میل کے ذریعے پاس ورڈ ری سیٹ ابھی فعال نہیں ہے۔ اپنے اکاؤنٹ والے ایڈریس سے {contact} پر ای میل کریں اور ہم دستی طور پر رسائی بحال کر دیں گے۔",
  "forgotRate": "یہاں سے بہت زیادہ ری سیٹ درخواستیں آئی ہیں۔ تھوڑی دیر بعد دوبارہ کوشش کریں۔",
  "backToLogin": "لاگ اِن پر واپس جائیں",
  "resetTitle": "نیا پاس ورڈ منتخب کریں · EasyMode",
  "resetH1": "نیا پاس ورڈ منتخب کریں",
  "resetPwLabel": "نیا پاس ورڈ",
  "resetBtn": "محفوظ کریں اور لاگ اِن کریں →",
  "resetSaving": "محفوظ ہو رہا ہے…",
  "resetDead": "یہ لنک اب درست نہیں رہا — ہو سکتا ہے یہ ختم ہو گیا ہو، یا پہلے ہی استعمال ہو چکا ہو۔",
  "resetExpiredH1": "یہ لنک اب کام نہیں کرتا",
  "resetNewLink": "مجھے نیا بھیجیں",
  "resetShortPw": "پاس ورڈ میں کم از کم 8 حروف ہونے چاہییں۔",
  "resetRate": "بہت زیادہ کوششیں۔ چند منٹ بعد دوبارہ کوشش کریں۔",
  "resetChangedH1": "پاس ورڈ تبدیل ہو گیا",
  "resetOrphan": "آپ کا نیا پاس ورڈ محفوظ ہو گیا ہے، لیکن یہ اکاؤنٹ ابھی کسی ورک اسپیس سے منسلک نہیں، اس لیے لاگ اِن کرنے کے لیے کچھ نہیں۔ {contact} پر ای میل کریں اور ہم اسے جوڑ دیں گے۔",
  "errEmail": "درست ای میل ایڈریس درج کریں۔",
  "errPassword": "پاس ورڈ میں کم از کم 8 حروف ہونے چاہییں۔",
  "errRate": "حال ہی میں یہاں سے بہت زیادہ اکاؤنٹس بنائے گئے ہیں۔ تھوڑی دیر بعد دوبارہ کوشش کریں۔",
  "errGeneric": "ابھی اکاؤنٹ نہیں بن سکا — ایک لمحے بعد دوبارہ کوشش کریں۔",
  "errBadLogin": "ای میل یا پاس ورڈ مطابقت نہیں رکھتے۔",
  "errLoginRate": "بہت زیادہ کوششیں۔ {n} منٹ بعد دوبارہ کوشش کریں۔"
};

export const AUTH_I18N: Record<AuthLang, AuthCopy> = { en: EN, es: ES, fr: FR, de: DE, zh: ZH, ur: UR };

/** Narrow anything (localStorage value, posted field, Accept-Language) to a
 *  language we actually have copy for. Never throws; falls back to English. */
export function authLang(raw: unknown): AuthLang {
  const s = String(raw ?? "").slice(0, 2).toLowerCase();
  return s === "es" || s === "fr" || s === "de" || s === "zh" || s === "ur" ? s : "en";
}

/** Copy for a language, always defined. */
export function authCopy(raw: unknown): AuthCopy {
  return AUTH_I18N[authLang(raw)];
}
