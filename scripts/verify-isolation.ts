import { PrismaClient } from '@prisma/client'

/**
 * Vérification de l'isolation, exécutée à chaque mise en ligne.
 *
 * Le cloisonnement entre créateurs repose sur le Row Level Security de PostgreSQL. Or
 * cette protection est silencieusement annulée si le rôle qui se connecte possède
 * l'attribut BYPASSRLS, ou si une table a perdu ses politiques. Rien ne planterait :
 * l'application fonctionnerait, et les données de chacun seraient visibles par tous.
 *
 * Ce contrôle tourne pendant la construction et fait échouer la mise en ligne. Une
 * installation non protégée ne doit jamais atteindre Internet.
 */

const PROTECTED_TABLES = [
  'Project',
  'ProjectVersion',
  'ChatMessage',
  'ProjectCheck',
  'AppRecord',
  'AppEndUser',
  'AppEndUserSession',
  'AppEvent',
  'AppPurchase',
  'CreatorProfile',
  'Idea',
  'IntegrationConnection',
  'IntegrationCredential',
  'IntegrationEvent',
  'MarketingKit',
  'MediaAsset',
  'AgentNote',
  'RadarRun',
  'RadarFeedback',
  'RadarSignal',
  'SupportSettings',
  'SupportKnowledgeEntry',
  'SupportConversation',
  'SupportMessage',
  'SupportTicket',
  'SupportInsight',
  'Notification',
  'Site',
  'Audit',
  'AuditPage',
  'AuditFinding',
  'ActionItem',
  'AuditCorrection',
  'VisibilityNote',
  'SiteArticle',
  'SiteWatch',
  'SiteAutomatisation',
  'ReleveRecherche',
  'PromptIA',
  'ReleveIA',
  'PointHebdo',
  'AdsAccount',
  'AdsProfil',
  'AdsCampagne',
  'AdsReleve',
  'AdsRecommandation',
  'AdsAction',
] as const

/*
 * CreatorReport et UnmetRequest n'y figurent pas, et c'est délibéré : comme AiUsage, elles
 * n'existent que pour être lues par l'exploitant, et aucun écran de créateur ne les relit.
 * Une table qu'on ne lit jamais par erreur n'a pas besoin qu'on l'empêche de mal la lire ;
 * l'écriture, elle, tient son identifiant de la session et jamais du navigateur. Le jour où
 * un créateur pourra relire ses propres signalements, elles rejoindront la liste.
 *
 * AuthThrottle est absente pour une raison plus forte encore : elle est écrite avant toute
 * authentification, au moment précis où il n'existe aucune identité à laquelle une politique
 * pourrait se rattacher. Elle ne contient d'ailleurs aucune donnée personnelle — ni adresse
 * visée, ni adresse IP, seulement leur empreinte — et aucun écran ne la relit.
 */

type RoleRow = { role: string; bypassrls: boolean }
type TableRow = { relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean; policies: bigint }

const prisma = new PrismaClient()
const problems: string[] = []

async function main(): Promise<void> {
  const [role] = await prisma.$queryRaw<RoleRow[]>`
    SELECT current_user AS role, rolbypassrls AS bypassrls
    FROM pg_roles WHERE rolname = current_user
  `

  if (role === undefined) {
    problems.push("Impossible d'identifier le rôle de connexion à la base.")
  } else if (role.bypassrls) {
    problems.push(
      `Le rôle « ${role.role} » contourne le Row Level Security (BYPASSRLS). ` +
        "Le cloisonnement entre créateurs ne s'appliquerait pas. " +
        'Connectez l’application avec un rôle sans cet attribut.',
    )
  }

  const tables = await prisma.$queryRaw<TableRow[]>`
    SELECT c.relname,
           c.relrowsecurity,
           c.relforcerowsecurity,
           (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
  `

  const byName = new Map(tables.map((table) => [table.relname, table]))

  for (const name of PROTECTED_TABLES) {
    const table = byName.get(name)
    if (table === undefined) {
      problems.push(`La table « ${name} » est absente : les migrations n'ont pas été appliquées.`)
      continue
    }
    if (!table.relrowsecurity) problems.push(`La table « ${name} » n'a pas le Row Level Security actif.`)
    if (!table.relforcerowsecurity) {
      problems.push(
        `La table « ${name} » n'impose pas le Row Level Security à son propriétaire (FORCE manquant).`,
      )
    }
    if (table.policies === 0n) problems.push(`La table « ${name} » n'a aucune politique d'accès.`)
  }

  if (problems.length > 0) {
    console.error('\n  MISE EN LIGNE INTERROMPUE : le cloisonnement des données n’est pas garanti.\n')
    for (const problem of problems) console.error(`   - ${problem}`)
    console.error('\n  Voir DEPLOIEMENT.md, section « Si quelque chose ne marche pas ».\n')
    process.exitCode = 1
    return
  }

  console.log(
    `Isolation vérifiée : ${PROTECTED_TABLES.length} tables protégées, rôle « ${role?.role} » sans contournement.`,
  )
}

main()
  .catch((error: unknown) => {
    console.error('Vérification de l’isolation impossible :', error)
    process.exitCode = 1
  })
  .finally(() => {
    void prisma.$disconnect()
  })
