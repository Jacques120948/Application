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
  get appUrl(): string {
    return read('APP_URL') ?? 'http://localhost:3000'
  },
  get isProduction(): boolean {
    return process.env.NODE_ENV === 'production'
  },
  /** Vrai quand les appels IA réels sont possibles. Voir src/server/ai/client.ts. */
  get aiEnabled(): boolean {
    return read('ANTHROPIC_API_KEY') !== undefined
  },
}
