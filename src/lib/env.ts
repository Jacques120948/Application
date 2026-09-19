/**
 * Accès aux variables d'environnement, validé et centralisé.
 *
 * Règle de sécurité : aucune valeur lue ici n'est destinée au navigateur. Les variables
 * publiques passent exclusivement par le préfixe NEXT_PUBLIC_ et ne transitent pas par
 * ce module.
 */
import { AppError } from './errors'

function read(name: string): string | undefined {
  const value = process.env[name]
  return value === undefined || value === '' ? undefined : value
}

function required(name: string): string {
  const value = read(name)
  if (value === undefined) {
    throw new AppError('INTERNAL', `Variable d'environnement manquante : ${name}`)
  }
  return value
}

export const env = {
  get databaseUrl(): string {
    return required('DATABASE_URL')
  },
  get sessionSecret(): string {
    const secret = required('SESSION_SECRET')
    if (secret.length < 32) {
      throw new AppError('INTERNAL', 'SESSION_SECRET doit faire au moins 32 caractères.')
    }
    return secret
  },
  get encryptionKey(): string {
    return required('ENCRYPTION_KEY')
  },
  get anthropicApiKey(): string | undefined {
    return read('ANTHROPIC_API_KEY')
  },
  /**
   * Code d'accès exigé à l'inscription, quand il est défini.
   *
   * Sert à mettre la plateforme en ligne pour un test privé sans que quiconque trouvant
   * l'adresse puisse créer un compte et consommer les crédits du propriétaire. Non défini,
   * l'inscription est ouverte à tous.
   */
  get signupCode(): string | undefined {
    return read('SIGNUP_CODE')
  },
  /**
   * Adresse du compte administrateur, promu à chaque mise en ligne par prisma/seed.ts.
   *
   * C'est l'amorçage : sans elle, personne ne pourrait ouvrir le back-office sur une
   * installation neuve sans écrire de SQL. Le rôle reste stocké en base, cette variable
   * ne fait que le poser la première fois.
   */
  /**
   * Jeton du planificateur, pour les routes appelées par une tâche périodique (Radar V2).
   *
   * Non défini, ces routes n'existent pas : elles répondent 404. C'est le réglage par
   * défaut, parce qu'une recherche automatique pour chaque personne a un coût, et que
   * l'ouvrir est une décision du propriétaire, pas du code.
   */
  get cronSecret(): string | undefined {
    const value = read('CRON_SECRET')
    return value !== undefined && value.length >= 32 ? value : undefined
  },
  get adminEmail(): string | undefined {
    const value = read('ADMIN_EMAIL')
    return value?.trim().toLowerCase()
  },
  /** Clé du fournisseur d'e-mails. Absente, la plateforme n'envoie aucun message. */
  get resendApiKey(): string | undefined {
    return read('RESEND_API_KEY')
  },
  /** Expéditeur des messages, par exemple « Evoliia <bonjour@evoliia.com> ». */
  get emailFrom(): string | undefined {
    return read('EMAIL_FROM')
  },
  /**
   * Stripe. Sans clé secrète, aucun paiement n'est proposé nulle part : la page des offres
   * dit que le paiement en ligne n'est pas activé, et les routes de paiement répondent
   * « introuvable ». Les secrets de signature des webhooks sont distincts : un pour les
   * abonnements Evoliia, un pour les comptes connectés des créateurs.
   */
  get stripeSecretKey(): string | undefined {
    return read('STRIPE_SECRET_KEY')
  },
  get stripeWebhookSecret(): string | undefined {
    return read('STRIPE_WEBHOOK_SECRET')
  },
  get stripeConnectWebhookSecret(): string | undefined {
    return read('STRIPE_CONNECT_WEBHOOK_SECRET')
  },
  /**
   * Commission d'Evoliia sur les ventes faites dans les applications créées, en pour cent.
   * Zéro par défaut : la prendre est une décision commerciale du propriétaire, pas du code.
   */
  get stripeApplicationFeePercent(): number {
    const value = Number(read('STRIPE_APPLICATION_FEE_PERCENT') ?? '0')
    return Number.isFinite(value) ? Math.min(30, Math.max(0, value)) : 0
  },
  get appUrl(): string {
    return read('APP_URL') ?? 'http://localhost:3000'
  },
  /**
   * Identifiants de l'application Google d'Evoliia, pour l'autorisation OAuth.
   *
   * Ils appartiennent à Evoliia et ne donnent accès à rien par eux-mêmes : c'est la personne
   * qui autorise, compte par compte, et le jeton obtenu ne vaut que pour son propre Search
   * Console. Le secret ne quitte jamais le serveur — il ne sert qu'à l'échange du code
   * contre un jeton, de serveur à serveur.
   *
   * Absents, le connecteur est éteint : la route d'autorisation répond « introuvable »,
   * comme si elle n'existait pas. Une porte fermée ne s'annonce pas.
   */
  get googleClientId(): string | undefined {
    return read('GOOGLE_OAUTH_CLIENT_ID')
  },
  get googleClientSecret(): string | undefined {
    return read('GOOGLE_OAUTH_CLIENT_SECRET')
  },
  /**
   * Clé Google AI d'Evoliia, pour créer des images au nom des créateurs.
   *
   * Elle ne quitte jamais le serveur : aucune route ne la renvoie, aucun composant ne la
   * lit, elle n'entre dans aucun prompt et dans aucun journal. Absente, la fonction est
   * simplement éteinte — le créateur garde la voie de sa propre clé, et rien n'échoue.
   */
  get geminiApiKey(): string | undefined {
    return read('GEMINI_API_KEY')
  },
  /**
   * Domaine des applications publiées, par exemple `evoliia.app`. Chaque application y
   * reçoit un sous-domaine tiré de son nom court. Sans cette variable, les applications
   * restent servies sous `/a/<nom-court>` et rien ne change : la fonction est éteinte,
   * pas à moitié branchée. Voir src/lib/apps-domain.ts.
   */
  get appsDomain(): string | undefined {
    const value = read('APPS_DOMAIN')
    return value === undefined ? undefined : value.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  },
  /**
   * Adresse publique de Postelya.
   *
   * Elle est réglable plutôt qu'écrite dans une page : Postelya vit aujourd'hui sur une
   * adresse Vercel et vivra demain sur son propre domaine. Le jour où il changera, personne
   * ne doit avoir à retrouver le lien au milieu d'un composant, ni à déployer Evoliia pour
   * corriger une adresse.
   *
   * La valeur par défaut est celle d'aujourd'hui : sans réglage, le bouton fonctionne.
   */
  get postelyaUrl(): string {
    return read('POSTELYA_URL') ?? 'https://postelya.vercel.app'
  },
  get isProduction(): boolean {
    return process.env.NODE_ENV === 'production'
  },
  /** Vrai quand les appels IA réels sont possibles. Voir src/server/ai/client.ts. */
  get aiEnabled(): boolean {
    return read('ANTHROPIC_API_KEY') !== undefined
  },
}
