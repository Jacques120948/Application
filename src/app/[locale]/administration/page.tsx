import { FEATURES } from "@/server/billing/features";
import { notFound, redirect } from "next/navigation";
import { getTranslator, resolveLocale } from "@/i18n";
import { getCurrentUser } from "@/server/auth/session";
import { getWallet } from "@/server/billing/credits";
import {
  getAdminOverview,
  listAiFailures,
  listFlags,
  listPlans,
  listUsers,
  listModelPricing,
  readAgentLimits,
  readLegalIdentity,
} from "@/server/admin/service";
import { Shell } from "@/components/studio/Shell";
import { Card, CardBody } from "@/components/ui";
import {
  AdminPlan,
  AdminUser,
  LegalIdentityForm,
  AgentLimitsEditor,
  AiPricingEditor,
  FlagEditor,
  PlanEditor,
  UserTable,
} from "@/components/studio/AdminPanels";

/**
 * Back-office.
 *
 * L'accès est refusé par `listPlans` et consorts, qui appellent `requireAdmin`. Un compte
 * ordinaire obtient une page « introuvable », pas un message lui apprenant que cet écran
 * existe.
 */
export default async function AdminPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const user = await getCurrentUser();
  if (user === null) redirect(`/${locale}/connexion`);
  // Page réellement introuvable pour un compte ordinaire : pas d'erreur serveur, et rien
  // qui laisse deviner l'existence du back-office. Les services revérifient ensuite.
  if (user.role !== "ADMIN") notFound();

  const t = getTranslator(locale);
  const [
    overview,
    plans,
    users,
    identity,
    wallet,
    flags,
    failures,
    pricing,
    agentLimits,
  ] = await Promise.all([
    getAdminOverview(),
    listPlans(),
    listUsers({ query: "", take: 50 }),
    readLegalIdentity(),
    getWallet(user.id),
    listFlags(),
    listAiFailures(),
    listModelPricing(),
    readAgentLimits(),
  ]);

  const figures = [
    { label: "Comptes créés", value: overview.users },
    { label: "Abonnements actifs", value: overview.subscriptions },
    { label: "Applications en ligne", value: overview.publishedApps },
    { label: "Offres visibles", value: overview.activePlans },
  ];

  return (
    <Shell
      locale={locale}
      userName={user.name ?? user.email}
      credits={wallet.balance}
      isAdmin={user.role === "ADMIN"}
    >
      <div className="mx-auto w-full max-w-4xl">
        <h1 className="mb-1 text-2xl font-semibold">{t("nav.admin")}</h1>
        <p className="mb-7 text-[var(--color-ink-soft)]">
          Les prix, les limites et les offres se modifient ici. Plus besoin de
          passer par la base de données.
        </p>

        <div className="mb-10 grid gap-4 sm:grid-cols-4">
          {figures.map((figure) => (
            <Card key={figure.label}>
              <CardBody>
                <p className="m-0 text-2xl font-semibold">{figure.value}</p>
                <p className="m-0 mt-1 text-xs text-[var(--color-ink-soft)]">
                  {figure.label}
                </p>
              </CardBody>
            </Card>
          ))}
        </div>

        <h2 className="mb-1 text-lg font-semibold">Santé de l’assistant</h2>
        <p className="mb-4 text-sm text-[var(--color-ink-soft)]">
          Les derniers appels au modèle qui ont échoué, avec la raison donnée
          par le fournisseur. Quand une fonction « ne marche pas », c’est ici
          qu’on regarde d’abord.
        </p>
        <Card className="mb-10">
          <CardBody>
            {failures.length === 0 ? (
              <p className="m-0 text-sm text-[var(--color-ink-soft)]">
                Aucun échec enregistré.
              </p>
            ) : (
              <ul className="m-0 grid list-none gap-3 p-0 text-sm">
                {failures.map((failure) => (
                  <li
                    key={failure.id}
                    className="grid gap-0.5 border-b border-[var(--color-line)] pb-3 last:border-0 last:pb-0"
                  >
                    <span className="flex flex-wrap gap-x-3 gap-y-1">
                      <span className="font-medium">{failure.operation}</span>
                      <span className="text-[var(--color-ink-soft)]">
                        {failure.model}
                      </span>
                      <span className="text-[var(--color-critical)]">
                        {failure.errorCode ?? "inconnu"}
                      </span>
                      <span className="ml-auto text-xs text-[var(--color-ink-faint)]">
                        {new Date(failure.createdAt).toLocaleString("fr-CH")} ·{" "}
                        {failure.email}
                      </span>
                    </span>
                    {failure.errorMessage !== null ? (
                      <code className="block break-words text-xs text-[var(--color-ink-soft)]">
                        {failure.errorMessage}
                      </code>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <h2 className="mb-1 text-lg font-semibold">Votre identité</h2>
        <p className="mb-4 text-sm text-[var(--color-ink-soft)]">
          Ces informations apparaissent sur les mentions légales, les conditions
          d’utilisation et la politique de confidentialité. Elles sont
          obligatoires dès que vous collectez des adresses e-mail.
        </p>
        <LegalIdentityForm identity={identity} />

        <h2 className="mt-12 mb-1 text-lg font-semibold">
          Les fonctions de l’installation
        </h2>
        <p className="mb-4 text-sm text-[var(--color-ink-soft)]">
          Une fonction fermée l’est pour tout le monde, quelle que soit l’offre.
          Ce réglage existe pour celles qui dépendent d’une autorisation
          extérieure : elles s’ouvrent le jour où elle arrive, sans
          redéploiement.
        </p>
        <FlagEditor flags={flags} />

        <h2 className="mt-12 mb-1 text-lg font-semibold">
          Le coût de l’intelligence artificielle
        </h2>
        <p className="mb-4 text-sm text-[var(--color-ink-soft)]">
          Deux choses distinctes. Les tarifs disent ce qu’Evoliia paie à
          Anthropic : ils se recopient depuis leur page de tarifs le jour où
          elle change. La conversion dit ce que le créateur paie à Evoliia :
          c’est une décision commerciale. Tant que rien n’est réglé ici, les
          valeurs du code s’appliquent, et ce sont celles d’aujourd’hui.
        </p>
        <AiPricingEditor
          models={pricing.models}
          multiplier={pricing.multiplier}
          microsPerCredit={pricing.microsPerCredit}
          imageMicros={pricing.imageMicros}
          imageKeyConfigured={pricing.imageKeyConfigured}
        />

        <h2 className="mt-12 mb-1 text-lg font-semibold">
          L’agent de construction
        </h2>
        <p className="mb-4 text-sm text-[var(--color-ink-soft)]">
          L’agent modifie une application en plusieurs étapes : il lit les pages
          concernées avant de décider et corrige ses propres erreurs. Ces bornes
          décident de ce qu’une seule demande peut consommer — c’est le réglage
          le plus sensible de l’installation. L’agent s’ouvre et se ferme plus
          haut, avec les autres fonctions.
        </p>
        <AgentLimitsEditor limits={agentLimits} />

        <h2 className="mt-12 mb-1 text-lg font-semibold">Les offres</h2>
        <p className="mb-4 text-sm text-[var(--color-ink-soft)]">
          Ce que vous changez ici s’applique immédiatement, sans redéploiement.
          L’export du code et la préparation pour mobile n’apparaissent pas :
          ils ne sont pas encore construits, donc aucune offre ne peut les
          promettre.
        </p>
        <PlanEditor
          plans={plans as unknown as AdminPlan[]}
          features={FEATURES.map((feature) => ({
            id: feature.id,
            label: feature.label,
            summary: feature.summary,
            status: feature.status,
          }))}
        />

        <h2 className="mt-12 mb-1 text-lg font-semibold">Les comptes</h2>
        <p className="mb-4 text-sm text-[var(--color-ink-soft)]">
          Les cinquante inscriptions les plus récentes. Attribuer une offre
          remplace la requête SQL qu’il fallait écrire à la main.
        </p>
        <UserTable
          users={users as AdminUser[]}
          plans={plans as unknown as AdminPlan[]}
        />
      </div>
    </Shell>
  );
}
